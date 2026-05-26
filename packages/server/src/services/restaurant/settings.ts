/**
 * ENG-039d3 — Per-tenant restaurant settings.
 *
 * Mirrors the AI-settings client pattern (`services/ai/client.ts`):
 * defensive read of `tenants.settings.restaurant.*`, merge with the
 * `DEFAULT_RESTAURANT_SETTINGS` baseline, persist via a partial patch.
 *
 * Today the only field is `serviceChargeRate` (0–30 inclusive,
 * percentage). The default of 0 means a tenant pays zero contract cost
 * until the operator opts in — non-restaurant tenants see a hidden UI
 * section and the server rejects any non-zero `serviceChargeAmount`
 * submitted under the disabled rate.
 *
 * @module services/restaurant/settings
 */

import { eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { tenants } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney as roundCurrency } from '../../lib/money.js';

export interface RestaurantSettings {
  /** Percentage applied to the cart subtotal on every checkout (0 disables). */
  serviceChargeRate: number;
}

export const DEFAULT_RESTAURANT_SETTINGS: RestaurantSettings = {
  serviceChargeRate: 0,
};

/** Inclusive ceiling. Mexico restaurant practice tops out near 15%; we
 * leave headroom above and reject malformed values. */
export const SERVICE_CHARGE_RATE_MAX = 30;

function normalizeRate(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    return DEFAULT_RESTAURANT_SETTINGS.serviceChargeRate;
  }
  return Math.min(raw, SERVICE_CHARGE_RATE_MAX);
}

/**
 * Read `tenants.settings.restaurant` for a tenant, merging with the
 * defaults so callers can treat the return value as total.
 */
export async function resolveRestaurantSettings(
  db: DatabaseInstance,
  tenantId: string
): Promise<RestaurantSettings> {
  const tenant = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const blob = (tenant?.settings ?? {}) as Record<string, unknown>;
  const restaurant = (blob.restaurant ?? {}) as Partial<RestaurantSettings>;
  return {
    serviceChargeRate: normalizeRate(restaurant.serviceChargeRate),
  };
}

/**
 * Persist (a partial patch of) `tenants.settings.restaurant`. Returns
 * the resolved settings after merge.
 */
export async function writeRestaurantSettings(
  db: DatabaseInstance,
  tenantId: string,
  patch: Partial<RestaurantSettings>
): Promise<RestaurantSettings> {
  const current = await resolveRestaurantSettings(db, tenantId);
  const next: RestaurantSettings = {
    serviceChargeRate:
      patch.serviceChargeRate !== undefined
        ? normalizeRate(patch.serviceChargeRate)
        : current.serviceChargeRate,
  };

  const tenant = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
  settings.restaurant = next;
  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date().toISOString() })
    .where(eq(tenants.id, tenantId));
  return next;
}

interface AssertServiceChargeArgs {
  db: DatabaseInstance;
  tenantId: string;
  /**
   * Customer-facing pre-tip total — `subtotal + tax - discount`. This
   * is the same base the modal's percentage math uses (so the drift
   * tolerance below stays at 1¢ regardless of the tenant's tax rate).
   * Using bare `subtotal` here would diverge on every taxed cart and
   * raise `SALE_SERVICE_CHARGE_DRIFT` for every restaurant tenant with
   * IVA-bearing items — pinned by the taxed-cart regression test.
   */
  base: number;
  /** Currency value the caller is trying to persist. */
  serviceChargeAmount: number;
}

const DRIFT_TOLERANCE = 0.01;

/**
 * Validate that the caller's `serviceChargeAmount` matches what the
 * tenant's rate would produce, throwing on mismatch. Called from both
 * the fresh-create and from-draft paths in `completeSale`.
 *
 * - Tenant rate = 0 + caller amount > 0 → `SALE_SERVICE_CHARGE_DISABLED`.
 * - Tenant rate > 0 + caller amount drifted from the expected value by
 *   more than 1¢ → `SALE_SERVICE_CHARGE_DRIFT` (including a stale or
 *   manipulated client that tries to submit zero).
 */
export async function assertServiceChargeMatchesTenant(
  args: AssertServiceChargeArgs
): Promise<RestaurantSettings> {
  const tenantSettings = await resolveRestaurantSettings(args.db, args.tenantId);
  if (tenantSettings.serviceChargeRate <= 0) {
    if (args.serviceChargeAmount <= 0) {
      return tenantSettings;
    }
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_SERVICE_CHARGE_DISABLED',
      message:
        'This tenant has no service charge configured; reset the cart to remove the charge',
    });
  }
  const expected = roundCurrency(
    (args.base * tenantSettings.serviceChargeRate) / 100
  );
  if (Math.abs(args.serviceChargeAmount - expected) > DRIFT_TOLERANCE) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_SERVICE_CHARGE_DRIFT',
      message:
        'Service charge amount no longer matches the tenant rate; reopen the modal to refresh',
      details: { expected, received: args.serviceChargeAmount },
    });
  }
  return tenantSettings;
}
