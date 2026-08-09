/**
 * semantic product search + auto-categorize embeddings.
 *
 * ## Purpose
 *
 * Adds vector-based product search ("vino tinto reserva" matches even
 * when the literal string isn't a substring) and pre-fills the fiscal
 * category at product create time using a small generative call. Both
 * features sit BEHIND `tenants.settings.ai.enabled` and require a
 * configured embedding-capable provider. OpenAI and Ollama ship
 * with `embeddingModel`; Anthropic does not embed, so a tenant on
 * Anthropic falls back to LIKE search (no embedding write happens).
 *
 * ## Storage
 *
 * Embeddings are stored as JSON-encoded float arrays in
 * `products.embedding` (~6 KB per row for 1536 dims). SQLite has no
 * native cosine operator, so interactive search first retrieves a bounded
 * tenant-safe literal shortlist and only parses/scores those vectors in JS.
 * Batch invoice/voice matchers still use the explicit all-tenant loader; they
 * are separate offline/batch paths rather than one allocation per keystroke.
 *
 * ## Algorithm
 *
 * Cosine similarity: `dot(a, b) / (||a|| * ||b||)`. Returns a value in
 * `[-1, 1]`; for normalized embeddings (which OpenAI returns), this
 * is equivalent to dot product. We don't normalize on write because
 * OpenAI already does it, and re-normalizing only adds noise.
 *
 * @module services/ai/embeddings
 */
import { embed, embedMany, generateObject } from 'ai';
import type { EmbeddingModelV4 } from '@ai-sdk/provider';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import type { DatabaseInstance } from '../../db/index.js';
import { products, type AIAuditCostState } from '../../db/schema.js';
import { currentMonthSpend, recordCall } from './auditLog.js';
import { resolveAISettings } from './client.js';
import { getProvider } from './providers/registry.js';
import type { AIProvider, AIProviderId } from './providers/types.js';
import { SEMANTIC_CANDIDATE_LIMIT } from '../products/semantic-candidates.js';

/** Default embedding model — OpenAI's small model is the right v1 default:
 *  cheap ($0.02 / 1M input), 1536 dims, good multilingual including Spanish. */
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

/** Top-K to return from semantic search. Bounded so the UI never
 *  drowns; operators can filter further with text input. */
const DEFAULT_SEARCH_LIMIT = 25;

/** Floor on cosine similarity; results below this are not surfaced
 *  even if they're in the top-K. 0.30 is a permissive default for
 *  multilingual product names (high lexical variance); tune later. */
const SIMILARITY_FLOOR = 0.3;

export type EmbeddingCapability =
  'semanticSearch' | 'catalogEmbeddings' | 'invoiceLineMatch' | 'voiceProductMatch';

export interface EmbeddingInvocationContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string | null;
  userId: string | null;
  capability: EmbeddingCapability;
}

export interface EmbeddingRuntime {
  embedOne(
    model: EmbeddingModelV4,
    value: string
  ): Promise<{ embedding: number[]; tokens: number }>;
  embedBatch(
    model: EmbeddingModelV4,
    values: string[]
  ): Promise<{ embeddings: number[][]; tokens: number }>;
}

export type EmbeddingProviderFactory = (id?: AIProviderId | null) => AIProvider;

export interface EmbeddingDependencies {
  runtime?: EmbeddingRuntime;
  providerFactory?: EmbeddingProviderFactory;
}

const defaultEmbeddingRuntime: EmbeddingRuntime = {
  async embedOne(model, value) {
    const result = await embed({ model, value });
    return {
      embedding: Array.from(result.embedding),
      tokens: result.usage?.tokens ?? 0,
    };
  },
  async embedBatch(model, values) {
    const result = await embedMany({ model, values });
    return {
      embeddings: result.embeddings.map(vector => Array.from(vector)),
      tokens: result.usage?.tokens ?? 0,
    };
  },
};

/**
 * Build the canonical text used to embed a product. Concatenates the
 * pieces an operator would actually type: name, category-ish hints in
 * the description, SKU. Keep this stable — changing the formula means
 * every embedding becomes inconsistent with the query, so a re-embed
 * pass is required afterward.
 */
function productCanonicalText(product: {
  name: string;
  description?: string | null;
  sku?: string | null;
}): string {
  const parts = [product.name];
  if (product.description) parts.push(product.description);
  if (product.sku) parts.push(product.sku);
  return parts.join(' — ');
}

/**
 * Cosine similarity between two equal-length numeric vectors. Exposed
 * because the invoice line matcher (`vision/invoice-line-matcher.ts`)
 * needs the same math as semantic search; keeping it in one place
 * means we cannot drift the implementations.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  } catch {
    return null;
  }
}

/**
 * Resolve an embedding-capable provider for a tenant. Returns null
 * when semantic AI is unavailable so product search can fall back to
 * LIKE instead of turning a catalog lookup into a hard settings error.
 */
async function resolveEmbeddingProvider(db: DatabaseInstance, tenantId: string) {
  const settings = await resolveAISettings(db, tenantId);
  if (!settings.enabled) return null;
  const provider = getProvider(settings.providerId);
  if (typeof provider.embeddingModel !== 'function') return null;
  if (!provider.isConfigured()) return null;
  return { provider, settings };
}

interface ResolvedEmbeddingInvocation {
  provider: AIProvider;
  modelId: string;
  model: EmbeddingModelV4;
  monthlyBudgetUsd: number;
}

function embeddingCost(
  provider: AIProvider,
  modelId: string,
  inputTokens: number
): { costUsd: number; costState: AIAuditCostState } {
  if (provider.id === 'ollama') {
    return { costUsd: 0, costState: 'local_zero' };
  }
  if (provider.pricing.models[modelId] === undefined) {
    return { costUsd: 0, costState: 'unknown' };
  }
  const costUsd = provider.pricing.calculateCostUsd(modelId, {
    inputTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  return Number.isFinite(costUsd) && costUsd >= 0
    ? { costUsd, costState: 'estimated' }
    : { costUsd: 0, costState: 'unknown' };
}

function normalizeUsageTokens(tokens: number): number {
  return Number.isFinite(tokens) && tokens >= 0 ? Math.floor(tokens) : 0;
}

function isValidEmbeddingVector(vector: number[]): boolean {
  return vector.length > 0 && vector.every(value => Number.isFinite(value));
}

function hasValidEmbeddingBatch(embeddings: number[][], expectedCount: number): boolean {
  if (embeddings.length !== expectedCount || embeddings.length === 0) return false;
  const dimensions = embeddings[0]?.length ?? 0;
  return (
    dimensions > 0 &&
    embeddings.every(vector => vector.length === dimensions && isValidEmbeddingVector(vector))
  );
}

async function recordEmbeddingCall(
  ctx: EmbeddingInvocationContext,
  input: {
    provider: AIProvider;
    modelId: string;
    inputTokens: number;
    costUsd: number;
    costState: AIAuditCostState;
    durationMs: number;
    errorCode: string | null;
  }
): Promise<void> {
  await recordCall(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    userId: ctx.userId,
    feature: ctx.capability,
    providerId: input.provider.id,
    modelId: input.modelId,
    inputTokens: input.inputTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: input.costUsd,
    costState: input.costState,
    durationMs: input.durationMs,
    errorCode: input.errorCode,
  });
}

async function resolveInvocation(
  ctx: EmbeddingInvocationContext,
  dependencies: EmbeddingDependencies
): Promise<ResolvedEmbeddingInvocation | null> {
  const startedAt = Date.now();
  const settings = await resolveAISettings(ctx.db, ctx.tenantId);
  const provider = (dependencies.providerFactory ?? getProvider)(settings.providerId);
  const modelId =
    typeof provider.embeddingModel === 'function'
      ? (provider.defaultEmbeddingModelId ?? DEFAULT_EMBEDDING_MODEL)
      : provider.defaultModelId;

  if (!settings.enabled) {
    await recordEmbeddingCall(ctx, {
      provider,
      modelId,
      inputTokens: 0,
      costUsd: 0,
      costState: 'not_incurred',
      durationMs: Date.now() - startedAt,
      errorCode: 'AI_DISABLED',
    });
    return null;
  }

  if (typeof provider.embeddingModel !== 'function' || !provider.isConfigured()) {
    await recordEmbeddingCall(ctx, {
      provider,
      modelId,
      inputTokens: 0,
      costUsd: 0,
      costState: 'not_incurred',
      durationMs: Date.now() - startedAt,
      errorCode: 'AI_EMBEDDING_UNAVAILABLE',
    });
    return null;
  }

  try {
    return {
      provider,
      modelId,
      model: provider.embeddingModel(modelId),
      monthlyBudgetUsd: settings.monthlyBudgetUsd,
    };
  } catch {
    await recordEmbeddingCall(ctx, {
      provider,
      modelId,
      inputTokens: 0,
      costUsd: 0,
      costState: 'not_incurred',
      durationMs: Date.now() - startedAt,
      errorCode: 'AI_PROVIDER_ERROR',
    });
    return null;
  }
}

async function embeddingBudgetAllows(
  ctx: EmbeddingInvocationContext,
  resolved: ResolvedEmbeddingInvocation
): Promise<boolean> {
  const startedAt = Date.now();
  if (resolved.monthlyBudgetUsd <= 0) {
    await recordEmbeddingCall(ctx, {
      provider: resolved.provider,
      modelId: resolved.modelId,
      inputTokens: 0,
      costUsd: 0,
      costState: 'not_incurred',
      durationMs: Date.now() - startedAt,
      errorCode: 'AI_BUDGET_EXCEEDED',
    });
    return false;
  }
  const spent = await currentMonthSpend(ctx.db, ctx.tenantId);
  if (spent < resolved.monthlyBudgetUsd) return true;
  await recordEmbeddingCall(ctx, {
    provider: resolved.provider,
    modelId: resolved.modelId,
    inputTokens: 0,
    costUsd: 0,
    costState: 'not_incurred',
    durationMs: Date.now() - startedAt,
    errorCode: 'AI_BUDGET_EXCEEDED',
  });
  return false;
}

/**
 * Resolve the embedding model id that an embed-capable provider would
 * use for this tenant right now — without firing a network call.
 * Reads `provider.defaultEmbeddingModelId` ( slice 2) and
 * falls back to the legacy `DEFAULT_EMBEDDING_MODEL` when a future
 * provider implements `embeddingModel` but does not advertise a
 * default. Returns null when AI is disabled / the provider does not
 * embed / the provider is not configured, mirroring
 * `resolveEmbeddingProvider`'s gating.
 *
 * Used by `products.embeddingHealth` ( drift banner) to
 * compare each row's stored `products.embedding_model` against the
 * canonical id the next regenerate would write back — so the
 * comparison stays consistent with what `embedText` / `embedTexts`
 * actually pass to the SDK at runtime.
 */
export async function resolveActiveEmbeddingModelId(
  db: DatabaseInstance,
  tenantId: string
): Promise<string | null> {
  const resolved = await resolveEmbeddingProvider(db, tenantId);
  if (!resolved) return null;
  return resolved.provider.defaultEmbeddingModelId ?? DEFAULT_EMBEDDING_MODEL;
}

/**
 * Embed a single text string. Used by the semantic search path to
 * convert the user's query into a vector before the cosine pass.
 */
export async function embedText(
  ctx: EmbeddingInvocationContext,
  text: string,
  dependencies: EmbeddingDependencies = {}
): Promise<{ embedding: number[]; model: string } | null> {
  const resolved = await resolveInvocation(ctx, dependencies);
  if (!resolved) return null;
  if (!(await embeddingBudgetAllows(ctx, resolved))) return null;

  const runtime = dependencies.runtime ?? defaultEmbeddingRuntime;
  const startedAt = Date.now();
  try {
    const result = await runtime.embedOne(resolved.model, text);
    if (!isValidEmbeddingVector(result.embedding)) {
      throw new Error('Embedding provider returned an invalid vector');
    }
    const inputTokens = normalizeUsageTokens(result.tokens);
    const cost = embeddingCost(resolved.provider, resolved.modelId, inputTokens);
    await recordEmbeddingCall(ctx, {
      provider: resolved.provider,
      modelId: resolved.modelId,
      inputTokens,
      ...cost,
      durationMs: Date.now() - startedAt,
      errorCode: null,
    });
    return { embedding: result.embedding, model: resolved.modelId };
  } catch {
    await recordEmbeddingCall(ctx, {
      provider: resolved.provider,
      modelId: resolved.modelId,
      inputTokens: 0,
      costUsd: 0,
      costState: resolved.provider.id === 'ollama' ? 'local_zero' : 'unknown',
      durationMs: Date.now() - startedAt,
      errorCode: 'AI_PROVIDER_ERROR',
    });
    return null;
  }
}

/**
 * Embed many texts in one call. Public surface so vision callers
 * (`invoice-line-matcher.ts`) can reuse the same provider resolution
 * + chunking the batch regenerate path uses. OpenAI's `embedMany`
 * accepts up to 2048 inputs per call; we chunk defensively at 256 to
 * stay well below that and to bound the spend per chunk under
 * `text-embedding-3-small` ($0.02 / 1M tokens).
 */
export async function embedTexts(
  ctx: EmbeddingInvocationContext,
  values: string[],
  dependencies: EmbeddingDependencies = {}
): Promise<{ embeddings: number[][]; model: string; providerId: string } | null> {
  const resolved = await resolveInvocation(ctx, dependencies);
  if (!resolved) return null;
  const runtime = dependencies.runtime ?? defaultEmbeddingRuntime;
  const embeddings: number[][] = [];
  const CHUNK = 256;
  for (let i = 0; i < values.length; i += CHUNK) {
    const slice = values.slice(i, i + CHUNK);
    if (!(await embeddingBudgetAllows(ctx, resolved))) return null;
    const startedAt = Date.now();
    try {
      const result = await runtime.embedBatch(resolved.model, slice);
      if (!hasValidEmbeddingBatch(result.embeddings, slice.length)) {
        throw new Error('Embedding provider returned an invalid batch');
      }
      const inputTokens = normalizeUsageTokens(result.tokens);
      const cost = embeddingCost(resolved.provider, resolved.modelId, inputTokens);
      await recordEmbeddingCall(ctx, {
        provider: resolved.provider,
        modelId: resolved.modelId,
        inputTokens,
        ...cost,
        durationMs: Date.now() - startedAt,
        errorCode: null,
      });
      embeddings.push(...result.embeddings);
    } catch {
      await recordEmbeddingCall(ctx, {
        provider: resolved.provider,
        modelId: resolved.modelId,
        inputTokens: 0,
        costUsd: 0,
        costState: resolved.provider.id === 'ollama' ? 'local_zero' : 'unknown',
        durationMs: Date.now() - startedAt,
        errorCode: 'AI_PROVIDER_ERROR',
      });
      return null;
    }
  }
  return {
    embeddings,
    model: resolved.modelId,
    providerId: resolved.provider.id,
  };
}

/**
 * Load every embedded product row for a tenant. Reserved for explicit batch
 * matchers (invoice and voice); interactive semantic search must use the
 * bounded candidate loader below so request memory cannot scale with catalog
 * size.
 */
export async function loadTenantProductEmbeddings(
  db: DatabaseInstance,
  tenantId: string
): Promise<Array<{ productId: string; embedding: number[] }>> {
  const rows = await db
    .select({ id: products.id, embedding: products.embedding })
    .from(products)
    .where(eq(products.tenantId, tenantId))
    .all();
  const out: Array<{ productId: string; embedding: number[] }> = [];
  for (const row of rows) {
    const parsed = parseEmbedding(row.embedding);
    if (!parsed) continue;
    out.push({ productId: row.id, embedding: parsed });
  }
  return out;
}

/**
 * Load only the bounded literal shortlist for one semantic-search request.
 * The function repeats the hard cap and tenant predicate at the storage
 * boundary, so a future caller cannot accidentally turn a large id array into
 * another all-catalog scan. Stale vectors from another model are excluded:
 * cosine values are meaningful only inside one embedding space.
 */
export async function loadSemanticCandidateEmbeddings(
  db: DatabaseInstance,
  tenantId: string,
  candidateProductIds: readonly string[],
  embeddingModel: string
): Promise<Array<{ productId: string; embedding: number[] }>> {
  const boundedIds = [...new Set(candidateProductIds)].slice(0, SEMANTIC_CANDIDATE_LIMIT);
  if (boundedIds.length === 0) return [];

  const rows = await db
    .select({ id: products.id, embedding: products.embedding })
    .from(products)
    .where(
      and(
        eq(products.tenantId, tenantId),
        eq(products.embeddingModel, embeddingModel),
        inArray(products.id, boundedIds)
      )
    )
    .all();
  const out: Array<{ productId: string; embedding: number[] }> = [];
  for (const row of rows) {
    const parsed = parseEmbedding(row.embedding);
    if (!parsed) continue;
    out.push({ productId: row.id, embedding: parsed });
  }
  return out;
}

/**
 * Cosine floor used across every semantic surface. Exported so vision
 * matchers + future surfaces stay aligned on a single tuning knob.
 */
export const SEMANTIC_SIMILARITY_FLOOR = SIMILARITY_FLOOR;

/**
 * Search products by semantic similarity. Returns top-K rows ordered
 * by cosine descending. When AI is disabled or the tenant has no
 * embeddings yet, returns null so the caller can fall back to LIKE.
 */
export async function semanticSearchProducts(
  ctx: Omit<EmbeddingInvocationContext, 'capability'>,
  query: string,
  candidateProductIds: readonly string[],
  limit: number = DEFAULT_SEARCH_LIMIT,
  dependencies: EmbeddingDependencies = {}
): Promise<Array<{ productId: string; similarity: number }> | null> {
  const queryEmbedding = await embedText(
    { ...ctx, capability: 'semanticSearch' },
    query,
    dependencies
  );
  if (!queryEmbedding) return null;

  const boundedCandidateIds = [...new Set(candidateProductIds)].slice(0, SEMANTIC_CANDIDATE_LIMIT);
  if (boundedCandidateIds.length === 0) return [];
  const embedded = await loadSemanticCandidateEmbeddings(
    ctx.db,
    ctx.tenantId,
    boundedCandidateIds,
    queryEmbedding.model
  );
  if (embedded.length === 0) return null;

  const literalRank = new Map(boundedCandidateIds.map((productId, index) => [productId, index]));
  const scored: Array<{ productId: string; similarity: number }> = [];
  for (const row of embedded) {
    const similarity = cosineSimilarity(queryEmbedding.embedding, row.embedding);
    if (similarity < SIMILARITY_FLOOR) continue;
    scored.push({ productId: row.productId, similarity });
  }
  scored.sort(
    (a, b) =>
      b.similarity - a.similarity ||
      (literalRank.get(a.productId) ?? Number.MAX_SAFE_INTEGER) -
        (literalRank.get(b.productId) ?? Number.MAX_SAFE_INTEGER) ||
      a.productId.localeCompare(b.productId)
  );
  return scored.slice(0, Math.max(1, Math.min(limit, 100)));
}

/**
 * Regenerate embeddings for every product in the tenant. Admin-only
 * batch op; used after the model id changes or after a bulk catalog
 * import. Writes the embedding back to the row + records the model
 * id and timestamp for staleness tracking.
 */
export async function regenerateProductEmbeddings(
  ctx: Omit<EmbeddingInvocationContext, 'capability'>,
  dependencies: EmbeddingDependencies = {}
): Promise<{ embedded: number; model: string } | null> {
  const rows = await ctx.db
    .select({
      id: products.id,
      name: products.name,
      description: products.description,
      sku: products.sku,
    })
    .from(products)
    .where(eq(products.tenantId, ctx.tenantId))
    .all();

  if (rows.length === 0) return null;

  const texts = rows.map(productCanonicalText);
  const result = await embedTexts({ ...ctx, capability: 'catalogEmbeddings' }, texts, dependencies);
  if (!result) return null;

  const now = new Date().toISOString();
  // Update one by one — Drizzle's better-sqlite3 driver doesn't have
  // a clean batch UPDATE for per-row payloads. For up to a few
  // thousand products this is acceptable; bigger catalogs would
  // benefit from a transaction wrapper (deferred).
  for (let i = 0; i < rows.length; i += 1) {
    await ctx.db
      .update(products)
      .set({
        embedding: JSON.stringify(result.embeddings[i]),
        embeddingModel: result.model,
        embeddedAt: now,
      })
      .where(and(eq(products.id, rows[i]!.id), eq(products.tenantId, ctx.tenantId)));
  }
  return { embedded: rows.length, model: result.model };
}

/**
 * Suggest a product category from the name + optional description.
 * Uses `generateObject` so the model is constrained to existing
 * category ids — no hallucination of new categories. Returns null
 * when AI is disabled or no categories exist for the tenant.
 */
export async function suggestProductCategory(
  db: DatabaseInstance,
  tenantId: string,
  input: { name: string; description?: string | null },
  candidates: Array<{ id: string; name: string }>
): Promise<{ categoryId: string; confidence: number } | null> {
  const resolved = await resolveEmbeddingProvider(db, tenantId);
  if (!resolved) return null;
  if (candidates.length === 0) return null;
  const { provider, settings } = resolved;
  const modelId = settings.modelId ?? provider.defaultModelId;

  const candidateIds = candidates.map(c => c.id) as [string, ...string[]];
  const schema = z.object({
    categoryId: z.enum(candidateIds),
    confidence: z.number().min(0).max(1),
  });

  try {
    const result = await generateObject({
      model: provider.languageModel(modelId),
      schema,
      prompt: [
        'Selecciona la categoría que mejor describe este producto.',
        `Nombre: ${input.name}`,
        input.description ? `Descripción: ${input.description}` : '',
        'Categorías disponibles (id → nombre):',
        ...candidates.map(c => `- ${c.id} → ${c.name}`),
        'Si ninguna categoría encaja con razonable confianza, retorna la mejor opción con un confidence bajo.',
      ]
        .filter(Boolean)
        .join('\n'),
    });
    return result.object;
  } catch {
    return null;
  }
}

// Exported test helpers — kept on a stable surface for unit tests.
export const __testInternals = {
  cosineSimilarity,
  parseEmbedding,
  productCanonicalText,
  SIMILARITY_FLOOR,
  DEFAULT_EMBEDDING_MODEL,
};
