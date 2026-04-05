import * as vscode from 'vscode';
import { ChatService, PipelineService, ContextService, DecisionService, AGENT_META, loadAgentConfig, saveAgentConfig, getModelForAgent, applyQualityPreset, isQualityPreset, DEFAULT_AGENT_MODELS, QUALITY_PRESETS } from '@thinkcoffee/core';
import type { ChatMessage, Pipeline, AgentRole } from '@thinkcoffee/core';
import type { AgentService } from '../agents/AgentService';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface ActiveProjectRef {
  id: string;
  name: string;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'thinkcoffee.chat';

  private _view?: vscode.WebviewView;
  private _chat: ChatService;
  private _pipelines: PipelineService;
  private _contexts: ContextService;
  private _decisions: DecisionService;
  private _getProject: () => ActiveProjectRef | null;
  private _agentService: AgentService | null = null;
  private _stopWatch: (() => void) | null = null;
  private _pipelineRefreshTimer?: ReturnType<typeof setInterval>;

  /** Per-pipeline chat channels (lazy) */
  private _pipelineChats = new Map<string, ChatService>();
  /** Currently viewed pipeline ID (null = list view) */
  private _activePipelineId: string | null = null;
  /** Auto-approve phases without user confirmation */
  private _autoApprove = true;

  /** Returns the chat service for the active pipeline (or global default) */
  private get _activeChat(): ChatService {
    if (this._activePipelineId) {
      return this._getOrCreatePipelineChat(this._activePipelineId);
    }
    return this._chat;
  }

  constructor(
    private readonly _extensionUri: vscode.Uri,
    chat: ChatService,
    pipelines: PipelineService,
    contexts: ContextService,
    decisions: DecisionService,
    getProject: () => ActiveProjectRef | null,
  ) {
    this._chat = chat;
    this._pipelines = pipelines;
    this._contexts = contexts;
    this._decisions = decisions;
    this._getProject = getProject;
  }

  setAgentService(service: AgentService) {
    this._agentService = service;
    service.onAgentStateChange(() => this._sendState());
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtml();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case 'send': this._handleMessage(msg.text); break;
        case 'ready': this._sendState(); break;
        case 'clear': this._activeChat.clear(); this._sendState(); break;
        case 'approve': this._approvePhase(); break;
        case 'reject': this._rejectPhase(msg.feedback); break;
        case 'createPipeline': this._createPipeline(msg.objective); break;
        case 'refreshPipeline': this._sendState(); break;
        case 'changeMode': this._changeMode(msg.mode); break;
        case 'setAutoApprove': this._autoApprove = !!msg.enabled; break;
        case 'switchPipeline': this._switchToPipeline(msg.pipelineId); break;
        case 'retryPipeline': this._retryPipelineById(msg.pipelineId); break;
        case 'backToList': this._backToList(); break;
        case 'newPipeline': this._promptNewPipeline(); break;
      }
    });

    // Watch chat for external messages (from MCP / Claude Desktop)
    this._stopWatch = this._chat.watch(() => this._sendState());

    // Poll pipeline state every 3s
    this._pipelineRefreshTimer = setInterval(() => this._sendPipelineState(), 3000);

    webviewView.onDidDispose(() => {
      if (this._stopWatch) this._stopWatch();
      if (this._pipelineRefreshTimer) clearInterval(this._pipelineRefreshTimer);
    });
  }

  /** Force refresh from outside */
  refresh() { this._sendState(); }

  /** Resume any incomplete pipelines — called once on activation */
  async resumeIncomplete() {
    const project = this._getProject();
    if (!project || !this._agentService) return;

    // First try to resume active (interrupted) pipelines
    const active = this._pipelines.getActive(project.id);
    if (active) {
      const currentPhase = active.phases[active.currentPhase];
      if (currentPhase) {
        this._switchToPipeline(active.id);

        if (!this._agentService.isPipelineLoopActive(active.id)) {
          if (currentPhase.status === 'in-progress') {
            this._pipelines.resetStaleTasks(project.id, active.id);
          }

          this._activeChat.send({
            sender: 'system',
            senderLabel: 'Pipeline',
            content: `Retomando pipeline: **${active.objective}**\nFase atual: **${currentPhase.name}** (${currentPhase.status})`,
            type: 'info',
          });

          const config = loadAgentConfig();
          if (config.mode === 'auto' || isQualityPreset(config.mode)) {
            await this._agentService.autoAssignModels(active);
          }

          this._agentService.runPipeline(project.id, active.id);
        }
      }
      return; // Active pipeline takes priority
    }

    // Then resume failed pipelines
    const failed = this._pipelines.getFailed(project.id);
    for (const pipeline of failed) {
      if (this._agentService.isPipelineLoopActive(pipeline.id)) continue;
      await this._resumeAndRunPipeline(project.id, pipeline);
    }
  }

  /** Expose active chat for AgentService to write to */
  getActiveChat(): ChatService { return this._activeChat; }

  getActivePipelineId(): string | null { return this._activePipelineId; }

  getChatForPipeline(pipelineId: string): ChatService {
    return this._getOrCreatePipelineChat(pipelineId);
  }

  /** Change quality preset mode from webview dropdown */
  private _changeMode(mode: string) {
    if (mode === 'auto') {
      const config = loadAgentConfig();
      config.mode = 'auto';
      saveAgentConfig(config);
      this._activeChat.send({
        sender: 'system',
        senderLabel: 'Sistema',
        content: 'Modo alterado para **Auto** — PM escolhe livremente os modelos para cada agente.',
        type: 'info',
      });
      this._sendState();
      return;
    }
    const presets = ['cafe-soluvel', 'coado-com-carinho', 'espresso-duplo'] as const;
    if (presets.includes(mode as any)) {
      applyQualityPreset(mode as any);
      this._activeChat.send({
        sender: 'system',
        senderLabel: 'Sistema',
        content: `Modo alterado para **${QUALITY_PRESETS[mode as keyof typeof QUALITY_PRESETS].label}** — ${QUALITY_PRESETS[mode as keyof typeof QUALITY_PRESETS].subtitle}`,
        type: 'info',
      });
      this._sendState();
    }
  }

  // ─── Pipeline navigation ──────────────────────────────────

  private _getOrCreatePipelineChat(pipelineId: string): ChatService {
    let chat = this._pipelineChats.get(pipelineId);
    if (!chat) {
      chat = new ChatService(`pipeline-${pipelineId}`);
      this._pipelineChats.set(pipelineId, chat);
    }
    return chat;
  }

  private _switchToPipeline(pipelineId: string) {
    // Swap watcher to new pipeline chat
    if (this._stopWatch) this._stopWatch();
    this._activePipelineId = pipelineId;
    const chat = this._getOrCreatePipelineChat(pipelineId);
    this._stopWatch = chat.watch(() => this._sendState());
    this._sendState();
  }

  private _backToList() {
    if (this._stopWatch) this._stopWatch();
    this._activePipelineId = null;
    this._stopWatch = this._chat.watch(() => this._sendState());
    this._sendState();
  }

  private async _promptNewPipeline() {
    const obj = await vscode.window.showInputBox({
      prompt: 'Objetivo da pipeline',
      placeHolder: 'Ex: Implementar autenticacao OAuth2...',
    });
    if (obj?.trim()) {
      await this._createPipeline(obj.trim());
    }
  }

  /** Show/hide typing indicator for an agent */
  sendTyping(role: AgentRole, label: string, active: boolean) {
    if (!this._view) return;
    this._view.webview.postMessage({
      command: 'typing',
      data: { role, label, active },
    });
  }

  // ─── State sync ────────────────────────────────────────────

  private _sendState() {
    if (!this._view) return;
    const project = this._getProject();

    if (this._activePipelineId && project) {
      // ─── Chat mode: viewing a specific pipeline ───
      const pipeline = this._pipelines.get(project.id, this._activePipelineId);
      if (!pipeline) {
        // Pipeline was deleted or doesn't exist — fall back to list
        this._activePipelineId = null;
        this._sendState();
        return;
      }
      // Only show agents running in THIS pipeline
      const runningAgents = this._agentService
        ? this._agentService.getRunning(this._activePipelineId)
        : [];
      const chat = this._getOrCreatePipelineChat(this._activePipelineId);
      const msgs = chat.getHistory(200);
      this._view.webview.postMessage({
        command: 'state',
        data: {
          mode: 'chat',
          messages: msgs,
          pipeline: pipeline ? this._serializePipeline(pipeline) : null,
          project: project ? { id: project.id, name: project.name } : null,
          agents: AGENT_META,
          runningAgents,
          modelConfig: loadAgentConfig(),
        },
      });
    } else {
      // ─── List mode: show all pipelines ───
      // Get all running agents and group by pipelineId for per-card indicators
      const allRunning = this._agentService ? this._agentService.getRunning() : [];
      const pipelines = project ? this._pipelines.list(project.id) : [];
      const serialized = pipelines
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map(p => ({
          id: p.id,
          objective: p.objective,
          status: p.status,
          createdAt: p.createdAt,
          currentPhase: p.currentPhase,
          totalPhases: p.phases.length,
          completedPhases: p.phases.filter(ph => ph.status === 'completed' || ph.status === 'approved').length,
          runningAgents: allRunning.filter(a => a.pipelineId === p.id),
        }));
      this._view.webview.postMessage({
        command: 'state',
        data: {
          mode: 'list',
          pipelines: serialized,
          project: project ? { id: project.id, name: project.name } : null,
          agents: AGENT_META,
          runningAgents: allRunning,
          modelConfig: loadAgentConfig(),
        },
      });
    }
  }

  private _sendPipelineState() {
    if (!this._view) return;
    if (!this._activePipelineId) return;
    const project = this._getProject();
    const pipeline = project ? this._pipelines.get(project.id, this._activePipelineId) : null;
    this._view.webview.postMessage({
      command: 'pipeline',
      data: pipeline ? this._serializePipeline(pipeline) : null,
    });
  }

  private _serializePipeline(p: Pipeline) {
    return {
      id: p.id,
      objective: p.objective,
      status: p.status,
      currentPhase: p.currentPhase,
      phases: p.phases.map(ph => ({
        id: ph.id,
        name: ph.name,
        order: ph.order,
        status: ph.status,
        parallel: ph.parallel,
        agents: ph.agents,
        tasks: ph.tasks.map(t => ({
          id: t.id,
          agent: t.agent,
          title: t.title,
          status: t.status,
          output: t.output ? (t.output.length > 500 ? t.output.substring(0, 500) + '...' : t.output) : null,
          artifacts: t.artifacts || [],
          completedAt: t.completedAt,
        })),
      })),
    };
  }

  // ─── Message handling ──────────────────────────────────────

  private async _handleMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Agent @mentions: @product-manager, @architect, @backend, etc.
    const agentRoles: AgentRole[] = ['product-manager', 'architect', 'organizer', 'backend', 'frontend', 'devops', 'qa', 'code-review'];
    const agentMatch = trimmed.match(/^@([\w-]+)\s+([\s\S]+)/);
    if (agentMatch) {
      const target = agentMatch[1];
      const message = agentMatch[2];

      // Check if it's an agent role
      if (agentRoles.includes(target as AgentRole)) {
        this._activeChat.send({
          sender: 'programmer',
          senderLabel: 'You',
          content: trimmed,
          type: 'request',
          mentions: [target],
        });
        this._sendState();
        if (this._agentService) {
          this._agentService.invokeAgent(this._activePipelineId || '', target as AgentRole, message);
        }
        return;
      }
      // Also support short names: @pm, @ar, @be, @fe, @do, @qa, @cr
      const shortMap: Record<string, AgentRole> = {
        pm: 'product-manager', ar: 'architect', og: 'organizer', be: 'backend',
        fe: 'frontend', do: 'devops', qa: 'qa', cr: 'code-review',
      };
      if (shortMap[target]) {
        this._activeChat.send({
          sender: 'programmer',
          senderLabel: 'You',
          content: trimmed,
          type: 'request',
          mentions: [shortMap[target]],
        });
        this._sendState();
        if (this._agentService) {
          this._agentService.invokeAgent(this._activePipelineId || '', shortMap[target], message);
        }
        return;
      }
    }

    if (trimmed.startsWith('@gh ')) {
      await this._handleGitHub(trimmed.slice(4));
    } else if (trimmed.startsWith('@terminal ')) {
      await this._handleTerminal(trimmed.slice(10));
    } else if (trimmed.startsWith('@files ')) {
      await this._handleFiles(trimmed.slice(7));
    } else if (trimmed.startsWith('/pipeline ')) {
      this._createPipeline(trimmed.slice(10));
    } else if (trimmed === '/approve') {
      this._approvePhase();
    } else if (trimmed.startsWith('/reject ')) {
      this._rejectPhase(trimmed.slice(8));
    } else if (trimmed === '/status') {
      this._showPipelineStatus();
    } else if (trimmed === '/run') {
      this._runCurrentPhase();
    } else if (trimmed === '/retry') {
      this._retryFailedPipeline();
    } else if (trimmed === '/stop') {
      this._stopAllAgents();
    } else if (trimmed === '/models') {
      this._showModels();
    } else if (trimmed === '/agents') {
      this._showRunningAgents();
    } else {
      // Regular message — if in list view, treat as new pipeline objective
      if (!this._activePipelineId) {
        this._createPipeline(trimmed);
      } else {
        this._activeChat.send({
          sender: 'programmer',
          senderLabel: 'You',
          content: trimmed,
          type: 'request',
        });
        this._sendState();
      }
    }
  }

  // ─── Agent commands ────────────────────────────────────────

  private async _runCurrentPhase() {
    const project = this._getProject();
    if (!project) { this._systemMsg('Nenhum projeto ativo.', 'error'); return; }
    const active = this._pipelines.getActive(project.id);
    if (!active) { this._systemMsg('Nenhum pipeline ativo. Use `/pipeline <objetivo>`.', 'info'); return; }
    const phase = active.phases[active.currentPhase];
    if (!phase || phase.status !== 'in-progress') {
      this._systemMsg('Fase atual nao esta em andamento. Talvez precise aprovar a fase anterior.', 'info');
      return;
    }
    if (!this._agentService) { this._systemMsg('AgentService nao inicializado.', 'error'); return; }
    this._agentService.runPhase(project.id, active.id);
  }

  private async _retryFailedPipeline() {
    const project = this._getProject();
    if (!project) { this._systemMsg('Nenhum projeto ativo.', 'error'); return; }
    if (!this._agentService) { this._systemMsg('AgentService nao inicializado.', 'error'); return; }

    // If viewing a specific failed pipeline, retry that one
    if (this._activePipelineId) {
      const pipeline = this._pipelines.get(project.id, this._activePipelineId);
      if (pipeline && pipeline.status === 'failed') {
        await this._resumeAndRunPipeline(project.id, pipeline);
        return;
      }
    }

    // Otherwise find any failed pipeline
    const failed = this._pipelines.getFailed(project.id);
    if (failed.length === 0) {
      this._systemMsg('Nenhuma pipeline falhou. Nada para retomar.', 'info');
      return;
    }

    // Retry the most recent failed pipeline
    const target = failed.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
    await this._resumeAndRunPipeline(project.id, target);
  }

  private async _retryPipelineById(pipelineId: string) {
    const project = this._getProject();
    if (!project) { this._systemMsg('Nenhum projeto ativo.', 'error'); return; }
    if (!this._agentService) { this._systemMsg('AgentService nao inicializado.', 'error'); return; }
    const pipeline = this._pipelines.get(project.id, pipelineId);
    if (!pipeline) { this._systemMsg('Pipeline nao encontrada.', 'error'); return; }
    if (pipeline.status !== 'failed') { this._systemMsg('Pipeline nao esta em estado de falha.', 'info'); return; }
    await this._resumeAndRunPipeline(project.id, pipeline);
  }

  private async _resumeAndRunPipeline(projectId: string, pipeline: Pipeline) {
    const resumed = this._pipelines.resumeFailed(projectId, pipeline.id);
    if (!resumed) { this._systemMsg('Falha ao retomar pipeline.', 'error'); return; }

    this._switchToPipeline(resumed.id);

    const phase = resumed.phases[resumed.currentPhase];
    this._activeChat.send({
      sender: 'system',
      senderLabel: 'Pipeline',
      content: `Retomando pipeline: **${resumed.objective}**\nFase: **${phase?.name || '?'}** — tasks resetadas para re-execucao.`,
      type: 'info',
    });

    const config = loadAgentConfig();
    if (config.mode === 'auto' || isQualityPreset(config.mode)) {
      await this._agentService!.autoAssignModels(resumed);
    }

    this._agentService!.runPipeline(projectId, resumed.id);
  }

  private _stopAllAgents() {
    if (!this._agentService) return;
    this._agentService.stopAll();
    this._systemMsg('Todos os agentes foram parados.', 'info');
  }

  private _showModels() {
    const config = loadAgentConfig();
    const roles: AgentRole[] = ['product-manager', 'architect', 'organizer', 'backend', 'frontend', 'devops', 'qa', 'code-review'];
    const lines = roles.map(r => {
      const model = config.models[r] || DEFAULT_AGENT_MODELS[r];
      const locked = r === 'product-manager' ? ' (obrigatorio)' : '';
      return `- **${AGENT_META[r].label}**: \`${model}\`${locked}`;
    });
    const presetData = (QUALITY_PRESETS as any)[config.mode];
    const header = presetData
      ? `**${presetData.label}** — ${presetData.subtitle}`
      : `Modo: **${config.mode}**`;
    this._systemMsg(`${header}\n\n${lines.join('\n')}`, 'info');
  }

  private _showRunningAgents() {
    if (!this._agentService) return;
    const running = this._agentService.getRunning();
    if (running.length === 0) {
      this._systemMsg('Nenhum agente rodando.', 'info');
      return;
    }
    const lines = running.map(r =>
      `- **${AGENT_META[r.role].label}**: ${Math.round(r.elapsed / 1000)}s`
    );
    this._systemMsg(`Agentes em execucao:\n\n${lines.join('\n')}`, 'info');
  }

  // ─── Pipeline actions ──────────────────────────────────────

  private async _createPipeline(objective: string) {
    const project = this._getProject();
    if (!project) {
      this._systemMsg('No project linked to this workspace.', 'error');
      return;
    }

    const obj = objective.trim();
    if (!obj) {
      this._systemMsg('Usage: /pipeline <objective>', 'info');
      return;
    }

    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

    // Step 1: PM (Opus) selects the quality mode based on project analysis
    if (this._agentService) {
      const config = loadAgentConfig();
      if (config.mode === 'auto' || config.mode === 'manual') {
        this._systemMsg('PM (Opus) esta analisando o objetivo para definir o modo de qualidade...', 'info');
        await this._agentService.pmSelectMode(obj);
      }
    }

    // Step 2: PM plans the phases dynamically
    let customPhases = null;
    if (this._agentService) {
      this._systemMsg(`PM esta planejando as fases para: **${obj}**`, 'info');
      customPhases = await this._agentService.planPhases(obj);
    }

    const p = this._pipelines.create(project.id, obj, ws, customPhases || undefined);

    // Create per-pipeline chat channel and start as PM conversation
    const chat = this._getOrCreatePipelineChat(p.id);
    chat.send({
      sender: 'product-manager',
      senderLabel: `PM - ${getModelForAgent('product-manager')}`,
      content: `Pipeline criada com **${p.phases.length} fases**:\n\n${p.phases.map((ph, i) => `${i + 1}. **${ph.name}** — ${ph.agents.map(a => AGENT_META[a].label).join(', ')}`).join('\n')}\n\nA primeira fase **${p.phases[0].name}** ja esta ativa. Use \`/run\` para iniciar os agentes.`,
      type: 'response',
    });

    // Switch to the new pipeline chat
    this._switchToPipeline(p.id);

    // Step 3: Auto-assign models within the selected mode's cost tier, then run
    if (this._agentService) {
      const config = loadAgentConfig();
      if (config.mode === 'auto' || isQualityPreset(config.mode)) {
        await this._agentService.autoAssignModels(p);
      }
      this._sendState(); // Refresh UI with updated mode/models
      this._agentService.runPipeline(project.id, p.id);
    }
  }

  private async _approvePhase() {
    const project = this._getProject();
    if (!project) return;

    const active = this._pipelines.getActive(project.id);
    if (!active) {
      this._systemMsg('No active pipeline to approve.', 'info');
      return;
    }

    const p = this._pipelines.approvePhase(project.id, active.id);
    if (!p) return;

    const nextPhase = p.phases[p.currentPhase];
    const msg = p.status === 'completed'
      ? 'Pipeline completed! All phases done.'
      : `Phase approved! Next: **${nextPhase.name}** (${nextPhase.agents.map(a => AGENT_META[a].label).join(', ')})`;

    this._activeChat.send({
      sender: 'programmer',
      senderLabel: 'You',
      content: 'Approved current phase.',
      type: 'request',
    });
    this._activeChat.send({
      sender: 'system',
      senderLabel: 'Pipeline',
      content: msg,
      type: 'info',
    });
    this._sendState();

    // If PM loop is not active, restart it
    if (p.status !== 'completed' && p.status !== 'failed' && this._agentService) {
      if (!this._agentService.isPipelineLoopActive(active.id)) {
        this._agentService.runPipeline(project.id, active.id);
      }
    }
  }

  private async _rejectPhase(feedback?: string) {
    const project = this._getProject();
    if (!project) return;

    const active = this._pipelines.getActive(project.id);
    if (!active) return;

    let fb = feedback?.trim();
    if (!fb) {
      fb = await vscode.window.showInputBox({
        prompt: 'Feedback for the agents',
        placeHolder: 'What needs improvement...',
      });
      if (!fb) return;
    }

    this._pipelines.rejectPhase(project.id, active.id, fb);
    this._activeChat.send({
      sender: 'programmer',
      senderLabel: 'You',
      content: `Rejected phase with feedback: ${fb}`,
      type: 'request',
    });
    this._activeChat.send({
      sender: 'system',
      senderLabel: 'Pipeline',
      content: 'Phase rejected. Agents will redo their tasks with your feedback.',
      type: 'info',
    });
    this._sendState();

    // Restart PM loop if not active
    if (this._agentService && !this._agentService.isPipelineLoopActive(active.id)) {
      this._agentService.runPipeline(project.id, active.id);
    }
  }

  private _showPipelineStatus() {
    const project = this._getProject();
    if (!project) return;
    const active = this._pipelines.getActive(project.id);
    if (!active) {
      this._systemMsg('No active pipeline. Use `/pipeline <objective>` to create one.', 'info');
      return;
    }
    const summary = this._pipelines.getStatusSummary(project.id, active.id);
    this._systemMsg(summary, 'info');
  }

  private _systemMsg(content: string, type: ChatMessage['type'] = 'info') {
    this._activeChat.send({ sender: 'system', senderLabel: 'ThinkCoffee', content, type });
    this._sendState();
  }

  // ─── @agent handlers ──────────────────────────────────────

  private async _handleGitHub(input: string) {
    this._activeChat.send({ sender: 'programmer', senderLabel: 'You', content: `@gh ${input}`, type: 'request' });
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    try {
      const output = execSync(`gh ${input} 2>&1`, { cwd: root, encoding: 'utf-8', timeout: 30000 });
      this._activeChat.send({ sender: 'github-cli', senderLabel: 'GitHub CLI', content: `\`gh ${input}\`\n\n\`\`\`\n${output.trim()}\n\`\`\``, type: 'response' });
    } catch (e: any) {
      this._activeChat.send({ sender: 'github-cli', senderLabel: 'GitHub CLI', content: `Failed: \`gh ${input}\`\n\n\`\`\`\n${e.stderr || e.message}\n\`\`\``, type: 'error' });
    }
    this._sendState();
  }

  private async _handleTerminal(input: string) {
    this._activeChat.send({ sender: 'programmer', senderLabel: 'You', content: `@terminal ${input}`, type: 'request' });
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    try {
      const output = execSync(input, { cwd: root, encoding: 'utf-8', timeout: 30000, shell: 'powershell.exe' });
      this._activeChat.send({ sender: 'terminal', senderLabel: 'Terminal', content: `\`${input}\`\n\n\`\`\`\n${output.trim() || '(no output)'}\n\`\`\``, type: 'code' });
    } catch (e: any) {
      this._activeChat.send({ sender: 'terminal', senderLabel: 'Terminal', content: `Failed: \`${input}\`\n\n\`\`\`\n${e.stderr || e.message}\n\`\`\``, type: 'error' });
    }
    this._sendState();
  }

  private async _handleFiles(input: string) {
    this._activeChat.send({ sender: 'programmer', senderLabel: 'You', content: `@files ${input}`, type: 'request' });
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { this._systemMsg('No workspace folder open.', 'error'); return; }

    try {
      const parts = input.split(' ');
      const action = parts[0];
      const filePath = parts.slice(1).join(' ');

      if (action === 'read' && filePath) {
        const abs = path.resolve(root, filePath);
        if (!abs.startsWith(root)) throw new Error('Path traversal denied');
        const content = fs.readFileSync(abs, 'utf-8');
        const lines = content.split('\n');
        const preview = lines.length > 100 ? lines.slice(0, 100).join('\n') + `\n... (${lines.length - 100} more lines)` : content;
        this._activeChat.send({ sender: 'system', senderLabel: 'Files', content: `**${filePath}** (${lines.length} lines)\n\n\`\`\`\n${preview}\n\`\`\``, type: 'response' });
      } else if (action === 'list') {
        const target = filePath ? path.resolve(root, filePath) : root;
        if (!target.startsWith(root) && target !== root) throw new Error('Path traversal denied');
        const entries = fs.readdirSync(target, { withFileTypes: true });
        const list = entries.filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
          .sort((a, b) => { if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1; return a.name.localeCompare(b.name); })
          .map(e => e.isDirectory() ? `${e.name}/` : e.name).join('\n');
        this._activeChat.send({ sender: 'system', senderLabel: 'Files', content: `**${filePath || '.'}**\n\n\`\`\`\n${list}\n\`\`\``, type: 'response' });
      } else {
        this._activeChat.send({ sender: 'system', senderLabel: 'Files', content: 'Usage: `@files read <path>` or `@files list [path]`', type: 'info' });
      }
    } catch (e: any) {
      this._activeChat.send({ sender: 'system', senderLabel: 'Files', content: `Error: ${e.message}`, type: 'error' });
    }
    this._sendState();
  }

  // ─── HTML ──────────────────────────────────────────────────

  private _getHtml(): string {
    return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  /* ─── Pipeline Progress Strip ───────────────────────────── */
  .pipeline-strip {
    display: none;
    flex-shrink: 0;
    flex-direction: column;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    cursor: default;
  }
  .pipeline-strip.active { display: flex; }
  .pipeline-strip .strip-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
  }
  .pipeline-strip .strip-objective {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 600;
    color: var(--vscode-foreground);
    font-size: 11px;
  }
  .pipeline-strip .strip-phase {
    font-size: 9px;
    padding: 1px 6px;
    border-radius: 8px;
    background: color-mix(in srgb, #3b82f6 15%, transparent);
    color: #3b82f6;
    font-weight: 600;
    white-space: nowrap;
  }
  .pipeline-strip .strip-phase.done {
    background: color-mix(in srgb, #22c55e 15%, transparent);
    color: #22c55e;
  }
  .progress-track {
    display: flex;
    height: 3px;
  }
  .progress-seg {
    flex: 1;
    transition: background 0.3s;
    background: var(--vscode-input-border, #333);
  }
  .progress-seg.completed { background: #22c55e; }
  .progress-seg.in-progress { background: #3b82f6; }
  .progress-seg.awaiting { background: #eab308; }
  .progress-seg.failed { background: #ef4444; }

  /* ─── Inline Approval Card (inside chat) ────────────────── */
  .approval-card {
    display: none;
    margin: 8px 0 8px 25px;
    padding: 10px 12px;
    border-radius: 8px;
    background: color-mix(in srgb, #eab308 6%, var(--vscode-input-background));
    border: 1px solid color-mix(in srgb, #eab308 25%, var(--vscode-input-border));
    animation: fadeIn 0.15s ease-in;
  }
  .approval-card.active { display: block; }
  .approval-card .ac-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }
  .approval-card .ac-icon {
    width: 20px; height: 20px; border-radius: 50%;
    background: #eab308;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 10px; color: #000; font-weight: 700;
  }
  .approval-card .ac-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }
  .approval-card .ac-desc {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 8px;
    line-height: 1.4;
  }
  .approval-card .ac-actions {
    display: flex;
    gap: 6px;
  }
  .approval-card .ac-actions button {
    padding: 4px 14px;
    border-radius: 4px;
    border: none;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-approve { background: #22c55e; color: #000; }
  .btn-approve:hover { background: #16a34a; }
  .btn-reject { background: transparent; color: #ef4444; border: 1px solid #ef4444 !important; }
  .btn-reject:hover { background: #ef444418; }

  /* ─── Stop button in input area ────────────────────────────── */
  .stop-btn-input {
    display: none;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid #ef4444;
    background: transparent;
    color: #ef4444;
    font-size: 12px;
    cursor: pointer;
    font-weight: 600;
    flex-shrink: 0;
  }
  .stop-btn-input:hover { background: #ef444411; }
  .stop-btn-input.active { display: inline-flex; align-items: center; justify-content: center; }

  /* ─── Messages ─────────────────────────────────────────── */
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 8px 10px;
  }

  .msg {
    margin-bottom: 10px;
    animation: fadeIn 0.15s ease-in;
  }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; } }

  .msg-header {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 2px;
  }

  .avatar {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: #fff;
    flex-shrink: 0;
  }

  .sender { font-weight: 600; font-size: 11px; }
  .time { font-size: 9px; color: var(--vscode-descriptionForeground); }

  .type-pill {
    font-size: 8px;
    padding: 1px 5px;
    border-radius: 6px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .type-pill.request { background: color-mix(in srgb, var(--vscode-terminal-ansiCyan) 25%, transparent); color: var(--vscode-terminal-ansiCyan); }
  .type-pill.response { background: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 25%, transparent); color: var(--vscode-terminal-ansiGreen); }
  .type-pill.code { background: color-mix(in srgb, var(--vscode-terminal-ansiYellow) 25%, transparent); color: var(--vscode-terminal-ansiYellow); }
  .type-pill.error { background: color-mix(in srgb, var(--vscode-terminal-ansiRed) 25%, transparent); color: var(--vscode-terminal-ansiRed); }
  .type-pill.info { background: color-mix(in srgb, var(--vscode-descriptionForeground) 20%, transparent); color: var(--vscode-descriptionForeground); }

  .msg-body {
    padding: 5px 8px;
    border-radius: 6px;
    background: var(--vscode-input-background);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    margin-left: 25px;
    font-size: 12px;
  }

  .msg-body code {
    font-family: var(--vscode-editor-font-family, monospace);
    background: var(--vscode-textCodeBlock-background);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 11px;
  }

  .msg-body pre {
    margin: 4px 0;
    padding: 6px 8px;
    background: var(--vscode-textCodeBlock-background);
    border-radius: 4px;
    overflow-x: auto;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    line-height: 1.4;
  }

  /* Agent-colored messages */
  .msg.programmer .msg-body { background: color-mix(in srgb, var(--vscode-terminal-ansiCyan) 8%, var(--vscode-input-background)); border-left: 2px solid var(--vscode-terminal-ansiCyan); }
  .msg.system .msg-body { border-left: 2px solid var(--vscode-descriptionForeground); }

  /* ─── Message status ticks ─────────────────────────────── */
  .msg-status {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-left: 4px;
    font-size: 9px;
    color: var(--vscode-descriptionForeground);
  }
  .msg-status .tick {
    font-size: 10px;
    line-height: 1;
  }
  .msg-status .tick.sent { color: var(--vscode-descriptionForeground); }
  .msg-status .tick.delivered { color: var(--vscode-terminal-ansiGreen); }

  /* ─── Typing indicator ─────────────────────────────────── */
  .typing-indicator {
    display: none;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    margin-bottom: 4px;
    animation: fadeIn 0.15s ease-in;
  }
  .typing-indicator.active { display: flex; }
  .typing-indicator .avatar {
    width: 20px; height: 20px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 700; color: #fff; flex-shrink: 0;
  }
  .typing-indicator .typing-label {
    font-size: 11px;
    font-weight: 600;
  }
  .typing-dots {
    display: inline-flex;
    gap: 3px;
    margin-left: 2px;
  }
  .typing-dots span {
    width: 5px; height: 5px;
    border-radius: 50%;
    background: var(--vscode-descriptionForeground);
    animation: typingBounce 1.2s infinite;
  }
  .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
  .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes typingBounce {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
    30% { transform: translateY(-4px); opacity: 1; }
  }

  /* ─── Mode selector ─────────────────────────────────────── */
  .mode-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-top: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    flex-shrink: 0;
  }
  .mode-bar label {
    font-size: 10px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
  }
  .mode-bar > label:first-child { margin-right: 4px; }
  .mode-select {
    font-size: 11px;
    font-family: var(--vscode-font-family, sans-serif);
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    padding: 2px 6px;
    outline: none;
    cursor: pointer;
  }
  .mode-select:focus { border-color: var(--vscode-focusBorder); }
  .mode-select option {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
  }
  .mode-subtitle {
    font-size: 9px;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ─── Auto-approve toggle ───────────────────────────────── */
  .autoapprove-wrap {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  }
  .autoapprove-wrap label {
    font-size: 9px;
    cursor: pointer;
    user-select: none;
  }
  .toggle-switch {
    position: relative;
    width: 28px;
    height: 14px;
    cursor: pointer;
  }
  .toggle-switch input { opacity: 0; width: 0; height: 0; }
  .toggle-track {
    position: absolute;
    inset: 0;
    border-radius: 7px;
    background: var(--vscode-input-border, #555);
    transition: background 0.2s;
  }
  .toggle-switch input:checked + .toggle-track {
    background: #22c55e;
  }
  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s;
  }
  .toggle-switch input:checked ~ .toggle-thumb {
    transform: translateX(14px);
  }

  /* ─── Send button states ────────────────────────────────── */
  .send-btn.sending {
    opacity: 0.5;
    pointer-events: none;
  }
  .send-btn .send-icon { display: inline; }
  .send-btn .sending-icon { display: none; }
  .send-btn.sending .send-icon { display: none; }
  .send-btn.sending .sending-icon { display: inline; }

  /* ─── Agent task inline cards ──────────────────────────── */
  .task-card {
    margin: 6px 0 6px 25px;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    font-size: 11px;
  }
  .task-card .tc-header {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 3px;
  }
  .task-card .tc-agent { font-weight: 600; }
  .task-card .tc-status {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 4px;
    font-weight: 600;
  }
  .tc-status.completed { background: #22c55e33; color: #22c55e; }
  .tc-status.in-progress { background: #3b82f633; color: #3b82f6; }
  .tc-status.pending { background: #6b728033; color: #9ca3af; }
  .tc-status.failed { background: #ef444433; color: #ef4444; }

  .task-card .tc-output {
    margin-top: 3px;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    max-height: 80px;
    overflow: hidden;
    cursor: pointer;
  }
  .task-card .tc-output:hover { max-height: none; }

  /* ─── Input ────────────────────────────────────────────── */
  .input-area {
    padding: 8px 10px;
    border-top: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    flex-shrink: 0;
  }

  .input-wrap {
    display: flex;
    gap: 4px;
    align-items: flex-end;
  }

  .input-area textarea {
    flex: 1;
    resize: none;
    border: 1px solid var(--vscode-input-border);
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    padding: 6px 8px;
    border-radius: 6px;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 12px;
    outline: none;
    min-height: 32px;
    max-height: 120px;
  }
  .input-area textarea:focus { border-color: var(--vscode-focusBorder); }

  .input-area button.send-btn {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    font-size: 12px;
  }
  .input-area button.send-btn:hover { background: var(--vscode-button-hoverBackground); }

  .hints {
    padding: 3px 0 0;
    font-size: 9px;
    color: var(--vscode-descriptionForeground);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--vscode-descriptionForeground);
    gap: 6px;
    text-align: center;
    padding: 16px;
  }
  .empty h3 { font-size: 14px; color: var(--vscode-foreground); }
  .empty p { font-size: 11px; line-height: 1.5; }

  .quick-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 8px;
  }
  .quick-actions button {
    padding: 3px 8px;
    border: 1px solid var(--vscode-input-border);
    background: var(--vscode-input-background);
    color: var(--vscode-foreground);
    border-radius: 4px;
    cursor: pointer;
    font-size: 10px;
  }
  .quick-actions button:hover { background: var(--vscode-list-hoverBackground); }

  /* ─── Pipeline List View ─────────────────────────────── */
  .pipeline-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 10px;
    display: none;
  }
  .pipeline-list.active { display: block; }
  .pipeline-list .pl-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .pipeline-list .pl-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--vscode-foreground);
  }
  .pipeline-list .pl-hint {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 10px;
  }
  .pl-card {
    padding: 10px;
    border-radius: 8px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    margin-bottom: 8px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    animation: fadeIn 0.15s ease-in;
  }
  .pl-card:hover {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-list-hoverBackground);
  }
  .pl-card .pl-objective {
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-foreground);
    margin-bottom: 4px;
    line-height: 1.4;
  }
  .pl-card .pl-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
  }
  .pl-card .pl-status {
    font-size: 9px;
    padding: 1px 6px;
    border-radius: 8px;
    font-weight: 600;
  }
  .pl-status.completed { background: #22c55e22; color: #22c55e; }
  .pl-status.failed { background: #ef444422; color: #ef4444; }
  .pl-status.active { background: #3b82f622; color: #3b82f6; }
  .pl-retry-btn {
    margin-left: auto;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 600;
    border: 1px solid #f97316;
    color: #f97316;
    background: #f9731611;
    border-radius: 6px;
    cursor: pointer;
  }
  .pl-retry-btn:hover { background: #f9731633; }
  .pl-card .pl-progress {
    display: flex;
    height: 3px;
    border-radius: 2px;
    overflow: hidden;
    margin-top: 6px;
  }
  .pl-card .pl-progress .pl-seg {
    flex: 1;
    background: var(--vscode-input-border, #333);
  }
  .pl-card .pl-progress .pl-seg.done { background: #22c55e; }

  /* ─── Back button in strip ────────────────────────────── */
  .back-btn {
    background: transparent;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 0 4px;
    font-size: 14px;
    line-height: 1;
    opacity: 0.7;
    flex-shrink: 0;
  }
  .back-btn:hover { opacity: 1; }
</style>
</head>
<body>
  <div class="pipeline-strip" id="pipelineStrip">
    <div class="strip-header">
      <button class="back-btn" id="backBtn" title="Voltar para lista">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span class="strip-objective" id="stripObjective"></span>
      <span class="strip-phase" id="stripPhase"></span>
    </div>
    <div class="progress-track" id="progressTrack"></div>
  </div>

  <div class="pipeline-list" id="pipelineList">
    <div class="pl-header">
      <span class="pl-title">Pipelines</span>
    </div>
    <div class="pl-hint">Envie uma mensagem para criar uma nova pipeline.</div>
    <div id="pipelineCards"></div>
  </div>

  <div class="messages" id="messages">
    <div class="typing-indicator" id="typingIndicator">
      <div class="avatar" id="typingAvatar">...</div>
      <span class="typing-label" id="typingLabel">Pensando</span>
      <div class="typing-dots"><span></span><span></span><span></span></div>
    </div>
    <div class="approval-card" id="approvalCard">
      <div class="ac-header">
        <div class="ac-icon">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <span class="ac-title" id="approvalTitle">Fase aguardando aprovacao</span>
      </div>
      <div class="ac-desc" id="approvalDesc">Revise o resultado dos agentes e aprove para continuar ou rejeite com feedback.</div>
      <div class="ac-actions">
        <button class="btn-approve" id="approveBtn">Aprovar</button>
        <button class="btn-reject" id="rejectBtn">Rejeitar</button>
      </div>
    </div>
    <div class="empty" id="emptyState">
      <h3>ThinkCoffee Agents</h3>
      <p>Multi-agent pipeline for your project.<br>Chat with agents, create pipelines, approve phases.</p>
      <div class="quick-actions">
        <button onclick="insertCmd('/pipeline ')">New Pipeline</button>
        <button onclick="insertCmd('/run')">Run Phase</button>
        <button onclick="insertCmd('/models')">View Models</button>
        <button onclick="insertCmd('@pm ')">Ask PM</button>
        <button onclick="insertCmd('@ar ')">Ask Architect</button>
        <button onclick="insertCmd('/status')">Status</button>
      </div>
    </div>
  </div>

  <div class="input-area">
    <div class="input-wrap">
      <textarea id="input" placeholder="Message agents... (/ for commands)" rows="1"></textarea>
      <button class="stop-btn-input" id="stopBtnInput" title="Stop agents">Stop</button>
      <button class="send-btn" id="sendBtn" title="Send">
        <span class="send-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></span>
        <span class="sending-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></circle></svg></span>
      </button>
    </div>
    <div class="hints">
      <strong>/pipeline</strong> create &bull;
      <strong>/run</strong> start &bull;
      <strong>/retry</strong> resume &bull;
      <strong>/approve</strong> &bull;
      <strong>/reject</strong> &bull;
      <strong>/models</strong> &bull;
      <strong>/agents</strong> &bull;
      <strong>/stop</strong> &bull;
      <strong>@pm</strong> <strong>@ar</strong> <strong>@og</strong> <strong>@be</strong> <strong>@fe</strong> <strong>@qa</strong> <strong>@cr</strong>
    </div>
    <div class="mode-bar" id="modeBar">
      <label>Modo:</label>
      <select class="mode-select" id="modeSelect">
        <option value="auto">Auto (PM decide)</option>
        <option value="cafe-soluvel">Cafe Soluvel</option>
        <option value="coado-com-carinho">Coado com Carinho</option>
        <option value="espresso-duplo">Espresso Duplo</option>
      </select>
      <span class="mode-subtitle" id="modeSubtitle">PM escolhe livremente</span>
      <div class="autoapprove-wrap">
        <label for="autoApproveToggle" title="Aprovar fases automaticamente sem pedir confirmacao">Auto-approve</label>
        <label class="toggle-switch" title="Aprovar fases automaticamente">
          <input type="checkbox" id="autoApproveToggle" checked>
          <span class="toggle-track"></span>
          <span class="toggle-thumb"></span>
        </label>
      </div>
    </div>
  </div>

<script>
  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById('messages');
  const emptyEl = document.getElementById('emptyState');
  const inputEl = document.getElementById('input');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtnInput = document.getElementById('stopBtnInput');
  const pipelineStrip = document.getElementById('pipelineStrip');
  const progressTrack = document.getElementById('progressTrack');
  const stripObjective = document.getElementById('stripObjective');
  const stripPhase = document.getElementById('stripPhase');
  const approvalCard = document.getElementById('approvalCard');
  const approvalTitle = document.getElementById('approvalTitle');
  const approveBtn = document.getElementById('approveBtn');
  const rejectBtn = document.getElementById('rejectBtn');
  const typingIndicator = document.getElementById('typingIndicator');
  const typingAvatar = document.getElementById('typingAvatar');
  const typingLabel = document.getElementById('typingLabel');
  const modeSelect = document.getElementById('modeSelect');
  const modeSubtitle = document.getElementById('modeSubtitle');
  const autoApproveToggle = document.getElementById('autoApproveToggle');
  const pipelineList = document.getElementById('pipelineList');
  const pipelineCards = document.getElementById('pipelineCards');
  const inputArea = document.querySelector('.input-area');
  const backBtn = document.getElementById('backBtn');

  let autoApproveEnabled = true;

  autoApproveToggle.addEventListener('change', () => {
    autoApproveEnabled = autoApproveToggle.checked;
    vscode.postMessage({ command: 'setAutoApprove', enabled: autoApproveEnabled });
  });

  backBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'backToList' });
  });

  let currentMode = 'list';

  function showListView(pipelines) {
    currentMode = 'list';
    pipelineList.classList.add('active');
    messagesEl.style.display = 'none';
    pipelineStrip.classList.remove('active');
    inputArea.style.display = '';
    inputEl.placeholder = 'Descreva o objetivo para criar uma pipeline...';

    pipelineCards.innerHTML = '';
    if (!pipelines || pipelines.length === 0) return;

    for (const p of pipelines) {
      const card = document.createElement('div');
      card.className = 'pl-card';
      card.onclick = () => vscode.postMessage({ command: 'switchPipeline', pipelineId: p.id });

      const statusClass = p.status === 'completed' ? 'completed' : p.status === 'failed' ? 'failed' : 'active';
      const statusLabel = p.status === 'completed' ? 'Concluido' : p.status === 'failed' ? 'Falhou' : 'Em andamento';
      const date = new Date(p.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

      let progressHtml = '<div class="pl-progress">';
      for (let i = 0; i < p.totalPhases; i++) {
        progressHtml += '<div class="pl-seg' + (i < p.completedPhases ? ' done' : '') + '"></div>';
      }
      progressHtml += '</div>';

      // Per-pipeline running agents indicator
      let agentChipsHtml = '';
      if (p.runningAgents && p.runningAgents.length > 0) {
        const chips = p.runningAgents.map(function(a) {
          var initials = AGENT_INITIALS[a.role] || '??';
          var color = AGENT_COLORS[a.role] || '#9ca3af';
          var secs = Math.round((a.elapsed || 0) / 1000);
          return '<span class="chip" style="background:' + color + '33;color:' + color + ';font-size:10px;padding:1px 5px;">' + initials + ' ' + secs + 's</span>';
        }).join('');
        agentChipsHtml = '<div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap;">' + chips + '</div>';
      }

      // Retry button for failed pipelines
      let retryHtml = '';
      if (p.status === 'failed') {
        retryHtml = '<button class="pl-retry-btn" data-pid="' + p.id + '" title="Retomar pipeline">Retomar</button>';
      }

      card.innerHTML =
        '<div class="pl-objective">' + escHtml(p.objective) + '</div>' +
        '<div class="pl-meta">' +
          '<span class="pl-status ' + statusClass + '">' + statusLabel + '</span>' +
          '<span>' + p.completedPhases + '/' + p.totalPhases + ' fases</span>' +
          '<span>' + date + '</span>' +
          retryHtml +
        '</div>' +
        progressHtml +
        agentChipsHtml;
      pipelineCards.appendChild(card);

      // Attach retry click handler (stop propagation so card click doesn't fire)
      const retryBtn = card.querySelector('.pl-retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          vscode.postMessage({ command: 'retryPipeline', pipelineId: p.id });
        });
      }
    }
  }

  function showChatView() {
    currentMode = 'chat';
    pipelineList.classList.remove('active');
    messagesEl.style.display = '';
    inputArea.style.display = '';
    inputEl.placeholder = 'Message agents... (/ for commands)';
  }

  const MODE_SUBTITLES = {
    'auto': 'PM escolhe livremente',
    'cafe-soluvel': 'Rapido e sem frescura',
    'coado-com-carinho': 'Equilibrado, pro dia a dia',
    'espresso-duplo': 'Premium, nivel barista',
  };

  modeSelect.addEventListener('change', () => {
    const mode = modeSelect.value;
    modeSubtitle.textContent = MODE_SUBTITLES[mode] || '';
    vscode.postMessage({ command: 'changeMode', mode });
  });

  let currentAgents = {};

  const AGENT_COLORS = {
    'programmer': '#22d3ee',
    'product-manager': '#a78bfa',
    'architect': '#f472b6',
    'backend': '#60a5fa',
    'frontend': '#34d399',
    'devops': '#fb923c',
    'qa': '#facc15',
    'code-review': '#c084fc',
    'organizer': '#f59e0b',
    'system': '#9ca3af',
    'github-cli': '#22c55e',
    'terminal': '#eab308',
  };

  const AGENT_INITIALS = {
    'programmer': 'U',
    'product-manager': 'PM',
    'architect': 'AR',
    'backend': 'BE',
    'frontend': 'FE',
    'devops': 'DO',
    'qa': 'QA',
    'code-review': 'CR',
    'organizer': 'OG',
    'system': 'S',
    'github-cli': 'GH',
    'terminal': 'T',
  };

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function renderMd(text) {
    let h = escHtml(text);
    h = h.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, (_, _l, code) => '<pre>' + code.trim() + '</pre>');
    h = h.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
    h = h.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    return h;
  }

  function renderPipeline(pipeline) {
    if (!pipeline) {
      pipelineStrip.classList.remove('active');
      approvalCard.classList.remove('active');
      return;
    }
    pipelineStrip.classList.add('active');
    stripObjective.textContent = pipeline.objective;

    // Progress segments
    progressTrack.innerHTML = '';
    let awaitingPhaseName = '';
    const completed = pipeline.phases.filter(p => p.status === 'completed' || p.status === 'approved').length;
    const total = pipeline.phases.length;

    pipeline.phases.forEach(ph => {
      const seg = document.createElement('div');
      seg.className = 'progress-seg';
      seg.title = ph.name + ' (' + ph.status + ')';
      if (ph.status === 'completed' || ph.status === 'approved') seg.classList.add('completed');
      else if (ph.status === 'in-progress') seg.classList.add('in-progress');
      else if (ph.status === 'awaiting-approval') { seg.classList.add('awaiting'); awaitingPhaseName = ph.name; }
      else if (ph.status === 'failed') seg.classList.add('failed');
      progressTrack.appendChild(seg);
    });

    // Current phase badge
    const cp = pipeline.phases[pipeline.currentPhase];
    if (pipeline.status === 'completed') {
      stripPhase.textContent = 'Concluido';
      stripPhase.classList.add('done');
    } else {
      stripPhase.textContent = cp ? cp.name : completed + '/' + total;
      stripPhase.classList.remove('done');
    }

    // Inline approval card in chat — or auto-approve
    if (awaitingPhaseName) {
      if (autoApproveEnabled) {
        approvalCard.classList.remove('active');
        vscode.postMessage({ command: 'approve' });
      } else {
        approvalTitle.textContent = awaitingPhaseName + ' aguardando aprovacao';
        approvalCard.classList.add('active');
        messagesEl.appendChild(approvalCard);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    } else {
      approvalCard.classList.remove('active');
    }
  }

  function renderMessages(msgs) {
    if (!msgs || !msgs.length) {
      emptyEl.style.display = 'flex';
      return;
    }
    emptyEl.style.display = 'none';

    const existing = messagesEl.querySelectorAll('.msg');
    const ids = new Set();
    existing.forEach(el => ids.add(el.dataset.id));

    for (const m of msgs) {
      if (ids.has(m.id)) continue;

      const div = document.createElement('div');
      div.className = 'msg ' + m.sender;
      div.dataset.id = m.id;

      const color = AGENT_COLORS[m.sender] || '#9ca3af';
      const initials = AGENT_INITIALS[m.sender] || m.sender.substring(0, 2).toUpperCase();

      const statusHtml = m.sender === 'programmer'
        ? '<span class="msg-status"><span class="tick delivered">&#10003;&#10003;</span></span>'
        : '';

      div.innerHTML =
        '<div class="msg-header">' +
          '<div class="avatar" style="background:' + color + '">' + initials + '</div>' +
          '<span class="sender" style="color:' + color + '">' + escHtml(m.senderLabel || m.sender) + '</span>' +
          '<span class="type-pill ' + m.type + '">' + m.type + '</span>' +
          '<span class="time">' + new Date(m.timestamp).toLocaleTimeString() + '</span>' +
          statusHtml +
        '</div>' +
        '<div class="msg-body">' + renderMd(m.content) + '</div>';
      messagesEl.appendChild(div);
    }

    // Keep approval card and typing indicator at bottom
    if (approvalCard.classList.contains('active')) {
      messagesEl.appendChild(approvalCard);
    }
    if (typingIndicator.classList.contains('active')) {
      messagesEl.appendChild(typingIndicator);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showTyping(role, label) {
    const color = AGENT_COLORS[role] || '#9ca3af';
    const init = AGENT_INITIALS[role] || role.substring(0, 2).toUpperCase();
    typingAvatar.style.background = color;
    typingAvatar.textContent = init;
    typingLabel.textContent = label || 'Pensando';
    typingLabel.style.color = color;
    typingIndicator.classList.add('active');
    messagesEl.appendChild(typingIndicator);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function hideTyping() {
    typingIndicator.classList.remove('active');
  }

  function insertCmd(cmd) {
    inputEl.value = cmd;
    inputEl.focus();
  }

  let sendTimeout = null;

  function send() {
    const text = inputEl.value.trim();
    if (!text) return;

    // Instant visual feedback: show sending state
    sendBtn.classList.add('sending');
    inputEl.disabled = true;

    vscode.postMessage({ command: 'send', text });
    inputEl.value = '';
    inputEl.style.height = '32px';

    // Re-enable after brief delay (state update will arrive)
    if (sendTimeout) clearTimeout(sendTimeout);
    sendTimeout = setTimeout(() => {
      sendBtn.classList.remove('sending');
      inputEl.disabled = false;
      inputEl.focus();
    }, 600);
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  inputEl.addEventListener('input', () => {
    inputEl.style.height = '32px';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  approveBtn.addEventListener('click', () => {
    approvalCard.classList.remove('active');
    vscode.postMessage({ command: 'approve' });
  });
  rejectBtn.addEventListener('click', () => {
    const fb = prompt('Feedback para os agentes:');
    if (fb) {
      approvalCard.classList.remove('active');
      vscode.postMessage({ command: 'reject', feedback: fb });
    }
  });
  stopBtnInput.addEventListener('click', () => vscode.postMessage({ command: 'send', text: '/stop' }));

  function renderRunningAgents(running) {
    if (!running || running.length === 0) {
      stopBtnInput.classList.remove('active');
      return;
    }
    stopBtnInput.classList.add('active');
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.command === 'state') {
      if (msg.data.agents) currentAgents = msg.data.agents;

      if (msg.data.mode === 'list') {
        showListView(msg.data.pipelines);
        renderRunningAgents([]); // In list mode, per-card indicators handle this
      } else {
        showChatView();
        renderPipeline(msg.data.pipeline);
        renderMessages(msg.data.messages);
        renderRunningAgents(msg.data.runningAgents);
        // Show typing for running agents
        if (msg.data.runningAgents && msg.data.runningAgents.length > 0) {
          const first = msg.data.runningAgents[0];
          const agentLabel = (currentAgents[first.role] && currentAgents[first.role].label) || first.role;
          showTyping(first.role, agentLabel + ' trabalhando...');
        } else {
          hideTyping();
        }
      }

      // Sync mode dropdown
      if (msg.data.modelConfig && msg.data.modelConfig.mode) {
        const m = msg.data.modelConfig.mode;
        if (modeSelect.value !== m) {
          modeSelect.value = MODE_SUBTITLES[m] ? m : 'auto';
          modeSubtitle.textContent = MODE_SUBTITLES[modeSelect.value] || '';
        }
      }
      // Reset send button
      sendBtn.classList.remove('sending');
      inputEl.disabled = false;
    } else if (msg.command === 'pipeline') {
      renderPipeline(msg.data);
    } else if (msg.command === 'typing') {
      if (msg.data.active) {
        showTyping(msg.data.role, msg.data.label);
      } else {
        hideTyping();
      }
    }
  });

  vscode.postMessage({ command: 'ready' });
</script>
</body>
</html>`;
  }
}
