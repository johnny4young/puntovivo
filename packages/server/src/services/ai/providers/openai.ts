/**
 * ENG-044 — OpenAI provider (chat).
 *
 * Activated as a fallback for Anthropic so the operator has a working
 * second provider while Anthropic billing reconciliation drags. The
 * Strategy / Factory abstraction shipped in ENG-030 was designed for
 * exactly this — adding a real provider is a single file plus tests.
 *
 * ENG-033 adds `embeddingModel(modelId)` and the embedding pricing
 * rows so semantic product search can use OpenAI
 * `text-embedding-3-small` by default.
 *
 * Pricing source: https://platform.openai.com/docs/pricing
 * Verified: 2026-04-30 via WebSearch (OpenAI does not allow direct
 * scrape; cross-checked against pricepertoken, openrouter, livechat
 * calculator, inworld). Update PRICING_TABLE when OpenAI publishes
 * new model snapshots.
 *
 * @module services/ai/providers/openai
 */
import { openai } from '@ai-sdk/openai';
import type { LanguageModelV3, EmbeddingModelV3 } from '@ai-sdk/provider';

import type { AIProvider, ModelPricing, ProviderPricing, TokenUsage } from './types.js';

/**
 * USD per 1M tokens. Default ships as `gpt-4.1-mini` — sweet spot
 * quality / cost for the co-pilot tool-calling pipeline; better than
 * `gpt-4o-mini` in multi-step agentic loops and SQL generation, still
 * ~87% cheaper per output token than Anthropic Sonnet 4.6. Operators
 * with a tighter budget can override down to `gpt-4o-mini` per tenant
 * via the AI Settings card; operators wanting premium quality can
 * override up to `gpt-4o` or `gpt-4.1`.
 *
 * Cache semantics: OpenAI auto-caches prompts >= 1024 tokens
 * server-side and bills the cached portion at a discount (50% off for
 * the gpt-4o family, 75% off for the gpt-4.1 family). There is no
 * separate cache-write surcharge (contrast with Anthropic), so
 * `cacheWrite` mirrors `input`.
 */
const PRICING_TABLE: Readonly<Record<string, ModelPricing>> = {
  // gpt-4.1-mini — DEFAULT. $0.40 / $1.60 / cached $0.10.
  'gpt-4.1-mini': { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0.4 },
  'gpt-4.1-mini-2025-04-14': { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0.4 },
  // gpt-4.1 — premium 4.1 family. $2.00 / $8.00 / cached $0.50.
  'gpt-4.1': { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 },
  'gpt-4.1-2025-04-14': { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 },
  // gpt-4o — production-stable flagship. $2.50 / $10.00 / cached $1.25.
  'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
  'gpt-4o-2024-08-06': { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
  // gpt-4o-mini — cheapest tier. $0.15 / $0.60 / cached $0.075. Lower
  // tool-calling fidelity than gpt-4.1-mini; offered as override only.
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
  'gpt-4o-mini-2024-07-18': { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
  // ENG-033 — embedding models. text-embedding-3-small is the default
  // (cheap, 1536 dims, multilingual including Spanish); -large
  // available for tenants that want higher accuracy at 3x the cost.
  // Output tokens are zero for embedding models; cost rolls through
  // input only.
  'text-embedding-3-small': { input: 0.02, output: 0, cacheRead: 0.02, cacheWrite: 0.02 },
  'text-embedding-3-large': { input: 0.13, output: 0, cacheRead: 0.13, cacheWrite: 0.13 },
};

const FALLBACK_MODEL_ID = 'gpt-4.1-mini';

const PRICING: ProviderPricing = {
  models: PRICING_TABLE,
  calculateCostUsd(modelId: string, usage: TokenUsage): number {
    const row = PRICING_TABLE[modelId] ?? PRICING_TABLE[FALLBACK_MODEL_ID];
    return (
      (usage.inputTokens / 1_000_000) * row.input +
      (usage.outputTokens / 1_000_000) * row.output +
      (usage.cacheReadTokens / 1_000_000) * row.cacheRead +
      (usage.cacheWriteTokens / 1_000_000) * row.cacheWrite
    );
  },
};

export const openaiProvider: AIProvider = {
  id: 'openai',
  defaultModelId: FALLBACK_MODEL_ID,
  pricing: PRICING,

  isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY?.trim());
  },

  languageModel(modelId: string): LanguageModelV3 {
    return openai(modelId);
  },

  cacheControlForSystemPrompt(): undefined {
    // OpenAI auto-caches prompts >= 1024 tokens server-side; no
    // providerOptions need to be threaded into generateText().
    return undefined;
  },

  // ENG-033 — semantic product search + auto-categorize.
  embeddingModel(modelId: string): EmbeddingModelV3 {
    return openai.embedding(modelId);
  },

  // ENG-040a — gpt-4o family + gpt-4.1 family + gpt-4o-mini accept
  // image content in user messages. Capability hint advertised so the
  // service layer can short-circuit when a future provider lacks it.
  visionModel(modelId: string): LanguageModelV3 {
    return openai(modelId);
  },
};
