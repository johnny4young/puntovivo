/**
 * AI Provider strategy interface.
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
import type { LanguageModelV4, EmbeddingModelV4, TranscriptionModelV4 } from '@ai-sdk/provider';

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
  languageModel(modelId: string): LanguageModelV4;

  /**
   * Optional. OpenAI uses `text-embedding-3-small` and Ollama uses
   * `nomic-embed-text`. Anthropic does
   * not embed and leaves this undefined so semantic-search callers
   * fall back to LIKE.
   */
  embeddingModel?(modelId: string): EmbeddingModelV4;

  /**
   * Optional. The canonical embedding model id this provider ships
   * with. Read by `services/ai/embeddings.ts::embedTexts` and
   * `embedText` so each provider's default flows through without a
   * hardcoded OpenAI-only constant in the resolver. Providers that
   * don't implement `embeddingModel` (Anthropic today) leave this
   * undefined.
   */
  readonly defaultEmbeddingModelId?: string;

  /**
   * Optional. Vision-capable language model for multimodal `image +
   * text` inputs consumed by `generateObject` / `generateText`. Anthropic
   * and OpenAI vision-capable models route through the existing
   * `languageModel` factory; this method is a capability signal — if
   * the provider does not implement it, `ai.extractInvoiceLines`
   * returns `AI_VISION_NOT_AVAILABLE`. Anthropic and OpenAI expose
   * vision-capable models; Ollama currently does not.
   */
  visionModel?(modelId: string): LanguageModelV4;

  /**
   * Optional. Whisper-style audio transcription.
   * Provider returns a `TranscriptionModelV4` consumed by the AI SDK
   * `transcribe({ model, audio })`. OpenAI activates
   * `whisper-1` and the `gpt-4o-transcribe` family; Anthropic + Ollama
   * leave this undefined so `services/ai/voice/transcribe.ts` surfaces
   * `AI_VOICE_NOT_AVAILABLE` instead of a generic
   * `AI_PROVIDER_ERROR` when those tenants try to transcribe.
   */
  transcriptionModel?(modelId: string): TranscriptionModelV4;

  /**
   * Optional. The canonical transcription model id this provider ships
   * with. Read by `services/ai/voice/transcribe.ts` so each provider's
   * default flows through without a hardcoded OpenAI-only constant.
   * Providers that don't implement `transcriptionModel` leave this
   * undefined.
   */
  readonly defaultTranscriptionModelId?: string;

  /**
   * Optional. Per-minute USD pricing for transcription models. Whisper
   * bills by audio duration, not tokens, so the token-based
   * `ProviderPricing.calculateCostUsd` does not fit. The voice service
   * reads this table directly. Providers that don't implement
   * `transcriptionModel` leave this undefined; providers that do leave
   * it undefined for a specific model id fall back to the
   * provider's default model price.
   */
  readonly transcriptionPricing?: Readonly<Record<string, { perMinuteUsd: number }>>;

  /**
   * Provider-specific options that must be spread into
   * `generateText({ providerOptions })` to enable system-prompt
   * caching. Anthropic returns
   * `{ anthropic: { cacheControl: { type: 'ephemeral' } } }`.
   * OpenAI / Ollama return `undefined` (no caching at this level).
   */
  cacheControlForSystemPrompt(): Record<string, unknown> | undefined;
}
