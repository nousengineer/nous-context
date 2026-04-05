import * as vscode from 'vscode';
import {
  ChatService, PipelineService, ContextService, DecisionService,
  AGENT_META, loadAgentConfig, saveAgentConfig, getModelForAgent,
  DEFAULT_AGENT_MODELS, AVAILABLE_MODELS,
} from '@thinkcoffee/core';
import type {
  AgentRole, Pipeline, AgentTask, ChatMessage, AgentModelConfig, PMModelAssignment,
} from '@thinkcoffee/core';
import fs from 'fs';
import path from 'path';

// ─── Types ───────────────────────────────────────────────────

interface RunningAgent {
  role: AgentRole;
  taskId: string;
  pipelineId: string;
  cts: vscode.CancellationTokenSource;
  startedAt: number;
}

interface AgentContext {
  projectId: string;
  projectName: string;
  workspace: string;
  objective: string;
  previousOutputs: { agent: AgentRole; output: string }[];
  task: AgentTask;
  rejectionFeedback?: string;
}

// ─── System Prompts ──────────────────────────────────────────

function buildSystemPrompt(role: AgentRole, ctx: AgentContext): string {
  const meta = AGENT_META[role];
  const base = `Voce e o ${meta.label} do time ThinkCoffee.
${meta.description}

## Projeto
- Nome: ${ctx.projectName}
- Workspace: ${ctx.workspace}
- Objetivo do pipeline: ${ctx.objective}

## Sua tarefa
${ctx.task.title}: ${ctx.task.description}

## Regras
- Responda em portugues (BR) a menos que o contexto exija ingles tecnico
- Seja objetivo e pratico — foque em output acionavel
- Se precisar de outro agente, mencione-o com @role (ex: @backend, @frontend)
- Formate sua resposta com markdown
- NAO use emojis — nunca`;

  const prev = ctx.previousOutputs.length > 0
    ? '\n\n## Outputs anteriores dos agentes\n' + ctx.previousOutputs.map(
      p => `### ${AGENT_META[p.agent].label}\n${p.output.substring(0, 3000)}`
    ).join('\n\n')
    : '';

  const feedback = ctx.rejectionFeedback
    ? `\n\n## FEEDBACK DE REJEICAO (prioridade alta)\n${ctx.rejectionFeedback}`
    : '';

  return base + prev + feedback;
}

function buildPMAutoAssignPrompt(objective: string, phases: { name: string; agents: AgentRole[] }[]): string {
  const models = AVAILABLE_MODELS.map(m => `- \`${m.family}\` (${m.label}, tier: ${m.tier})`).join('\n');
  const agents = phases.flatMap(p => p.agents).map(a => `- ${a}: ${AGENT_META[a].description}`).join('\n');

  return `Voce e o Product Manager (rodando em claude-opus-4.6).
Seu trabalho agora e ESCOLHER qual modelo de IA cada agente do pipeline deve usar.

## Objetivo do pipeline
${objective}

## Agentes no pipeline
${agents}

## Modelos disponiveis
${models}

## Regras de escolha
- PM (voce) SEMPRE usa claude-opus-4.6 (ja definido, nao mude)
- Para tarefas complexas de raciocinio/arquitetura: use claude-opus-4.5, claude-opus-4.6, gemini-2.5-pro ou gemini-3.1-pro
- Para implementacao de codigo: use gpt-5.3-codex, gpt-5.2-codex ou grok-code-fast-1
- Para tarefas padrao: use claude-sonnet-4.6, claude-sonnet-4.5 ou gpt-5.2
- Para tarefas leves/rapidas: use claude-haiku-4.5, gpt-5.4-mini, gpt-5-mini ou raptor-mini
- Code Review deve ser um modelo forte (opus ou gemini pro)

Responda APENAS com JSON valido, sem markdown. Formato:
[{"role": "architect", "model": "claude-opus-4", "reason": "arquitetura complexa"}, ...]

NAO inclua product-manager na lista (ja esta definido).`;
}

// ─── Agent Tools ─────────────────────────────────────────────

function getAgentTools(workspace: string): vscode.LanguageModelChatTool[] {
  return [
    {
      name: 'read_file',
      description: 'Read a file from the workspace. Returns file contents.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from workspace root' },
        },
        required: ['path'],
      },
    },
    {
      name: 'list_files',
      description: 'List files/directories at a path in the workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from workspace root (use "." for root)' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description: 'Write content to a file in the workspace. Creates directories as needed.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from workspace root' },
          content: { type: 'string', description: 'Full file content to write' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'search_code',
      description: 'Search for a text pattern across workspace files. Returns matching lines with file paths.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Text or regex pattern to search for' },
          fileGlob: { type: 'string', description: 'Optional glob pattern to filter files (e.g. **/*.ts)' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'run_command',
      description: 'Run a shell command in the workspace directory. Returns stdout/stderr.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
        },
        required: ['command'],
      },
    },
    {
      name: 'mention_agent',
      description: 'Request another agent to handle a specific subtask. The mentioned agent will be triggered after you finish.',
      inputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'string', description: 'Agent role to mention (e.g. backend, frontend, qa)' },
          message: { type: 'string', description: 'What you need this agent to do' },
        },
        required: ['agent', 'message'],
      },
    },
  ];
}

async function handleToolCall(
  toolCall: vscode.LanguageModelToolCallPart,
  workspace: string,
  chat: ChatService,
  agentRole: AgentRole,
): Promise<string> {
  const input = toolCall.input as Record<string, string>;

  switch (toolCall.name) {
    case 'read_file': {
      const abs = path.resolve(workspace, input.path);
      if (!abs.startsWith(workspace)) return 'Error: Path traversal denied';
      try {
        const content = fs.readFileSync(abs, 'utf-8');
        const lines = content.split('\n');
        return lines.length > 500
          ? lines.slice(0, 500).join('\n') + `\n... (${lines.length - 500} more lines)`
          : content;
      } catch (e: any) {
        return `Error reading file: ${e.message}`;
      }
    }
    case 'list_files': {
      const target = path.resolve(workspace, input.path || '.');
      if (!target.startsWith(workspace) && target !== workspace) return 'Error: Path traversal denied';
      try {
        const entries = fs.readdirSync(target, { withFileTypes: true });
        return entries
          .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
          .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
          })
          .map(e => e.isDirectory() ? `${e.name}/` : e.name)
          .join('\n');
      } catch (e: any) {
        return `Error listing files: ${e.message}`;
      }
    }
    case 'write_file': {
      const abs = path.resolve(workspace, input.path);
      if (!abs.startsWith(workspace)) return 'Error: Path traversal denied';
      try {
        const dir = path.dirname(abs);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(abs, input.content, 'utf-8');
        chat.send({
          sender: agentRole,
          senderLabel: AGENT_META[agentRole].label,
          content: `Arquivo escrito: \`${input.path}\``,
          type: 'code',
        });
        return `File written: ${input.path}`;
      } catch (e: any) {
        return `Error writing file: ${e.message}`;
      }
    }
    case 'search_code': {
      try {
        const glob = input.fileGlob || '**/*';
        const results = await vscode.workspace.findFiles(glob, '**/node_modules/**', 50);
        const matches: string[] = [];
        const regex = new RegExp(input.pattern, 'gi');
        for (const uri of results) {
          try {
            const content = fs.readFileSync(uri.fsPath, 'utf-8');
            const lines = content.split('\n');
            lines.forEach((line, i) => {
              if (regex.test(line)) {
                const rel = path.relative(workspace, uri.fsPath).replace(/\\/g, '/');
                matches.push(`${rel}:${i + 1}: ${line.trim()}`);
              }
              regex.lastIndex = 0;
            });
          } catch { /* skip binary files */ }
          if (matches.length >= 100) break;
        }
        return matches.length > 0 ? matches.join('\n') : 'No matches found.';
      } catch (e: any) {
        return `Error searching: ${e.message}`;
      }
    }
    case 'run_command': {
      try {
        const { execSync } = require('child_process');
        const output = execSync(input.command, {
          cwd: workspace,
          encoding: 'utf-8',
          timeout: 30000,
          shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
        });
        chat.send({
          sender: agentRole,
          senderLabel: AGENT_META[agentRole].label,
          content: `\`${input.command}\`\n\n\`\`\`\n${(output || '(no output)').trim().substring(0, 2000)}\n\`\`\``,
          type: 'code',
        });
        return output.trim().substring(0, 4000) || '(no output)';
      } catch (e: any) {
        return `Command failed: ${e.stderr || e.message}`.substring(0, 2000);
      }
    }
    case 'mention_agent': {
      // Record the mention — AgentService will pick it up
      return `Mentioned @${input.agent}: "${input.message}" — will be triggered after your task completes.`;
    }
    default:
      return `Unknown tool: ${toolCall.name}`;
  }
}

// ─── AgentService ────────────────────────────────────────────

export class AgentService {
  private _running = new Map<string, RunningAgent>(); // taskId -> RunningAgent
  private _directInvocations = new Set<AgentRole>(); // roles with active direct invocations
  private _pendingMentions: { from: AgentRole; to: AgentRole; message: string }[] = [];
  private _chat: ChatService;
  private _pipelines: PipelineService;
  private _contexts: ContextService;
  private _decisions: DecisionService;
  private _getProject: () => { id: string; name: string } | null;
  private _onAgentStateChange = new vscode.EventEmitter<void>();
  readonly onAgentStateChange = this._onAgentStateChange.event;

  constructor(
    chat: ChatService,
    pipelines: PipelineService,
    contexts: ContextService,
    decisions: DecisionService,
    getProject: () => { id: string; name: string } | null,
  ) {
    this._chat = chat;
    this._pipelines = pipelines;
    this._contexts = contexts;
    this._decisions = decisions;
    this._getProject = getProject;
  }

  /** Get currently running agents */
  getRunning(): { role: AgentRole; taskId: string; elapsed: number }[] {
    const pipelineAgents = Array.from(this._running.values()).map(r => ({
      role: r.role,
      taskId: r.taskId,
      elapsed: Date.now() - r.startedAt,
    }));
    // Include direct invocations
    for (const role of this._directInvocations) {
      if (!pipelineAgents.some(a => a.role === role)) {
        pipelineAgents.push({ role, taskId: `direct-${role}`, elapsed: 0 });
      }
    }
    return pipelineAgents;
  }

  /** Stop a running agent */
  stopAgent(taskId: string): void {
    const running = this._running.get(taskId);
    if (running) {
      running.cts.cancel();
      this._running.delete(taskId);
      this._chat.send({
        sender: 'system',
        senderLabel: 'Pipeline',
        content: `${AGENT_META[running.role].label} foi cancelado.`,
        type: 'info',
      });
      this._onAgentStateChange.fire();
    }
  }

  /** Stop all running agents */
  stopAll(): void {
    for (const [taskId] of this._running) {
      this.stopAgent(taskId);
    }
  }

  // ─── Auto-assign models via PM (Opus) ───────────────────

  async autoAssignModels(pipeline: Pipeline): Promise<AgentModelConfig | null> {
    const project = this._getProject();
    if (!project) return null;

    this._chat.send({
      sender: 'product-manager',
      senderLabel: 'PM (Opus)',
      content: 'Analisando pipeline para decidir qual modelo cada agente deve usar...',
      type: 'info',
    });

    try {
      const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'claude-opus-4.6' });
      if (!model) {
        this._chat.send({
          sender: 'system', senderLabel: 'System',
          content: 'claude-opus-4.6 nao disponivel. Usando configuracao padrao.',
          type: 'error',
        });
        return null;
      }

      const prompt = buildPMAutoAssignPrompt(
        pipeline.objective,
        pipeline.phases.map(p => ({ name: p.name, agents: p.agents })),
      );

      const messages = [vscode.LanguageModelChatMessage.User(prompt)];
      const cts = new vscode.CancellationTokenSource();
      const response = await model.sendRequest(messages, {}, cts.token);

      let fullText = '';
      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          fullText += part.value;
        }
      }
      cts.dispose();

      // Parse JSON response
      const jsonMatch = fullText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('PM nao retornou JSON valido');

      const assignments: PMModelAssignment[] = JSON.parse(jsonMatch[0]);
      const config = loadAgentConfig();
      config.mode = 'auto';

      for (const a of assignments) {
        if (a.role !== 'product-manager') {
          config.models[a.role as AgentRole] = a.model;
        }
      }

      saveAgentConfig(config);

      // Report assignments in chat
      const report = assignments.map(a =>
        `- **${AGENT_META[a.role as AgentRole]?.label || a.role}**: \`${a.model}\` — ${a.reason}`
      ).join('\n');

      this._chat.send({
        sender: 'product-manager',
        senderLabel: 'PM (Opus)',
        content: `Modelos atribuidos pelo PM:\n\n${report}\n\n- **Product Manager**: \`claude-opus-4.6\` --- obrigatorio`,
        type: 'response',
      });

      return config;

    } catch (err: any) {
      this._chat.send({
        sender: 'system', senderLabel: 'System',
        content: `Falha ao auto-atribuir modelos: ${err.message}. Usando padrao.`,
        type: 'error',
      });
      return null;
    }
  }

  // ─── Run pipeline phase ─────────────────────────────────

  async runPhase(projectId: string, pipelineId: string): Promise<void> {
    const pipeline = this._pipelines.get(projectId, pipelineId);
    if (!pipeline) return;

    const phase = pipeline.phases[pipeline.currentPhase];
    if (!phase || phase.status !== 'in-progress') return;

    const workspace = pipeline.workspace || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const project = this._getProject();
    if (!project) return;

    // Collect prior outputs from completed phases
    const previousOutputs: { agent: AgentRole; output: string }[] = [];
    for (let i = 0; i < pipeline.currentPhase; i++) {
      for (const task of pipeline.phases[i].tasks) {
        if (task.output) {
          previousOutputs.push({ agent: task.agent, output: task.output });
        }
      }
    }

    this._chat.send({
      sender: 'system',
      senderLabel: 'Pipeline',
      content: `Fase **${phase.name}** iniciada. Agentes: ${phase.agents.map(a => AGENT_META[a].label).join(', ')}${phase.parallel ? ' (paralelo)' : ''}`,
      type: 'info',
    });

    // Check for rejection feedback
    const rejectionFeedback = (phase as any).rejectionFeedback;

    if (phase.parallel) {
      // Run all agents in parallel
      const promises = phase.tasks.map(task =>
        this._runAgent(task, {
          projectId: project.id,
          projectName: project.name,
          workspace,
          objective: pipeline.objective,
          previousOutputs,
          task,
          rejectionFeedback,
        }, pipelineId)
      );
      await Promise.allSettled(promises);
    } else {
      // Run sequentially
      for (const task of phase.tasks) {
        await this._runAgent(task, {
          projectId: project.id,
          projectName: project.name,
          workspace,
          objective: pipeline.objective,
          previousOutputs,
          task,
          rejectionFeedback,
        }, pipelineId);
      }
    }

    // Process pending @mentions from this phase
    await this._processPendingMentions(projectId, pipelineId, workspace, previousOutputs);
  }

  // ─── Run a single agent ─────────────────────────────────

  private async _runAgent(task: AgentTask, ctx: AgentContext, pipelineId: string): Promise<void> {
    const role = task.agent;
    const config = loadAgentConfig();
    const modelFamily = getModelForAgent(role, config);

    // Select model
    let model: vscode.LanguageModelChat;
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: modelFamily });
      if (!models.length) {
        // Fallback to any available model
        const fallback = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        if (!fallback.length) throw new Error('Nenhum modelo Copilot disponivel');
        model = fallback[0];
        this._chat.send({
          sender: 'system', senderLabel: 'System',
          content: `${modelFamily} indisponivel para ${AGENT_META[role].label}. Usando ${fallback[0].family}.`,
          type: 'info',
        });
      } else {
        model = models[0];
      }
    } catch (err: any) {
      this._pipelines.failTask(ctx.projectId, pipelineId, task.id, err.message);
      this._chat.send({
        sender: role, senderLabel: AGENT_META[role].label,
        content: `Falha ao iniciar: ${err.message}`,
        type: 'error',
      });
      return;
    }

    // Start task in pipeline
    this._pipelines.startTask(ctx.projectId, pipelineId, task.id);

    const cts = new vscode.CancellationTokenSource();
    this._running.set(task.id, { role, taskId: task.id, pipelineId, cts, startedAt: Date.now() });
    this._onAgentStateChange.fire();

    // Announce in chat
    this._chat.send({
      sender: role,
      senderLabel: AGENT_META[role].label,
      content: `Iniciando: **${task.title}** (modelo: \`${model.family}\`)`,
      type: 'info',
    });

    const workspace = ctx.workspace;
    const tools = getAgentTools(workspace);
    const systemPrompt = buildSystemPrompt(role, ctx);
    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(systemPrompt, 'system'),
      vscode.LanguageModelChatMessage.User(
        `Execute sua tarefa agora. Use as ferramentas disponiveis para ler/escrever arquivos e executar comandos conforme necessario.\n\nTarefa: ${task.title}\n${task.description}`,
        role,
      ),
    ];

    try {
      let fullOutput = '';
      let toolCallRounds = 0;
      const MAX_TOOL_ROUNDS = 15;

      while (toolCallRounds < MAX_TOOL_ROUNDS) {
        const response = await model.sendRequest(messages, { tools }, cts.token);

        let textAccum = '';
        const pendingToolCalls: vscode.LanguageModelToolCallPart[] = [];

        for await (const part of response.stream) {
          if (cts.token.isCancellationRequested) break;

          if (part instanceof vscode.LanguageModelTextPart) {
            textAccum += part.value;
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            pendingToolCalls.push(part);
          }
        }

        if (textAccum) {
          fullOutput += textAccum;
          // Post text to chat (chunked if long)
          const chunks = splitMessage(textAccum, 3000);
          for (const chunk of chunks) {
            this._chat.send({
              sender: role,
              senderLabel: AGENT_META[role].label,
              content: chunk,
              type: 'response',
            });
          }
        }

        // No tool calls — done
        if (pendingToolCalls.length === 0) break;

        // Handle tool calls
        toolCallRounds++;

        // Add assistant message with tool calls
        messages.push(vscode.LanguageModelChatMessage.Assistant(
          pendingToolCalls.map(tc => new vscode.LanguageModelToolCallPart(tc.callId, tc.name, tc.input)),
        ));

        // Execute tools and add results
        const toolResults: vscode.LanguageModelToolResultPart[] = [];
        for (const tc of pendingToolCalls) {
          // Check for @mentions
          if (tc.name === 'mention_agent') {
            const input = tc.input as { agent: string; message: string };
            this._pendingMentions.push({
              from: role,
              to: input.agent as AgentRole,
              message: input.message,
            });
            this._chat.send({
              sender: role,
              senderLabel: AGENT_META[role].label,
              content: `@${input.agent} ${input.message}`,
              type: 'request',
              mentions: [input.agent],
            });
          }

          const result = await handleToolCall(tc, workspace, this._chat, role);
          toolResults.push(
            new vscode.LanguageModelToolResultPart(tc.callId, [new vscode.LanguageModelTextPart(result)])
          );
        }

        // Add tool results as user message
        messages.push(vscode.LanguageModelChatMessage.User(toolResults));
      }

      // Task complete
      this._pipelines.completeTask(ctx.projectId, pipelineId, task.id, fullOutput);
      this._pipelines.saveAgentHistory(
        ctx.projectId, pipelineId, task.id,
        this._contexts, this._decisions,
      ).catch(() => {});

      this._chat.send({
        sender: role,
        senderLabel: AGENT_META[role].label,
        content: `Tarefa concluida: **${task.title}**`,
        type: 'info',
      });

    } catch (err: any) {
      if (cts.token.isCancellationRequested) {
        this._pipelines.failTask(ctx.projectId, pipelineId, task.id, 'Cancelado pelo usuario');
      } else {
        const errMsg = err instanceof vscode.LanguageModelError
          ? `LM Error (${err.code}): ${err.message}`
          : err.message || String(err);
        this._pipelines.failTask(ctx.projectId, pipelineId, task.id, errMsg);
        this._chat.send({
          sender: role, senderLabel: AGENT_META[role].label,
          content: `Erro: ${errMsg}`,
          type: 'error',
        });
      }
    } finally {
      cts.dispose();
      this._running.delete(task.id);
      this._onAgentStateChange.fire();
    }
  }

  // ─── Process @mentions ──────────────────────────────────

  private async _processPendingMentions(
    projectId: string,
    pipelineId: string,
    workspace: string,
    previousOutputs: { agent: AgentRole; output: string }[],
  ): Promise<void> {
    const mentions = [...this._pendingMentions];
    this._pendingMentions = [];

    for (const mention of mentions) {
      // Check if this agent is in a future phase — if so, it will run when that phase starts
      // For now, we just log the mention; the pipeline flow handles ordering
      this._chat.send({
        sender: 'system',
        senderLabel: 'Pipeline',
        content: `${AGENT_META[mention.from].label} solicitou @${mention.to}: ${mention.message}`,
        type: 'info',
      });
    }
  }

  // ─── Direct agent invocation (outside pipeline) ─────────

  async invokeAgent(role: AgentRole, userMessage: string): Promise<void> {
    const project = this._getProject();
    if (!project) {
      this._chat.send({
        sender: 'system', senderLabel: 'System',
        content: 'Nenhum projeto ativo.',
        type: 'error',
      });
      return;
    }

    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const config = loadAgentConfig();
    const modelFamily = getModelForAgent(role, config);

    let model: vscode.LanguageModelChat;
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: modelFamily });
      if (!models.length) {
        const fallback = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        if (!fallback.length) throw new Error('Nenhum modelo Copilot disponivel');
        model = fallback[0];
      } else {
        model = models[0];
      }
    } catch (err: any) {
      this._chat.send({
        sender: 'system', senderLabel: 'System',
        content: `Erro ao selecionar modelo para ${AGENT_META[role].label}: ${err.message}`,
        type: 'error',
      });
      return;
    }

    this._chat.send({
      sender: role,
      senderLabel: AGENT_META[role].label,
      content: `Processando... (modelo: \`${model.family}\`)`,
      type: 'info',
    });

    // Track direct invocation so typing indicator shows
    this._directInvocations.add(role);
    this._onAgentStateChange.fire();

    const meta = AGENT_META[role];
    const systemPrompt = `Voce e o ${meta.label} do time ThinkCoffee.\n${meta.description}\n\nProjeto: ${project.name}\nWorkspace: ${workspace}\n\nResponda em portugues (BR). Seja objetivo. NAO use emojis.`;

    const messages = [
      vscode.LanguageModelChatMessage.User(systemPrompt, 'system'),
      vscode.LanguageModelChatMessage.User(userMessage, 'user'),
    ];

    const tools = getAgentTools(workspace);
    const cts = new vscode.CancellationTokenSource();

    try {
      let fullOutput = '';
      let rounds = 0;
      const MAX_ROUNDS = 10;

      while (rounds < MAX_ROUNDS) {
        const response = await model.sendRequest(messages, { tools }, cts.token);
        let textAccum = '';
        const toolCalls: vscode.LanguageModelToolCallPart[] = [];

        for await (const part of response.stream) {
          if (part instanceof vscode.LanguageModelTextPart) {
            textAccum += part.value;
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            toolCalls.push(part);
          }
        }

        if (textAccum) {
          fullOutput += textAccum;
          const chunks = splitMessage(textAccum, 3000);
          for (const chunk of chunks) {
            this._chat.send({
              sender: role,
              senderLabel: AGENT_META[role].label,
              content: chunk,
              type: 'response',
            });
          }
        }

        if (toolCalls.length === 0) break;
        rounds++;

        messages.push(vscode.LanguageModelChatMessage.Assistant(
          toolCalls.map(tc => new vscode.LanguageModelToolCallPart(tc.callId, tc.name, tc.input)),
        ));

        const results: vscode.LanguageModelToolResultPart[] = [];
        for (const tc of toolCalls) {
          const result = await handleToolCall(tc, workspace, this._chat, role);
          results.push(new vscode.LanguageModelToolResultPart(tc.callId, [new vscode.LanguageModelTextPart(result)]));
        }
        messages.push(vscode.LanguageModelChatMessage.User(results));
      }
    } catch (err: any) {
      const errMsg = err instanceof vscode.LanguageModelError
        ? `LM Error (${err.code}): ${err.message}`
        : err.message || String(err);
      this._chat.send({
        sender: role, senderLabel: AGENT_META[role].label,
        content: `Erro: ${errMsg}`,
        type: 'error',
      });
    } finally {
      this._directInvocations.delete(role);
      this._onAgentStateChange.fire();
      cts.dispose();
    }
  }

  dispose(): void {
    this.stopAll();
    this._onAgentStateChange.dispose();
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at paragraph or line boundary
    let splitIdx = remaining.lastIndexOf('\n\n', maxLen);
    if (splitIdx < maxLen * 0.3) splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx < maxLen * 0.3) splitIdx = maxLen;
    chunks.push(remaining.substring(0, splitIdx));
    remaining = remaining.substring(splitIdx).trimStart();
  }
  return chunks;
}
