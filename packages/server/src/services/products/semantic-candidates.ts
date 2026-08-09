/** Bounded literal candidate retrieval for hybrid semantic product search. */
import { and, asc, eq, like, ne, or } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { products } from '../../db/schema.js';
import { findExactProductMatches } from './exact-search.js';
import { findFtsProductMatches } from './fts-search.js';

/**
 * Hard memory/CPU boundary for one semantic request. At the largest currently
 * supported OpenAI vector (3,072 float values), 200 parsed vectors remain a
 * bounded request-local working set instead of scaling with tenant catalog size.
 */
export const SEMANTIC_CANDIDATE_LIMIT = 200;

export type SemanticCandidateSource = 'exact' | 'fts' | 'substring';

export interface SemanticProductCandidate {
  productId: string;
  source: SemanticCandidateSource;
}

function boundedLimit(limit: number): number {
  if (!Number.isFinite(limit)) return SEMANTIC_CANDIDATE_LIMIT;
  return Math.max(1, Math.min(Math.floor(limit), SEMANTIC_CANDIDATE_LIMIT));
}

/**
 * Retrieve a high-recall but bounded hybrid-search pool.
 *
 * Exact codes retain first priority. FTS uses OR between sanitized query tokens
 * here (unlike the precise literal endpoint's AND) because semantic similarity
 * is responsible for reranking the shortlist. LIKE is only a compatibility
 * fallback for punctuation-only and within-token searches that FTS cannot
 * represent. Every lane excludes catalog-only variant parents and applies the
 * tenant boundary before returning an id.
 */
export async function findSemanticProductCandidates(
  db: DatabaseInstance,
  tenantId: string,
  query: string,
  limit: number = SEMANTIC_CANDIDATE_LIMIT
): Promise<SemanticProductCandidate[]> {
  const maxCandidates = boundedLimit(limit);
  const matches: SemanticProductCandidate[] = [];
  const seen = new Set<string>();
  const append = (source: SemanticCandidateSource, productIds: readonly string[]) => {
    for (const productId of productIds) {
      if (seen.has(productId)) continue;
      seen.add(productId);
      matches.push({ productId, source });
      if (matches.length === maxCandidates) return;
    }
  };

  const exact = await findExactProductMatches(db, tenantId, query, {}, maxCandidates);
  append(
    'exact',
    exact.map(match => match.productId)
  );

  const remainingAfterExact = maxCandidates - matches.length;
  if (remainingAfterExact === 0) return matches;
  const fts = findFtsProductMatches(db, tenantId, query, {}, remainingAfterExact, 'OR');
  append(
    'fts',
    fts.map(match => match.productId)
  );

  // FTS already supplies the high-recall shortlist when it returns anything.
  // Scanning for substring candidates as well would add work without a new
  // retrieval lane. Keep LIKE only for queries FTS could not resolve at all.
  if (fts.length > 0 || matches.length === maxCandidates) return matches;

  const substringRows = await db
    .select({ productId: products.id })
    .from(products)
    .where(
      and(
        eq(products.tenantId, tenantId),
        ne(products.catalogType, 'variant_parent'),
        or(
          like(products.name, `%${query}%`),
          like(products.sku, `%${query}%`),
          like(products.barcode, `%${query}%`)
        )
      )
    )
    .orderBy(asc(products.name), asc(products.id))
    .limit(maxCandidates - matches.length)
    .all();
  append(
    'substring',
    substringRows.map(row => row.productId)
  );
  return matches;
}
