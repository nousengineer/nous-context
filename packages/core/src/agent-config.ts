import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AgentRole } from './pipeline';

// ─── Types ───────────────────────────────────────────────────

/**
 * Quality presets — cada um com nome de cafe e nivel de qualidade:
 *
 * - cafe-soluvel:       O dev pediu pra ontem. Modelos rapidos, zero frescura.
 * - coado-com-carinho:  Equilibrio entre velocidade e qualidade. Dia a dia.
 * - espresso-duplo:     Premium. Cada agente recebe o melhor modelo pra sua area.
 *                        PM toma um Opus 4.6 e cobra resultado de todos.
 */
export type QualityPreset = 'cafe-soluvel' | 'coado-com-carinho' | 'espresso-duplo';

export const QUALITY_PRESETS: Record<QualityPreset, {
  label: string;
  subtitle: string;
  description: string;
  costRange: { min: CostMultiplier; max: CostMultiplier };
  models: Record<AgentRole, string>;
  ranking: string[]; // Modelos do tier em ordem de preferencia (melhor → pior)
}> = {
  'cafe-soluvel': {
    label: 'Cafe Soluvel',
    subtitle: 'So gratuitas (0x)',
    description: 'Zero custo. So modelos inclusos no plano. Ideal pra hotfix rapido, POC descartavel, ou quando o budget ja era. PM tambem usa modelo free.',
    costRange: { min: 0, max: 0 },
    models: {
      'product-manager': 'claude-sonnet-4',    // Melhor raciocinio free pra PM
      'architect': 'gpt-4o',                   // Bom raciocinio geral, free
      'backend': 'grok-code-fast-1',           // Code-specialized, free
      'frontend': 'gpt-4.1',                   // Bom geral, free
      'devops': 'gpt-5.4-mini',               // Mini capaz
      'qa': 'claude-haiku-4.5',               // Analise rapida
      'code-review': 'gemini-3-flash',         // Review rapido
    },
    ranking: [
      'claude-sonnet-4',     // Melhor raciocinio free
      'gpt-4o',              // Forte raciocinio geral
      'gpt-4.1',             // Solido
      'grok-code-fast-1',    // Bom pra codigo
      'gpt-5.4-mini',        // Mini capaz
      'gpt-5-mini',          // Mini alternativo
      'claude-haiku-4.5',    // Rapido
      'gemini-3-flash',      // Flash rapido
      'raptor-mini',         // Ultima opcao
    ],
  },
  'coado-com-carinho': {
    label: 'Coado com Carinho',
    subtitle: '0.1x a 1x — dia a dia',
    description: 'Equilibrio custo/qualidade. Modelos de 0.1x ate 1x. PM usa modelo 1x (escolhido pelo Opus). Features normais, refactors, tasks de sprint.',
    costRange: { min: 0.1, max: 1 },
    models: {
      'product-manager': 'claude-sonnet-4.6',  // 1x — melhor PM no tier mid
      'architect': 'gemini-2.5-pro',            // 1x — contexto longo, design
      'backend': 'gpt-5.3-codex',              // 1x — melhor code
      'frontend': 'gpt-5.2-codex',             // 0.5x — code pra UI
      'devops': 'claude-sonnet-4.5',           // 0.5x — equilibrado
      'qa': 'gpt-5.2',                          // 0.5x — analise solida
      'code-review': 'gpt-5.1',                // 0.25x — review decente
    },
    ranking: [
      'claude-sonnet-4.6',   // 1x — melhor raciocinio mid
      'gemini-2.5-pro',      // 1x — contexto longo
      'gpt-5.3-codex',       // 1x — melhor code
      'gpt-5.2-codex',       // 0.5x — code
      'claude-sonnet-4.5',   // 0.5x — equilibrado
      'gpt-5.2',             // 0.5x — geral
      'gpt-5.1',             // 0.25x — basico
    ],
  },
  'espresso-duplo': {
    label: 'Espresso Duplo',
    subtitle: 'Premium 3x — nivel barista',
    description: 'Quando tem que ficar perfeito. So modelos 3x. Cada agente no maximo. Arquitetura de sistema, migration critica, lancamento de produto.',
    costRange: { min: 3, max: 3 },
    models: {
      'product-manager': 'claude-opus-4.6',    // 3x — melhor raciocinio
      'architect': 'gemini-3.1-pro',            // 3x — melhor pra arquitetura
      'backend': 'gpt-5.4',                     // 3x — mais capaz
      'frontend': 'claude-opus-4.5',            // 3x — raciocinio profundo UI
      'devops': 'claude-opus-4.5',             // 3x — infra critica
      'qa': 'claude-opus-4.6',                 // 3x — testa tudo
      'code-review': 'claude-opus-4.6',        // 3x — revisao com lupa
    },
    ranking: [
      'claude-opus-4.6',     // 3x — topo absoluto
      'claude-opus-4.5',     // 3x — raciocinio profundo
      'gpt-5.4',             // 3x — muito capaz
      'gemini-3.1-pro',      // 3x — contexto longo premium
    ],
  },
};

export interface AgentModelConfig {
  /** 'auto' = PM (Opus) decides mode + models, 'manual' = user picks, or a quality preset */
  mode: 'auto' | 'manual' | QualityPreset;
  /** Model family per agent role */
  models: Record<AgentRole, string>;
  /** System prompt overrides per agent (optional) */
  promptOverrides?: Partial<Record<AgentRole, string>>;
}

/**
 * Copilot cost multipliers:
 * - 0   = free / included (nao conta no consumo)
 * - 0.1 = quase gratis
 * - 0.25 = baixo custo
 * - 0.5 = medio
 * - 1   = baseline (1x premium request)
 * - 3   = premium (3x premium requests)
 */
export type CostMultiplier = 0 | 0.1 | 0.25 | 0.5 | 1 | 3;

/** Model families available via VS Code Language Model API (Copilot) */
export const AVAILABLE_MODELS = [
  // Anthropic — Claude
  { family: 'claude-opus-4.6', label: 'Claude Opus 4.6', tier: 'premium', vendor: 'copilot', cost: 3 as CostMultiplier },
  { family: 'claude-opus-4.5', label: 'Claude Opus 4.5', tier: 'premium', vendor: 'copilot', cost: 3 as CostMultiplier },
  { family: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6', tier: 'standard', vendor: 'copilot', cost: 1 as CostMultiplier },
  { family: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5', tier: 'standard', vendor: 'copilot', cost: 0.5 as CostMultiplier },
  { family: 'claude-sonnet-4', label: 'Claude Sonnet 4', tier: 'standard', vendor: 'copilot', cost: 0 as CostMultiplier },
  { family: 'claude-haiku-4.5', label: 'Claude Haiku 4.5', tier: 'fast', vendor: 'copilot', cost: 0 as CostMultiplier },
  // OpenAI — GPT / Codex
  { family: 'gpt-5.4', label: 'GPT-5.4', tier: 'premium', vendor: 'copilot', cost: 3 as CostMultiplier },
  { family: 'gpt-5.4-mini', label: 'GPT-5.4 mini', tier: 'fast', vendor: 'copilot', cost: 0 as CostMultiplier },
  { family: 'gpt-5.3-codex', label: 'GPT-5.3-Codex', tier: 'code', vendor: 'copilot', cost: 1 as CostMultiplier },
  { family: 'gpt-5.2-codex', label: 'GPT-5.2-Codex', tier: 'code', vendor: 'copilot', cost: 0.5 as CostMultiplier },
  { family: 'gpt-5.2', label: 'GPT-5.2', tier: 'standard', vendor: 'copilot', cost: 0.5 as CostMultiplier },
  { family: 'gpt-5.1', label: 'GPT-5.1', tier: 'standard', vendor: 'copilot', cost: 0.25 as CostMultiplier },
  { family: 'gpt-5-mini', label: 'GPT-5 mini', tier: 'fast', vendor: 'copilot', cost: 0 as CostMultiplier },
  { family: 'gpt-4o', label: 'GPT-4o', tier: 'standard', vendor: 'copilot', cost: 0 as CostMultiplier },
  { family: 'gpt-4.1', label: 'GPT-4.1', tier: 'standard', vendor: 'copilot', cost: 0 as CostMultiplier },
  // Google — Gemini
  { family: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro (Preview)', tier: 'premium', vendor: 'copilot', cost: 3 as CostMultiplier },
  { family: 'gemini-3-flash', label: 'Gemini 3 Flash (Preview)', tier: 'fast', vendor: 'copilot', cost: 0 as CostMultiplier },
  { family: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'premium', vendor: 'copilot', cost: 1 as CostMultiplier },
  // xAI — Grok
  { family: 'grok-code-fast-1', label: 'Grok Code Fast 1', tier: 'code', vendor: 'copilot', cost: 0 as CostMultiplier },
  // Microsoft — Raptor
  { family: 'raptor-mini', label: 'Raptor mini (Preview)', tier: 'fast', vendor: 'copilot', cost: 0 as CostMultiplier },
] as const;

export type ModelFamily = typeof AVAILABLE_MODELS[number]['family'];

/**
 * Default model assignments — modo espresso-duplo como padrao:
 * - PM: Opus 4.6 — melhor raciocinio estrategico
 * - Architect: Gemini 3.1 Pro — premium, contexto longo
 * - Backend: GPT-5.4 — premium, codegen top
 * - Frontend: Claude Opus 4.5 — raciocinio profundo pra UI
 * - DevOps: Claude Opus 4.5 — infra critica
 * - QA: Claude Opus 4.6 — testes exaustivos
 * - Code Review: Claude Opus 4.6 — revisao com lupa
 */
export const DEFAULT_AGENT_MODELS: Record<AgentRole, string> = {
  'product-manager': 'claude-opus-4.6',
  'architect': 'gemini-3.1-pro',
  'backend': 'gpt-5.4',
  'frontend': 'claude-opus-4.5',
  'devops': 'claude-opus-4.5',
  'qa': 'claude-opus-4.6',
  'code-review': 'claude-opus-4.6',
};

// ─── Config file management ──────────────────────────────────

function getConfigPath(): string {
  return path.join(os.homedir(), '.thinkcoffee', 'agent-config.json');
}

/** Load agent model configuration (creates default if missing) */
export function loadAgentConfig(): AgentModelConfig {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as AgentModelConfig;
    }
  } catch (err) {
    console.error(`[ThinkCoffee] Failed to load agent config: ${(err as Error).message}`);
  }
  // Return default — cafe-soluvel (gratuito) para nao gastar sem querer
  return applyQualityPreset('cafe-soluvel');
}

/** Save agent model configuration */
export function saveAgentConfig(config: AgentModelConfig): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/** Get model family for a specific agent */
export function getModelForAgent(role: AgentRole, config?: AgentModelConfig): string {
  const cfg = config || loadAgentConfig();
  return cfg.models[role] || DEFAULT_AGENT_MODELS[role];
}

/** Update a single agent's model */
export function setAgentModel(role: AgentRole, modelFamily: string): AgentModelConfig {
  const config = loadAgentConfig();
  config.models[role] = modelFamily;
  saveAgentConfig(config);
  return config;
}

/** PM auto-assigns models based on task complexity */
export interface PMModelAssignment {
  role: AgentRole;
  model: string;
  reason: string;
}

/** Apply a quality preset — updates config and saves */
export function applyQualityPreset(preset: QualityPreset): AgentModelConfig {
  const presetData = QUALITY_PRESETS[preset];
  if (!presetData) throw new Error(`Preset desconhecido: ${preset}`);

  const config: AgentModelConfig = {
    mode: preset,
    models: { ...presetData.models },
  };
  saveAgentConfig(config);
  return config;
}

/** Check if mode is a quality preset */
export function isQualityPreset(mode: string): mode is QualityPreset {
  return mode in QUALITY_PRESETS;
}

// ─── Cost Tier Helpers ───────────────────────────────────────

/** Get cost multiplier for a model family */
export function getModelCost(family: string): CostMultiplier {
  const model = AVAILABLE_MODELS.find(m => m.family === family);
  return (model?.cost ?? 0) as CostMultiplier;
}

/** Get models within a cost range */
export function getModelsByCostRange(min: number, max: number): typeof AVAILABLE_MODELS[number][] {
  return [...AVAILABLE_MODELS.filter(m => m.cost >= min && m.cost <= max)];
}

/** Get the ranking list for a preset (fallback order for model swaps) */
export function getPresetRanking(preset: QualityPreset): string[] {
  return QUALITY_PRESETS[preset]?.ranking ?? [];
}

/** Get the PM model for a given preset */
export function getPMModelForPreset(preset: QualityPreset): string {
  return QUALITY_PRESETS[preset]?.models['product-manager'] ?? 'claude-opus-4.6';
}

// ─── Model Failure History ───────────────────────────────────

/** A record of a model failing/being rejected for a role */
export interface ModelFailureEntry {
  model: string;
  role: string;
  taskTitle: string;
  feedback: string;
  timestamp: string;
}

/** Full failure history keyed by model family */
export interface ModelFailureHistory {
  /** model family -> array of failures */
  failures: Record<string, ModelFailureEntry[]>;
}

function getFailureHistoryPath(): string {
  return path.join(os.homedir(), '.thinkcoffee', 'model-failures.json');
}

/** Load model failure history */
export function loadModelFailures(): ModelFailureHistory {
  const p = getFailureHistoryPath();
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch { /* ignore */ }
  return { failures: {} };
}

/** Record a model failure/rejection */
export function recordModelFailure(
  model: string,
  role: string,
  taskTitle: string,
  feedback: string,
): void {
  const history = loadModelFailures();
  if (!history.failures[model]) history.failures[model] = [];

  history.failures[model].push({
    model,
    role,
    taskTitle,
    feedback: feedback.substring(0, 500),
    timestamp: new Date().toISOString(),
  });

  // Keep at most 50 entries per model to avoid unbounded growth
  if (history.failures[model].length > 50) {
    history.failures[model] = history.failures[model].slice(-50);
  }

  const filePath = getFailureHistoryPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf-8');
}

/** Get failure count per model, optionally filtered by role */
export function getModelFailureCounts(role?: string): Record<string, number> {
  const history = loadModelFailures();
  const counts: Record<string, number> = {};
  for (const [model, entries] of Object.entries(history.failures)) {
    const filtered = role ? entries.filter(e => e.role === role) : entries;
    if (filtered.length > 0) {
      counts[model] = filtered.length;
    }
  }
  return counts;
}
