import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { sites } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';

/**
 * Multi-tenant site-scope guard.
 *
 * Assert that `siteId` belongs to `tenantId` before any procedure operates on
 * it, so a user can never reach a site from another tenant. Shared by every
 * router that accepts a `siteId` (inventory, sites, sequentials, peripherals)
 * instead of copy-pasting the same check per router. Throws `NOT_FOUND` when
 * the site does not exist for the tenant; returns the row for callers that
 * want it.
 */
export async function ensureTenantSite(db: DatabaseInstance, tenantId: string, siteId: string) {
  const site = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)))
    .get();

  if (!site) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'AUTHORITY_SITE_NOT_FOUND',
      message: 'Site not found',
    });
  }

  return site;
}
