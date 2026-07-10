/**
 * ENG-194b — Per-tenant cash-close settings.
 *
 * Mirrors the restaurant-settings pattern (`services/restaurant/settings.ts`):
 * defensive read of `tenants.settings.cashClose.*`, merge with the
 * `DEFAULT_CASH_CLOSE_SETTINGS` baseline, persist via a partial patch.
 *
 * Today the only field is `blindClose`. `true` (the default) keeps the
 * anti-fraud blind close: cashiers count the till without seeing the
 * expected balance, and only managers/admins get the live over/short
 * semaphore (ENG-194). `false` is an explicit tenant opt-out — e.g. an
 * owner-operated shop — that shows the live semaphore to every role.
 *
 * The value reaches the POS through the `auth.me` session payload (the
 * tenant row's `settings` blob is passed verbatim), so like the restaurant
 * service-charge rate, a change here is picked up on the next login or
 * page refresh.
 *
 * @module services/cash-close-settings
 */

import { eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../db/index.js';
import { tenants } from '../db/schema.js';

/** Tenant-level knobs for the cash-session close flow. */
export interface CashCloseSettings {
  /**
   * When true (default), the close is blind for cashiers: the expected
   * balance stays hidden while they count and only managers/admins see
   * the live over/short semaphore. When false, every role sees it.
   */
  blindClose: boolean;
}

export const DEFAULT_CASH_CLOSE_SETTINGS: CashCloseSettings = {
  blindClose: true,
};

function normalizeBlindClose(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : DEFAULT_CASH_CLOSE_SETTINGS.blindClose;
}

/**
 * Read `tenants.settings.cashClose` for a tenant, merging with the
 * defaults so callers can treat the return value as total.
 */
export async function resolveCashCloseSettings(
  db: DatabaseInstance,
  tenantId: string
): Promise<CashCloseSettings> {
  const tenant = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const blob = (tenant?.settings ?? {}) as Record<string, unknown>;
  const cashClose = (blob.cashClose ?? {}) as Partial<CashCloseSettings>;
  return {
    blindClose: normalizeBlindClose(cashClose.blindClose),
  };
}

/**
 * Persist (a partial patch of) `tenants.settings.cashClose`. Returns the
 * resolved settings after merge.
 */
export async function writeCashCloseSettings(
  db: DatabaseInstance,
  tenantId: string,
  patch: Partial<CashCloseSettings>
): Promise<CashCloseSettings> {
  const current = await resolveCashCloseSettings(db, tenantId);
  const next: CashCloseSettings = {
    blindClose:
      patch.blindClose !== undefined ? normalizeBlindClose(patch.blindClose) : current.blindClose,
  };

  const tenant = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
  settings.cashClose = next;
  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date().toISOString() })
    .where(eq(tenants.id, tenantId));
  return next;
}
