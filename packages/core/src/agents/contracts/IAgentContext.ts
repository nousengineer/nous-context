/**
 * IAgentContext - Contexto de execucao do agente
 * 
 * Contem todas as informacoes necessarias para o agente
 * executar sua tarefa, incluindo outputs anteriores e configuracoes.
 */

import type { AgentRole } from './IAgent';
import type { AgentTask } from '../../pipeline';

// ─── Previous Output ─────────────────────────────────────────

/**
 * Output de um agente anterior no pipeline.
 */
export interface PreviousOutput {
  /** Role do agente que produziu o output */
  agent: AgentRole;
  
  /** Conteudo textual do output */
  output: string;
  
  /** Arquivos criados/modificados */
  artifacts?: string[];
  
  /** Timestamp do output */
  timestamp: string;
  
  /** Fase em que o output foi produzido */
  phase?: string;
  
  /** Se o output foi de uma re-execucao (retry) */
  isRetry?: boolean;
}

// ─── Phase Info ──────────────────────────────────────────────

/**
 * Informacoes da fase atual do pipeline.
 */
export interface PhaseInfo {
  /** ID unico da fase */
  id: string;
  
  /** Nome da fase (ex: "Architecture", "Implementation") */
  name: string;
  
  /** Ordem da fase no pipeline (0-based) */
  order: number;
  
  /** Total de fases no pipeline */
  totalPhases: number;
  
  /** Se a fase executa agentes em paralelo */
  parallel: boolean;
  
  /** Se a fase requer aprovacao humana */
  requiresApproval: boolean;
}

// ─── Environment ─────────────────────────────────────────────

/**
 * Variaveis de ambiente e configuracao para o agente.
 */
export interface AgentEnvironment {
  /** Variaveis de ambiente do sistema */
  [key: string]: string;
}

// ─── Agent Context ───────────────────────────────────────────

/**
 * Contexto completo de execucao de um agente.
 * 
 * Passado para o agente em todas as chamadas de lifecycle.
 */
export interface IAgentContext {
  // ─── Identificadores ─────────────────────────────────────
  
  /** ID unico do projeto */
  projectId: string;
  
  /** Nome legivel do projeto */
  projectName: string;
  
  /** ID do pipeline em execucao */
  pipelineId: string;
  
  // ─── Workspace ───────────────────────────────────────────
  
  /** Caminho absoluto do workspace */
  workspace: string;
  
  /** Objetivo do pipeline (o que o usuario pediu) */
  objective: string;
  
  // ─── Fase e Task ─────────────────────────────────────────
  
  /** Informacoes da fase atual */
  phase: PhaseInfo;
  
  /** Tarefa sendo executada */
  task: AgentTask;
  
  // ─── Historico ───────────────────────────────────────────
  
  /** Outputs dos agentes anteriores */
  previousOutputs: PreviousOutput[];
  
  /** Feedback de rejeicao do PM (se houver) */
  rejectionFeedback?: string;
  
  /** Numero de tentativas (se for retry) */
  attemptNumber?: number;
  
  // ─── Configuracao ────────────────────────────────────────
  
  /** Variaveis de ambiente */
  env: AgentEnvironment;
  
  /** Modelo sendo usado para execucao */
  model?: string;
  
  /** Se esta em modo dry-run */
  dryRun?: boolean;
  
  /** Timeout em ms (se houver) */
  timeout?: number;
  
  // ─── Metadata ────────────────────────────────────────────
  
  /** Dados adicionais (extensivel) */
  metadata?: Record<string, unknown>;
  
  /** Timestamp de inicio da execucao */
  startedAt?: string;
}

// ─── Context Builder ─────────────────────────────────────────

/**
 * Builder para criar contextos de agente.
 * 
 * @example
 * ```typescript
 * const context = new AgentContextBuilder()
 *   .setProject('proj-123', 'My Project')
 *   .setPipeline('pipe-456')
 *   .setWorkspace('/path/to/workspace')
 *   .setObjective('Implementar feature X')
 *   .setPhase({ id: 'p1', name: 'Impl', order: 2, totalPhases: 5, parallel: true, requiresApproval: true })
 *   .setTask(task)
 *   .addPreviousOutput({ agent: 'architect', output: '...', timestamp: '...' })
 *   .build();
 * ```
 */
export class AgentContextBuilder {
  private _context: Partial<IAgentContext> = {
    env: {},
    previousOutputs: [],
  };
  
  setProject(id: string, name: string): this {
    this._context.projectId = id;
    this._context.projectName = name;
    return this;
  }
  
  setPipeline(id: string): this {
    this._context.pipelineId = id;
    return this;
  }
  
  setWorkspace(path: string): this {
    this._context.workspace = path;
    return this;
  }
  
  setObjective(objective: string): this {
    this._context.objective = objective;
    return this;
  }
  
  setPhase(phase: PhaseInfo): this {
    this._context.phase = phase;
    return this;
  }
  
  setTask(task: AgentTask): this {
    this._context.task = task;
    return this;
  }
  
  addPreviousOutput(output: PreviousOutput): this {
    this._context.previousOutputs!.push(output);
    return this;
  }
  
  setRejectionFeedback(feedback: string): this {
    this._context.rejectionFeedback = feedback;
    return this;
  }
  
  setEnv(env: AgentEnvironment): this {
    this._context.env = { ...this._context.env, ...env };
    return this;
  }
  
  setModel(model: string): this {
    this._context.model = model;
    return this;
  }
  
  setDryRun(dryRun: boolean): this {
    this._context.dryRun = dryRun;
    return this;
  }
  
  setTimeout(timeout: number): this {
    this._context.timeout = timeout;
    return this;
  }
  
  setMetadata(metadata: Record<string, unknown>): this {
    this._context.metadata = { ...this._context.metadata, ...metadata };
    return this;
  }
  
  setAttemptNumber(attempt: number): this {
    this._context.attemptNumber = attempt;
    return this;
  }
  
  build(): IAgentContext {
    // Validar campos obrigatorios
    const required: (keyof IAgentContext)[] = [
      'projectId', 'projectName', 'pipelineId', 'workspace', 
      'objective', 'phase', 'task'
    ];
    
    for (const field of required) {
      if (this._context[field] === undefined) {
        throw new Error(`AgentContext: campo obrigatorio '${field}' nao definido`);
      }
    }
    
    return {
      ...this._context,
      startedAt: new Date().toISOString(),
    } as IAgentContext;
  }
}
