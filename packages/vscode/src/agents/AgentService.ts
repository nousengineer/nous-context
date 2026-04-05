import * as vscode from 'vscode';
import {
  ChatService, PipelineService, ContextService, DecisionService,
  AGENT_META, loadAgentConfig, saveAgentConfig, getModelForAgent,
  DEFAULT_AGENT_MODELS, AVAILABLE_MODELS,
} from '@thinkcoffee/core';
import type {
  AgentRole, Pipeline, AgentTask, ChatMessage, AgentModelConfig, PMModelAssignment, PhaseTemplate,
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

## Regras criticas
1. VOCE DEVE USAR a ferramenta write_file para criar/editar arquivos. NAO apenas descreva o que faria — FACA.
2. Primeiro leia o codigo existente (read_file, list_files), depois escreva os arquivos.
3. Cada deliverable (documento, codigo, config, teste) deve ser um arquivo escrito no workspace via write_file.
4. Se sua tarefa e de arquitetura/planejamento, escreva o documento em um arquivo .md no workspace.
5. Se sua tarefa e de codigo, escreva os arquivos .ts/.tsx/.js etc no workspace.
6. Responda em portugues (BR) a menos que o contexto exija ingles tecnico.
7. Seja objetivo e pratico — foque em output acionavel.
8. Se precisar de outro agente, mencione-o com @role (ex: @backend, @frontend).
9. Formate sua resposta com markdown.
10. NAO use emojis — nunca.`;

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

function buildPMPlanPhasesPrompt(objective: string): string {
  const roles = Object.entries(AGENT_META)
    .map(([role, meta]) => `- \`${role}\`: ${meta.description}`)
    .join('\n');

  return `Voce e o Product Manager (PM) do time ThinkCoffee, rodando em claude-opus-4.6.
Seu trabalho agora e PLANEJAR AS FASES da pipeline para o objetivo abaixo.

## Objetivo
${objective}

## Agentes disponiveis
${roles}

## Regras
- Voce decide QUANTAS fases, QUAIS sao as fases, e QUAIS AGENTES participam de cada fase
- Cada fase tem: name (string), order (int comecando de 0), parallel (bool — se os agentes da fase rodam em paralelo), agents (lista de roles)
- Cada fase pode ter 1 ou mais agentes
- A PRIMEIRA fase deve SEMPRE incluir "product-manager" para planejamento
- Fases de implementacao que tem backend+frontend+devops podem ser paralelas
- Fases de teste e review devem vir DEPOIS da implementacao
- NAO crie fases desnecessarias. Se o objetivo for simples, menos fases. Se for complexo, mais fases
- Voce pode customizar a descricao da tarefa de cada agente em cada fase via taskDescriptions
- Se precisar de uma fase de "Refatoracao", "Design de UI", "Seguranca", etc, voce pode criar

## Formato de resposta
Responda APENAS com JSON valido (array), sem markdown, sem explicacao. Formato:
[
  {
    "name": "Planning",
    "order": 0,
    "parallel": false,
    "agents": ["product-manager"],
    "taskDescriptions": {
      "product-manager": {
        "title": "Definir requisitos e backlog",
        "description": "Analisar objetivo e produzir requisitos, criterios de aceite, user stories."
      }
    }
  },
  {
    "name": "Architecture",
    "order": 1,
    "parallel": false,
    "agents": ["architect"],
    "taskDescriptions": {
      "architect": {
        "title": "Definir arquitetura tecnica",
        "description": "Stack, estrutura de pastas, contratos de API, modelo de dados."
      }
    }
  }
]

Pense bem no objetivo e crie as fases mais adequadas. Adapte a pipeline ao projeto.`;
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
  private _activePipelineLoop: string | null = null; // pipelineId of active PM oversight loop
  private _getChat: () => ChatService;
  private _pipelines: PipelineService;
  private _contexts: ContextService;
  private _decisions: DecisionService;
  private _getProject: () => { id: string; name: string } | null;
  private _onAgentStateChange = new vscode.EventEmitter<void>();
  readonly onAgentStateChange = this._onAgentStateChange.event;

  /** Shorthand to get the active chat */
  private get _chat(): ChatService { return this._getChat(); }

  constructor(
    getChat: () => ChatService,
    pipelines: PipelineService,
    contexts: ContextService,
    decisions: DecisionService,
    getProject: () => { id: string; name: string } | null,
  ) {
    this._getChat = getChat;
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

  // ─── PM plans the phases ─────────────────────────────────

  async planPhases(objective: string): Promise<PhaseTemplate[] | null> {
    this._chat.send({
      sender: 'product-manager',
      senderLabel: 'PM (Opus)',
      content: 'Analisando o objetivo para planejar as fases da pipeline...',
      type: 'info',
    });

    try {
      const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'claude-opus-4.6' });
      if (!model) {
        this._chat.send({
          sender: 'system', senderLabel: 'System',
          content: 'claude-opus-4.6 nao disponivel. Usando fases padrao.',
          type: 'error',
        });
        return null;
      }

      const prompt = buildPMPlanPhasesPrompt(objective);
      const messages = [vscode.LanguageModelChatMessage.User(prompt)];
      const cts = new vscode.CancellationTokenSource();

      // Track PM as running for typing indicator
      this._directInvocations.add('product-manager');
      this._onAgentStateChange.fire();

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
      if (!jsonMatch) throw new Error('PM nao retornou JSON valido para as fases');

      const rawPhases: any[] = JSON.parse(jsonMatch[0]);

      // Validate and cast
      const phases: PhaseTemplate[] = rawPhases.map((rp, idx) => ({
        name: String(rp.name || `Phase ${idx + 1}`),
        order: typeof rp.order === 'number' ? rp.order : idx,
        parallel: Boolean(rp.parallel),
        agents: (rp.agents as string[]).filter((a: string) =>
          Object.keys(AGENT_META).includes(a)
        ) as AgentRole[],
        taskDescriptions: rp.taskDescriptions,
      }));

      // Ensure at least one phase with a valid agent
      if (phases.length === 0 || phases.some(p => p.agents.length === 0)) {
        throw new Error('PM retornou fases invalidas (sem agentes)');
      }

      // Report to chat
      const report = phases.map((p, i) =>
        `${i + 1}. **${p.name}** — ${p.agents.map(a => AGENT_META[a as AgentRole]?.label || a).join(', ')}${p.parallel ? ' (paralelo)' : ''}`
      ).join('\n');

      this._chat.send({
        sender: 'product-manager',
        senderLabel: 'PM (Opus)',
        content: `Pipeline planejada com **${phases.length} fases**:\n\n${report}`,
        type: 'response',
      });

      return phases;
    } catch (err: any) {
      this._chat.send({
        sender: 'system', senderLabel: 'System',
        content: `Falha ao planejar fases: ${err.message}. Usando fases padrao.`,
        type: 'error',
      });
      return null;
    } finally {
      this._directInvocations.delete('product-manager');
      this._onAgentStateChange.fire();
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

    // Only run tasks that are pending (skip completed or already in-progress)
    const tasksToRun = phase.tasks.filter(t => t.status === 'pending');
    if (tasksToRun.length === 0) return;

    if (phase.parallel) {
      // Run all agents in parallel
      const promises = tasksToRun.map(task =>
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
      for (const task of tasksToRun) {
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
    const kickoff = `Execute sua tarefa agora.\n\nTarefa: ${task.title}\n${task.description}\n\nIMPORTANTE: Voce DEVE usar write_file para criar os arquivos. NAO apenas descreva em texto o que faria — use as ferramentas para LER o codigo existente e ESCREVER os arquivos no workspace. Comece lendo a estrutura com list_files e read_file, depois crie/edite arquivos com write_file.`;
    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(systemPrompt + '\n\n---\n\n' + kickoff),
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

        // Add assistant message with text + tool calls (Claude requires faithful reproduction)
        const assistantParts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
        if (textAccum) {
          assistantParts.push(new vscode.LanguageModelTextPart(textAccum));
        }
        for (const tc of pendingToolCalls) {
          assistantParts.push(new vscode.LanguageModelToolCallPart(tc.callId, tc.name, tc.input));
        }
        messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

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

      // PM reviews individual task after completion
      if (role !== 'product-manager') {
        await this._pmTaskReview(ctx.projectId, pipelineId, task, role, fullOutput);
      }

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
      // Check if this agent already has a task in the current phase
      const pipeline = this._pipelines.get(projectId, pipelineId);
      if (!pipeline) continue;

      const currentPhase = pipeline.phases[pipeline.currentPhase];
      const hasTaskInPhase = currentPhase?.tasks.some(t => t.agent === mention.to);

      if (hasTaskInPhase) {
        // Agent is in the current phase — it already ran or will run
        this._chat.send({
          sender: 'system',
          senderLabel: 'Pipeline',
          content: `${AGENT_META[mention.from].label} solicitou @${mention.to}: ${mention.message}`,
          type: 'info',
        });
      } else {
        // Agent is NOT in the current phase — invoke directly with the mention context
        this._chat.send({
          sender: 'system',
          senderLabel: 'Pipeline',
          content: `${AGENT_META[mention.from].label} invocou @${mention.to}: ${mention.message}`,
          type: 'info',
        });

        // Collect all prior outputs including the mentioning agent's output
        const allOutputs = [...previousOutputs];
        for (const task of currentPhase?.tasks || []) {
          if (task.output && !allOutputs.some(o => o.agent === task.agent)) {
            allOutputs.push({ agent: task.agent, output: task.output });
          }
        }

        // Invoke the mentioned agent directly with context from the mention
        await this.invokeAgent(mention.to, `Solicitacao de ${AGENT_META[mention.from].label}:\n\n${mention.message}\n\nContexto adicional dos outputs anteriores:\n${allOutputs.map(o => `### ${AGENT_META[o.agent].label}\n${o.output.substring(0, 2000)}`).join('\n\n')}`);
      }
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
      vscode.LanguageModelChatMessage.User(systemPrompt + '\n\n---\n\n' + userMessage),
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

        // Add assistant message with text + tool calls (Claude requires faithful reproduction)
        const assistantParts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
        if (textAccum) {
          assistantParts.push(new vscode.LanguageModelTextPart(textAccum));
        }
        for (const tc of toolCalls) {
          assistantParts.push(new vscode.LanguageModelToolCallPart(tc.callId, tc.name, tc.input));
        }
        messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

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
    this._activePipelineLoop = null;
    this.stopAll();
    this._onAgentStateChange.dispose();
  }

  /** Check if PM oversight loop is running for a pipeline */
  isPipelineLoopActive(pipelineId: string): boolean {
    return this._activePipelineLoop === pipelineId;
  }

  // ─── PM Pipeline Oversight Loop ─────────────────────────

  /**
   * Run the full pipeline with PM oversight.
   * PM monitors each phase: run agents -> PM reviews -> approve/reject -> repeat.
   * Only one loop can be active at a time.
   */
  async runPipeline(projectId: string, pipelineId: string): Promise<void> {
    // Prevent duplicate loops
    if (this._activePipelineLoop === pipelineId) return;
    this._activePipelineLoop = pipelineId;

    this._chat.send({
      sender: 'product-manager',
      senderLabel: 'PM (Opus)',
      content: 'Assumindo supervisao da pipeline. Vou acompanhar cada fase e avaliar os resultados.',
      type: 'info',
    });

    try {
      while (this._activePipelineLoop === pipelineId) {
        const pipeline = this._pipelines.get(projectId, pipelineId);
        if (!pipeline) break;

        // Pipeline done?
        if (pipeline.status === 'completed' || pipeline.status === 'failed') {
          this._chat.send({
            sender: 'product-manager',
            senderLabel: 'PM (Opus)',
            content: pipeline.status === 'completed'
              ? 'Pipeline concluida com sucesso! Todas as fases foram aprovadas.'
              : 'Pipeline falhou. Verifique os erros nos logs dos agentes.',
            type: 'info',
          });

          // On success, create feature branch + commit + PR
          if (pipeline.status === 'completed') {
            await this._pmGitFinalize(projectId, pipelineId);
          }
          break;
        }

        const phase = pipeline.phases[pipeline.currentPhase];
        if (!phase) break;

        if (phase.status === 'in-progress') {
          // Run the phase agents
          await this.runPhase(projectId, pipelineId);

          // Re-read pipeline — PM task review may have reset tasks to pending
          const updated = this._pipelines.get(projectId, pipelineId);
          if (!updated) break;
          const updPhase = updated.phases[updated.currentPhase];
          if (!updPhase) break;

          // Check for failed tasks — PM decides how to handle
          const failedTasks = updPhase.tasks.filter(t => t.status === 'failed');
          if (failedTasks.length > 0) {
            const decision = await this._pmHandleFailedTasks(projectId, pipelineId, failedTasks);
            if (decision === 'abort') {
              // Mark pipeline as failed
              const p = this._pipelines.get(projectId, pipelineId);
              if (p) {
                p.status = 'failed';
                updPhase.status = 'failed';
                this._pipelines.save(p);
              }
              this._chat.send({
                sender: 'product-manager',
                senderLabel: 'PM (Opus)',
                content: 'Pipeline abortada pelo PM devido a falhas criticas.',
                type: 'info',
              });
              break;
            }
            // decision === 'retry' — tasks were reset to pending, re-run
            continue;
          }

          // Check for tasks PM rejected (reset to pending)
          const pendingTasks = updPhase.tasks.filter(t => t.status === 'pending');
          if (pendingTasks.length > 0) {
            // Re-run the phase to process pending tasks
            continue;
          }

          // After runPhase completes, the phase should be awaiting-approval or failed
          // Continue the loop to check
          continue;
        }

        if (phase.status === 'awaiting-approval') {
          // PM reviews the phase
          const review = await this._pmReviewPhase(projectId, pipelineId);

          if (review.approved) {
            // Approve and advance
            const p = this._pipelines.approvePhase(projectId, pipelineId, 'product-manager');
            if (!p) break;

            this._chat.send({
              sender: 'product-manager',
              senderLabel: 'PM (Opus)',
              content: `Fase **${phase.name}** aprovada pelo PM.${p.status === 'completed' ? '\n\nPipeline concluida!' : ''}`,
              type: 'info',
            });
            this._onAgentStateChange.fire();

            if (p.status === 'completed') {
              await this._pmGitFinalize(projectId, pipelineId);
              break;
            }
            if (p.status === 'failed') break;
            // Next iteration will pick up the new in-progress phase
            continue;
          } else {
            // Reject with feedback
            this._pipelines.rejectPhase(projectId, pipelineId, review.feedback);

            this._chat.send({
              sender: 'product-manager',
              senderLabel: 'PM (Opus)',
              content: `Fase **${phase.name}** rejeitada. Agentes vao refazer com feedback:\n\n${review.feedback}`,
              type: 'info',
            });
            this._onAgentStateChange.fire();
            // Next iteration will re-run the phase (now in-progress again)
            continue;
          }
        }

        // Phase is in some other state (pending, completed, etc) — shouldn't happen, but break to be safe
        break;
      }
    } catch (err: any) {
      this._chat.send({
        sender: 'system',
        senderLabel: 'Pipeline',
        content: `Erro no loop do PM: ${err.message}`,
        type: 'error',
      });
    } finally {
      if (this._activePipelineLoop === pipelineId) {
        this._activePipelineLoop = null;
      }
      this._onAgentStateChange.fire();
    }
  }

  // ─── Model rotation on rejection ────────────────────────

  /** Pick a different model for an agent, preferring higher tiers. */
  private _pickAlternativeModel(role: AgentRole, currentModel: string): string {
    const tierRank: Record<string, number> = { premium: 4, code: 3, standard: 2, fast: 1 };
    const candidates = AVAILABLE_MODELS
      .filter(m => m.family !== currentModel && m.family !== 'claude-opus-4.6') // Never steal PM's model
      .sort((a, b) => (tierRank[b.tier] || 0) - (tierRank[a.tier] || 0));

    if (candidates.length === 0) return currentModel;

    // Prefer a model from a different vendor for diversity
    const currentVendorPrefix = currentModel.split('-')[0]; // e.g. "claude", "gpt", "gemini"
    const diffVendor = candidates.find(m => !m.family.startsWith(currentVendorPrefix));
    return (diffVendor || candidates[0]).family;
  }

  // ─── PM Individual Task Review ──────────────────────────

  /**
   * After each agent completes a task, PM evaluates the output.
   * PM can approve the task or request a redo.
   */
  private async _pmTaskReview(
    projectId: string,
    pipelineId: string,
    task: AgentTask,
    agentRole: AgentRole,
    output: string,
  ): Promise<void> {
    const pipeline = this._pipelines.get(projectId, pipelineId);
    if (!pipeline) return;

    this._chat.send({
      sender: 'product-manager',
      senderLabel: 'PM (Opus)',
      content: `Revisando tarefa de ${AGENT_META[agentRole].label}: **${task.title}**...`,
      type: 'info',
    });

    this._directInvocations.add('product-manager');
    this._onAgentStateChange.fire();

    try {
      const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'claude-opus-4.6' });
      if (!model) return; // Skip review if model unavailable

      const prompt = `Voce e o Product Manager (PM) supervisando a pipeline: "${pipeline.objective}"

## Agente: ${AGENT_META[agentRole].label}
## Tarefa: ${task.title}
## Descricao: ${task.description}

## Output do agente (ultimos 6000 chars)
${output.substring(output.length - 6000)}

## Sua tarefa
Avalie se o agente completou a tarefa adequadamente:
1. O output atende a descricao da tarefa?
2. O agente usou write_file para criar/modificar os arquivos necessarios?
3. Ha erros graves ou omissoes criticas?

Responda APENAS com JSON valido:
{"approved": true, "summary": "Breve resumo do que foi feito"}
ou
{"approved": false, "feedback": "O que precisa ser corrigido"}

Seja pragmatico — aprove se o trabalho e razoavel. Rejeite apenas se ha falhas criticas.`;

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

      const jsonMatch = fullText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;

      const result = JSON.parse(jsonMatch[0]);

      if (result.approved) {
        this._chat.send({
          sender: 'product-manager',
          senderLabel: 'PM (Opus)',
          content: `Tarefa aprovada (${AGENT_META[agentRole].label}): ${result.summary || 'OK'}`,
          type: 'info',
        });
      } else {
        // PM rejects the individual task — switch the agent's model and retry
        const config = loadAgentConfig();
        const currentModel = getModelForAgent(agentRole, config);
        const newModel = this._pickAlternativeModel(agentRole, currentModel);

        if (newModel && newModel !== currentModel) {
          config.models[agentRole] = newModel;
          saveAgentConfig(config);
        }

        const modelMsg = newModel && newModel !== currentModel
          ? `\nTrocando modelo: \`${currentModel}\` -> \`${newModel}\``
          : '';

        this._chat.send({
          sender: 'product-manager',
          senderLabel: 'PM (Opus)',
          content: `Tarefa rejeitada (${AGENT_META[agentRole].label}): ${result.feedback}\n\nAgente vai refazer.${modelMsg}`,
          type: 'info',
        });

        // Reset task to pending so the phase won't complete yet
        const p = this._pipelines.get(projectId, pipelineId);
        if (p) {
          const phase = p.phases[p.currentPhase];
          const t = phase?.tasks.find(tt => tt.id === task.id);
          if (t) {
            t.status = 'pending';
            t.output = `[PM FEEDBACK] ${result.feedback}\n\n[OUTPUT ANTERIOR]\n${(t.output || '').substring(0, 2000)}`;
            this._pipelines.save(p);
          }
        }
      }
    } catch (err: any) {
      // On error, skip review — don't block the pipeline
      this._chat.send({
        sender: 'system',
        senderLabel: 'System',
        content: `Erro no review individual do PM: ${err.message}`,
        type: 'error',
      });
    } finally {
      this._directInvocations.delete('product-manager');
      this._onAgentStateChange.fire();
    }
  }

  // ─── PM Handle Failed/Missing Agents ────────────────────

  /**
   * PM evaluates failed tasks and decides: retry them or abort the pipeline.
   * Returns 'retry' (tasks reset to pending) or 'abort'.
   */
  private async _pmHandleFailedTasks(
    projectId: string,
    pipelineId: string,
    failedTasks: AgentTask[],
  ): Promise<'retry' | 'abort'> {
    const pipeline = this._pipelines.get(projectId, pipelineId);
    if (!pipeline) return 'abort';

    const phase = pipeline.phases[pipeline.currentPhase];
    if (!phase) return 'abort';

    const failedSummary = failedTasks
      .map(t => `- **${AGENT_META[t.agent].label}** — ${t.title}: ${(t.output || 'sem output').substring(0, 1000)}`)
      .join('\n');

    this._chat.send({
      sender: 'product-manager',
      senderLabel: 'PM (Opus)',
      content: `Detectei ${failedTasks.length} tarefa(s) com falha na fase **${phase.name}**. Avaliando...`,
      type: 'info',
    });

    this._directInvocations.add('product-manager');
    this._onAgentStateChange.fire();

    try {
      const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'claude-opus-4.6' });
      if (!model) {
        // Default: retry once
        this._resetTasksToPending(pipeline, failedTasks);
        return 'retry';
      }

      const prompt = `Voce e o Product Manager (PM) supervisando a pipeline: "${pipeline.objective}"

## Fase atual: ${phase.name}
## Tarefas com falha
${failedSummary}

## Tarefa
Decida o que fazer com as tarefas que falharam:
1. "retry" — Resetar as tarefas para tentar novamente (use se o erro parece transitorio ou o agente pode corrigir)
2. "abort" — Abortar a pipeline (use APENAS se o erro e irrecuperavel e bloqueia tudo)

Responda APENAS com JSON:
{"decision": "retry", "reason": "Motivo"}
ou
{"decision": "abort", "reason": "Motivo"}

Prefira "retry" na duvida. Aborte apenas em situacoes realmente irrecuperaveis.`;

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

      const jsonMatch = fullText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this._resetTasksToPending(pipeline, failedTasks);
        return 'retry';
      }

      const result = JSON.parse(jsonMatch[0]);

      this._chat.send({
        sender: 'product-manager',
        senderLabel: 'PM (Opus)',
        content: `Decisao do PM: **${result.decision}** — ${result.reason || ''}`,
        type: 'info',
      });

      if (result.decision === 'abort') {
        return 'abort';
      }

      // Retry: reset failed tasks
      this._resetTasksToPending(pipeline, failedTasks);
      return 'retry';
    } catch (err: any) {
      this._chat.send({
        sender: 'system',
        senderLabel: 'System',
        content: `Erro no tratamento de falhas do PM: ${err.message}. Tentando retry.`,
        type: 'error',
      });
      this._resetTasksToPending(pipeline, failedTasks);
      return 'retry';
    } finally {
      this._directInvocations.delete('product-manager');
      this._onAgentStateChange.fire();
    }
  }

  private _resetTasksToPending(pipeline: Pipeline, tasks: AgentTask[]): void {
    const phase = pipeline.phases[pipeline.currentPhase];
    if (!phase) return;
    for (const failed of tasks) {
      const t = phase.tasks.find(tt => tt.id === failed.id);
      if (t) {
        t.status = 'pending';
        t.output = `[RETRY] Erro anterior: ${(t.output || '').substring(0, 1000)}`;
      }
    }
    phase.status = 'in-progress';
    this._pipelines.save(pipeline);
  }

  // ─── PM Git Finalize ────────────────────────────────────

  /**
   * On pipeline completion, PM creates a feature branch, commits all changes, and opens a PR.
   */
  private async _pmGitFinalize(projectId: string, pipelineId: string): Promise<void> {
    const pipeline = this._pipelines.get(projectId, pipelineId);
    if (!pipeline) return;

    const workspace = pipeline.workspace || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    if (!workspace) return;

    this._chat.send({
      sender: 'product-manager',
      senderLabel: 'PM (Opus)',
      content: 'Pipeline concluida. Iniciando workflow Git: criando branch, commit e PR...',
      type: 'info',
    });

    this._directInvocations.add('product-manager');
    this._onAgentStateChange.fire();

    try {
      const { execSync } = require('child_process');
      const execOpts = { cwd: workspace, encoding: 'utf-8' as const, timeout: 30000 };

      // Generate branch name from objective
      const branchSlug = pipeline.objective
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 50);
      const branchName = `feature/${branchSlug}-${pipelineId.substring(0, 8)}`;

      // Check if git repo exists
      try {
        execSync('git rev-parse --is-inside-work-tree', execOpts);
      } catch {
        this._chat.send({
          sender: 'product-manager',
          senderLabel: 'PM (Opus)',
          content: 'Workspace nao e um repositorio Git. Pulando workflow Git.',
          type: 'info',
        });
        return;
      }

      // Get current branch for PR base
      let baseBranch = 'main';
      try {
        baseBranch = execSync('git rev-parse --abbrev-ref HEAD', execOpts).trim();
      } catch { /* use main */ }

      // Create and checkout feature branch
      try {
        execSync(`git checkout -b ${branchName}`, execOpts);
      } catch {
        // Branch might exist, try switching
        try {
          execSync(`git checkout ${branchName}`, execOpts);
        } catch (err: any) {
          this._chat.send({
            sender: 'product-manager',
            senderLabel: 'PM (Opus)',
            content: `Erro ao criar branch: ${err.message}`,
            type: 'error',
          });
          return;
        }
      }

      // Stage all changes
      execSync('git add -A', execOpts);

      // Check if there are changes to commit
      const status = execSync('git status --porcelain', execOpts).trim();
      if (!status) {
        this._chat.send({
          sender: 'product-manager',
          senderLabel: 'PM (Opus)',
          content: 'Nenhuma alteracao detectada para commit. Branch criada mas sem mudancas.',
          type: 'info',
        });
        return;
      }

      // Commit
      const commitMsg = `feat: ${pipeline.objective}\n\nPipeline ThinkCoffee (${pipelineId})\nFases: ${pipeline.phases.map(p => p.name).join(', ')}`;
      execSync(`git commit -m ${JSON.stringify(commitMsg)}`, execOpts);

      this._chat.send({
        sender: 'product-manager',
        senderLabel: 'PM (Opus)',
        content: `Branch **${branchName}** criada com commit.\nBase: ${baseBranch}`,
        type: 'info',
      });

      // Try to push and create PR
      try {
        execSync(`git push -u origin ${branchName}`, { ...execOpts, timeout: 60000 });

        // Try GitHub CLI for PR creation
        try {
          const prTitle = `feat: ${pipeline.objective}`;
          const prBody = `## Pipeline ThinkCoffee\n\n**Objetivo:** ${pipeline.objective}\n**Pipeline ID:** ${pipelineId}\n\n### Fases\n${pipeline.phases.map(p => `- ${p.name}: ${p.status}`).join('\n')}`;
          execSync(
            `gh pr create --title ${JSON.stringify(prTitle)} --body ${JSON.stringify(prBody)} --base ${baseBranch}`,
            { ...execOpts, timeout: 60000 },
          );

          this._chat.send({
            sender: 'product-manager',
            senderLabel: 'PM (Opus)',
            content: `PR criado com sucesso! Branch: **${branchName}** -> ${baseBranch}`,
            type: 'info',
          });
        } catch {
          this._chat.send({
            sender: 'product-manager',
            senderLabel: 'PM (Opus)',
            content: `Push feito. PR nao criado automaticamente (gh CLI nao disponivel). Crie manualmente: **${branchName}** -> ${baseBranch}`,
            type: 'info',
          });
        }
      } catch (pushErr: any) {
        this._chat.send({
          sender: 'product-manager',
          senderLabel: 'PM (Opus)',
          content: `Branch e commit criados localmente. Push falhou: ${pushErr.message}\n\nExecute manualmente:\n\`git push -u origin ${branchName}\``,
          type: 'info',
        });
      }
    } catch (err: any) {
      this._chat.send({
        sender: 'product-manager',
        senderLabel: 'PM (Opus)',
        content: `Erro no workflow Git: ${err.message}`,
        type: 'error',
      });
    } finally {
      this._directInvocations.delete('product-manager');
      this._onAgentStateChange.fire();
    }
  }

  // ─── PM Phase Review ────────────────────────────────────

  private async _pmReviewPhase(
    projectId: string,
    pipelineId: string,
  ): Promise<{ approved: boolean; feedback: string }> {
    const pipeline = this._pipelines.get(projectId, pipelineId);
    if (!pipeline) return { approved: true, feedback: '' };

    const phase = pipeline.phases[pipeline.currentPhase];
    if (!phase) return { approved: true, feedback: '' };

    this._chat.send({
      sender: 'product-manager',
      senderLabel: 'PM (Opus)',
      content: `Revisando fase **${phase.name}**...`,
      type: 'info',
    });

    this._directInvocations.add('product-manager');
    this._onAgentStateChange.fire();

    try {
      const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'claude-opus-4.6' });
      if (!model) {
        this._chat.send({
          sender: 'system', senderLabel: 'System',
          content: 'claude-opus-4.6 indisponivel para review. Auto-aprovando fase.',
          type: 'error',
        });
        return { approved: true, feedback: '' };
      }

      // Collect outputs from this phase
      const outputs = phase.tasks.map(t =>
        `### ${AGENT_META[t.agent].label} — ${t.title}\nStatus: ${t.status}\n${t.output ? t.output.substring(0, 4000) : '(sem output)'}`
      ).join('\n\n');

      // Collect objective and prior context
      const priorPhases = pipeline.phases
        .filter((_, i) => i < pipeline.currentPhase)
        .map(p => `- **${p.name}**: ${p.status}`)
        .join('\n');

      const prompt = `Voce e o Product Manager (PM) do time ThinkCoffee.
Voce esta supervisando a pipeline: "${pipeline.objective}"

## Fase atual: ${phase.name} (fase ${pipeline.currentPhase + 1} de ${pipeline.phases.length})
Agentes: ${phase.agents.map(a => AGENT_META[a].label).join(', ')}

## Fases anteriores
${priorPhases || '(nenhuma)'}

## Outputs dos agentes nesta fase
${outputs}

## Sua tarefa
Avalie os outputs dos agentes desta fase. Verifique:
1. Os outputs atendem ao objetivo da pipeline?
2. A qualidade do trabalho e aceitavel?
3. Os arquivos foram criados/modificados corretamente?
4. Ha erros, omissoes ou inconsistencias?

## Formato de resposta
Responda APENAS com JSON valido (sem markdown), no formato:
{"approved": true}
ou
{"approved": false, "feedback": "Explicacao detalhada do que precisa ser corrigido ou melhorado."}

Se os outputs estiverem razoaveis e cumprirem o minimo necessario, APROVE. Rejeite apenas se houver problemas claros.
NAO seja excessivamente exigente — foque em bloqueios reais.`;

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

      // Parse JSON
      const jsonMatch = fullText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this._chat.send({
          sender: 'product-manager', senderLabel: 'PM (Opus)',
          content: 'Nao consegui gerar review estruturado. Aprovando fase.',
          type: 'info',
        });
        return { approved: true, feedback: '' };
      }

      const result = JSON.parse(jsonMatch[0]);
      return {
        approved: !!result.approved,
        feedback: result.feedback || '',
      };

    } catch (err: any) {
      this._chat.send({
        sender: 'system', senderLabel: 'System',
        content: `Erro na review do PM: ${err.message}. Auto-aprovando.`,
        type: 'error',
      });
      return { approved: true, feedback: '' };
    } finally {
      this._directInvocations.delete('product-manager');
      this._onAgentStateChange.fire();
    }
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
