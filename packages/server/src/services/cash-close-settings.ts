/**
 * Per-tenant cash-close settings.
 *
 * Mirrors the restaurant-settings pattern (`services/restaurant/settings.ts`):
 * defensive read of `tenants.settings.cashClose.*`, merge with the
 * `DEFAULT_CASH_CLOSE_SETTINGS` baseline, persist via a partial patch.
 *
 * Today the only field is `blindClose`. `true` (the default) keeps the
 * anti-fraud blind close: cashiers count the till without seeing the
 * expected balance, and only managers/admins get the live over/short
 * semaphore (). `false` is an explicit tenant opt-out — e.g. an
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
import { isValidCashRoundingStep } from '../lib/money.js';
import { readTenantSettingsRow } from './tenant-settings-read.js';

/** Tenant-level knobs for the cash-session close flow. */
export interface CashCloseSettings {
  /**
   * When true (default), the close is blind for cashiers: the expected
   * balance stays hidden while they count and only managers/admins see
   * the live over/short semaphore. When false, every role sees it.
   */
  blindClose: boolean;
  /**
   * Optional smallest-coin step (e.g. 50 for COP, 10 for CLP) applied only to
   * single-tender cash sales and pure cash refunds. Card, transfer and split
   * tenders remain on the currency's base payable unit.
   */
  cashRoundingStep: number | null;
}

export const DEFAULT_CASH_CLOSE_SETTINGS: CashCloseSettings = {
  blindClose: true,
  cashRoundingStep: null,
};

function normalizeBlindClose(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : DEFAULT_CASH_CLOSE_SETTINGS.blindClose;
}

function normalizeCashRoundingStep(raw: unknown): number | null {
  return isValidCashRoundingStep(raw) ? raw : null;
}

/** Synchronous reader for callers inside a Drizzle SQLite write transaction. */
export function resolveCashCloseSettingsSync(
  db: DatabaseInstance,
  tenantId: string
): CashCloseSettings {
  const tenant = readTenantSettingsRow(db, tenantId);
  const blob = (tenant?.settings ?? {}) as Record<string, unknown>;
  const cashClose = (blob.cashClose ?? {}) as Partial<CashCloseSettings>;
  return {
    blindClose: normalizeBlindClose(cashClose.blindClose),
    cashRoundingStep: normalizeCashRoundingStep(cashClose.cashRoundingStep),
  };
}

/**
 * Read `tenants.settings.cashClose` for a tenant, merging with the
 * defaults so callers can treat the return value as total.
 */
export async function resolveCashCloseSettings(
  db: DatabaseInstance,
  tenantId: string
): Promise<CashCloseSettings> {
  return resolveCashCloseSettingsSync(db, tenantId);
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
  if (patch.blindClose === undefined && patch.cashRoundingStep === undefined) {
    return current;
  }
  const next: CashCloseSettings = {
    blindClose:
      patch.blindClose === undefined ? current.blindClose : normalizeBlindClose(patch.blindClose),
    cashRoundingStep:
      patch.cashRoundingStep === undefined
        ? current.cashRoundingStep
        : normalizeCashRoundingStep(patch.cashRoundingStep),
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
