/**
 * slice 1 — Ollama provider (chat + vision).
 *
 * Activated against the community Vercel AI SDK provider
 * `ollama-ai-provider-v2`. Version 4 targets `ai@^7` and ships as a
 * pure JS factory `createOllama({ baseURL })` returning a model
 * builder compatible with the AI SDK `LanguageModelV4` contract.
 *
 * Ollama serves locally so there is no API key surface: configuration
 * is a base URL only. The default `http://localhost:11434` is what the
 * Ollama daemon binds to out of the box. Operators that point at a
 * dedicated GPU box set `OLLAMA_BASE_URL=https://gpu.lan:11434`.
 *
 * Pricing: local compute is free at the API layer — `pricing.calculateCostUsd`
 * returns `0` for any token usage shape. The per-tenant budget kill
 * switch (`monthlyBudgetUsd > 0`) still applies as a master gate so the
 * operator can disable all AI calls (including Ollama) by setting the
 * budget to 0.
 *
 * Vision dispatches through the same `provider(modelId)` factory the
 * chat path uses; the operator's selected model (e.g. `llava`,
 * `llama3.2-vision`, `qwen2-vl`) determines whether the model accepts
 * `image` content. `extractInvoiceFromImage` only checks
 * `typeof provider.visionModel === 'function'` — we expose the method
 * so the OCR pipeline never short-circuits with
 * `AI_VISION_NOT_AVAILABLE` for Ollama tenants. A non-vision model id
 * surfaces a provider-side error at call time, which the service layer
 * maps to `AI_PROVIDER_ERROR`.
 *
 * slice 2 also exposes Ollama embeddings via
 * `createOllama({ baseURL }).embedding(modelId)`. The default model is
 * `embeddinggemma`, so semantic search can run fully offline once the
 * operator has pulled that model and regenerated catalog
 * embeddings.
 *
 * @module services/ai/providers/ollama
 */
import { createOllama } from 'ollama-ai-provider-v2';
import type { EmbeddingModelV4, LanguageModelV4 } from '@ai-sdk/provider';

import type { AIProvider, ProviderPricing, TokenUsage } from './types.js';

/** Default Ollama base URL — matches the daemon's out-of-box bind. */
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

/** Recommended chat default. Operators can override per-tenant. */
const FALLBACK_MODEL_ID = 'llama3.2';

/**
 * Canonical Ollama embedding model. `embeddinggemma` is one of Ollama's
 * current recommended models, is designed for on-device multilingual use,
 * and produces 768-d vectors. On Puntovivo corpus v1 (36 products, 24 neutral
 * LATAM/cross-language queries) it reached nDCG@10 0.9613 and recall@3 1.0,
 * ahead of qwen3-embedding:0.6b, the previous `nomic-embed-text` default, and
 * all-minilm. The retained benchmark records the cold-load and quality
 * trade-offs; this is a product-domain choice, not a universal leaderboard.
 *
 * Embedding spaces remain incompatible even when their dimensions match.
 * `embedding_model` is therefore part of every load predicate; a row from
 * nomic/OpenAI/Qwen is never scored against an embeddinggemma query.
 *
 * After switching providers the operator must click "Regenerate
 * embeddings" on the products page to re-embed the catalog under
 * the new model. Same constraint as switching between OpenAI's
 * small + large embedding models. `products.embeddingHealth` surfaces this
 * model drift to managers and administrators.
 */
const FALLBACK_EMBEDDING_MODEL_ID = 'embeddinggemma';

const FREE_PRICING: ProviderPricing = {
  models: {},
  calculateCostUsd(_modelId: string, _usage: TokenUsage): number {
    return 0;
  },
};

function resolveBaseUrl(): string {
  const override = process.env.OLLAMA_BASE_URL?.trim();
  return override && override.length > 0 ? override : DEFAULT_OLLAMA_BASE_URL;
}

function buildClient() {
  // The Ollama REST API lives at `<baseURL>/api/<endpoint>`. The
  // `ollama-ai-provider-v2` SDK uses the configured `baseURL` verbatim
  // and appends bare endpoint paths (`/chat`, `/generate`, ...) onto
  // it — it does NOT add `/api` automatically. We MUST include the
  // `/api` suffix here, otherwise every request lands at
  // `<baseURL>/chat` and 404s. The trailing-slash strip keeps the
  // concatenation stable when the operator's env var carries one.
  return createOllama({ baseURL: `${resolveBaseUrl().replace(/\/$/, '')}/api` });
}

export const ollamaProvider: AIProvider = {
  id: 'ollama',
  defaultModelId: FALLBACK_MODEL_ID,
  defaultEmbeddingModelId: FALLBACK_EMBEDDING_MODEL_ID,
  pricing: FREE_PRICING,

  isConfigured(): boolean {
    // No API key requirement; an unset env var falls back to the
    // localhost default which is also "configured". The first real call
    // surfaces a connection error if the daemon is offline; we don't
    // probe at this layer (mirrors how Anthropic / OpenAI only check
    // their env vars without round-tripping the provider).
    return true;
  },

  languageModel(modelId: string): LanguageModelV4 {
    return buildClient()(modelId);
  },

  // vision capability advertised. The model id picks which
  // Ollama model serves the request; `llava`, `bakllava`,
  // `llama3.2-vision`, `qwen2-vl`, `granite-3.2-vision` are common
  // operator choices. Same factory as `languageModel` because Ollama
  // does not split chat and vision builders.
  visionModel(modelId: string): LanguageModelV4 {
    return buildClient()(modelId);
  },

  // slice 2 — embeddings capability advertised. Routes through
  // `createOllama({ baseURL }).embedding(modelId)` (the SDK's primary
  // embedding factory; `textEmbedding` / `textEmbeddingModel` are
  // deprecated aliases). Same `EmbeddingModelV4` contract OpenAI
  // returns, so the provider-agnostic call site in
  // `services/ai/embeddings.ts::embedTexts` does not branch.
  //
  // The operator pulls a model once with `ollama pull embeddinggemma`
  // (or any other supported embedding model — see
  // `FALLBACK_EMBEDDING_MODEL_ID` JSDoc for the dimension-drift
  // caveat).
  embeddingModel(modelId: string): EmbeddingModelV4 {
    return buildClient().embedding(modelId);
  },

  cacheControlForSystemPrompt(): undefined {
    // Ollama does not advertise a prompt-cache control surface today;
    // pricing is zero anyway so caching is purely a latency knob and
    // not worth threading through `providerOptions`.
    return undefined;
  },
};

/** Test helpers — exported so unit tests can verify the URL resolver
 * + default model ids without spinning up the SDK. */
export const __ollamaInternals = {
  resolveBaseUrl,
  DEFAULT_OLLAMA_BASE_URL,
  FALLBACK_MODEL_ID,
  FALLBACK_EMBEDDING_MODEL_ID,
};
