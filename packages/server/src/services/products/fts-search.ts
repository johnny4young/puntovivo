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
  return `tenant_scope:"${productSearchTenantScope(tenantId)}" AND {name sku barcode description}:(${terms})`;
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
    '`product_search_fts`.`tenant_id` = ?',
    '`products`.`tenant_id` = ?',
    "`products`.`catalog_type` <> 'variant_parent'",
  ];
  const params: Array<string | number> = [matchQuery, tenantId, tenantId];
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
  params.push(limit);

  const rows = sqliteClient(db)
    .prepare(
      `SELECT
         product_search_fts.product_id AS productId,
         bm25(product_search_fts, 0.0, 0.0, 0.0, 10.0, 8.0, 8.0, 2.0) AS score
       FROM product_search_fts
       INNER JOIN products ON products.id = product_search_fts.product_id
       WHERE ${predicates.join(' AND ')}
       ORDER BY score ASC, products.name COLLATE NOCASE ASC, products.id ASC
       LIMIT ?`
    )
    .all(...params) as Array<{ productId: string; score: number }>;

  return rows;
}
