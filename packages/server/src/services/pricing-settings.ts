/**
 * Tenant-level pricing policy: does the catalog price already
 * include the tax?
 *
 * `priceIncludesTax: true` is the default and the only behavior the
 * engine had before this seam existed — consumer-facing LATAM prices are
 * quoted tax-inclusive. `false` switches every line computation (sales,
 * quotations, and the web cart previews through the shared
 * `splitLineTax`) to treat the catalog price as the pre-tax base and add
 * the tax on top, the usual convention for wholesale / B2B pricing.
 *
 * Stored in `tenants.settings.pricing` (JSON namespace, same pattern as
 * `settings.restaurant`). Reads are defensive: a missing or malformed
 * namespace resolves to the default so no historical tenant changes
 * behavior.
 *
 * @module services/pricing-settings
 */

import { eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../db/index.js';
import { tenants } from '../db/schema.js';

export interface PricingSettings {
  priceIncludesTax: boolean;
}

export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  priceIncludesTax: true,
};

/**
 * Defensive parse of a raw `tenants.settings` value. Synchronous so it
 * can also run inside a better-sqlite3 write transaction (which cannot
 * await) - e.g. to pin the audit `before` value to the same atomic
 * boundary as the settings write.
 */
export function parsePricingSettings(rawSettings: unknown): PricingSettings {
  const settings = (rawSettings ?? {}) as Record<string, unknown>;
  const pricing = settings.pricing;
  if (!pricing || typeof pricing !== 'object') {
    return { ...DEFAULT_PRICING_SETTINGS };
  }

  const candidate = pricing as Partial<PricingSettings>;
  return {
    priceIncludesTax:
      typeof candidate.priceIncludesTax === 'boolean'
        ? candidate.priceIncludesTax
        : DEFAULT_PRICING_SETTINGS.priceIncludesTax,
  };
}

export async function resolvePricingSettings(
  db: DatabaseInstance,
  tenantId: string
): Promise<PricingSettings> {
  const row = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();

  return parsePricingSettings(row?.settings);
}
