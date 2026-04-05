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
  models: Record<AgentRole, string>;
}> = {
  'cafe-soluvel': {
    label: 'Cafe Soluvel',
    subtitle: 'Rapido e sem frescura',
    description: 'Entrega no susto. Modelos leves e rapidos. Ideal pra hotfix de sexta as 17h, POC descartavel, ou quando o PM jura que "eh so um botaozinho".',
    models: {
      'product-manager': 'claude-opus-4.6',   // PM sempre Opus, ate no soluvel
      'architect': 'claude-haiku-4.5',          // Rapido, desenho simples
      'backend': 'grok-code-fast-1',            // Grok mete codigo rapido
      'frontend': 'gpt-5.4-mini',              // Mini pro front
      'devops': 'raptor-mini',                  // Raptor resolve infra basica
      'qa': 'gpt-5-mini',                       // Testa o basico
      'code-review': 'gemini-3-flash',          // Revisao rapida
    },
  },
  'coado-com-carinho': {
    label: 'Coado com Carinho',
    subtitle: 'Equilibrado, pro dia a dia',
    description: 'O cafe do dia a dia. Bom equilibrio entre velocidade e qualidade. Features normais, refactors, tasks de sprint. Nao vai ganhar premio mas nao vai dar vergonha no PR.',
    models: {
      'product-manager': 'claude-opus-4.6',   // PM sempre Opus
      'architect': 'gemini-2.5-pro',            // Bom contexto longo
      'backend': 'gpt-5.3-codex',              // Codex pra implementacao
      'frontend': 'gpt-5.2-codex',             // Codex pra UI
      'devops': 'claude-sonnet-4.6',           // Sonnet equilibrado
      'qa': 'claude-sonnet-4.5',               // Sonnet pra testes
      'code-review': 'claude-opus-4.5',        // Opus pra revisao
    },
  },
  'espresso-duplo': {
    label: 'Espresso Duplo',
    subtitle: 'Premium, nivel barista',
    description: 'Quando tem que ficar perfeito. Todos os agentes no maximo. Arquitetura de sistema, migration critica, lancamento de produto, aquela feature que o CTO vai revisar pessoalmente.',
    models: {
      'product-manager': 'claude-opus-4.6',   // PM sempre Opus
      'architect': 'gemini-3.1-pro',            // O melhor pra arquitetura
      'backend': 'gpt-5.4',                     // GPT top tier
      'frontend': 'gpt-5.3-codex',             // Codex forte + Opus review
      'devops': 'claude-opus-4.5',             // Opus pra infra critica
      'qa': 'claude-opus-4.6',                 // Opus testa tudo
      'code-review': 'claude-opus-4.6',        // Opus revisa com lupa
    },
  },
};

export interface AgentModelConfig {
  /** 'auto' = PM (Opus) decides models for each agent, 'manual' = user picks, or a quality preset */
  mode: 'auto' | 'manual' | QualityPreset;
  /** Model family per agent role. PM is always opus regardless of this setting. */
  models: Record<AgentRole, string>;
  /** System prompt overrides per agent (optional) */
  promptOverrides?: Partial<Record<AgentRole, string>>;
}

/** Model families available via VS Code Language Model API (Copilot) */
export const AVAILABLE_MODELS = [
  // Anthropic — Claude
  { family: 'claude-opus-4.6', label: 'Claude Opus 4.6', tier: 'premium', vendor: 'copilot' },
  { family: 'claude-opus-4.5', label: 'Claude Opus 4.5', tier: 'premium', vendor: 'copilot' },
  { family: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6', tier: 'standard', vendor: 'copilot' },
  { family: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5', tier: 'standard', vendor: 'copilot' },
  { family: 'claude-sonnet-4', label: 'Claude Sonnet 4', tier: 'standard', vendor: 'copilot' },
  { family: 'claude-haiku-4.5', label: 'Claude Haiku 4.5', tier: 'fast', vendor: 'copilot' },
  // OpenAI — GPT / Codex
  { family: 'gpt-5.4', label: 'GPT-5.4', tier: 'premium', vendor: 'copilot' },
  { family: 'gpt-5.4-mini', label: 'GPT-5.4 mini', tier: 'fast', vendor: 'copilot' },
  { family: 'gpt-5.3-codex', label: 'GPT-5.3-Codex', tier: 'code', vendor: 'copilot' },
  { family: 'gpt-5.2-codex', label: 'GPT-5.2-Codex', tier: 'code', vendor: 'copilot' },
  { family: 'gpt-5.2', label: 'GPT-5.2', tier: 'standard', vendor: 'copilot' },
  { family: 'gpt-5.1', label: 'GPT-5.1', tier: 'standard', vendor: 'copilot' },
  { family: 'gpt-5-mini', label: 'GPT-5 mini', tier: 'fast', vendor: 'copilot' },
  { family: 'gpt-4o', label: 'GPT-4o', tier: 'standard', vendor: 'copilot' },
  { family: 'gpt-4.1', label: 'GPT-4.1', tier: 'standard', vendor: 'copilot' },
  // Google — Gemini
  { family: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro (Preview)', tier: 'premium', vendor: 'copilot' },
  { family: 'gemini-3-flash', label: 'Gemini 3 Flash (Preview)', tier: 'fast', vendor: 'copilot' },
  { family: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'premium', vendor: 'copilot' },
  // xAI — Grok
  { family: 'grok-code-fast-1', label: 'Grok Code Fast 1', tier: 'code', vendor: 'copilot' },
  // Microsoft — Raptor
  { family: 'raptor-mini', label: 'Raptor mini (Preview)', tier: 'fast', vendor: 'copilot' },
] as const;

export type ModelFamily = typeof AVAILABLE_MODELS[number]['family'];

/**
 * Default model assignments — distributed by role specialty:
 * - PM: Opus 4.6 (obrigatorio) — melhor raciocinio estrategico
 * - Architect: Gemini 2.5 Pro — excelente contexto longo p/ design de sistema
 * - Backend: GPT-5.3-Codex — especializado em codigo, implementacao
 * - Frontend: GPT-5.2-Codex — especializado em codigo, UI
 * - DevOps: Claude Sonnet 4.6 — bom equilibrio raciocinio + pratico
 * - QA: Claude Sonnet 4.5 — analise detalhada p/ testes
 * - Code Review: Claude Opus 4.5 — raciocinio profundo p/ revisao
 */
export const DEFAULT_AGENT_MODELS: Record<AgentRole, string> = {
  'product-manager': 'claude-opus-4.6',  // Obrigatorio Opus — decisoes estrategicas
  'architect': 'gemini-2.5-pro',          // Contexto longo, design de sistema
  'backend': 'gpt-5.3-codex',             // Especializado em codigo
  'frontend': 'gpt-5.2-codex',            // Especializado em codigo / UI
  'devops': 'claude-sonnet-4.6',          // Equilibrio raciocinio + infra
  'qa': 'claude-sonnet-4.5',              // Analise detalhada de testes
  'code-review': 'claude-opus-4.5',       // Raciocinio profundo p/ revisao
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
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as AgentModelConfig;
      // Enforce PM is always opus
      raw.models['product-manager'] = 'claude-opus-4.6';
      return raw;
    }
  } catch (err) {
    console.error(`[ThinkCoffee] Failed to load agent config: ${(err as Error).message}`);
  }
  // Return default
  return {
    mode: 'manual',
    models: { ...DEFAULT_AGENT_MODELS },
  };
}

/** Save agent model configuration */
export function saveAgentConfig(config: AgentModelConfig): void {
  // Enforce PM is always opus
  config.models['product-manager'] = 'claude-opus-4.6';

  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/** Get model family for a specific agent */
export function getModelForAgent(role: AgentRole, config?: AgentModelConfig): string {
  if (role === 'product-manager') return 'claude-opus-4.6'; // Always
  const cfg = config || loadAgentConfig();
  return cfg.models[role] || DEFAULT_AGENT_MODELS[role];
}

/** Update a single agent's model */
export function setAgentModel(role: AgentRole, modelFamily: string): AgentModelConfig {
  const config = loadAgentConfig();
  if (role === 'product-manager') {
    modelFamily = 'claude-opus-4.6'; // Cannot change PM
  }
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
  // PM always opus
  config.models['product-manager'] = 'claude-opus-4.6';
  saveAgentConfig(config);
  return config;
}

/** Check if mode is a quality preset */
export function isQualityPreset(mode: string): mode is QualityPreset {
  return mode in QUALITY_PRESETS;
}
