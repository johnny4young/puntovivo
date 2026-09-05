/**
 * tenant locale + catalogs tRPC router.
 *
 * Three procedures:
 * - `tenantLocale.get` — returns the resolved locale for the current
 * tenant (falls back to US/USD when no row exists).
 * - `tenantLocale.update` (admin only) — upserts the tenant's locale
 * settings row. Validates both `countryCode` and
 * `currencyOverride` against the global catalogs so the FK
 * constraint fires before the write.
 * - `tenantLocale.listCountries` / `listCurrencies` — read-only dumps
 * of the global catalogs. Used by the admin picker.
 *
 * The resolver itself lives in `services/tenant-locale.ts`; this
 * router just exposes the HTTP surface.
 *
 * @module trpc/routers/tenantLocale
 */

import { and, asc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { adminProcedure } from '../middleware/roles.js';
import { assertVersionedWriteApplied } from '../../lib/optimisticVersion.js';
import { countryCatalog, currencyCatalog, tenantLocaleSettings, tenants } from '../../db/schema.js';
import { resolveTenantLocale } from '../../services/tenant-locale.js';
import { updateTenantLocaleInput } from '../schemas/tenantLocale.js';

export const tenantLocaleRouter = router({
  /**
   * Resolved locale for the signed-in tenant. Callers (LocaleProvider)
   * use this to hydrate the formatter context.
   */
  get: tenantProcedure.query(async ({ ctx }) => {
    return resolveTenantLocale(ctx.db, ctx.tenantId);
  }),

  /**
   * Read-only dump of the country catalog. Ordered by Spanish name
   * so the admin picker renders in an operator-friendly order.
   */
  listCountries: tenantProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(countryCatalog).orderBy(asc(countryCatalog.nameEs)).all();
  }),

  /**
   * Read-only dump of the currency catalog. Ordered by code so the
   * admin picker is predictable.
   */
  listCurrencies: tenantProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(currencyCatalog).orderBy(asc(currencyCatalog.code)).all();
  }),

  /**
   * Upsert the tenant's locale settings. Admin only. Validates both
   * `countryCode` and `currencyOverride` against the catalogs.
   */
  update: adminProcedure.input(updateTenantLocaleInput).mutation(async ({ ctx, input }) => {
    const country = await ctx.db
      .select({
        code: countryCatalog.code,
        defaultCurrencyCode: countryCatalog.defaultCurrencyCode,
      })
      .from(countryCatalog)
      .where(eq(countryCatalog.code, input.countryCode))
      .get();
    if (!country) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Country code ${input.countryCode} is not in the catalog`,
      });
    }
    if (input.currencyOverride) {
      const currency = await ctx.db
        .select({ code: currencyCatalog.code })
        .from(currencyCatalog)
        .where(eq(currencyCatalog.code, input.currencyOverride))
        .get();
      if (!currency) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Currency code ${input.currencyOverride} is not in the catalog`,
        });
      }
    }

    const now = new Date().toISOString();
    const existing = await ctx.db
      .select({
        tenantId: tenantLocaleSettings.tenantId,
        localeOverride: tenantLocaleSettings.localeOverride,
        currencyOverride: tenantLocaleSettings.currencyOverride,
        timezoneOverride: tenantLocaleSettings.timezoneOverride,
        firstDayOfWeekOverride: tenantLocaleSettings.firstDayOfWeekOverride,
        version: tenantLocaleSettings.version,
      })
      .from(tenantLocaleSettings)
      .where(eq(tenantLocaleSettings.tenantId, ctx.tenantId))
      .get();
    const nextCurrencyOverride =
      existing && input.currencyOverride === undefined
        ? existing.currencyOverride
        : (input.currencyOverride ?? null);
    const effectiveCurrencyCode = nextCurrencyOverride ?? country.defaultCurrencyCode;
    ctx.db.transaction(tx => {
      if (existing) {
        // optimistic-concurrency guard on the update branch. The version
        // predicate also protects legacy clients that omit the token: a race
        // still fails closed instead of letting the currency seam diverge.
        const expectedVersion = input.version ?? existing.version;
        const versionedUpdate = tx
          .update(tenantLocaleSettings)
          .set({
            countryCode: input.countryCode,
            localeOverride:
              input.localeOverride === undefined ? existing.localeOverride : input.localeOverride,
            currencyOverride: nextCurrencyOverride,
            timezoneOverride:
              input.timezoneOverride === undefined
                ? existing.timezoneOverride
                : input.timezoneOverride,
            firstDayOfWeekOverride:
              input.firstDayOfWeekOverride === undefined
                ? existing.firstDayOfWeekOverride
                : input.firstDayOfWeekOverride,
            version: expectedVersion + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(tenantLocaleSettings.tenantId, ctx.tenantId),
              eq(tenantLocaleSettings.version, expectedVersion)
            )
          )
          .run() as { changes?: number };
        assertVersionedWriteApplied('tenantLocale', versionedUpdate.changes ?? 0, expectedVersion);
      } else {
        tx.insert(tenantLocaleSettings)
          .values({
            tenantId: ctx.tenantId,
            countryCode: input.countryCode,
            localeOverride: input.localeOverride ?? null,
            currencyOverride: input.currencyOverride ?? null,
            timezoneOverride: input.timezoneOverride ?? null,
            firstDayOfWeekOverride: input.firstDayOfWeekOverride ?? null,
            // no row exists yet, so the resolved-locale fallback is
            // the virtual version 0. Persist the first real write as 1 so a
            // second tab that also loaded fallback version 0 is rejected by
            // the guarded update branch instead of overwriting this save.
            version: (input.version ?? 0) + 1,
            updatedAt: now,
          })
          .run();
      }

      // New monetary rows read this flattened seam, while the renderer reads
      // tenant_locale_settings. They must move in the same transaction or an
      // operator can see USD in the cart while the committed sale freezes COP.
      const tenantUpdate = tx
        .update(tenants)
        .set({ defaultCurrencyCode: effectiveCurrencyCode, updatedAt: now })
        .where(eq(tenants.id, ctx.tenantId))
        .run() as { changes?: number };
      if ((tenantUpdate.changes ?? 0) !== 1) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
      }
    });

    // Return the freshly resolved locale so the client can update
    // its context without a second round-trip.
    return resolveTenantLocale(ctx.db, ctx.tenantId);
  }),
});
