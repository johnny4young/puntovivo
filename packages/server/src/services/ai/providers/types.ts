/**
 * ENG-030 — AI Provider strategy interface.
 *
 * One contract every concrete provider implements. The pipeline in
 * `services/ai/client.ts` is provider-agnostic — it routes through this
 * interface for cost computation, language-model construction, and
 * provider-specific options like Anthropic's prompt-cache control.
 *
 * Adding a new provider (Google, Mistral, ...) is a single new file
 * implementing `AIProvider` plus a `registry.ts` entry. The rest of the
 * system never imports a vendor SDK directly.
 *
 * @module services/ai/providers/types
 */
import type { LanguageModelV3, EmbeddingModelV3 } from '@ai-sdk/provider';

/** Identifier for the configured AI provider. */
export type AIProviderId = 'anthropic' | 'openai' | 'ollama';

export interface ModelPricing {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M cached input tokens read (Anthropic ephemeral cache hit). */
  cacheRead: number;
  /** USD per 1M cached input tokens written (first time the cache is filled). */
  cacheWrite: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ProviderPricing {
  /** Map from model id (provider-specific) to its pricing row. */
  readonly models: Readonly<Record<string, ModelPricing>>;
  /**
   * Compute USD cost for a single completion. Falls back to the
   * provider's default model pricing when an unknown `modelId` is
   * supplied so the caller never hits a divide-by-zero.
   */
  calculateCostUsd(modelId: string, usage: TokenUsage): number;
}

export interface AIProvider {
  readonly id: AIProviderId;
  /** Default model id when the tenant has not picked an override. */
  readonly defaultModelId: string;
  readonly pricing: ProviderPricing;

  /** Returns true when the provider's credentials are wired. */
  isConfigured(): boolean;

  /**
   * Vercel AI SDK language-model factory. Throws via `throwServerError`
   * when the provider is `notImplemented`. Caller is expected to gate
   * on `isConfigured()` first.
   */
  languageModel(modelId: string): LanguageModelV3;

  /**
   * Optional. Only OpenAI returns a model in Phase 1 (Anthropic does
   * not embed; Ollama's embedding support is parked for ENG-040).
   * ENG-033 activated this for OpenAI.
   */
  embeddingModel?(modelId: string): EmbeddingModelV3;

  /**
   * Optional. Vision-capable language model for multimodal `image +
   * text` inputs consumed by `generateObject` / `generateText`. Anthropic
   * and OpenAI vision-capable models route through the existing
   * `languageModel` factory; this method is a capability signal — if
   * the provider does not implement it, `ai.extractInvoiceLines`
   * returns `AI_VISION_NOT_AVAILABLE`. ENG-040a activated this for
   * Anthropic + OpenAI; Ollama follows in ENG-040b.
   */
  visionModel?(modelId: string): LanguageModelV3;

  /**
   * Provider-specific options that must be spread into
   * `generateText({ providerOptions })` to enable system-prompt
   * caching. Anthropic returns
   * `{ anthropic: { cacheControl: { type: 'ephemeral' } } }`.
   * OpenAI / Ollama return `undefined` (no caching at this level).
   */
  cacheControlForSystemPrompt(): Record<string, unknown> | undefined;
}

/**
 * Marker variant for providers that exist only as type-completeness
 * stubs. Selecting a `notImplemented` provider via
 * `ai.settings.update` throws an `AI_PROVIDER_ERROR` referencing the
 * ticket that will turn it on.
 */
export interface NotImplementedProvider extends AIProvider {
  readonly notImplemented: true;
  readonly availableInTicket: string;
}

export function isNotImplemented(
  provider: AIProvider | NotImplementedProvider
): provider is NotImplementedProvider {
  return 'notImplemented' in provider && provider.notImplemented === true;
}
