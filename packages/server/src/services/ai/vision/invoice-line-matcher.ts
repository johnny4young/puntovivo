/**
 * ENG-040 slice 1b — invoice line to product matching.
 *
 * Takes the structured lines returned by `extractInvoiceFromImage`
 * (ENG-040a) and maps each one to the best product candidate in the
 * tenant's catalog using the same embeddings infrastructure that powers
 * semantic product search (ENG-033). Returns top-1 per line above the
 * shared cosine floor; lines below the floor surface as `null` so the
 * operator can fall back to the manual product picker for them.
 *
 * One batch embed call covers the whole invoice; one audit log row
 * covers the whole match. AI off / no embedded products short-circuit
 * to `mode:'unavailable'` so the modal can render a helpful hint instead
 * of throwing.
 *
 * @module services/ai/vision/invoice-line-matcher
 */
import { and, eq, inArray } from 'drizzle-orm';

import type { DatabaseInstance } from '../../../db/index.js';
import { products, unitXProduct, units } from '../../../db/schema.js';
import { recordCall } from '../auditLog.js';
import {
  SEMANTIC_SIMILARITY_FLOOR,
  cosineSimilarity,
  embedTexts,
  loadTenantProductEmbeddings,
} from '../embeddings.js';

export interface InvoiceLineForMatching {
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  totalLine: number | null;
}

export interface MatchedProductSummary {
  productId: string;
  productName: string;
  productSku: string;
  cost: number;
  stock: number;
  unitId: string;
  unitName: string | null;
  unitAbbreviation: string | null;
  unitEquivalence: number;
}

export interface InvoiceLineMatch {
  line: InvoiceLineForMatching;
  product: MatchedProductSummary | null;
  similarity: number | null;
}

export type InvoiceLineMatcherResult =
  | { mode: 'matched'; matches: InvoiceLineMatch[] }
  | { mode: 'unavailable'; reason: 'ai-disabled' | 'no-embeddings'; matches: [] };

export interface InvoiceLineMatcherContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string | null;
  userId: string | null;
}

/**
 * Match every invoice line to a product candidate. Pure data path:
 * the procedure layer owns the AI-budget pre-flight + role gating; this
 * function focuses on cosine math + audit-log persistence on the
 * successful path.
 */
export async function matchInvoiceLinesToProducts(
  ctx: InvoiceLineMatcherContext,
  lines: InvoiceLineForMatching[]
): Promise<InvoiceLineMatcherResult> {
  if (lines.length === 0) {
    return { mode: 'matched', matches: [] };
  }

  // The DB-load happens before `embedTexts` so a tenant with no
  // embedded products is signalled as `no-embeddings` rather than as
  // `ai-disabled`. When AI is also off the modal still collapses both
  // reasons into the same operator hint (`match.unavailable` i18n key)
  // — the distinction is purely for audit-log telemetry. Keeping the
  // DB-load first avoids a wasted embedding API call in the common
  // "tenant on free plan, no embeddings yet" path.
  const embedded = await loadTenantProductEmbeddings(ctx.db, ctx.tenantId);
  if (embedded.length === 0) {
    return { mode: 'unavailable', reason: 'no-embeddings', matches: [] };
  }

  const startedAt = Date.now();
  const embedResult = await embedTexts(
    ctx.db,
    ctx.tenantId,
    lines.map(line => line.description)
  );
  if (!embedResult) {
    // Same signal regardless of root cause — the modal collapses both
    // "AI off" and "provider lacks embeddings" into one hint that tells
    // the operator how to fix the tenant.
    return { mode: 'unavailable', reason: 'ai-disabled', matches: [] };
  }

  const winners: Array<{ productId: string; similarity: number } | null> = embedResult.embeddings.map(
    queryVec => {
      let best: { productId: string; similarity: number } | null = null;
      for (const row of embedded) {
        const sim = cosineSimilarity(queryVec, row.embedding);
        if (sim < SEMANTIC_SIMILARITY_FLOOR) continue;
        if (best === null || sim > best.similarity) {
          best = { productId: row.productId, similarity: sim };
        }
      }
      return best;
    }
  );

  const matchedIds = Array.from(
    new Set(winners.filter((w): w is NonNullable<typeof w> => w !== null).map(w => w.productId))
  );

  // Hydrate one row per distinct match: product card + base unit data
  // so the renderer can call `mergePurchaseCartItem` with the same
  // shape `ProductSearchDialog` already produces.
  const summaries = matchedIds.length === 0
    ? new Map<string, MatchedProductSummary>()
    : await hydrateProductSummaries(ctx.db, ctx.tenantId, matchedIds);

  const matches: InvoiceLineMatch[] = lines.map((line, idx) => {
    const winner = winners[idx];
    if (!winner) {
      return { line, product: null, similarity: null };
    }
    const summary = summaries.get(winner.productId);
    if (!summary) {
      // Defensive: product disappeared between embedding load and
      // hydrate. Surface as unmatched rather than throwing.
      return { line, product: null, similarity: null };
    }
    return {
      line,
      product: summary,
      similarity: winner.similarity,
    };
  });

  // One audit log row covers the whole batch. Cost stays 0 because the
  // embedding pricing isn't surfaced through `ProviderPricing` today —
  // when ENG-040b adds per-call pricing for embedding models, plumb
  // the math through here. The audit row is still valuable as a usage
  // counter even at $0.
  await recordCall(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    userId: ctx.userId,
    feature: 'invoiceLineMatch',
    providerId: embedResult.providerId,
    modelId: embedResult.model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    durationMs: Date.now() - startedAt,
    errorCode: null,
  });

  return { mode: 'matched', matches };
}

async function hydrateProductSummaries(
  db: DatabaseInstance,
  tenantId: string,
  productIds: string[]
): Promise<Map<string, MatchedProductSummary>> {
  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      cost: products.cost,
      stock: products.stock,
    })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), inArray(products.id, productIds)))
    .all();

  const unitRows = await db
    .select({
      productId: unitXProduct.productId,
      unitId: unitXProduct.unitId,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      equivalence: unitXProduct.equivalence,
      isBase: unitXProduct.isBase,
    })
    .from(unitXProduct)
    .innerJoin(units, eq(unitXProduct.unitId, units.id))
    .where(inArray(unitXProduct.productId, productIds))
    .all();

  const unitsByProduct = new Map<string, typeof unitRows>();
  for (const row of unitRows) {
    const bucket = unitsByProduct.get(row.productId) ?? [];
    bucket.push(row);
    unitsByProduct.set(row.productId, bucket);
  }

  const out = new Map<string, MatchedProductSummary>();
  for (const product of productRows) {
    const unitsForProduct = unitsByProduct.get(product.id) ?? [];
    if (unitsForProduct.length === 0) {
      // Without a unit assignment we cannot build a valid cart line —
      // skip silently so the operator falls back to the manual picker.
      continue;
    }
    const baseUnit =
      unitsForProduct.find(u => u.isBase === true) ?? unitsForProduct[0];
    if (!baseUnit) continue;
    out.set(product.id, {
      productId: product.id,
      productName: product.name,
      productSku: product.sku,
      cost: product.cost ?? 0,
      stock: product.stock ?? 0,
      unitId: baseUnit.unitId,
      unitName: baseUnit.unitName,
      unitAbbreviation: baseUnit.unitAbbreviation,
      unitEquivalence: baseUnit.equivalence,
    });
  }
  return out;
}

/** Test seam — exported so unit tests can reach the cosine winner
 *  picker without spinning up the provider mocks. */
export const __matcherInternals = {
  hydrateProductSummaries,
};
