import * as vscode from 'vscode';
import { AVAILABLE_MODELS, type CostMultiplier } from '@thinkcoffee/core';

// ─── Types ───────────────────────────────────────────────────

export interface DiscoveredModel {
  family: string;
  label: string;
  tier: 'premium' | 'code' | 'standard' | 'fast';
  vendor: string;
  maxInputTokens: number;
  costMultiplier: CostMultiplier;
}

// ─── Tier inference from family name ─────────────────────────

const TIER_PATTERNS: { pattern: RegExp; tier: DiscoveredModel['tier'] }[] = [
  { pattern: /opus/i, tier: 'premium' },
  { pattern: /pro\b/i, tier: 'premium' },
  { pattern: /codex/i, tier: 'code' },
  { pattern: /code/i, tier: 'code' },
  { pattern: /mini/i, tier: 'fast' },
  { pattern: /haiku/i, tier: 'fast' },
  { pattern: /flash/i, tier: 'fast' },
  { pattern: /raptor-mini/i, tier: 'fast' },
];

function inferTier(family: string, maxTokens: number): DiscoveredModel['tier'] {
  // Check hardcoded list first for known models
  const known = AVAILABLE_MODELS.find(m => m.family === family);
  if (known) return known.tier as DiscoveredModel['tier'];

  // Infer from name patterns
  for (const { pattern, tier } of TIER_PATTERNS) {
    if (pattern.test(family)) return tier;
  }

  // Infer from context window size — larger = probably more capable
  if (maxTokens >= 200000) return 'premium';
  if (maxTokens >= 100000) return 'standard';

  return 'standard';
}

function inferLabel(family: string): string {
  // Check hardcoded list for known labels
  const known = AVAILABLE_MODELS.find(m => m.family === family);
  if (known) return known.label;

  // Generate label from family name
  return family
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function inferCostMultiplier(family: string, tier: DiscoveredModel['tier']): CostMultiplier {
  // Check hardcoded list first
  const known = AVAILABLE_MODELS.find(m => m.family === family);
  if (known) return known.cost;

  // Infer from tier
  const tierCostMap: Record<string, CostMultiplier> = {
    premium: 3,
    code: 1,
    standard: 0.33,
    fast: 0,
  };
  return tierCostMap[tier] ?? 0;
}

// ─── Registry ────────────────────────────────────────────────

let _cachedModels: DiscoveredModel[] | null = null;
let _cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Discover all available Copilot models dynamically via VS Code LM API.
 * Results are cached for 5 minutes. Falls back to hardcoded list on error.
 */
export async function discoverModels(force = false): Promise<DiscoveredModel[]> {
  const now = Date.now();
  if (!force && _cachedModels && (now - _cacheTimestamp) < CACHE_TTL) {
    return _cachedModels;
  }

  try {
    const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (!allModels.length) {
      return _fallbackModels();
    }

    // Deduplicate by family
    const seen = new Set<string>();
    const discovered: DiscoveredModel[] = [];

    for (const model of allModels) {
      if (seen.has(model.family)) continue;
      seen.add(model.family);

      const tier = inferTier(model.family, model.maxInputTokens);
      discovered.push({
        family: model.family,
        label: inferLabel(model.family),
        tier,
        vendor: model.vendor,
        maxInputTokens: model.maxInputTokens,
        costMultiplier: inferCostMultiplier(model.family, tier),
      });
    }

    // Keep only free models, then sort by tier priority.
    const freeModels = discovered.filter(m => m.costMultiplier === 0);
    const tierRank: Record<string, number> = { premium: 4, code: 3, standard: 2, fast: 1 };
    freeModels.sort((a, b) => (tierRank[b.tier] || 0) - (tierRank[a.tier] || 0));

    _cachedModels = freeModels;
    _cacheTimestamp = now;
    return freeModels;
  } catch {
    return _fallbackModels();
  }
}

/** Synchronous access to cached models (returns fallback if not yet discovered) */
export function getCachedModels(): DiscoveredModel[] {
  return _cachedModels || _fallbackModels();
}

/** Invalidate cache so next call to discoverModels re-queries */
export function invalidateModelCache(): void {
  _cachedModels = null;
  _cacheTimestamp = 0;
}

function _fallbackModels(): DiscoveredModel[] {
  return AVAILABLE_MODELS
    .filter(m => m.cost === 0)
    .map(m => ({
      family: m.family,
      label: m.label,
      tier: m.tier as DiscoveredModel['tier'],
      vendor: m.vendor,
      maxInputTokens: 0,
      costMultiplier: m.cost,
    }));
}
