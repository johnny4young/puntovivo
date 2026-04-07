/**
 * Sites tRPC Router
 *
 * Site selection support for tenant-aware flows.
 *
 * Procedures:
 * - sites.list (tenant) - List active sites for the current tenant
 *
 * @module trpc/routers/sites
 */

import { and, asc, eq } from 'drizzle-orm';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { sites } from '../../db/schema.js';

export const sitesRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    const items = await ctx.db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.isActive, true)))
      .orderBy(asc(sites.name))
      .all();

    return {
      items,
      activeSiteId: ctx.siteId,
    };
  }),
});
