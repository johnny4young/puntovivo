import {
  GS1_IN_STORE_PREFIXES,
  GS1_SCHEMES,
  isGs1PrefixConfig,
  type Gs1PrefixConfig,
  type Gs1Scheme,
} from '@puntovivo/shared/gs1';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DatabaseInstance } from '../../../db/index.js';
import { sitePeripherals } from '../../../db/schema.js';

const gs1PrefixSchema = z.enum(GS1_IN_STORE_PREFIXES);

/**
 * Optional site-level assignment of the in-store prefixes to weight or price.
 * At least one prefix must remain active and no prefix can carry both roles.
 */
export const gs1PrefixConfigSchema: z.ZodType<Gs1PrefixConfig> = z
  .object({
    weight: z.array(gs1PrefixSchema).max(GS1_IN_STORE_PREFIXES.length),
    price: z.array(gs1PrefixSchema).max(GS1_IN_STORE_PREFIXES.length),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (!isGs1PrefixConfig(config)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Assign at least one unique GS1 prefix',
      });
    }
  });

const siteScannerParseConfigSchema = z
  .object({
    gs1Scheme: z.enum(GS1_SCHEMES).default('generic'),
    gs1Prefixes: gs1PrefixConfigSchema.optional(),
  })
  .passthrough();

export interface SiteGs1ParseOptions {
  gs1Scheme: Gs1Scheme;
  gs1Prefixes?: Gs1PrefixConfig;
}

/**
 * Resolve barcode semantics from the active site's persisted scanner. The
 * request cannot supply an alternate map: a cashier may read this config, but
 * the server remains authoritative when decoding price or weight labels.
 */
export async function resolveSiteGs1ParseOptions(args: {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string | null;
}): Promise<SiteGs1ParseOptions> {
  // Prefix meaning is site-owned. A stale or modified client must not be able
  // to omit its site header and fall back to the historical map when the real
  // site has reversed weight/price semantics.
  if (!args.siteId) return { gs1Scheme: 'none' };

  const row = await args.db
    .select({ config: sitePeripherals.config })
    .from(sitePeripherals)
    .where(
      and(
        eq(sitePeripherals.tenantId, args.tenantId),
        eq(sitePeripherals.siteId, args.siteId),
        eq(sitePeripherals.kind, 'scanner'),
        eq(sitePeripherals.driver, 'wedge'),
        eq(sitePeripherals.isActive, true)
      )
    )
    .get();

  if (!row) return { gs1Scheme: 'generic' };
  const parsed = siteScannerParseConfigSchema.safeParse(row.config ?? {});
  if (!parsed.success) {
    // Legacy/corrupt rows must not silently reinterpret a price as a weight.
    return { gs1Scheme: 'none' };
  }

  return {
    gs1Scheme: parsed.data.gs1Scheme,
    ...(parsed.data.gs1Prefixes ? { gs1Prefixes: parsed.data.gs1Prefixes } : {}),
  };
}
