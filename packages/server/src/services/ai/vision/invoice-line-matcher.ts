import { and, eq, inArray } from 'drizzle-orm';

import type { DatabaseInstance } from '../../../db/index.js';
import { products, unitXProduct, units } from '../../../db/schema.js';
import { productStockTotalSql } from '../../inventory-balances/derive.js';
import { recordCall } from '../auditLog.js';
import { cosineSimilarity, embedTexts, loadTenantProductEmbeddings } from '../embeddings.js';

const INVOICE_LINE_SIMILARITY_FLOOR = 0.85;

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
  source: 'sku' | 'embedding' | null;
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

export interface InvoiceLineMatcherOptions {
  bestEffortSkuFallback?: boolean;
}

function normalizeSku(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function descriptionContainsSku(description: string, sku: string): boolean {
  const normalizedSku = normalizeSku(sku);
  if (normalizedSku.length < 2) return false;
  return normalizeSku(description).includes(normalizedSku);
}

async function loadExactSkuProductIds(
  db: DatabaseInstance,
  tenantId: string,
  lines: InvoiceLineForMatching[]
): Promise<Map<number, string>> {
  const productRows = await db
    .select({ id: products.id, sku: products.sku })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.isActive, true)))
    .all();

  const out = new Map<number, string>();
  lines.forEach((line, idx) => {
    const winner = productRows.find(product =>
      descriptionContainsSku(line.description, product.sku)
    );
    if (winner) out.set(idx, winner.id);
  });
  return out;
}

export async function matchInvoiceLinesToProducts(
  ctx: InvoiceLineMatcherContext,
  lines: InvoiceLineForMatching[],
  options: InvoiceLineMatcherOptions = {}
): Promise<InvoiceLineMatcherResult> {
  if (lines.length === 0) {
    return { mode: 'matched', matches: [] };
  }

  const matches: InvoiceLineMatch[] = lines.map(line => ({
    line,
    product: null,
    source: null,
    similarity: null,
  }));

  if (options.bestEffortSkuFallback === true) {
    const exactSkuMatches = await loadExactSkuProductIds(ctx.db, ctx.tenantId, lines);
    const exactSkuProductIds = [...new Set(exactSkuMatches.values())];
    const exactSkuSummaries =
      exactSkuProductIds.length === 0
        ? new Map<string, MatchedProductSummary>()
        : await hydrateProductSummaries(ctx.db, ctx.tenantId, exactSkuProductIds);

    lines.forEach((line, idx) => {
      const exactProductId = exactSkuMatches.get(idx);
      const product = exactProductId ? (exactSkuSummaries.get(exactProductId) ?? null) : null;
      if (!product) return;
      matches[idx] = {
        line,
        product,
        source: 'sku',
        similarity: 1,
      };
    });
  }

  const remaining = matches
    .map((match, idx) => ({ match, idx }))
    .filter(({ match }) => match.product === null);

  if (remaining.length === 0) {
    return { mode: 'matched', matches };
  }

  const embedded = await loadTenantProductEmbeddings(ctx.db, ctx.tenantId);
  if (embedded.length === 0) {
    return options.bestEffortSkuFallback === true
      ? { mode: 'matched', matches }
      : { mode: 'unavailable', reason: 'no-embeddings', matches: [] };
  }

  const startedAt = Date.now();
  const embedResult = await embedTexts(
    ctx.db,
    ctx.tenantId,
    remaining.map(({ match }) => match.line.description)
  );
  if (!embedResult) {
    return options.bestEffortSkuFallback === true
      ? { mode: 'matched', matches }
      : { mode: 'unavailable', reason: 'ai-disabled', matches: [] };
  }

  const winners: Array<{ productId: string; similarity: number } | null> =
    embedResult.embeddings.map(queryVec => {
      let best: { productId: string; similarity: number } | null = null;
      for (const row of embedded) {
        const sim = cosineSimilarity(queryVec, row.embedding);
        if (sim < INVOICE_LINE_SIMILARITY_FLOOR) continue;
        if (best === null || sim > best.similarity) {
          best = { productId: row.productId, similarity: sim };
        }
      }
      return best;
    });

  const matchedIds = Array.from(
    new Set(winners.filter((w): w is NonNullable<typeof w> => w !== null).map(w => w.productId))
  );

  // Hydrate one row per distinct match: product card + base unit data
  // so the renderer can call `mergePurchaseCartItem` with the same
  // shape `ProductSearchDialog` already produces.
  const summaries =
    matchedIds.length === 0
      ? new Map<string, MatchedProductSummary>()
      : await hydrateProductSummaries(ctx.db, ctx.tenantId, matchedIds);

  remaining.forEach(({ idx }, remainingIdx) => {
    const line = lines[idx]!;
    const winner = winners[remainingIdx];
    if (!winner) {
      matches[idx] = { line, product: null, source: null, similarity: null };
      return;
    }
    const summary = summaries.get(winner.productId);
    if (!summary) {
      // Defensive: product disappeared between embedding load and
      // hydrate. Surface as unmatched rather than throwing.
      matches[idx] = { line, product: null, source: null, similarity: null };
      return;
    }
    matches[idx] = {
      line,
      product: summary,
      source: 'embedding',
      similarity: winner.similarity,
    };
  });

  // One audit log row covers the whole batch. Cost stays 0 because the
  // embedding pricing isn't surfaced through `ProviderPricing` today —
  // when  adds per-call pricing for embedding models, plumb
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
      stock: productStockTotalSql,
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
    const baseUnit = unitsForProduct.find(u => u.isBase === true) ?? unitsForProduct[0];
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
 * picker without spinning up the provider mocks. */
export const __matcherInternals = {
  hydrateProductSummaries,
};
