/** Tenant-scoped FTS5 candidates for interactive literal product search. */
import { Buffer } from 'node:buffer';

import type Database from 'better-sqlite3';

import type { DatabaseInstance } from '../../db/index.js';
import type { ExactProductSearchFilters } from './exact-search.js';

const MAX_QUERY_TOKENS = 8;
const MAX_TOKEN_LENGTH = 48;
const SELECTIVE_MATCH_LIMIT = 64;
// A contradiction, rather than a presumed-absent token, also rejects corrupt indexes.
const EMPTY_MATCH = 'tenant_scope:"empty" NOT tenant_scope:"empty"';

export interface FtsProductMatch {
  productId: string;
  score: number;
}

export type ProductFtsTokenOperator = 'AND' | 'OR';

function sqliteClient(db: DatabaseInstance): Database.Database {
  return (db as DatabaseInstance & { $client: Database.Database }).$client;
}

// Five filter-presence flags and two query paths bound the cache to 64
// statements per native connection. Only SQL is retained: every invocation
// rebinds tenant, MATCH, filters and limit, and rechecks identity in SQLite.
const statements = new WeakMap<Database.Database, Map<number, Database.Statement>>();

function preparedSearch(
  client: Database.Database,
  shape: number,
  query: () => string
): Database.Statement {
  let cache = statements.get(client);
  if (!cache) {
    cache = new Map();
    statements.set(client, cache);
  }
  let statement = cache.get(shape);
  if (!statement) {
    statement = client.prepare(query());
    cache.set(shape, statement);
  }
  return statement;
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
function buildProductTextQuery(
  query: string,
  tokenOperator: ProductFtsTokenOperator
): string | null {
  const tokens = query
    .normalize('NFC')
    .match(/[\p{L}\p{N}]+/gu)
    ?.slice(0, MAX_QUERY_TOKENS)
    .map(token => [...token].slice(0, MAX_TOKEN_LENGTH).join(''))
    .filter(Boolean);
  if (!tokens || tokens.length === 0) return null;

  const terms = tokens.map(token => `"${token.replaceAll('"', '""')}"*`).join(` ${tokenOperator} `);
  return `{name sku barcode description active_ingredient generic_name manufacturer sanitary_registration}:(${terms})`;
}

export function buildProductFtsQuery(
  tenantId: string,
  query: string,
  tokenOperator: ProductFtsTokenOperator = 'AND'
): string | null {
  const textQuery = buildProductTextQuery(query, tokenOperator);
  return textQuery ? `tenant_scope:"${productSearchTenantScope(tenantId)}" AND ${textQuery}` : null;
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
  const textQuery = buildProductTextQuery(query, tokenOperator);
  if (!textQuery) return [];
  const matchQuery = `tenant_scope:"${productSearchTenantScope(tenantId)}" AND ${textQuery}`;

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
  const shape =
    (filters.categoryId ? 1 : 0) |
    (filters.providerId ? 2 : 0) |
    (filters.isActive !== undefined ? 4 : 0) |
    (filters.tracksStock !== undefined ? 8 : 0) |
    (filters.pharmacyOnly ? 16 : 0);
  const scoreSql =
    'bm25(product_search_fts, 0.0, 0.0, 0.0, 10.0, 8.0, 8.0, 2.0, 9.0, 9.0, 4.0, 9.0)';

  // FTS triggers preserve product rowids; future table rebuilds must preserve
  // them or rebuild FTS. All business filters and authoritative tenant scope
  // precede LIMIT. Defer reading FTS content to this bounded shortlist, while
  // checking its text identity in the SAME SQL snapshot, not a later query.
  // A bounded, tenant-scoped probe and both ranking paths share ONE snapshot.
  // Small queries rank only the complete probe rowids with text-only BM25:
  // the scope phrase has zero weight, but including it makes FTS5 compute its
  // corpus-wide phrase statistics. Broad queries retain the original MATCH.
  // Never probe global cardinality or truncate a broad set before ranking.
  const selection = `SELECT products.id AS productId, products.name AS productName,
    product_search_fts.rowid AS ftsRowid, ${scoreSql} AS score
    FROM product_search_fts
    INNER JOIN products ON products.rowid = product_search_fts.rowid`;
  const candidates = preparedSearch(
    client,
    shape,
    () => `WITH scope_probe AS MATERIALIZED (
         SELECT rowid FROM product_search_fts WHERE product_search_fts MATCH ?
         LIMIT ${SELECTIVE_MATCH_LIMIT + 1}
       ), candidates AS MATERIALIZED (
         ${selection}
         WHERE ${predicates.join(' AND ')}
           AND product_search_fts.rowid IN (
             SELECT rowid FROM scope_probe
             WHERE (SELECT count(*) FROM scope_probe) <= ${SELECTIVE_MATCH_LIMIT}
           )
         UNION ALL
         ${selection}
         WHERE product_search_fts MATCH (
           CASE WHEN (SELECT count(*) FROM scope_probe) > ${SELECTIVE_MATCH_LIMIT}
             THEN ? ELSE '${EMPTY_MATCH}' END
         ) AND ${predicates.slice(1).join(' AND ')}
         ORDER BY score ASC, productName COLLATE NOCASE ASC, productId ASC
         LIMIT ?
       )
       SELECT product_search_fts.product_id AS productId, candidates.score,
         CASE WHEN candidates.productId = product_search_fts.product_id
           AND product_search_fts.tenant_id = ? THEN 1 ELSE 0 END AS identityValid
       FROM candidates
       LEFT JOIN product_search_fts ON product_search_fts.rowid = candidates.ftsRowid
       ORDER BY candidates.score ASC, candidates.productName COLLATE NOCASE ASC,
         candidates.productId ASC`
  ).all(matchQuery, textQuery, ...params.slice(1), ...params, limit, tenantId) as Array<
    FtsProductMatch & { identityValid: number }
  >;

  if (candidates.every(candidate => candidate.identityValid === 1)) {
    return candidates.map(({ productId, score }) => ({ productId, score }));
  }

  // If every top-N row is valid, excluding invalid rows outside N cannot change
  // the result. Otherwise rerun the FULL guarded query: dropping bad shortlisted
  // rows would hide valid matches beyond the cutoff and violate ranking/recall.
  return preparedSearch(
    client,
    shape | 32,
    () => `SELECT product_search_fts.product_id AS productId, ${scoreSql} AS score
       FROM product_search_fts
       INNER JOIN products ON products.rowid = product_search_fts.rowid
         AND products.id = product_search_fts.product_id
       WHERE ${predicates.join(' AND ')} AND product_search_fts.tenant_id = ?
       ORDER BY score ASC, products.name COLLATE NOCASE ASC, products.id ASC
       LIMIT ?`
  ).all(...params, tenantId, limit) as FtsProductMatch[];
}
