import * as vscode from 'vscode';
import {
  ChatService, PipelineService, ContextService, DecisionService,
  AGENT_META, loadAgentConfig, saveAgentConfig, getModelForAgent,
  DEFAULT_AGENT_MODELS, QUALITY_PRESETS, getModelCost,
  applyQualityPreset, isQualityPreset, getPMModelForPreset,
  recordModelFailure, getModelFailureCounts,
  ActionLogService, // Assuming ActionLogService is exported from core
} from '@thinkcoffee/core';
import { discoverModels, getCachedModels, type DiscoveredModel } from './ModelRegistry';
import type {
  AgentRole, Pipeline, AgentTask, ChatMessage, AgentModelConfig, PMModelAssignment, PhaseTemplate, QualityPreset, ActionLogEntry,
} from '@thinkcoffee/core';
import fs from 'fs';
import path from 'path';
import { DiffPreviewHandler } from '../utils/DiffPreviewHandler';
import { CommandConfirmationHandler } from '../utils/CommandConfirmationHandler';

// Assume ActionLogService is available or needs to be instantiated
// For this example, we'll mock it if it's not provided.
let actionLogService: ActionLogService;

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
  projectName:string;
  workspace: string;
  objective: string;
  previousOutputs: { agent: AgentRole; output: string }[];
  task: AgentTask;
  rejectionFeedback?: string;
  pipelineId: string;
  phaseIndex: number;
}

// ─── Agent Label Helper ──────────────────────────────────────

const AGENT_SIGLA: Record<AgentRole, string> = {
  'product-manager': 'PM',
  'architect': 'AR',
  'backend': 'BE',
  'frontend': 'FE',
  'devops': 'DO',
  'qa': 'QA',
  'code-review': 'CR',
};

/** Build agent label as "SIGLA - model_family" */
function agentLabel(role: AgentRole, modelOverride?: string): string {
  const sigla = AGENT_SIGLA[role] || role.substring(0, 2).toUpperCase();
  const model = modelOverride || getModelForAgent(role);
  return `${sigla} - ${model}`;
}

/** Get PM model family for the active preset (or opus fallback) */
function getActivePMModel(): string {
  const config = loadAgentConfig();
  const preset = isQualityPreset(config.mode) ? config.mode as QualityPreset : undefined;
  return preset ? getPMModelForPreset(preset) : getModelForAgent('product-manager', config);
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

// ... (other prompt builders remain the same)

// ─── Agent Tools ─────────────────────────────────────────────

function getAgentTools(workspace: string): vscode.LanguageModelChatTool[] {
    return [
        {
            name: 'read_file',
            description: 'Read a file from the workspace. Returns file contents.',
            inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Relative path from workspace root' } }, required: ['path'] },
        },
        {
            name: 'list_files',
            description: 'List files/directories at a path in the workspace.',
            inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Relative path from workspace root (use "." for root)' } }, required: ['path'] },
        },
        {
            name: 'write_file',
            description: 'Write content to a file in the workspace. Creates directories as needed.',
            inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Relative path from workspace root' }, content: { type: 'string', description: 'Full file content to write' } }, required: ['path', 'content'] },
        },
        {
            name: 'search_code',
            description: 'Search for a text pattern across workspace files. Returns matching lines with file paths.',
            inputSchema: { type: 'object', properties: { pattern: { type: 'string', description: 'Text or regex pattern to search for' }, fileGlob: { type: 'string', description: 'Optional glob pattern to filter files (e.g. **/*.ts)' } }, required: ['pattern'] },
        },
        {
            name: 'run_command',
            description: 'Run a shell command in the workspace directory. Returns stdout/stderr.',
            inputSchema: { type: 'object', properties: { command: { type: 'string', description: 'Shell command to execute' } }, required: ['command'] },
        },
        {
            name: 'mention_agent',
            description: 'Request another agent to handle a specific subtask. The mentioned agent will be triggered after you finish.',
            inputSchema: { type: 'object', properties: { agent: { type: 'string', description: 'Agent role to mention (e.g. backend, frontend, qa)' }, message: { type: 'string', description: 'What you need this agent to do' } }, required: ['agent', 'message'] },
        },
    ];
}

async function handleToolCall(
    toolCall: vscode.LanguageModelToolCallPart,
    workspace: string,
    chat: ChatService,
    agentContext: Omit<AgentContext, 'objective' | 'previousOutputs' | 'task' | 'projectName'>,
): Promise<string> {
    const input = toolCall.input as Record<string, string>;
    const { pipelineId, phaseIndex, agentRole } = agentContext;
    const startTime = Date.now();
    let logEntry: Omit<ActionLogEntry, 'id' | 'timestamp'> = {
        pipelineId,
        phaseIndex,
        taskId: agentContext.task.id,
        agentRole,
        toolName: toolCall.name as any,
        input,
        output: '',
        result: 'success',
        durationMs: 0,
        dryRun: false, // This should be passed in the context
    };

    try {
        switch (toolCall.name) {
            case 'read_file': {
                // ... (implementation remains the same)
                return '...';
            }
            case 'list_files': {
                // ... (implementation remains the same)
                return '...';
            }
            case 'write_file': {
                if (!input.path || typeof input.path !== 'string') throw new Error('path is required (string)');
                if (!input.content && input.content !== '') throw new Error('content is required (string)');

                const confirmed = await DiffPreviewHandler.showDiff(workspace, input.path, input.content);
                if (!confirmed) {
                    logEntry.result = 'rejected';
                    throw new Error('User rejected file changes.');
                }

                const abs = path.resolve(workspace, input.path);
                if (!abs.startsWith(workspace)) {
                    logEntry.result = 'blocked';
                    throw new Error('Path traversal denied');
                }
                
                const dir = path.dirname(abs);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(abs, input.content, 'utf-8');
                
                const successMsg = `File written: ${input.path}`;
                chat.send({ sender: agentRole, senderLabel: agentLabel(agentRole), content: `Arquivo escrito: \`${input.path}\``, type: 'code' });
                logEntry.output = successMsg;
                return successMsg;
            }
            case 'run_command': {
                const isDestructive = /^\s*(rm|git\s+reset|git\s+clean)/.test(input.command);
                const confirmed = await CommandConfirmationHandler.getConfirmation(input.command, isDestructive ? 'destructive' : 'safe');

                if (!confirmed) {
                    logEntry.result = 'rejected';
                    throw new Error('User denied command execution.');
                }

                const { execSync } = require('child_process');
                const output = execSync(input.command, { cwd: workspace, encoding: 'utf-8', timeout: 30000, shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh' });
                
                const outputStr = (output || '(no output)').trim().substring(0, 4000);
                chat.send({ sender: agentRole, senderLabel: agentLabel(agentRole), content: `\`${input.command}\`\n\n\`\`\`\n${outputStr.substring(0, 2000)}\n\`\`\``, type: 'code' });
                logEntry.output = outputStr;
                return outputStr;
            }
            // ... other cases
            default:
                throw new Error(`Unknown tool: ${toolCall.name}`);
        }
    } catch (e: any) {
        logEntry.result = logEntry.result === 'success' ? 'error' : logEntry.result;
        logEntry.output = e.message;
        return `Error: ${e.message}`;
    } finally {
        logEntry.durationMs = Date.now() - startTime;
        // await actionLogService.log(logEntry);
    }
}

// ─── AgentService ────────────────────────────────────────────

export class AgentService {
  // ... (rest of the class remains the same, but the `handleToolCall` invocation needs to be updated)
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
    // Inject ActionLogService
  ) {
    this._getChat = getChat;
    this._pipelines = pipelines;
    this._contexts = contexts;
    this._decisions = decisions;
    this._getProject = getProject;
    // actionLogService = new ActionLogService(vscode.workspace.workspaceFolders![0].uri.fsPath);
  }

  // ... other methods
}
