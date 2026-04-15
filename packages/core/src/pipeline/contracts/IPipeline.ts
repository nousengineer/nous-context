/**
 * IPipeline - Contratos de Pipeline
 * 
 * Define interfaces para pipelines, fases e tasks.
 */

import type { AgentRole } from '../../agents/contracts/IAgent';

// ─── Status Types ────────────────────────────────────────────

/**
 * Status de uma fase.
 */
export type PhaseStatus = 
  | 'pending'
  | 'in-progress'
  | 'awaiting-approval'
  | 'approved'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

/**
 * Status de uma task.
 */
export type TaskStatus = 
  | 'pending'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'skipped'
  | 'cancelled';

/**
 * Status de um pipeline.
 */
export type PipelineStatus = 
  | 'pending'
  | 'active'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ─── Task Description ────────────────────────────────────────

/**
 * Descricao de uma task.
 */
export interface TaskDescription {
  /** Titulo da task */
  title: string;
  
  /** Descricao detalhada */
  description: string;
  
  /** Criterios de aceite */
  acceptanceCriteria?: string[];
  
  /** Artifacts esperados */
  expectedArtifacts?: string[];
  
  /** Dependencias de outras tasks */
  dependencies?: string[];
  
  /** Prioridade (menor = mais urgente) */
  priority?: number;
  
  /** Estimativa de tempo em minutos */
  estimatedMinutes?: number;
}

// ─── Agent Task ──────────────────────────────────────────────

/**
 * Task de um agente.
 */
export interface AgentTask {
  /** ID unico */
  id: string;
  
  /** Role do agente */
  agent: AgentRole;
  
  /** Titulo */
  title: string;
  
  /** Descricao */
  description: string;
  
  /** Status atual */
  status: TaskStatus;
  
  /** Output do agente */
  output?: string;
  
  /** Arquivos criados/modificados */
  artifacts?: string[];
  
  /** Timestamp de inicio */
  startedAt?: string;
  
  /** Timestamp de conclusao */
  completedAt?: string;
  
  /** Numero de tentativas */
  attemptCount?: number;
  
  /** Erro (se falhou) */
  error?: {
    code: string;
    message: string;
  };
  
  /** Modelo usado */
  model?: string;
  
  /** Metricas */
  metrics?: TaskMetrics;
}

/**
 * Metricas de uma task.
 */
export interface TaskMetrics {
  /** Duracao em ms */
  durationMs: number;
  
  /** Tokens usados */
  tokensUsed?: number;
  
  /** Chamadas de tools */
  toolCallsCount?: number;
  
  /** Retries realizados */
  retriesCount?: number;
}

// ─── Phase Condition ─────────────────────────────────────────

/**
 * Tipos de condicao para executar fase.
 */
export type PhaseConditionType = 
  | 'always'
  | 'if-previous-success'
  | 'if-artifact-exists'
  | 'if-output-contains'
  | 'custom';

/**
 * Condicao para executar uma fase.
 */
export interface PhaseCondition {
  /** Tipo da condicao */
  type: PhaseConditionType;
  
  /** Parametros da condicao */
  params?: Record<string, unknown>;
}

// ─── Phase Hooks ─────────────────────────────────────────────

/**
 * Hooks de uma fase.
 */
export interface PhaseHooks {
  /** Antes de iniciar a fase */
  beforePhase?: string;
  
  /** Apos completar a fase */
  afterPhase?: string;
  
  /** Em caso de erro */
  onPhaseError?: string;
}

// ─── Phase Config ────────────────────────────────────────────

/**
 * Configuracao de uma fase do pipeline.
 */
export interface PhaseConfig {
  /** Nome da fase */
  name: string;
  
  /** Ordem de execucao */
  order: number;
  
  /** Execucao paralela dos agentes? */
  parallel: boolean;
  
  /** Requer aprovacao humana? */
  requiresApproval: boolean;
  
  /** Roles participantes */
  agents: AgentRole[];
  
  /** Descricoes customizadas por agente */
  taskDescriptions?: Record<AgentRole, TaskDescription>;
  
  /** Condicao para executar */
  condition?: PhaseCondition;
  
  /** Hooks da fase */
  hooks?: PhaseHooks;
  
  /** Timeout em segundos */
  timeout?: number;
  
  /** Max retries por task */
  maxRetries?: number;
}

// ─── Pipeline Phase ──────────────────────────────────────────

/**
 * Instancia de uma fase em execucao.
 */
export interface PipelinePhase {
  /** ID unico */
  id: string;
  
  /** Nome da fase */
  name: string;
  
  /** Ordem */
  order: number;
  
  /** Execucao paralela? */
  parallel: boolean;
  
  /** Requer aprovacao? */
  requiresApproval: boolean;
  
  /** Status atual */
  status: PhaseStatus;
  
  /** Roles */
  agents: AgentRole[];
  
  /** Tasks */
  tasks: AgentTask[];
  
  /** Timestamp de aprovacao */
  approvedAt?: string;
  
  /** Quem aprovou */
  approvedBy?: string;
  
  /** Timestamp de inicio */
  startedAt?: string;
  
  /** Timestamp de conclusao */
  completedAt?: string;
  
  /** Feedback de rejeicao */
  rejectionFeedback?: string;
}

// ─── Pipeline Settings ───────────────────────────────────────

/**
 * Configuracoes globais de um pipeline.
 */
export interface PipelineSettings {
  /** Timeout global em segundos */
  timeout?: number;
  
  /** Falha rapida se um agente falhar */
  failFast?: boolean;
  
  /** Numero de retries automaticos */
  autoRetry?: number;
  
  /** Intervalo entre retries (ms) */
  retryDelay?: number;
  
  /** Dry-run por padrao */
  dryRunDefault?: boolean;
  
  /** Requer aprovacao para todas as fases */
  requireApprovalForAll?: boolean;
  
  /** Notificar em eventos */
  notifications?: {
    onPhaseComplete?: boolean;
    onTaskFailed?: boolean;
    onPipelineComplete?: boolean;
  };
}

// ─── Pipeline Template ───────────────────────────────────────

/**
 * Template de pipeline reutilizavel.
 */
export interface PipelineTemplate {
  /** ID unico */
  id: string;
  
  /** Nome do template */
  name: string;
  
  /** Descricao */
  description: string;
  
  /** Versao */
  version: string;
  
  /** Fases */
  phases: PhaseConfig[];
  
  /** Configuracoes globais */
  settings?: PipelineSettings;
  
  /** Tags */
  tags?: string[];
  
  /** Autor */
  author?: string;
  
  /** Se e um template builtin */
  isBuiltin?: boolean;
}

// ─── Pipeline Instance ───────────────────────────────────────

/**
 * Instancia de um pipeline em execucao.
 */
export interface Pipeline {
  /** ID unico */
  id: string;
  
  /** ID do template usado (se houver) */
  templateId?: string;
  
  /** ID do projeto */
  projectId: string;
  
  /** Caminho do workspace */
  workspace: string;
  
  /** Objetivo do pipeline */
  objective: string;
  
  /** Status atual */
  status: PipelineStatus;
  
  /** Indice da fase atual */
  currentPhase: number;
  
  /** Fases */
  phases: PipelinePhase[];
  
  /** Configuracoes */
  settings?: PipelineSettings;
  
  /** Timestamp de criacao */
  createdAt: string;
  
  /** Timestamp de atualizacao */
  updatedAt: string;
  
  /** Timestamp de conclusao */
  completedAt?: string;
  
  /** ID do pipeline pai (se for sub-pipeline) */
  parentPipelineId?: string;
  
  /** ID da task pai (se for sub-pipeline) */
  parentTaskId?: string;
  
  /** Metricas agregadas */
  metrics?: PipelineMetrics;
}

/**
 * Metricas de um pipeline.
 */
export interface PipelineMetrics {
  /** Duracao total em ms */
  totalDurationMs: number;
  
  /** Tokens totais usados */
  totalTokensUsed?: number;
  
  /** Total de tasks */
  tasksTotal: number;
  
  /** Tasks completadas */
  tasksCompleted: number;
  
  /** Tasks falhadas */
  tasksFailed: number;
  
  /** Fases completadas */
  phasesCompleted: number;
  
  /** Fases totais */
  phasesTotal: number;
}

// ─── Pipeline Events ─────────────────────────────────────────

/**
 * Tipos de eventos de pipeline.
 */
export type PipelineEventType =
  | 'pipeline:created'
  | 'pipeline:started'
  | 'pipeline:paused'
  | 'pipeline:resumed'
  | 'pipeline:completed'
  | 'pipeline:failed'
  | 'pipeline:cancelled'
  | 'phase:started'
  | 'phase:completed'
  | 'phase:failed'
  | 'phase:approved'
  | 'phase:rejected'
  | 'task:started'
  | 'task:completed'
  | 'task:failed'
  | 'task:retrying';

/**
 * Evento de pipeline.
 */
export interface PipelineEvent {
  /** Tipo do evento */
  type: PipelineEventType;
  
  /** ID do pipeline */
  pipelineId: string;
  
  /** ID do projeto */
  projectId: string;
  
  /** Indice da fase (se aplicavel) */
  phaseIndex?: number;
  
  /** ID da task (se aplicavel) */
  taskId?: string;
  
  /** Dados adicionais */
  data?: Record<string, unknown>;
  
  /** Timestamp */
  timestamp: string;
}
