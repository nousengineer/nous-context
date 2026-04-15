/**
 * IAgentLifecycle - Sistema de hooks de ciclo de vida
 * 
 * Permite interceptar e extender a execucao de agentes
 * sem modificar o codigo core.
 */

import type { AgentRole, AgentResult } from './IAgent';
import type { IAgentContext } from './IAgentContext';
import type { ToolResult } from '../tools/IAgentTool';

// ─── Lifecycle Phases ────────────────────────────────────────

/**
 * Fases do ciclo de vida de um agente.
 */
export type LifecyclePhase =
  | 'pre-execute'      // Antes de iniciar execucao
  | 'post-execute'     // Apos execucao bem sucedida
  | 'on-error'         // Quando ocorre erro
  | 'on-retry'         // Antes de um retry
  | 'on-tool-call'     // Antes de executar um tool
  | 'on-tool-result'   // Apos executar um tool
  | 'on-stream-chunk'  // Ao receber chunk de streaming
  | 'on-cancel';       // Quando execucao e cancelada

// ─── Lifecycle Event ─────────────────────────────────────────

/**
 * Evento base de lifecycle.
 */
export interface LifecycleEventBase {
  /** Fase do ciclo de vida */
  phase: LifecyclePhase;
  
  /** Role do agente */
  agent: AgentRole;
  
  /** Contexto de execucao */
  context: IAgentContext;
  
  /** Timestamp do evento */
  timestamp: string;
}

/**
 * Evento pre-execute.
 */
export interface PreExecuteEvent extends LifecycleEventBase {
  phase: 'pre-execute';
}

/**
 * Evento post-execute.
 */
export interface PostExecuteEvent extends LifecycleEventBase {
  phase: 'post-execute';
  result: AgentResult;
}

/**
 * Evento de erro.
 */
export interface ErrorEvent extends LifecycleEventBase {
  phase: 'on-error';
  error: Error;
  /** Se o erro e recuperavel */
  recoverable: boolean;
}

/**
 * Evento de retry.
 */
export interface RetryEvent extends LifecycleEventBase {
  phase: 'on-retry';
  attemptNumber: number;
  maxAttempts: number;
  lastError: Error;
}

/**
 * Evento de chamada de tool.
 */
export interface ToolCallEvent extends LifecycleEventBase {
  phase: 'on-tool-call';
  toolName: string;
  toolArgs: Record<string, unknown>;
}

/**
 * Evento de resultado de tool.
 */
export interface ToolResultEvent extends LifecycleEventBase {
  phase: 'on-tool-result';
  toolName: string;
  result: ToolResult;
  durationMs: number;
}

/**
 * Evento de chunk de streaming.
 */
export interface StreamChunkEvent extends LifecycleEventBase {
  phase: 'on-stream-chunk';
  chunk: string;
  totalLength: number;
}

/**
 * Evento de cancelamento.
 */
export interface CancelEvent extends LifecycleEventBase {
  phase: 'on-cancel';
  reason: string;
}

/**
 * Uniao de todos os tipos de evento.
 */
export type LifecycleEvent =
  | PreExecuteEvent
  | PostExecuteEvent
  | ErrorEvent
  | RetryEvent
  | ToolCallEvent
  | ToolResultEvent
  | StreamChunkEvent
  | CancelEvent;

// ─── Hook Result ─────────────────────────────────────────────

/**
 * Resultado de um hook de lifecycle.
 */
export interface HookResult {
  /** Se deve continuar a execucao */
  continue: boolean;
  
  /** Modificar o contexto (opcional) */
  modifiedContext?: Partial<IAgentContext>;
  
  /** Modificar o resultado (para post-execute) */
  modifiedResult?: Partial<AgentResult>;
  
  /** Mensagem de log */
  message?: string;
}

// ─── Lifecycle Hook ──────────────────────────────────────────

/**
 * Hook de ciclo de vida.
 * 
 * @example
 * ```typescript
 * const loggingHook: IAgentLifecycleHook = {
 *   id: 'my-logging-hook',
 *   phases: ['pre-execute', 'post-execute', 'on-error'],
 *   priority: 0,
 *   async handle(event) {
 *     console.log(`[${event.phase}] Agent ${event.agent}`);
 *     return { continue: true };
 *   },
 * };
 * ```
 */
export interface IAgentLifecycleHook {
  /** Identificador unico do hook */
  id: string;
  
  /** Nome legivel */
  name?: string;
  
  /** Descricao do que o hook faz */
  description?: string;
  
  /** Fases em que o hook deve ser chamado */
  phases: LifecyclePhase[];
  
  /** Prioridade (menor = executa primeiro) */
  priority: number;
  
  /** Se o hook esta habilitado */
  enabled?: boolean;
  
  /** Filtro de agentes (vazio = todos) */
  agentFilter?: AgentRole[];
  
  /**
   * Handler do hook.
   * 
   * @param event - Evento de lifecycle
   * @returns Resultado indicando se deve continuar
   */
  handle(event: LifecycleEvent): Promise<HookResult>;
}

// ─── Lifecycle Manager ───────────────────────────────────────

/**
 * Gerenciador de hooks de lifecycle.
 */
export interface IAgentLifecycleManager {
  /**
   * Registra um hook.
   * 
   * @throws Se ja existir um hook com o mesmo id
   */
  register(hook: IAgentLifecycleHook): void;
  
  /**
   * Remove um hook.
   * 
   * @returns true se o hook foi removido
   */
  unregister(hookId: string): boolean;
  
  /**
   * Obtem um hook por id.
   */
  get(hookId: string): IAgentLifecycleHook | undefined;
  
  /**
   * Lista todos os hooks registrados.
   */
  list(): IAgentLifecycleHook[];
  
  /**
   * Lista hooks para uma fase especifica.
   */
  getForPhase(phase: LifecyclePhase): IAgentLifecycleHook[];
  
  /**
   * Habilita um hook.
   */
  enable(hookId: string): void;
  
  /**
   * Desabilita um hook.
   */
  disable(hookId: string): void;
  
  /**
   * Emite um evento de lifecycle.
   * Executa todos os hooks relevantes em ordem de prioridade.
   * 
   * @returns Resultado agregado de todos os hooks
   */
  emit(event: LifecycleEvent): Promise<HookResult>;
}

// ─── Default Implementation ──────────────────────────────────

/**
 * Implementacao default do LifecycleManager.
 */
export class AgentLifecycleManager implements IAgentLifecycleManager {
  private _hooks: Map<string, IAgentLifecycleHook> = new Map();
  
  register(hook: IAgentLifecycleHook): void {
    if (this._hooks.has(hook.id)) {
      throw new Error(`LifecycleManager: hook '${hook.id}' ja registrado`);
    }
    this._hooks.set(hook.id, { ...hook, enabled: hook.enabled ?? true });
  }
  
  unregister(hookId: string): boolean {
    return this._hooks.delete(hookId);
  }
  
  get(hookId: string): IAgentLifecycleHook | undefined {
    return this._hooks.get(hookId);
  }
  
  list(): IAgentLifecycleHook[] {
    return Array.from(this._hooks.values());
  }
  
  getForPhase(phase: LifecyclePhase): IAgentLifecycleHook[] {
    return this.list()
      .filter(h => h.enabled !== false && h.phases.includes(phase))
      .sort((a, b) => a.priority - b.priority);
  }
  
  enable(hookId: string): void {
    const hook = this._hooks.get(hookId);
    if (hook) {
      hook.enabled = true;
    }
  }
  
  disable(hookId: string): void {
    const hook = this._hooks.get(hookId);
    if (hook) {
      hook.enabled = false;
    }
  }
  
  async emit(event: LifecycleEvent): Promise<HookResult> {
    const hooks = this.getForPhase(event.phase);
    
    // Filtrar por agente se especificado
    const relevantHooks = hooks.filter(h => {
      if (!h.agentFilter || h.agentFilter.length === 0) return true;
      return h.agentFilter.includes(event.agent);
    });
    
    let aggregatedResult: HookResult = { continue: true };
    
    for (const hook of relevantHooks) {
      try {
        const result = await hook.handle(event);
        
        // Se algum hook diz para parar, paramos
        if (!result.continue) {
          return result;
        }
        
        // Agregar modificacoes
        if (result.modifiedContext) {
          aggregatedResult.modifiedContext = {
            ...aggregatedResult.modifiedContext,
            ...result.modifiedContext,
          };
        }
        
        if (result.modifiedResult) {
          aggregatedResult.modifiedResult = {
            ...aggregatedResult.modifiedResult,
            ...result.modifiedResult,
          };
        }
        
      } catch (err) {
        console.error(`[LifecycleManager] Error in hook '${hook.id}':`, err);
        // Continua para o proximo hook mesmo com erro
      }
    }
    
    return aggregatedResult;
  }
}

// ─── Global Manager ──────────────────────────────────────────

let _globalManager: IAgentLifecycleManager | null = null;

/**
 * Obtem o manager global de lifecycle.
 */
export function getLifecycleManager(): IAgentLifecycleManager {
  if (!_globalManager) {
    _globalManager = new AgentLifecycleManager();
  }
  return _globalManager;
}

/**
 * Define o manager global (para testes ou config custom).
 */
export function setLifecycleManager(manager: IAgentLifecycleManager): void {
  _globalManager = manager;
}

// ─── Built-in Hooks ──────────────────────────────────────────

/**
 * Hook de logging basico (exemplo).
 */
export const loggingHook: IAgentLifecycleHook = {
  id: 'thinkcoffee:logging',
  name: 'Default Logging Hook',
  description: 'Loga eventos de lifecycle no console',
  phases: ['pre-execute', 'post-execute', 'on-error', 'on-tool-call'],
  priority: 1000, // Executa por ultimo
  enabled: false, // Desabilitado por default
  
  async handle(event: LifecycleEvent): Promise<HookResult> {
    const { phase, agent, context } = event;
    const prefix = `[ThinkCoffee] [${phase}] [${agent}]`;
    
    switch (phase) {
      case 'pre-execute':
        console.log(`${prefix} Starting task: ${context.task.title}`);
        break;
      case 'post-execute':
        const postEvent = event as PostExecuteEvent;
        console.log(`${prefix} Completed:`, postEvent.result.success ? 'SUCCESS' : 'FAILED');
        break;
      case 'on-error':
        const errorEvent = event as ErrorEvent;
        console.error(`${prefix} Error:`, errorEvent.error.message);
        break;
      case 'on-tool-call':
        const toolEvent = event as ToolCallEvent;
        console.log(`${prefix} Tool call: ${toolEvent.toolName}`);
        break;
    }
    
    return { continue: true };
  },
};

/**
 * Hook de metricas (exemplo).
 */
export const metricsHook: IAgentLifecycleHook = {
  id: 'thinkcoffee:metrics',
  name: 'Metrics Collection Hook',
  description: 'Coleta metricas de execucao',
  phases: ['pre-execute', 'post-execute', 'on-tool-call', 'on-tool-result'],
  priority: 0, // Executa primeiro
  enabled: false,
  
  async handle(event: LifecycleEvent): Promise<HookResult> {
    // Implementacao de metricas aqui
    // Pode enviar para observability (DataDog, Prometheus, etc)
    return { continue: true };
  },
};
