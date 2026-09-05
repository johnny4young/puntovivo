/** Tenant-scoped FTS5 candidates for interactive literal product search. */
import { Buffer } from 'node:buffer';

import type Database from 'better-sqlite3';

import type { DatabaseInstance } from '../../db/index.js';
import type { ExactProductSearchFilters } from './exact-search.js';

const MAX_QUERY_TOKENS = 8;
const MAX_TOKEN_LENGTH = 48;

export interface FtsProductMatch {
  productId: string;
  score: number;
}

export type ProductFtsTokenOperator = 'AND' | 'OR';

function sqliteClient(db: DatabaseInstance): Database.Database {
  return (db as DatabaseInstance & { $client: Database.Database }).$client;
}

/**
 * Encode an arbitrary tenant id as one collision-free tokenizer token.
 * The leading letter keeps the token shape stable even for numeric ids.
 */
export function productSearchTenantScope(tenantId: string): string {
  return `t${Buffer.from(tenantId, 'utf8').toString('hex')}`;
}

/**
 * Convert untrusted operator text to quoted FTS5 prefix phrases.
 * No FTS operators from the input survive this tokenizer boundary.
 */
export function buildProductFtsQuery(
  tenantId: string,
  query: string,
  tokenOperator: ProductFtsTokenOperator = 'AND'
): string | null {
  const tokens = query
    .normalize('NFC')
    .match(/[\p{L}\p{N}]+/gu)
    ?.slice(0, MAX_QUERY_TOKENS)
    .map(token => [...token].slice(0, MAX_TOKEN_LENGTH).join(''))
    .filter(Boolean);
  if (!tokens || tokens.length === 0) return null;

  const terms = tokens.map(token => `"${token.replaceAll('"', '""')}"*`).join(` ${tokenOperator} `);
  return `tenant_scope:"${productSearchTenantScope(tenantId)}" AND {name sku barcode description active_ingredient generic_name manufacturer sanitary_registration}:(${terms})`;
}

/**
 * Resolve a bounded BM25-ranked candidate set. Tenant ownership is enforced
 * three times: an indexed scope token inside MATCH, the stored FTS tenant id,
 * and the authoritative products row joined by id.
 */
export function findFtsProductMatches(
  db: DatabaseInstance,
  tenantId: string,
  query: string,
  filters: ExactProductSearchFilters,
  limit: number,
  tokenOperator: ProductFtsTokenOperator = 'AND'
): FtsProductMatch[] {
  const matchQuery = buildProductFtsQuery(tenantId, query, tokenOperator);
  if (!matchQuery) return [];

  const predicates = [
    '`product_search_fts` MATCH ?',
    '`products`.`tenant_id` = ?',
    "`products`.`catalog_type` <> 'variant_parent'",
  ];
  const params: Array<string | number> = [matchQuery, tenantId];
  if (filters.categoryId) {
    predicates.push('`products`.`category_id` = ?');
    params.push(filters.categoryId);
  }
  if (filters.providerId) {
    predicates.push('`products`.`provider_id` = ?');
    params.push(filters.providerId);
  }
  if (filters.isActive !== undefined) {
    predicates.push('`products`.`is_active` = ?');
    params.push(filters.isActive ? 1 : 0);
  }
  if (filters.tracksStock !== undefined) {
    predicates.push('`products`.`tracks_stock` = ?');
    params.push(filters.tracksStock ? 1 : 0);
  }
  if (filters.pharmacyOnly) {
    predicates.push(
      'EXISTS (SELECT 1 FROM `pharmacy_product_profiles` WHERE `pharmacy_product_profiles`.`product_id` = `products`.`id` AND `pharmacy_product_profiles`.`tenant_id` = ?)'
    );
    params.push(tenantId);
  }
  const client = sqliteClient(db);
  const scoreSql =
    'bm25(product_search_fts, 0.0, 0.0, 0.0, 10.0, 8.0, 8.0, 2.0, 9.0, 9.0, 4.0, 9.0)';

  // FTS triggers preserve product rowids; future table rebuilds must preserve
  // them or rebuild FTS. All business filters and authoritative tenant scope
  // precede LIMIT. Defer reading FTS content to this bounded shortlist, while
  // checking its text identity in the SAME SQL snapshot, not a later query.
  const candidates = client
    .prepare(
      `WITH candidates AS MATERIALIZED (
         SELECT products.id AS productId, products.name AS productName,
           product_search_fts.rowid AS ftsRowid, ${scoreSql} AS score
         FROM product_search_fts
         INNER JOIN products ON products.rowid = product_search_fts.rowid
         WHERE ${predicates.join(' AND ')}
         ORDER BY score ASC, products.name COLLATE NOCASE ASC, products.id ASC
         LIMIT ?
       )
       SELECT product_search_fts.product_id AS productId, candidates.score,
         CASE WHEN candidates.productId = product_search_fts.product_id
           AND product_search_fts.tenant_id = ? THEN 1 ELSE 0 END AS identityValid
       FROM candidates
       LEFT JOIN product_search_fts ON product_search_fts.rowid = candidates.ftsRowid
       ORDER BY candidates.score ASC, candidates.productName COLLATE NOCASE ASC,
         candidates.productId ASC`
    )
    .all(...params, limit, tenantId) as Array<FtsProductMatch & { identityValid: number }>;

  if (candidates.every(candidate => candidate.identityValid === 1)) {
    return candidates.map(({ productId, score }) => ({ productId, score }));
  }

  // If every top-N row is valid, excluding invalid rows outside N cannot change
  // the result. Otherwise rerun the FULL guarded query: dropping bad shortlisted
  // rows would hide valid matches beyond the cutoff and violate ranking/recall.
  return client
    .prepare(
      `SELECT product_search_fts.product_id AS productId, ${scoreSql} AS score
       FROM product_search_fts
       INNER JOIN products ON products.rowid = product_search_fts.rowid
         AND products.id = product_search_fts.product_id
       WHERE ${predicates.join(' AND ')} AND product_search_fts.tenant_id = ?
       ORDER BY score ASC, products.name COLLATE NOCASE ASC, products.id ASC
       LIMIT ?`
    )
    .all(...params, tenantId, limit) as FtsProductMatch[];
}
