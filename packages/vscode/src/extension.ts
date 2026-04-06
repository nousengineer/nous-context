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
  PipelineService,
  AGENT_META,
  loadAgentConfig,
  saveAgentConfig,
  setAgentModel,
  applyQualityPreset,
  QUALITY_PRESETS,
  getModelForAgent,
} from '@thinkcoffee/core';
import type { Project, AgentRole, QualityPreset } from '@thinkcoffee/core';
import { ChatViewProvider } from './chat/ChatViewProvider';
import { AgentService } from './agents/AgentService';
import { discoverModels } from './agents/ModelRegistry';
import { SafetyNetPanel } from './views/SafetyNetPanel';
import { SafetyNetIntegration, DryRunManager } from './utils';
import { DryRunStatusBar } from './utils/DryRunStatusBar';
import fs from 'fs';
import path from 'path';
import { getPipelineChatHistoryService } from './chat/PipelineChatHistoryService';
import { ChatPanel } from './chat/ChatPanel';

let projectService: ProjectService;
let contextService: ContextService;
let decisionService: DecisionService;
let pipelineService: PipelineService;
let agentService: AgentService;
let safetyNetIntegration: SafetyNetIntegration;
let dryRunStatusBar: DryRunStatusBar;

/** The project bound to the current workspace (auto-created on activate) */
let activeProject: Project | null = null;

// ─── Helpers ─────────────────────────────────────────────────

/** Get the workspace-bound project. Falls back to pickProject if no workspace. */
async function getProject(): Promise<Project | undefined> {
  if (activeProject) {
    // Refresh to get latest relations
    const fresh = await projectService.get(activeProject.id);
    if (fresh) return fresh;
  }
  return pickProject();
}

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
  try {
    await _activate(context);
  } catch (err: any) {
    // Still register the webview provider so VS Code stops showing "Loading..."
    const errMsg = err?.message || String(err);
    console.error('[ThinkCoffee] Activation failed:', errMsg);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('thinkcoffee.chat', {
        resolveWebviewView(view: vscode.WebviewView) {
          view.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>body{font-family:system-ui;padding:16px;color:#ccc;background:#1e1e1e}
h3{color:#f87171;margin:0 0 8px}p{font-size:13px;line-height:1.5}
code{background:#2d2d2d;padding:2px 6px;border-radius:3px;font-size:12px}
button{margin-top:12px;padding:6px 14px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer}
</style></head><body>
<h3>ThinkCoffee - Erro na inicializacao</h3>
<p>A extensao nao conseguiu inicializar:</p>
<p><code>${errMsg.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></p>
<p>Tente recarregar a janela (<code>Ctrl+Shift+P</code> → <code>Reload Window</code>).</p>
<button onclick="const vscode=acquireVsCodeApi();vscode.postMessage({command:'reload'})">Recarregar</button>
</body></html>`;
          view.webview.onDidReceiveMessage(msg => {
            if (msg.command === 'reload') {
              vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
          });
        },
      })
    );
    vscode.window.showErrorMessage(`ThinkCoffee: ${errMsg}`);
  }
}

async function _activate(context: vscode.ExtensionContext) {
  const db = await getDatabase();
  projectService = new ProjectService(db);
  contextService = new ContextService(db);
  decisionService = new DecisionService(db);
  pipelineService = new PipelineService();

  // Pre-warm model discovery cache (non-blocking)
  discoverModels().catch(() => { });

  // ─── Auto-bind project to workspace ────────────────────────
  const wsRoot = getWorkspaceRoot();
  if (wsRoot) {
    let project = await projectService.findByWorkspace(wsRoot);
    if (!project) {
      // Auto-create a project for this workspace
      const name = path.basename(wsRoot);
      project = await projectService.create({ name, description: `Project for ${name}` });
      await projectService.linkWorkspace(project.id, wsRoot);
      project = await projectService.get(project.id) || project;
    }
    activeProject = project;

    // Initialize Safety Net Integration
    safetyNetIntegration = new SafetyNetIntegration(wsRoot);

    // Run automatic cleanup on activation if enabled
    const autoCleanup = vscode.workspace.getConfiguration('thinkcoffee.safetynet').get<boolean>('autoCleanup', true);
    if (autoCleanup) {
      // Get active pipeline IDs to protect from cleanup
      const activePipelines = new Set<string>();
      if (activeProject) {
        const pipelinesForProject = pipelineService.list(activeProject.id);
        for (const p of pipelinesForProject) {
          if (p.status === 'active' || p.status === 'in-progress') {
            activePipelines.add(p.id);
          }
        }
      }
      safetyNetIntegration.runCleanup(activePipelines).catch(console.error);
    }
  }

  // Status bar — show active project
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBar.command = 'thinkcoffee.openChat';
  if (activeProject) {
    statusBar.text = `$(coffee) ${activeProject.name}`;
    statusBar.tooltip = `ThinkCoffee: ${activeProject.name} (${activeProject.id})`;
  } else {
    statusBar.text = '$(coffee) ThinkCoffee';
    statusBar.tooltip = 'No workspace project';
  }
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Dry-Run Status Bar
  if (safetyNetIntegration) {
    dryRunStatusBar = new DryRunStatusBar(safetyNetIntegration.dryRunManager);
    context.subscriptions.push(dryRunStatusBar);
  }

  // ─── Chat Sidebar (replaces tree views) ─────────────────────
  const chat = new ChatService('default');
  const chatProvider = new ChatViewProvider(
    context.extensionUri,
    chat,
    pipelineService,
    contextService,
    decisionService,
    () => activeProject ? { id: activeProject.id, name: activeProject.name } : null,
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // ─── Agent Service ───────────────────────────────────────────
  agentService = new AgentService(
    () => chatProvider.getActiveChat(),
    (pid) => chatProvider.getChatForPipeline(pid),
    pipelineService,
    contextService,
    decisionService,
    () => activeProject ? { id: activeProject.id, name: activeProject.name } : null,
  );
  chatProvider.setAgentService(agentService);
  context.subscriptions.push({ dispose: () => agentService.dispose() });

  // ─── Resume incomplete pipelines after a short delay ────────
  setTimeout(() => {
    chatProvider.resumeIncomplete();
  }, 3000);

  // Commands
  context.subscriptions.push(

    // ─── Create Project ──────────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.createProject', async () => {
      const root = getWorkspaceRoot();
      const defaultName = root ? path.basename(root) : '';
      const name = await vscode.window.showInputBox({ prompt: 'Project name', value: defaultName });
      if (!name) return;
      const description = await vscode.window.showInputBox({ prompt: 'Project description (optional)' });
      const project = await projectService.create({ name, description: description || undefined });
      // Link to current workspace
      if (root) {
        await projectService.linkWorkspace(project.id, root);
        activeProject = await projectService.get(project.id) || project;
      }
      vscode.window.showInformationMessage(`Project created: ${project.name} (linked to workspace)`);
      chatProvider.refresh();
    }),

    // ─── Add Context ─────────────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.addContext', async () => {
      const project = await getProject();
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
      chatProvider.refresh();
    }),

    // ─── Add File as Context ─────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.addFileAsContext', async (uri?: vscode.Uri) => {
      const fileUri = uri || vscode.window.activeTextEditor?.document.uri;
      if (!fileUri) {
        vscode.window.showWarningMessage('No file selected or open.');
        return;
      }

      const project = await getProject();
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
      chatProvider.refresh();
    }),

    // ─── Add Selection as Context ────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.addSelectionAsContext', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage('No text selected.');
        return;
      }

      const project = await getProject();
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
      chatProvider.refresh();
    }),

    // ─── Add Workspace Structure as Context ──────────────────
    vscode.commands.registerCommand('thinkcoffee.addStructureAsContext', async () => {
      const root = getWorkspaceRoot();
      if (!root) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      const project = await getProject();
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
      chatProvider.refresh();
    }),

    // ─── Add Decision ────────────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.addDecision', async () => {
      const project = await getProject();
      if (!project) return;

      const title = await vscode.window.showInputBox({ prompt: 'Decision title' });
      if (!title) return;

      const description = await vscode.window.showInputBox({ prompt: 'What was decided and why?' });
      if (!description) return;

      await decisionService.create({ projectId: project.id, title, description });
      vscode.window.showInformationMessage(`Decision recorded: ${title}`);
      chatProvider.refresh();
    }),

    // ─── Sync Context ────────────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.syncContext', async () => {
      const project = await getProject();
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
      const project = await getProject();
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

    // ─── Open Chat (focus sidebar) ─────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.openChat', () => {
      vscode.commands.executeCommand('thinkcoffee.chat.focus');
    }),

    // --- Open Pipeline Chat History ---
    vscode.commands.registerCommand('thinkcoffee.openPipelineChat', (pipelineId: string) => {
      if (!pipelineId) {
        vscode.window.showWarningMessage('ID do Pipeline nao fornecido.');
        return;
      }
      const historyService = getPipelineChatHistoryService();
      const chatService = historyService.getChatForPipeline(pipelineId);
      ChatPanel.create(context.extensionUri, chatService);
    }),

    // ─── Context commands (kept for editor/explorer menus) ───
    vscode.commands.registerCommand('thinkcoffee.openContextFile', async () => {
      // No-op without tree items — context is in the chat now
    }),
    vscode.commands.registerCommand('thinkcoffee.viewContext', async () => { }),

    // ─── Pipeline: Create ────────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.createPipeline', async () => {
      const project = await getProject();
      if (!project) return;

      const objective = await vscode.window.showInputBox({
        prompt: 'What should be built? (objective)',
        placeHolder: 'e.g. criar sistema de login com OAuth',
      });
      if (!objective) return;

      const ws = getWorkspaceRoot() || '';
      const p = pipelineService.create(project.id, objective, ws);
      vscode.window.showInformationMessage(`Pipeline created: ${p.objective}`);
      chatProvider.refresh();
    }),

    // ─── Pipeline: Approve Phase ─────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.approvePhase', async () => {
      const project = await getProject();
      if (!project) return;
      const active = pipelineService.getActive(project.id);
      if (!active) { vscode.window.showWarningMessage('No active pipeline.'); return; }

      const p = pipelineService.approvePhase(project.id, active.id);
      if (!p) return;

      const nextPhase = p.phases[p.currentPhase];
      const msg = p.status === 'completed'
        ? 'Pipeline completed! All phases done.'
        : `Approved! Next: ${nextPhase.name} (${nextPhase.agents.map(a => AGENT_META[a].label).join(', ')})`;
      vscode.window.showInformationMessage(msg);
      chatProvider.refresh();
    }),

    // ─── Pipeline: Reject Phase ──────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.rejectPhase', async () => {
      const project = await getProject();
      if (!project) return;
      const active = pipelineService.getActive(project.id);
      if (!active) { vscode.window.showWarningMessage('No active pipeline.'); return; }

      const feedback = await vscode.window.showInputBox({
        prompt: 'Feedback for the agents (what needs to change)',
        placeHolder: 'Explain what needs to improvement...',
      });
      if (!feedback) return;

      pipelineService.rejectPhase(project.id, active.id, feedback);
      vscode.window.showInformationMessage('Phase rejected. Agents will redo with your feedback.');
      chatProvider.refresh();
    }),

    // ─── Pipeline: View Task Output (no-op, shown in chat) ──
    vscode.commands.registerCommand('thinkcoffee.viewTaskOutput', () => { }),

    // ─── Pipeline: Refresh ───────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.refreshPipeline', () => chatProvider.refresh()),
    vscode.commands.registerCommand('thinkcoffee.refreshProjects', () => chatProvider.refresh()),

    // ─── Open Another Project in New Window ──────────────────
    vscode.commands.registerCommand('thinkcoffee.openOtherProject', async () => {
      const all = await projectService.list();
      const others = all.filter(p => !activeProject || p.id !== activeProject.id);
      if (!others.length) {
        vscode.window.showInformationMessage('No other projects. Each workspace creates its own project.');
        return;
      }

      const selected = await vscode.window.showQuickPick(
        others.map(p => {
          const ws = (p.metadata as any)?.workspace;
          return {
            label: p.name,
            description: ws ? path.basename(ws) : 'no workspace',
            detail: ws || 'Not linked to a folder',
            workspace: ws as string | undefined,
          };
        }),
        { placeHolder: 'Select a project to open in a new window' }
      );
      if (!selected) return;

      if (selected.workspace && fs.existsSync(selected.workspace)) {
        const uri = vscode.Uri.file(selected.workspace);
        await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
      } else {
        vscode.window.showWarningMessage(`Project "${selected.label}" has no linked workspace folder.`);
      }
    }),

    // ─── Configure Agent Models ──────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.configureAgentModels', async () => {
      const config = loadAgentConfig();
      const presetKeys = Object.keys(QUALITY_PRESETS) as QualityPreset[];

      const modeChoice = await vscode.window.showQuickPick([
        // Quality presets first
        ...presetKeys.map(key => {
          const p = QUALITY_PRESETS[key];
          return {
            label: p.label,
            description: p.subtitle,
            detail: p.description,
            value: key as string,
          };
        }),
        // Then auto mode
        {
          label: 'Auto',
          description: 'Let PM choose models for each agent',
          detail: 'The Product Manager agent will analyze the objective and assign optimal models',
          value: 'auto',
        },
        // Then direct model config
        {
          label: 'Manual',
          description: 'Choose model for each agent manually',
          detail: 'Set a specific model for any agent role',
          value: 'manual',
        },
      ], { placeHolder: 'Select mode or preset' });

      if (!modeChoice) return;

      if (modeChoice.value === 'manual') {
        // Manual: pick an agent, then a model
        const roles = Object.keys(AGENT_META) as AgentRole[];
        const agentPick = await vscode.window.showQuickPick(
          roles.map(r => ({ label: AGENT_META[r].label, description: r, role: r })),
          { placeHolder: 'Which agent to configure?' }
        );
        if (!agentPick) return;

        const modelPick = await vscode.window.showInputBox({
          prompt: `Model for ${agentPick.label}`,
          value: getModelForAgent(agentPick.role, config),
          placeHolder: 'e.g. claude-sonnet-4-20250514, gpt-4.1, gemini-2.5-pro',
        });
        if (!modelPick) return;

        setAgentModel(agentPick.role, modelPick);
        vscode.window.showInformationMessage(`${agentPick.label} now uses ${modelPick}`);
      } else if (modeChoice.value === 'auto') {
        saveAgentConfig({ ...config, mode: 'auto' });
        vscode.window.showInformationMessage('Mode: Auto — PM will assign models when running pipelines.');
      } else {
        // Apply a quality preset
        applyQualityPreset(modeChoice.value as QualityPreset);
        const preset = QUALITY_PRESETS[modeChoice.value as QualityPreset];
        vscode.window.showInformationMessage(`Preset applied: ${preset.label}`);
      }

      chatProvider.refresh();
    }),

    // ═══════════════════════════════════════════════════════════
    // SAFETY NET COMMANDS
    // ═══════════════════════════════════════════════════════════

    // ─── Toggle Dry-Run Mode ─────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.toggleDryRun', () => {
      if (!safetyNetIntegration) {
        vscode.window.showWarningMessage('Safety Net nao disponivel - abra um workspace primeiro.');
        return;
      }
      safetyNetIntegration.toggleDryRun();
    }),

    // ─── Open Safety Net Panel ───────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.openSafetyNet', () => {
      const wsRoot = getWorkspaceRoot();
      if (!wsRoot) {
        vscode.window.showWarningMessage('Nenhum workspace aberto.');
        return;
      }

      // Tentar obter pipeline ativo
      let pipelineId: string | undefined;
      if (activeProject) {
        const active = pipelineService.getActive(activeProject.id);
        if (active) {
          pipelineId = active.id;
        }
      }

      SafetyNetPanel.createOrShow(context.extensionUri, wsRoot, pipelineId);
    }),

    // ─── Rollback Phase ──────────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.rollback', async () => {
      if (!safetyNetIntegration) {
        vscode.window.showWarningMessage('Safety Net nao disponivel.');
        return;
      }

      const project = await getProject();
      if (!project) return;

      const active = pipelineService.getActive(project.id);
      if (!active) {
        vscode.window.showWarningMessage('Nenhum pipeline ativo.');
        return;
      }

      // Perguntar qual fase reverter
      const phases = active.phases.map((p, i) => ({
        label: `Fase ${i}: ${p.name}`,
        description: p.status,
        phaseIndex: i,
      }));

      const selected = await vscode.window.showQuickPick(phases, {
        placeHolder: 'Selecione a fase para reverter',
      });

      if (!selected) return;

      const chat = chatProvider.getActiveChat();
      await safetyNetIntegration.executeRollback(
        active.id,
        selected.phaseIndex,
        chat,
        pipelineService,
        project.id
      );

      chatProvider.refresh();
    }),

    // ─── List Snapshots ──────────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.listSnapshots', async () => {
      if (!safetyNetIntegration) {
        vscode.window.showWarningMessage('Safety Net nao disponivel.');
        return;
      }

      const project = await getProject();
      if (!project) return;

      const active = pipelineService.getActive(project.id);
      if (!active) {
        vscode.window.showWarningMessage('Nenhum pipeline ativo.');
        return;
      }

      const chat = chatProvider.getActiveChat();
      await safetyNetIntegration.listSnapshots(active.id, chat);
    }),

    // ─── Cleanup Snapshots ───────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.cleanupSnapshots', async () => {
      if (!safetyNetIntegration) {
        vscode.window.showWarningMessage('Safety Net nao disponivel.');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        'Tem certeza que deseja limpar snapshots antigos?',
        { modal: true },
        'Sim, limpar',
        'Cancelar'
      );

      if (confirm !== 'Sim, limpar') return;

      // Coletar pipelines ativos
      const activePipelines = new Set<string>();
      if (activeProject) {
        const allPipelines = pipelineService.list(activeProject.id);
        for (const p of allPipelines) {
          if (p.status === 'active' || p.status === 'in-progress') {
            activePipelines.add(p.id);
          }
        }
      }

      await safetyNetIntegration.runCleanup(activePipelines);
    }),

  ); // End of commands
}

export function deactivate() {
  // Cleanup is handled by disposal
}
