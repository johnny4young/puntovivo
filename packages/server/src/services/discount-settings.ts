/**
 * ENG-211 — Per-tenant expiry-discount settings.
 *
 * Mirrors the `cash-close-settings` pattern (defensive read of
 * `tenants.settings.discount.*`, merge with defaults, persist a partial
 * patch). It closes the ENG-199 follow-up: the radar's discount tiers
 * shipped as exported constants (`EXPIRY_DISCOUNT_TIERS`) precisely so the
 * SOURCE of the values could move here without rewriting any caller.
 *
 * The tier rule stays the same shape — a first-match-wins ladder of
 * `{ maxDays, pct }` — but a tenant can now tune it: a bakery discounting
 * at 3 days is a different business from a pharmacy discounting at 60.
 * Invalid or absent blobs fall back to `DEFAULT_EXPIRY_DISCOUNT_TIERS`
 * (the ENG-199 rule), so a corrupt settings JSON can never leave the radar
 * without a rule.
 *
 * @module services/discount-settings
 */

import { eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../db/index.js';
import { tenants } from '../db/schema.js';
import { EXPIRY_DISCOUNT_TIERS, type ExpiryDiscountTier } from './price-suggestions.js';

/** Tenant-level knobs for the expiry radar's discount suggestions. */
export interface DiscountSettings {
  /**
   * First-match-wins ladder: a lot expiring within `maxDays` days earns
   * `pct`. ALWAYS returned sorted ascending by `maxDays` — the rule
   * evaluator depends on that order, so normalization sorts rather than
   * trusting the stored blob.
   */
  expiryTiers: ExpiryDiscountTier[];
}

/** The ENG-199 rule stays the baseline for every tenant that never tuned it. */
export const DEFAULT_EXPIRY_DISCOUNT_TIERS: ExpiryDiscountTier[] = EXPIRY_DISCOUNT_TIERS.map(
  tier => ({ ...tier })
);

export const DEFAULT_DISCOUNT_SETTINGS: DiscountSettings = {
  expiryTiers: DEFAULT_EXPIRY_DISCOUNT_TIERS,
};

/** Bounds mirrored by the Zod input; enforced here too because the blob is
 * free-form JSON that a bad migration or manual edit could corrupt. */
export const TIER_MAX_DAYS_LIMIT = 365;
export const MAX_TIERS = 5;

function isValidTier(raw: unknown): raw is ExpiryDiscountTier {
  if (!raw || typeof raw !== 'object') return false;
  const tier = raw as { maxDays?: unknown; pct?: unknown };
  return (
    typeof tier.maxDays === 'number' &&
    Number.isInteger(tier.maxDays) &&
    tier.maxDays >= 1 &&
    tier.maxDays <= TIER_MAX_DAYS_LIMIT &&
    typeof tier.pct === 'number' &&
    Number.isInteger(tier.pct) &&
    tier.pct >= 1 &&
    tier.pct <= 99
  );
}

/**
 * Normalize a stored/patched tier list. Drops invalid entries, de-duplicates
 * by `maxDays` (first wins), sorts ascending, and caps the length. An empty
 * result falls back to the defaults: the radar must never be left ruleless.
 */
export function normalizeExpiryTiers(raw: unknown): ExpiryDiscountTier[] {
  if (!Array.isArray(raw)) return DEFAULT_EXPIRY_DISCOUNT_TIERS.map(tier => ({ ...tier }));
  const seen = new Set<number>();
  const valid: ExpiryDiscountTier[] = [];
  for (const entry of raw) {
    if (!isValidTier(entry) || seen.has(entry.maxDays)) continue;
    seen.add(entry.maxDays);
    valid.push({ maxDays: entry.maxDays, pct: entry.pct });
  }
  if (valid.length === 0) return DEFAULT_EXPIRY_DISCOUNT_TIERS.map(tier => ({ ...tier }));
  valid.sort((a, b) => a.maxDays - b.maxDays);
  return valid.slice(0, MAX_TIERS);
}

/** Read `tenants.settings.discount`, merged with defaults (total value). */
export async function resolveDiscountSettings(
  db: DatabaseInstance,
  tenantId: string
): Promise<DiscountSettings> {
  const tenant = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const blob = (tenant?.settings ?? {}) as Record<string, unknown>;
  const discount = (blob.discount ?? {}) as { expiryTiers?: unknown };
  return { expiryTiers: normalizeExpiryTiers(discount.expiryTiers) };
}

/**
 * Persist (a partial patch of) `tenants.settings.discount`. Returns the
 * resolved settings after merge. An empty patch is a true no-op.
 */
export async function writeDiscountSettings(
  db: DatabaseInstance,
  tenantId: string,
  patch: Partial<DiscountSettings>
): Promise<DiscountSettings> {
  const current = await resolveDiscountSettings(db, tenantId);
  if (patch.expiryTiers === undefined) {
    return current;
  }
  const next: DiscountSettings = { expiryTiers: normalizeExpiryTiers(patch.expiryTiers) };

  const tenant = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
  settings.discount = next;
  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date().toISOString() })
    .where(eq(tenants.id, tenantId));
  return next;
}
