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
  AVAILABLE_MODELS,
  DEFAULT_AGENT_MODELS,
  QUALITY_PRESETS,
} from '@thinkcoffee/core';
import type { Project, AgentRole, QualityPreset } from '@thinkcoffee/core';
import { ChatViewProvider } from './chat/ChatViewProvider';
import { AgentService } from './agents/AgentService';
import fs from 'fs';
import path from 'path';

let projectService: ProjectService;
let contextService: ContextService;
let decisionService: DecisionService;
let pipelineService: PipelineService;
let agentService: AgentService;

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
  const db = await getDatabase();
  projectService = new ProjectService(db);
  contextService = new ContextService(db);
  decisionService = new DecisionService(db);
  pipelineService = new PipelineService();

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
    pipelineService,
    contextService,
    decisionService,
    () => activeProject ? { id: activeProject.id, name: activeProject.name } : null,
  );
  chatProvider.setAgentService(agentService);
  context.subscriptions.push({ dispose: () => agentService.dispose() });

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

    // ─── Context commands (kept for editor/explorer menus) ───
    vscode.commands.registerCommand('thinkcoffee.openContextFile', async () => {
      // No-op without tree items — context is in the chat now
    }),
    vscode.commands.registerCommand('thinkcoffee.viewContext', async () => {}),

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
        placeHolder: 'Explain what needs improvement...',
      });
      if (!feedback) return;

      pipelineService.rejectPhase(project.id, active.id, feedback);
      vscode.window.showInformationMessage('Phase rejected. Agents will redo with your feedback.');
      chatProvider.refresh();
    }),

    // ─── Pipeline: View Task Output (no-op, shown in chat) ──
    vscode.commands.registerCommand('thinkcoffee.viewTaskOutput', () => {}),

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
        // Separator
        { label: '', description: '', detail: '', value: '', kind: vscode.QuickPickItemKind.Separator } as any,
        // Manual / Auto
        { label: 'Manual', description: 'Voce escolhe o modelo de cada agente, um por um', value: 'manual' },
        { label: 'Auto (PM Opus decide)', description: 'O PM (Opus 4.6) analisa o pipeline e atribui modelos', value: 'auto' },
      ], { placeHolder: 'Escolha o modo de qualidade do cafe', matchOnDetail: true });
      if (!modeChoice || !modeChoice.value) return;

      // Quality preset
      if (modeChoice.value in QUALITY_PRESETS) {
        const preset = modeChoice.value as QualityPreset;
        const applied = applyQualityPreset(preset);
        const p = QUALITY_PRESETS[preset];

        const roles: AgentRole[] = ['product-manager', 'architect', 'backend', 'frontend', 'devops', 'qa', 'code-review'];
        const lines = roles.map(r => {
          const model = applied.models[r];
          const locked = r === 'product-manager' ? ' (obrigatorio)' : '';
          return `- **${AGENT_META[r].label}**: \`${model}\`${locked}`;
        });

        chat.send({
          sender: 'system',
          senderLabel: 'Config',
          content: `**${p.label}** — ${p.subtitle}\n\n${p.description}\n\n${lines.join('\n')}`,
          type: 'info',
        });
        chatProvider.refresh();
        vscode.window.showInformationMessage(`Modo "${p.label}" ativado.`);
        return;
      }

      // Auto mode
      if (modeChoice.value === 'auto') {
        config.mode = 'auto';
        saveAgentConfig(config);

        const project = activeProject;
        if (project) {
          const pipeline = pipelineService.getActive(project.id);
          if (pipeline) {
            await agentService.autoAssignModels(pipeline);
          } else {
            vscode.window.showInformationMessage(
              'Modo auto ativado. O PM atribuira modelos quando um pipeline for criado.'
            );
          }
        }
        chatProvider.refresh();
        return;
      }

      // Manual mode — let user pick model for each agent
      const roles: AgentRole[] = ['product-manager', 'architect', 'backend', 'frontend', 'devops', 'qa', 'code-review'];

      for (const role of roles) {
        if (role === 'product-manager') continue; // Always opus

        const currentModel = config.models[role] || DEFAULT_AGENT_MODELS[role];
        const items = AVAILABLE_MODELS.map(m => ({
          label: m.label,
          description: `${m.family} (${m.tier})`,
          picked: m.family === currentModel,
          family: m.family,
        }));

        const pick = await vscode.window.showQuickPick(items, {
          placeHolder: `Modelo para ${AGENT_META[role].label} (atual: ${currentModel})`,
        });
        if (!pick) continue;

        setAgentModel(role, pick.family);
      }

      chatProvider.refresh();
      vscode.window.showInformationMessage('Modelos dos agentes configurados.');
    }),

    // ─── Run Current Phase ───────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.runPhase', async () => {
      const project = await getProject();
      if (!project) return;

      const active = pipelineService.getActive(project.id);
      if (!active) {
        vscode.window.showWarningMessage('Nenhum pipeline ativo.');
        return;
      }

      const phase = active.phases[active.currentPhase];
      if (!phase || phase.status !== 'in-progress') {
        vscode.window.showWarningMessage('Fase atual nao esta em andamento.');
        return;
      }

      // Auto-assign models if in auto mode
      const config = loadAgentConfig();
      if (config.mode === 'auto') {
        await agentService.autoAssignModels(active);
      }

      agentService.runPhase(project.id, active.id);
    }),

    // ─── Stop All Agents ─────────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.stopAgents', () => {
      agentService.stopAll();
      vscode.window.showInformationMessage('Todos os agentes foram parados.');
      chatProvider.refresh();
    }),

    // ─── Invoke Single Agent ─────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.invokeAgent', async () => {
      const roles: AgentRole[] = ['product-manager', 'architect', 'backend', 'frontend', 'devops', 'qa', 'code-review'];
      const config = loadAgentConfig();

      const pick = await vscode.window.showQuickPick(
        roles.map(r => ({
          label: AGENT_META[r].label,
          description: `${config.models[r] || DEFAULT_AGENT_MODELS[r]}`,
          detail: AGENT_META[r].description,
          role: r,
        })),
        { placeHolder: 'Qual agente invocar?' }
      );
      if (!pick) return;

      const message = await vscode.window.showInputBox({
        prompt: `Mensagem para ${pick.label}`,
        placeHolder: 'O que voce precisa que esse agente faca...',
      });
      if (!message) return;

      chat.send({
        sender: 'programmer',
        senderLabel: 'You',
        content: `@${pick.role} ${message}`,
        type: 'request',
        mentions: [pick.role],
      });
      chatProvider.refresh();
      agentService.invokeAgent(pick.role, message);
    }),

    // ─── View Agent Models ───────────────────────────────────
    vscode.commands.registerCommand('thinkcoffee.viewAgentModels', () => {
      const config = loadAgentConfig();
      const roles: AgentRole[] = ['product-manager', 'architect', 'backend', 'frontend', 'devops', 'qa', 'code-review'];
      const lines = roles.map(r => {
        const model = config.models[r] || DEFAULT_AGENT_MODELS[r];
        const locked = r === 'product-manager' ? ' (obrigatorio)' : '';
        return `- **${AGENT_META[r].label}**: \`${model}\`${locked}`;
      });
      const presetLabel = (QUALITY_PRESETS as any)[config.mode]?.label;
      const modeLabel = presetLabel ? `**${presetLabel}** (${config.mode})` : `**${config.mode}**`;
      chat.send({
        sender: 'system',
        senderLabel: 'Config',
        content: `Modo: ${modeLabel}\n\n${lines.join('\n')}`,
        type: 'info',
      });
      chatProvider.refresh();
    }),
  );
}

export function deactivate() {}