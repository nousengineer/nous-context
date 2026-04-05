import * as vscode from 'vscode';
import { ChatService, PipelineService, ContextService, DecisionService, AGENT_META } from '@thinkcoffee/core';
import type { ChatMessage, Pipeline, AgentRole } from '@thinkcoffee/core';
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
  private _stopWatch: (() => void) | null = null;
  private _pipelineRefreshTimer?: ReturnType<typeof setInterval>;

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
        case 'send': await this._handleMessage(msg.text); break;
        case 'ready': this._sendState(); break;
        case 'clear': this._chat.clear(); this._sendState(); break;
        case 'approve': this._approvePhase(); break;
        case 'reject': this._rejectPhase(msg.feedback); break;
        case 'createPipeline': this._createPipeline(msg.objective); break;
        case 'refreshPipeline': this._sendState(); break;
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

  // ─── State sync ────────────────────────────────────────────

  private _sendState() {
    if (!this._view) return;
    const msgs = this._chat.getHistory(200);
    const project = this._getProject();
    const pipeline = project ? this._pipelines.getActive(project.id) : null;
    this._view.webview.postMessage({
      command: 'state',
      data: {
        messages: msgs,
        pipeline: pipeline ? this._serializePipeline(pipeline) : null,
        project: project ? { id: project.id, name: project.name } : null,
        agents: AGENT_META,
      },
    });
  }

  private _sendPipelineState() {
    if (!this._view) return;
    const project = this._getProject();
    const pipeline = project ? this._pipelines.getActive(project.id) : null;
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

    if (trimmed.startsWith('@gh ')) {
      await this._handleGitHub(trimmed.slice(4));
    } else if (trimmed.startsWith('@terminal ')) {
      await this._handleTerminal(trimmed.slice(10));
    } else if (trimmed.startsWith('@files ')) {
      await this._handleFiles(trimmed.slice(7));
    } else if (trimmed.startsWith('/pipeline ')) {
      await this._createPipeline(trimmed.slice(10));
    } else if (trimmed === '/approve') {
      await this._approvePhase();
    } else if (trimmed.startsWith('/reject ')) {
      await this._rejectPhase(trimmed.slice(8));
    } else if (trimmed === '/status') {
      this._showPipelineStatus();
    } else {
      // Regular message
      this._chat.send({
        sender: 'programmer',
        senderLabel: 'You',
        content: trimmed,
        type: 'request',
      });
      this._sendState();
    }
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
    const p = this._pipelines.create(project.id, obj, ws);
    this._chat.send({
      sender: 'system',
      senderLabel: 'Pipeline',
      content: `Pipeline created: **${obj}**\n\nPhases: ${p.phases.map(ph => ph.name).join(' -> ')}\n\nFirst phase **${p.phases[0].name}** is now active.`,
      type: 'info',
    });
    this._sendState();
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

    this._chat.send({
      sender: 'programmer',
      senderLabel: 'You',
      content: 'Approved current phase.',
      type: 'request',
    });
    this._chat.send({
      sender: 'system',
      senderLabel: 'Pipeline',
      content: msg,
      type: 'info',
    });
    this._sendState();
    vscode.commands.executeCommand('thinkcoffee.refreshPipeline');
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
    this._chat.send({
      sender: 'programmer',
      senderLabel: 'You',
      content: `Rejected phase with feedback: ${fb}`,
      type: 'request',
    });
    this._chat.send({
      sender: 'system',
      senderLabel: 'Pipeline',
      content: 'Phase rejected. Agents will redo their tasks with your feedback.',
      type: 'info',
    });
    this._sendState();
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
    this._chat.send({ sender: 'system', senderLabel: 'ThinkCoffee', content, type });
    this._sendState();
  }

  // ─── @agent handlers ──────────────────────────────────────

  private async _handleGitHub(input: string) {
    this._chat.send({ sender: 'programmer', senderLabel: 'You', content: `@gh ${input}`, type: 'request' });
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    try {
      const output = execSync(`gh ${input} 2>&1`, { cwd: root, encoding: 'utf-8', timeout: 30000 });
      this._chat.send({ sender: 'github-cli', senderLabel: 'GitHub CLI', content: `\`gh ${input}\`\n\n\`\`\`\n${output.trim()}\n\`\`\``, type: 'response' });
    } catch (e: any) {
      this._chat.send({ sender: 'github-cli', senderLabel: 'GitHub CLI', content: `Failed: \`gh ${input}\`\n\n\`\`\`\n${e.stderr || e.message}\n\`\`\``, type: 'error' });
    }
    this._sendState();
  }

  private async _handleTerminal(input: string) {
    this._chat.send({ sender: 'programmer', senderLabel: 'You', content: `@terminal ${input}`, type: 'request' });
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    try {
      const output = execSync(input, { cwd: root, encoding: 'utf-8', timeout: 30000, shell: 'powershell.exe' });
      this._chat.send({ sender: 'terminal', senderLabel: 'Terminal', content: `\`${input}\`\n\n\`\`\`\n${output.trim() || '(no output)'}\n\`\`\``, type: 'code' });
    } catch (e: any) {
      this._chat.send({ sender: 'terminal', senderLabel: 'Terminal', content: `Failed: \`${input}\`\n\n\`\`\`\n${e.stderr || e.message}\n\`\`\``, type: 'error' });
    }
    this._sendState();
  }

  private async _handleFiles(input: string) {
    this._chat.send({ sender: 'programmer', senderLabel: 'You', content: `@files ${input}`, type: 'request' });
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
        this._chat.send({ sender: 'system', senderLabel: 'Files', content: `**${filePath}** (${lines.length} lines)\n\n\`\`\`\n${preview}\n\`\`\``, type: 'response' });
      } else if (action === 'list') {
        const target = filePath ? path.resolve(root, filePath) : root;
        if (!target.startsWith(root) && target !== root) throw new Error('Path traversal denied');
        const entries = fs.readdirSync(target, { withFileTypes: true });
        const list = entries.filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
          .sort((a, b) => { if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1; return a.name.localeCompare(b.name); })
          .map(e => e.isDirectory() ? `${e.name}/` : e.name).join('\n');
        this._chat.send({ sender: 'system', senderLabel: 'Files', content: `**${filePath || '.'}**\n\n\`\`\`\n${list}\n\`\`\``, type: 'response' });
      } else {
        this._chat.send({ sender: 'system', senderLabel: 'Files', content: 'Usage: `@files read <path>` or `@files list [path]`', type: 'info' });
      }
    } catch (e: any) {
      this._chat.send({ sender: 'system', senderLabel: 'Files', content: `Error: ${e.message}`, type: 'error' });
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

  /* ─── Pipeline Banner ─────────────────────────────────── */
  .pipeline-bar {
    padding: 6px 10px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editor-background);
    flex-shrink: 0;
    display: none;
  }
  .pipeline-bar.active { display: block; }
  .pipeline-bar .objective {
    font-weight: 600;
    font-size: 12px;
    margin-bottom: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .phase-track {
    display: flex;
    gap: 2px;
    align-items: center;
  }
  .phase-dot {
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: var(--vscode-input-border, #444);
    transition: background 0.2s;
  }
  .phase-dot.completed { background: #22c55e; }
  .phase-dot.in-progress { background: #3b82f6; }
  .phase-dot.awaiting { background: #eab308; }
  .phase-dot.failed { background: #ef4444; }

  .phase-label {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    margin-top: 3px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .phase-label .current-phase { font-weight: 600; color: var(--vscode-foreground); }

  .approval-bar {
    display: none;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: color-mix(in srgb, #eab308 10%, var(--vscode-editor-background));
    align-items: center;
    flex-shrink: 0;
  }
  .approval-bar.active { display: flex; }
  .approval-bar .label {
    flex: 1;
    font-size: 11px;
    font-weight: 600;
  }
  .approval-bar button {
    padding: 3px 10px;
    border-radius: 3px;
    border: none;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-approve { background: #22c55e; color: #000; }
  .btn-approve:hover { background: #16a34a; }
  .btn-reject { background: #ef4444; color: #fff; }
  .btn-reject:hover { background: #dc2626; }

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
</style>
</head>
<body>
  <div class="pipeline-bar" id="pipelineBar">
    <div class="objective" id="pipelineObj"></div>
    <div class="phase-track" id="phaseTrack"></div>
    <div class="phase-label">
      <span class="current-phase" id="currentPhase"></span>
      <span id="pipelineStatus"></span>
    </div>
  </div>

  <div class="approval-bar" id="approvalBar">
    <span class="label" id="approvalLabel">Phase awaiting approval</span>
    <button class="btn-approve" id="approveBtn">Approve</button>
    <button class="btn-reject" id="rejectBtn">Reject</button>
  </div>

  <div class="messages" id="messages">
    <div class="empty" id="emptyState">
      <h3>ThinkCoffee Agents</h3>
      <p>Multi-agent pipeline for your project.<br>Chat with agents, create pipelines, approve phases.</p>
      <div class="quick-actions">
        <button onclick="insertCmd('/pipeline ')">New Pipeline</button>
        <button onclick="insertCmd('/status')">Pipeline Status</button>
        <button onclick="insertCmd('@files list ')">List Files</button>
        <button onclick="insertCmd('@terminal ')">Run Command</button>
      </div>
    </div>
  </div>

  <div class="input-area">
    <div class="input-wrap">
      <textarea id="input" placeholder="Message agents... (/ for commands)" rows="1"></textarea>
      <button class="send-btn" id="sendBtn" title="Send">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
    <div class="hints">
      <strong>/pipeline</strong> create &bull;
      <strong>/approve</strong> &bull;
      <strong>/reject</strong> &bull;
      <strong>/status</strong> &bull;
      <strong>@gh</strong> &bull;
      <strong>@terminal</strong> &bull;
      <strong>@files</strong>
    </div>
  </div>

<script>
  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById('messages');
  const emptyEl = document.getElementById('emptyState');
  const inputEl = document.getElementById('input');
  const sendBtn = document.getElementById('sendBtn');
  const pipelineBar = document.getElementById('pipelineBar');
  const phaseTrack = document.getElementById('phaseTrack');
  const pipelineObj = document.getElementById('pipelineObj');
  const currentPhaseEl = document.getElementById('currentPhase');
  const pipelineStatusEl = document.getElementById('pipelineStatus');
  const approvalBar = document.getElementById('approvalBar');
  const approvalLabel = document.getElementById('approvalLabel');
  const approveBtn = document.getElementById('approveBtn');
  const rejectBtn = document.getElementById('rejectBtn');

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
      pipelineBar.classList.remove('active');
      approvalBar.classList.remove('active');
      return;
    }
    pipelineBar.classList.add('active');
    pipelineObj.textContent = pipeline.objective;

    phaseTrack.innerHTML = '';
    let awaitingPhaseName = '';
    pipeline.phases.forEach(ph => {
      const dot = document.createElement('div');
      dot.className = 'phase-dot';
      dot.title = ph.name + ' (' + ph.status + ')';
      if (ph.status === 'completed' || ph.status === 'approved') dot.classList.add('completed');
      else if (ph.status === 'in-progress') dot.classList.add('in-progress');
      else if (ph.status === 'awaiting-approval') { dot.classList.add('awaiting'); awaitingPhaseName = ph.name; }
      else if (ph.status === 'failed') dot.classList.add('failed');
      phaseTrack.appendChild(dot);
    });

    const cp = pipeline.phases[pipeline.currentPhase];
    currentPhaseEl.textContent = cp ? cp.name : 'Done';
    pipelineStatusEl.textContent = pipeline.status;

    if (awaitingPhaseName) {
      approvalBar.classList.add('active');
      approvalLabel.textContent = awaitingPhaseName + ' awaiting approval';
    } else {
      approvalBar.classList.remove('active');
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

      div.innerHTML =
        '<div class="msg-header">' +
          '<div class="avatar" style="background:' + color + '">' + initials + '</div>' +
          '<span class="sender" style="color:' + color + '">' + escHtml(m.senderLabel || m.sender) + '</span>' +
          '<span class="type-pill ' + m.type + '">' + m.type + '</span>' +
          '<span class="time">' + new Date(m.timestamp).toLocaleTimeString() + '</span>' +
        '</div>' +
        '<div class="msg-body">' + renderMd(m.content) + '</div>';
      messagesEl.appendChild(div);
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function insertCmd(cmd) {
    inputEl.value = cmd;
    inputEl.focus();
  }

  function send() {
    const text = inputEl.value.trim();
    if (!text) return;
    vscode.postMessage({ command: 'send', text });
    inputEl.value = '';
    inputEl.style.height = '32px';
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  inputEl.addEventListener('input', () => {
    inputEl.style.height = '32px';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  approveBtn.addEventListener('click', () => vscode.postMessage({ command: 'approve' }));
  rejectBtn.addEventListener('click', () => {
    const fb = prompt('Feedback for agents:');
    if (fb) vscode.postMessage({ command: 'reject', feedback: fb });
  });

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.command === 'state') {
      if (msg.data.agents) currentAgents = msg.data.agents;
      renderPipeline(msg.data.pipeline);
      renderMessages(msg.data.messages);
    } else if (msg.command === 'pipeline') {
      renderPipeline(msg.data);
    }
  });

  vscode.postMessage({ command: 'ready' });
</script>
</body>
</html>`;
  }
}
