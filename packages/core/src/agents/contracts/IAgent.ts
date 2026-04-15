/**
 * IAgent - Contrato base para agentes do ThinkCoffee
 * 
 * Define a interface que todo agente deve implementar para ser
 * registrado e executado pelo sistema de pipeline.
 */

import type { AgentTask } from '../../pipeline';
import type { IAgentContext } from './IAgentContext';
import type { AgentTool } from '../tools/IAgentTool';

// ─── Agent Roles ─────────────────────────────────────────────

/**
 * Roles builtin do sistema.
 * Extensivel via string para permitir agentes customizados.
 */
export type BuiltinAgentRole =
  | 'product-manager'
  | 'architect'
  | 'organizer'
  | 'git'
  | 'dead-code'
  | 'troubleshooter'
  | 'backend'
  | 'frontend'
  | 'devops'
  | 'qa'
  | 'code-review';

/**
 * AgentRole aceita roles builtin ou customizados (string).
 */
export type AgentRole = BuiltinAgentRole | (string & {});

// ─── Agent Capability ────────────────────────────────────────

/**
 * Capability que um agente possui.
 * Usado para descoberta e matching de agentes.
 */
export interface AgentCapability {
  /** Identificador unico da capability (ex: 'file-write', 'git-commit') */
  id: string;
  /** Nome legivel para UI */
  name: string;
  /** Descricao do que a capability permite fazer */
  description: string;
  /** Tags para busca/filtro */
  tags?: string[];
}

// ─── Agent Metadata ──────────────────────────────────────────

/**
 * Metadata descritiva do agente.
 * Usada para registro, UI e documentacao.
 */
export interface AgentMetadata {
  /** Role unico do agente (ex: 'backend', 'security') */
  role: AgentRole;
  
  /** Nome legivel (ex: "Backend Engineer") */
  label: string;
  
  /** Sigla para UI compacta (ex: "BE") */
  sigla: string;
  
  /** Descricao do que o agente faz */
  description: string;
  
  /** Capabilities do agente */
  capabilities: AgentCapability[];
  
  /** Versao semver do agente */
  version: string;
  
  /** Autor/fonte do agente (opcional) */
  author?: string;
  
  /** URL de documentacao (opcional) */
  docsUrl?: string;
  
  /** Icone do agente (opcional, emoji ou path) */
  icon?: string;
}

// ─── Agent Result ────────────────────────────────────────────

/**
 * Resultado da execucao de um agente.
 */
export interface AgentResult {
  /** Execucao foi bem sucedida? */
  success: boolean;
  
  /** Output textual do agente */
  output: string;
  
  /** Arquivos criados/modificados */
  artifacts?: string[];
  
  /** Erro (se success = false) */
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
  
  /** Metricas de execucao */
  metrics?: {
    durationMs: number;
    tokensUsed?: number;
    toolCallsCount?: number;
  };
  
  /** Dados adicionais */
  data?: Record<string, unknown>;
}

// ─── IAgent Interface ────────────────────────────────────────

/**
 * Interface principal de um agente.
 * 
 * Para criar um agente customizado, implemente esta interface
 * e registre via IAgentRegistry.
 * 
 * @example
 * ```typescript
 * class MyCustomAgent implements IAgent {
 *   readonly metadata: AgentMetadata = {
 *     role: 'my-custom',
 *     label: 'My Custom Agent',
 *     sigla: 'MC',
 *     description: 'Does something custom',
 *     capabilities: [],
 *     version: '1.0.0',
 *   };
 *   
 *   getTools() { return []; }
 *   buildSystemPrompt(ctx) { return '...'; }
 *   canExecute(task) { return task.agent === 'my-custom'; }
 * }
 * ```
 */
export interface IAgent {
  /** Metadata do agente (readonly) */
  readonly metadata: AgentMetadata;
  
  /**
   * Retorna os tools que o agente pode usar.
   * Pode variar baseado no contexto.
   */
  getTools(context?: IAgentContext): AgentTool[];
  
  /**
   * Constroi o system prompt para o modelo.
   * Recebe o contexto completo da execucao.
   */
  buildSystemPrompt(context: IAgentContext): string;
  
  /**
   * Valida se o agente pode executar uma tarefa.
   * Usado para early rejection antes da execucao.
   */
  canExecute(task: AgentTask): boolean;
  
  /**
   * Hook executado ANTES da chamada ao modelo.
   * Use para setup, validacao, ou preparacao de contexto.
   */
  beforeExecute?(context: IAgentContext): Promise<void>;
  
  /**
   * Hook executado APOS a chamada ao modelo.
   * Use para cleanup, logging, ou pos-processamento.
   */
  afterExecute?(context: IAgentContext, result: AgentResult): Promise<void>;
  
  /**
   * Hook executado quando ocorre um erro.
   * Pode tentar recuperar ou transformar o erro.
   */
  onError?(context: IAgentContext, error: Error): Promise<AgentResult | void>;
}

// ─── Base Agent Class ────────────────────────────────────────

/**
 * Classe base abstrata para facilitar implementacao de agentes.
 * Fornece implementacoes default para metodos opcionais.
 */
export abstract class BaseAgent implements IAgent {
  abstract readonly metadata: AgentMetadata;
  
  abstract getTools(context?: IAgentContext): AgentTool[];
  abstract buildSystemPrompt(context: IAgentContext): string;
  
  canExecute(task: AgentTask): boolean {
    return task.agent === this.metadata.role;
  }
  
  async beforeExecute(_context: IAgentContext): Promise<void> {
    // Override se necessario
  }
  
  async afterExecute(_context: IAgentContext, _result: AgentResult): Promise<void> {
    // Override se necessario
  }
  
  async onError(_context: IAgentContext, error: Error): Promise<AgentResult> {
    return {
      success: false,
      output: '',
      error: {
        code: 'AGENT_ERROR',
        message: error.message,
        stack: error.stack,
      },
    };
  }
}
