/**
 * Currency seam helper — single source of truth for resolving a
 * tenant's default ISO-4217 currency code.
 *
 * Why this exists. The storage layer was extended in  to carry
 * a `currency_code` column on every transactional row (sales,
 * sale_items, quotations, quotation_items, products,
 * `customers.credit_limit_currency_code`) plus `exchange_rate_at_sale`
 * + nullable `settle_currency_code` on the four sale / quotation
 * tables. Each INSERT path that previously assumed "everything is in
 * the tenant's default currency" now has to stamp that currency
 * explicitly. Reading the value from `tenants.default_currency_code`
 * once per write keeps the contract uniform and the multi-tenant
 * boundary intact.
 *
 * Why not parse `tenants.settings` JSON. Until , the tenant
 * currency lived in `tenants.settings.currency` (undocumented JSON)
 * and `tenant_locale_settings.currency_override` / `country_code →
 * country_catalog.default_currency_code`. The 0037 migration
 * back-fills a flat `tenants.default_currency_code` column with the
 * COALESCE of those three sources, so application code never has to
 * touch the JSON path on the write hot path again.
 *
 * Fallback policy. If a tenant row is missing (transient bootstrap)
 * or the column comes back null, fall back to `'COP'` — that is the
 * project default and matches `payment_outbox.currencyCode`'s
 * existing DEFAULT. Production tenants get the explicit value after
 * the 0037 backfill; the fallback exists so a misconfigured fixture
 * never crashes a sale.
 *
 * Apply at the boundary of every monetary write that does not
 * already accept a currency override from the operator (product
 * import, customer credit limit override, future  multi-
 * currency sale). The helper is intentionally small + sync to keep
 * the call site readable: `const currencyCode =
 * resolveTenantCurrency(ctx.db, ctx.tenantId);`.
 */

import type { DatabaseInstance } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { tenants } from '../db/schema.js';

/**
 * Project-wide fallback when a tenant row cannot resolve to an
 * explicit currency. Matches `payment_outbox.currencyCode` default
 * (`'COP'`). Production tenants never hit this — they carry an
 * explicit `default_currency_code` after migration 0037.
 */
export const TENANT_CURRENCY_FALLBACK = 'COP';

/**
 * Resolve the ISO-4217 currency code stamped on every transactional
 * write for a tenant. Synchronous because `better-sqlite3` is
 * synchronous — keeping it sync avoids forcing every caller into
 * async/await purely for a primary-key lookup.
 *
 * @param db - The tenant-scoped DB instance from `ctx.db`.
 * @param tenantId - The caller's tenant id (`ctx.tenantId`).
 * @returns The tenant's `default_currency_code`, or
 * `TENANT_CURRENCY_FALLBACK` if the row is missing / null.
 */
export function resolveTenantCurrency(db: DatabaseInstance, tenantId: string): string {
  const row = db
    .select({ code: tenants.defaultCurrencyCode })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  return row?.code ?? TENANT_CURRENCY_FALLBACK;
}
