/**
 * ENG-030 — Anthropic provider implementation.
 *
 * Wraps `@ai-sdk/anthropic` with Puntovivo's pricing table + prompt-
 * cache helper. The SDK reads the API key from `ANTHROPIC_API_KEY`
 * automatically; `isConfigured()` guards every call site.
 *
 * @module services/ai/providers/anthropic
 */
import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV4 } from '@ai-sdk/provider';

import type { AIProvider, ModelPricing, ProviderPricing, TokenUsage } from './types.js';

/**
 * USD per 1M tokens. Operator updates this table when Anthropic
 * publishes new model pricing or when a new Sonnet / Opus / Haiku
 * revision lands. The default model id below is what
 * `defaultModelId` resolves to when the tenant hasn't picked an
 * override.
 *
 * Each entry lists either an alias (`claude-sonnet-4-6`) or a pinned
 * snapshot (`claude-sonnet-4-5-20250929`). Aliases route to the
 * latest snapshot Anthropic publishes; snapshots are the safe pin
 * once production traffic depends on a specific behaviour. The audit
 * log carries whatever id the caller resolved, so historical cost
 * math stays correct across alias rotations.
 *
 * Default ships as Haiku 4.5 — significantly cheaper than Sonnet
 * (~$1 / $5 per 1M vs $3 / $15) and more than capable for the
 * connection-test smoke and most ENG-031 co-pilot turns. Operators
 * with a higher quality bar can flip to Sonnet 4.6 (or Opus 4.7) per
 * tenant via the AI Settings card.
 */
const PRICING_TABLE: Readonly<Record<string, ModelPricing>> = {
  // Haiku 4.5 — default. Lowest cost, fastest latency.
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // Sonnet family — production chat / tool-calling. 4.6 is the alias
  // currently published; 4.5 still listed for callers who pin the
  // older snapshot.
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4-5-20250929': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  // Opus family — premium tier; ~5x Sonnet cost. Use only when the
  // workload genuinely needs the strongest reasoning.
  'claude-opus-4-7': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-opus-4-5-20251101': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-opus-4-1': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-opus-4-1-20250805': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
};

const FALLBACK_MODEL_ID = 'claude-haiku-4-5';

/**
 * Returns the pricing row for `modelId` or falls back to
 * `FALLBACK_MODEL_ID`. Throws (Categoría B per ENG-181) when the
 * fallback itself is missing — that is a programmer-assert: the
 * registry is statically defined above, so this branch only fires
 * if someone removes the fallback row without updating
 * `FALLBACK_MODEL_ID`. ENG-179a — added the explicit guard so
 * `noUncheckedIndexedAccess` can narrow the lookup to a defined row.
 */
function resolvePricingRow(modelId: string): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
} {
  const row = PRICING_TABLE[modelId] ?? PRICING_TABLE[FALLBACK_MODEL_ID];
  if (!row) {
    throw new Error(
      `anthropic provider: PRICING_TABLE missing fallback model ${FALLBACK_MODEL_ID}`,
      {
        cause: {
          provider: 'anthropic',
          requestedModel: modelId,
          fallbackModel: FALLBACK_MODEL_ID,
          catalog: 'PRICING_TABLE',
        },
      }
    );
  }
  return row;
}

const PRICING: ProviderPricing = {
  models: PRICING_TABLE,
  calculateCostUsd(modelId: string, usage: TokenUsage): number {
    const row = resolvePricingRow(modelId);
    return (
      (usage.inputTokens / 1_000_000) * row.input +
      (usage.outputTokens / 1_000_000) * row.output +
      (usage.cacheReadTokens / 1_000_000) * row.cacheRead +
      (usage.cacheWriteTokens / 1_000_000) * row.cacheWrite
    );
  },
};

export const anthropicProvider: AIProvider = {
  id: 'anthropic',
  defaultModelId: FALLBACK_MODEL_ID,
  pricing: PRICING,

  isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  },

  languageModel(modelId: string): LanguageModelV4 {
    return anthropic(modelId);
  },

  // ENG-040a — every Claude 3+ language model supports image content in
  // user messages, so the vision factory routes through the same SDK
  // entry point as `languageModel`. Capability advertised so the UI +
  // service layer can gate on `provider.visionModel` rather than
  // guessing per provider id.
  visionModel(modelId: string): LanguageModelV4 {
    return anthropic(modelId);
  },

  cacheControlForSystemPrompt(): Record<string, unknown> {
    // Anthropic ephemeral cache: 5-minute TTL, ~90% cost reduction on
    // the cached portion of subsequent calls. The provider applies
    // this to the system prompt by default; per-message cache markers
    // can be added by callers in ENG-031 + ENG-033 if they want to
    // cache reusable scaffolding.
    return { anthropic: { cacheControl: { type: 'ephemeral' } } };
  },
};
