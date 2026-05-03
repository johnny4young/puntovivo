/**
 * ENG-052b — MEGA seed: misc tables (logos + category↔provider
 * assignments). These are small surfaces but the / company + filters
 * UI depend on them being populated to render meaningfully.
 *
 * @module db/seed-mega/historical-misc
 */

import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { categories, categoryXProvider, logos } from '../schema.js';
import type { MegaContext } from './types.js';

interface CreatedHistoricalMisc {
  logosCount: number;
  categoryProviderLinksCount: number;
}

/**
 * 1×1 transparent PNG embedded as a data URI. Stand-in for a real
 * uploaded logo so the company page has something to render in the
 * preview area without needing a real image asset on disk.
 */
const PLACEHOLDER_LOGO_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

export async function seedHistoricalMisc(
  ctx: MegaContext
): Promise<CreatedHistoricalMisc> {
  const { db, clock, tenantId, providerIds } = ctx;

  // ----- Logo placeholder -----
  const logoRow: typeof logos.$inferInsert = {
    id: nanoid(),
    tenantId,
    name: 'Logo principal demo',
    imageUrl: PLACEHOLDER_LOGO_DATA_URL,
    isActive: true,
    createdAt: clock.nowIso,
    updatedAt: clock.nowIso,
  };
  await db.insert(logos).values(logoRow).onConflictDoNothing().run();

  // ----- Category × Provider matrix -----
  // Pull every category we have for the tenant, then assign each to
  // every other provider via round-robin so the filter dropdowns +
  // the providers-per-category report have populated data.
  const tenantCategories = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.tenantId, tenantId))
    .all();

  const links: Array<typeof categoryXProvider.$inferInsert> = [];
  for (let i = 0; i < tenantCategories.length; i += 1) {
    const cat = tenantCategories[i]!;
    // Each category gets 2 providers (round-robin)
    const providerA = providerIds[(i * 2) % providerIds.length];
    const providerB = providerIds[(i * 2 + 1) % providerIds.length];
    if (providerA) {
      links.push({
        id: nanoid(),
        tenantId,
        categoryId: cat.id,
        providerId: providerA,
        createdAt: clock.nowIso,
        updatedAt: clock.nowIso,
      });
    }
    if (providerB && providerB !== providerA) {
      links.push({
        id: nanoid(),
        tenantId,
        categoryId: cat.id,
        providerId: providerB,
        createdAt: clock.nowIso,
        updatedAt: clock.nowIso,
      });
    }
  }
  if (links.length > 0) {
    await db.insert(categoryXProvider).values(links).onConflictDoNothing().run();
  }

  return {
    logosCount: 1,
    categoryProviderLinksCount: links.length,
  };
}
