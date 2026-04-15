/**
 * Agent Configuration Types
 * 
 * Modelo de dados para configuracao de agentes e presets de qualidade.
 */

import type { AgentRole } from '../contracts/IAgent';

// ─── Agent Settings ──────────────────────────────────────────

/**
 * Configuracoes customizaveis por agente.
 */
export interface AgentSettings {
  /** Temperatura do modelo (0-1, onde 0 = deterministico) */
  temperature?: number;
  
  /** Max tokens de resposta */
  maxTokens?: number;
  
  /** Tools habilitados (lista de nomes) */
  enabledTools?: string[];
  
  /** Tools desabilitados (lista de nomes) */
  disabledTools?: string[];
  
  /** Timeout em segundos */
  timeout?: number;
  
  /** Numero maximo de retries */
  maxRetries?: number;
  
  /** Delay entre retries em ms */
  retryDelay?: number;
  
  /** System prompt override */
  systemPromptOverride?: string;
  
  /** Adicao ao system prompt */
  systemPromptAppend?: string;
  
  /** Modelo especifico (override do preset) */
  model?: string;
}

// ─── Quality Preset ──────────────────────────────────────────

/**
 * Presets de qualidade disponiveis.
 */
export type QualityPreset = 
  | 'free-tier'
  | 'budget-tier'
  | 'lite-tier'
  | 'standard-tier'
  | 'premium-tier'
  | 'ultra-tier';

/**
 * Multiplicadores de custo do Copilot.
 */
export type CostMultiplier = 0 | 0.25 | 0.33 | 1 | 3 | 30;

/**
 * Configuracao de um preset de qualidade.
 */
export interface QualityPresetConfig {
  /** Nome legivel */
  label: string;
  
  /** Subtitulo (ex: "Gratuito (0x)") */
  subtitle: string;
  
  /** Descricao detalhada */
  description: string;
  
  /** Range de custo */
  costRange: {
    min: CostMultiplier;
    max: CostMultiplier;
  };
  
  /** Modelo padrao por role */
  models: Record<AgentRole, string>;
  
  /** Ordem de preferencia de modelos */
  ranking: string[];
  
  /** Settings padrao para o preset */
  defaultSettings?: AgentSettings;
  
  /** Se o preset esta habilitado */
  enabled?: boolean;
  
  /** Tags para busca */
  tags?: string[];
}

// ─── Agent Model Config ──────────────────────────────────────

/**
 * Modo de operacao da configuracao de agentes.
 */
export type AgentConfigMode = 'auto' | 'manual' | QualityPreset;

/**
 * Configuracao completa de modelos de agentes.
 */
export interface AgentModelConfig {
  /** Modo de operacao */
  mode: AgentConfigMode;
  
  /** Modelo por role */
  models: Record<AgentRole, string>;
  
  /** Overrides de system prompt por role */
  promptOverrides?: Partial<Record<AgentRole, string>>;
  
  /** Configuracoes customizadas por agente */
  agentSettings?: Partial<Record<AgentRole, AgentSettings>>;
  
  /** Configuracoes globais (aplicadas a todos) */
  globalSettings?: AgentSettings;
  
  /** Versao do schema de config */
  version?: string;
  
  /** Timestamp da ultima atualizacao */
  updatedAt?: string;
}

// ─── Model Info ──────────────────────────────────────────────

/**
 * Tier de modelo.
 */
export type ModelTier = 'free' | 'lite' | 'standard' | 'premium' | 'ultra';

/**
 * Vendor do modelo.
 */
export type ModelVendor = 
  | 'copilot'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'xai'
  | 'microsoft'
  | 'ollama'
  | 'other';

/**
 * Informacoes de um modelo disponivel.
 */
export interface ModelInfo {
  /** Identificador da familia do modelo */
  family: string;
  
  /** Nome legivel */
  label: string;
  
  /** Tier do modelo */
  tier: ModelTier;
  
  /** Vendor/provider */
  vendor: ModelVendor;
  
  /** Multiplicador de custo */
  cost: CostMultiplier;
  
  /** Capabilities do modelo */
  capabilities?: string[];
  
  /** Context window size */
  contextWindow?: number;
  
  /** Se suporta tool calling */
  supportsTools?: boolean;
  
  /** Se esta disponivel */
  available?: boolean;
}

// ─── Model Failure Tracking ──────────────────────────────────

/**
 * Registro de falha de modelo.
 */
export interface ModelFailureEntry {
  /** Modelo que falhou */
  model: string;
  
  /** Role que estava executando */
  role: string;
  
  /** Titulo da task */
  taskTitle: string;
  
  /** Feedback/razao da falha */
  feedback: string;
  
  /** Timestamp */
  timestamp: string;
  
  /** Codigo de erro (se disponivel) */
  errorCode?: string;
  
  /** Pipeline ID */
  pipelineId?: string;
}

/**
 * Historico de falhas de modelos.
 */
export interface ModelFailureHistory {
  /** Falhas por modelo */
  failures: Record<string, ModelFailureEntry[]>;
  
  /** Versao do schema */
  version?: string;
}

// ─── Ollama Config ───────────────────────────────────────────

/**
 * Configuracao do Ollama como provider.
 */
export interface OllamaConfig {
  /** Se o Ollama esta habilitado */
  enabled: boolean;
  
  /** Endpoint da API */
  endpoint: string;
  
  /** Modelo padrao */
  model: string;
  
  /** Timeout em segundos */
  timeout?: number;
  
  /** Modelos disponiveis (cache) */
  availableModels?: string[];
  
  /** Timestamp do ultimo health check */
  lastHealthCheck?: string;
  
  /** Status do ultimo health check */
  lastHealthStatus?: 'ok' | 'error' | 'unknown';
}

// ─── Config Schema ───────────────────────────────────────────

/**
 * Schema completo de configuracao.
 */
export interface ThinkCoffeeConfig {
  /** Configuracao de agentes */
  agents: AgentModelConfig;
  
  /** Configuracao do Ollama */
  ollama: OllamaConfig;
  
  /** Historico de falhas */
  failures?: ModelFailureHistory;
  
  /** Versao do schema */
  version: string;
  
  /** Timestamp da criacao */
  createdAt: string;
  
  /** Timestamp da ultima atualizacao */
  updatedAt: string;
}

// ─── Default Values ──────────────────────────────────────────

/**
 * Settings padrao para agentes.
 */
export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  temperature: 0.7,
  maxTokens: 4096,
  timeout: 300,
  maxRetries: 2,
  retryDelay: 1000,
};

/**
 * Configuracao padrao do Ollama.
 */
export const DEFAULT_OLLAMA_CONFIG: OllamaConfig = {
  enabled: false,
  endpoint: 'http://localhost:11434',
  model: 'llama3',
  timeout: 120,
};

/**
 * Versao atual do schema de config.
 */
export const CONFIG_VERSION = '2.0.0';
