import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AgentRole } from './pipeline';

// ─── Types ───────────────────────────────────────────────────

export interface AgentModelConfig {
  /** 'auto' = PM (Opus) decides models for each agent, 'manual' = user picks */
  mode: 'auto' | 'manual';
  /** Model family per agent role. PM is always opus regardless of this setting. */
  models: Record<AgentRole, string>;
  /** System prompt overrides per agent (optional) */
  promptOverrides?: Partial<Record<AgentRole, string>>;
}

/** Model families available via VS Code Language Model API (Copilot) */
export const AVAILABLE_MODELS = [
  { family: 'claude-opus-4', label: 'Claude Opus 4', tier: 'premium', vendor: 'copilot' },
  { family: 'claude-sonnet-4', label: 'Claude Sonnet 4', tier: 'standard', vendor: 'copilot' },
  { family: 'gpt-4o', label: 'GPT-4o', tier: 'standard', vendor: 'copilot' },
  { family: 'gpt-4o-mini', label: 'GPT-4o Mini', tier: 'fast', vendor: 'copilot' },
  { family: 'o3-mini', label: 'o3-mini', tier: 'reasoning', vendor: 'copilot' },
  { family: 'claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', tier: 'standard', vendor: 'copilot' },
] as const;

export type ModelFamily = typeof AVAILABLE_MODELS[number]['family'];

/** Default model assignments. PM is ALWAYS opus. */
export const DEFAULT_AGENT_MODELS: Record<AgentRole, string> = {
  'product-manager': 'claude-opus-4',   // Obrigatorio Opus
  'architect': 'claude-sonnet-4',
  'backend': 'claude-sonnet-4',
  'frontend': 'claude-sonnet-4',
  'devops': 'gpt-4o',
  'qa': 'claude-sonnet-4',
  'code-review': 'claude-opus-4',
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
      raw.models['product-manager'] = 'claude-opus-4';
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
  config.models['product-manager'] = 'claude-opus-4';

  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/** Get model family for a specific agent */
export function getModelForAgent(role: AgentRole, config?: AgentModelConfig): string {
  if (role === 'product-manager') return 'claude-opus-4'; // Always
  const cfg = config || loadAgentConfig();
  return cfg.models[role] || DEFAULT_AGENT_MODELS[role];
}

/** Update a single agent's model */
export function setAgentModel(role: AgentRole, modelFamily: string): AgentModelConfig {
  const config = loadAgentConfig();
  if (role === 'product-manager') {
    modelFamily = 'claude-opus-4'; // Cannot change PM
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
