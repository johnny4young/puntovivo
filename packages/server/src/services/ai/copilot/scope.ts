/**
 * Resolve the sites actually present in a Co-pilot analytics snapshot before
 * checking per-site quotas. An omitted or null body site means tenant-wide
 * analytics; the selected UI site is only a prompt focus, not a data filter.
 */
import { and, eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../../../db/index.js';
import { sites } from '../../../db/schema.js';
import { throwServerError } from '../../../lib/errorCodes.js';

/** Every site whose data the pending snapshot is allowed to include. */
export async function resolveCopilotQuotaSites(
  db: DatabaseInstance,
  tenantId: string,
  requestedSiteId: string | null | undefined
): Promise<string[]> {
  if (requestedSiteId) {
    const row = await db
      .select({ id: sites.id })
      .from(sites)
      .where(
        and(eq(sites.id, requestedSiteId), eq(sites.tenantId, tenantId), eq(sites.isActive, true))
      )
      .get();
    if (row) return [row.id];
  } else {
    // The snapshot reads historical sales from every tenant site, including
    // inactive ones. Charge exactly that scope rather than the UI header site.
    const rows = await db
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.tenantId, tenantId))
      .all();
    if (rows.length > 0) return rows.map(row => row.id);
  }

  return throwServerError({
    trpcCode: 'BAD_REQUEST',
    errorCode: 'AI_COPILOT_SQL_REJECTED',
    message: 'Requested analytics site is not available for this tenant',
  });
}
