/**
 * A-22 — one paginated-list primitive for the CRUD routers.
 *
 * ~10 routers (locations, vatRates, units, providers, categories,
 * customerCatalogs, …) each hand-rolled the same block: an offset from
 * page/perPage, a `Promise.all([select…limit…offset, select count(*)])`,
 * and a `{ items, page, perPage, totalItems, totalPages }` envelope. The
 * repetition is not just noise — it is where a subtle bug lives: the count
 * query MUST carry the same `where` as the items query, or the pager offers
 * pages of a result set the filter already narrowed (the exact class of bug
 * 's server test pins for customers). This helper takes ONE `where`
 * and feeds both queries, so that drift is impossible by construction.
 *
 * Tenant scoping stays the caller's job: the `where` it passes must already
 * include `eq(table.tenantId, ctx.tenantId)`. The helper does not invent a
 * scope — it standardizes the count/offset/totalPages math around whatever
 * predicate the caller built. Generic over the table so the row type flows
 * through with no `any` at the call sites.
 *
 * @module trpc/lib/paginatedList
 */

import { sql, type SQL } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { DatabaseInstance } from '../../db/index.js';

/** The envelope every list procedure returns; matches the existing shape. */
export interface PaginatedResult<TRow> {
  items: TRow[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

export interface PaginatedListArgs<TTable extends SQLiteTable> {
  db: DatabaseInstance;
  table: TTable;
  /**
   * The full predicate — MUST include the tenant scope. `undefined` selects
   * everything (only correct for tenant-less tables; the CRUD routers always
   * pass a tenant-scoped `and(...)`).
   */
  where: SQL | undefined;
  page: number;
  perPage: number;
  /** Optional ORDER BY; omit to keep the table's natural order. */
  orderBy?: SQL | SQL[] | undefined;
}

/**
 * Run the standard list query: items page + total count under the SAME
 * `where`, returned in the canonical envelope. `totalItems` reflects the
 * filtered set, so `totalPages` is honest about how many pages the current
 * filter actually has.
 */
export async function paginatedList<TTable extends SQLiteTable>(
  args: PaginatedListArgs<TTable>
): Promise<PaginatedResult<TTable['$inferSelect']>> {
  const { db, table, where, page, perPage, orderBy } = args;
  const offset = (page - 1) * perPage;

  const itemsQuery = db
    .select()
    .from(table as SQLiteTable)
    .where(where);
  const ordered =
    orderBy === undefined
      ? itemsQuery
      : itemsQuery.orderBy(...(Array.isArray(orderBy) ? orderBy : [orderBy]));

  const [items, countRow] = await Promise.all([
    ordered.limit(perPage).offset(offset).all(),
    db
      .select({ count: sql<number>`count(*)` })
      .from(table as SQLiteTable)
      .where(where)
      .get(),
  ]);

  const totalItems = countRow?.count ?? 0;
  return {
    items: items as TTable['$inferSelect'][],
    page,
    perPage,
    totalItems,
    totalPages: Math.ceil(totalItems / perPage),
  };
}
