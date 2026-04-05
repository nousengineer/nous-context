import * as vscode from 'vscode';
import {
  getDatabase,
  ProjectService,
  ContextService,
  DecisionService,
  exportProject,
  getExportFilename,
  ExportFormat,
  ChatService,
} from '@thinkcoffee/core';
import type { Project, ContextEntry, Decision } from '@thinkcoffee/core';
import { ChatPanel } from './chat/ChatPanel';
import fs from 'fs';
import path from 'path';

let projectService: ProjectService;
let contextService: ContextService;
let decisionService: DecisionService;

// ─── Helpers ─────────────────────────────────────────────────
async function pickProject(): Promise<Project | undefined> {
  const projects = await projectService.list();
  if (!projects.length) {
    vscode.window.showWarningMessage('No ThinkCoffee projects yet. Create one first.');
    return;
  }
  const selected = await vscode.window.showQuickPick(
    projects.map(p => ({ label: p.name, description: p.id, detail: p.description || '', project: p })),
    { placeHolder: 'Select a project' }
  );
  return selected ? await projectService.get(selected.description!) || undefined : undefined;
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Get relative path of a file from workspace root */
function relPath(absPath: string): string {
  const root = getWorkspaceRoot();
  if (!root) return absPath;
  return path.relative(root, absPath).replace(/\\/g, '/');
}

export async function activate(context: vscode.ExtensionContext) {
  const db = await getDatabase();
  projectService = new ProjectService(db);
  contextService = new ContextService(db);
  decisionService = new DecisionService(db);

  // Tree data providers
  const projectProvider = new ProjectTreeProvider();
  vscode.window.registerTreeDataProvider('thinkcoffee.projects', projectProvider);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('thinkcoffee.refreshProjects', () => projectProvider.refresh()),

    // ─── Create Project ──────────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.createProject', async () => {
      const root = getWorkspaceRoot();
      const defaultName = root ? path.basename(root) : '';
      const name = await vscode.window.showInputBox({ prompt: 'Project name', value: defaultName });
      if (!name) return;
      const description = await vscode.window.showInputBox({ prompt: 'Project description (optional)' });
      const project = await projectService.create({ name, description: description || undefined });
      vscode.window.showInformationMessage(`Project created: ${project.name} (${project.id})`);
      projectProvider.refresh();
    }),

    // ─── Add Context ─────────────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.addContext', async () => {
      const project = await pickProject();
      if (!project) return;

      const key = await vscode.window.showInputBox({ prompt: 'Context key (short label)' });
      if (!key) return;

      const value = await vscode.window.showInputBox({ prompt: 'Context value' });
      if (!value) return;

      const category = await vscode.window.showQuickPick(
        ['architecture', 'requirements', 'dependencies', 'standards', 'general'],
        { placeHolder: 'Category' }
      );
      if (!category) return;

      await contextService.create({ projectId: project.id, key, value, category });
      vscode.window.showInformationMessage(`Context added: [${category}] ${key}`);
      projectProvider.refresh();
    }),

    // ─── Add File as Context ─────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.addFileAsContext', async (uri?: vscode.Uri) => {
      const fileUri = uri || vscode.window.activeTextEditor?.document.uri;
      if (!fileUri) {
        vscode.window.showWarningMessage('No file selected or open.');
        return;
      }

      const project = await pickProject();
      if (!project) return;

      const doc = await vscode.workspace.openTextDocument(fileUri);
      const content = doc.getText();
      const rel = relPath(fileUri.fsPath);
      const lang = doc.languageId;

      const key = await vscode.window.showInputBox({
        prompt: 'Context key',
        value: `file:${rel}`,
      });
      if (!key) return;

      const category = await vscode.window.showQuickPick(
        ['architecture', 'requirements', 'dependencies', 'standards', 'general'],
        { placeHolder: 'Category' }
      );
      if (!category) return;

      const value = `File: \`${rel}\` (${lang})\n\n\`\`\`${lang}\n${content}\n\`\`\``;
      await contextService.create({ projectId: project.id, key, value, category, priority: 2 });
      vscode.window.showInformationMessage(`File added as context: ${rel}`);
      projectProvider.refresh();
    }),

    // ─── Add Selection as Context ────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.addSelectionAsContext', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage('No text selected.');
        return;
      }

      const project = await pickProject();
      if (!project) return;

      const selection = editor.document.getText(editor.selection);
      const rel = relPath(editor.document.uri.fsPath);
      const lang = editor.document.languageId;
      const startLine = editor.selection.start.line + 1;
      const endLine = editor.selection.end.line + 1;

      const key = await vscode.window.showInputBox({
        prompt: 'Context key',
        value: `${rel}:L${startLine}-L${endLine}`,
      });
      if (!key) return;

      const category = await vscode.window.showQuickPick(
        ['architecture', 'requirements', 'dependencies', 'standards', 'general'],
        { placeHolder: 'Category' }
      );
      if (!category) return;

      const value = `From \`${rel}\` lines ${startLine}-${endLine} (${lang}):\n\n\`\`\`${lang}\n${selection}\n\`\`\``;
      await contextService.create({ projectId: project.id, key, value, category, priority: 2 });
      vscode.window.showInformationMessage(`Selection added as context: ${key}`);
      projectProvider.refresh();
    }),

    // ─── Add Workspace Structure as Context ──────────────────
    vscode.commands.registerCommand('thinkcoffee.addStructureAsContext', async () => {
      const root = getWorkspaceRoot();
      if (!root) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      const project = await pickProject();
      if (!project) return;

      const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'coverage', '.cache', 'target']);
      const lines: string[] = [path.basename(root) + '/'];

      function tree(dir: string, prefix: string, depth: number) {
        if (depth >= 4) return;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        entries.sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        const filtered = entries.filter(e => !IGNORE.has(e.name) && !e.name.startsWith('.'));
        for (let i = 0; i < filtered.length; i++) {
          const entry = filtered[i];
          const isLast = i === filtered.length - 1;
          const connector = isLast ? '`-- ' : '|-- ';
          const child = isLast ? '    ' : '|   ';
          if (entry.isDirectory()) {
            lines.push(`${prefix}${connector}${entry.name}/`);
            tree(path.join(dir, entry.name), prefix + child, depth + 1);
          } else {
            lines.push(`${prefix}${connector}${entry.name}`);
          }
        }
      }
      tree(root, '', 0);
      const structure = lines.join('\n');

      await contextService.create({
        projectId: project.id,
        key: 'project-structure',
        value: `Workspace directory tree:\n\n\`\`\`\n${structure}\n\`\`\``,
        category: 'architecture',
        priority: 3,
      });
      vscode.window.showInformationMessage('Workspace structure added as context.');
      projectProvider.refresh();
    }),

    // ─── Add Decision ────────────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.addDecision', async () => {
      const project = await pickProject();
      if (!project) return;

      const title = await vscode.window.showInputBox({ prompt: 'Decision title' });
      if (!title) return;

      const description = await vscode.window.showInputBox({ prompt: 'What was decided and why?' });
      if (!description) return;

      await decisionService.create({ projectId: project.id, title, description });
      vscode.window.showInformationMessage(`Decision recorded: ${title}`);
      projectProvider.refresh();
    }),

    // ─── Sync Context ────────────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.syncContext', async () => {
      const project = await pickProject();
      if (!project) return;

      const workspaceRoot = getWorkspaceRoot();
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      const formats: ExportFormat[] = ['copilot', 'claude', 'cursor'];
      const written: string[] = [];

      for (const format of formats) {
        const content = exportProject(project, format);
        const targetPath = path.join(workspaceRoot, getExportFilename(format, project.name));
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(targetPath, content, 'utf-8');
        written.push(getExportFilename(format, project.name));
      }

      vscode.window.showInformationMessage(`Synced: ${written.join(', ')}`);
    }),

    // ─── Export Context ──────────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.exportContext', async () => {
      const project = await pickProject();
      if (!project) return;

      const format = await vscode.window.showQuickPick(
        ['markdown', 'json', 'plain', 'copilot', 'claude', 'cursor'],
        { placeHolder: 'Export format' }
      ) as ExportFormat | undefined;
      if (!format) return;

      const content = exportProject(project, format);
      const doc = await vscode.workspace.openTextDocument({ content, language: format === 'json' ? 'json' : 'markdown' });
      await vscode.window.showTextDocument(doc);
    }),

    // ─── Open Chat ───────────────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.openChat', () => {
      const chat = new ChatService('default');
      ChatPanel.create(context.extensionUri, chat);
    }),

    // ─── Open File from Context ──────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.openContextFile', async (item?: ContextTreeItem) => {
      if (!item?.entry) return;
      // Extract file path from context value like "File: `src/foo.ts`..."
      const match = item.entry.value.match(/(?:File|From)\s*:\s*`([^`]+)`/);
      if (!match) {
        // Show context as text
        const doc = await vscode.workspace.openTextDocument({ content: item.entry.value, language: 'markdown' });
        await vscode.window.showTextDocument(doc);
        return;
      }
      const root = getWorkspaceRoot();
      if (!root) return;
      const abs = path.join(root, match[1]);
      if (fs.existsSync(abs)) {
        const doc = await vscode.workspace.openTextDocument(abs);
        await vscode.window.showTextDocument(doc);
      } else {
        vscode.window.showWarningMessage(`File not found: ${match[1]}`);
      }
    })
  );
}

export function deactivate() {}

// --- Tree Data Provider ---

type TreeNode = ProjectTreeItem | SectionTreeItem | ContextTreeItem | DecisionTreeItem;

class ProjectTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChange = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  refresh() { this._onDidChange.fire(undefined); }

  async getTreeItem(element: TreeNode) { return element; }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      const projects = await projectService.list();
      return projects.map(p => new ProjectTreeItem(p));
    }

    if (element instanceof ProjectTreeItem) {
      const items: SectionTreeItem[] = [];
      const ctxCount = element.project.contextEntries?.length || 0;
      const decCount = element.project.decisions?.length || 0;
      items.push(new SectionTreeItem('context', `Context (${ctxCount})`, element.project));
      items.push(new SectionTreeItem('decisions', `Decisions (${decCount})`, element.project));
      return items;
    }

    if (element instanceof SectionTreeItem) {
      if (element.section === 'context') {
        return (element.project.contextEntries || [])
          .sort((a, b) => b.priority - a.priority)
          .map(e => new ContextTreeItem(e));
      }
      if (element.section === 'decisions') {
        return (element.project.decisions || [])
          .map(d => new DecisionTreeItem(d));
      }
    }

    return [];
  }
}

class ProjectTreeItem extends vscode.TreeItem {
  constructor(public readonly project: Project) {
    super(project.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = project.status;
    this.tooltip = project.description || project.name;
    this.contextValue = 'project';
  }
}

class SectionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly section: 'context' | 'decisions',
    label: string,
    public readonly project: Project
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = `section-${section}`;
  }
}

class ContextTreeItem extends vscode.TreeItem {
  constructor(public readonly entry: ContextEntry) {
    super(`[${entry.category}] ${entry.key}`, vscode.TreeItemCollapsibleState.None);
    const isFile = /(?:File|From)\s*:\s*`[^`]+`/.test(entry.value);
    this.description = `P${entry.priority}` + (isFile ? ' (file)' : '');
    this.tooltip = entry.value.substring(0, 300);
    this.contextValue = isFile ? 'context-file' : 'context';
    if (isFile) {
      this.command = {
        command: 'thinkcoffee.openContextFile',
        title: 'Open File',
        arguments: [this],
      };
    }
  }
}

class DecisionTreeItem extends vscode.TreeItem {
  constructor(public readonly decision: Decision) {
    super(decision.title, vscode.TreeItemCollapsibleState.None);
    this.description = `[${decision.status}]`;
    this.tooltip = decision.description;
    this.contextValue = 'decision';
  }
}
