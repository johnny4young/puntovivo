import type { DatabaseInstance } from '../../db/index.js';
import { resolveDiscountSettings } from '../discount-settings.js';
import {
  resolveTenantBusinessClock,
  type TenantBusinessClock,
} from '../pharmacy/business-clock.js';
import { daysUntilLotExpiry } from './expiry.js';
import { listSellableLots } from './queries.js';

export interface NextLotHint {
  lotNumber: string;
  expiresAt: string | null;
  daysToExpiry: number | null;
  /** Inside the tenant's widest expiry-discount window, so it should leave first. */
  nearExpiry: boolean;
}

/** The lot each product sells next at the site (FEFO), keyed by product id. */
export async function resolveNextLotHints(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    siteId: string;
    productIds: readonly string[];
    clock?: TenantBusinessClock;
  }
): Promise<Map<string, NextLotHint>> {
  const hints = new Map<string, NextLotHint>();
  if (args.productIds.length === 0) return hints;
  const [clock, settings] = await Promise.all([
    // A hint never fails the read that carries it, e.g. a search with a broken tenant locale.
    args.clock ?? resolveTenantBusinessClock(db, args.tenantId).catch(() => null),
    resolveDiscountSettings(db, args.tenantId),
  ]);
  if (!clock) return hints;
  const nearExpiryDays = Math.max(0, ...settings.expiryTiers.map(tier => tier.maxDays));
  const lots = listSellableLots(db, {
    tenantId: args.tenantId,
    siteId: args.siteId,
    productIds: [...new Set(args.productIds)],
    nowIso: clock.nowIso,
    businessDate: clock.businessDate,
  });
  for (const lot of lots) {
    if (hints.has(lot.productId)) continue;
    const daysToExpiry = daysUntilLotExpiry(lot.expiresAt, clock.nowIso, clock.businessDate);
    hints.set(lot.productId, {
      lotNumber: lot.lotNumber,
      expiresAt: lot.expiresAt,
      daysToExpiry,
      nearExpiry: daysToExpiry !== null && daysToExpiry <= nearExpiryDays,
    });
  }
  return hints;
}
