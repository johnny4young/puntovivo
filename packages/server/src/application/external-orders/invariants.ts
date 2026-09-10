import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { sites, tenants } from '../../db/schema.js';
import { isModuleActiveInSettings } from '../../services/modules/manifest.js';
import { externalOrderError } from '../../services/external-orders/errors.js';
/** Resolve owned active site and tenant/module again under the command writer. */
export function assertExternalOrderSite(
  tx: DatabaseInstance,
  tenantId: string,
  siteId: string
): void {
  const tenant = tx
    .select({ settings: tenants.settings, active: tenants.isActive })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const site = tx
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.id, siteId), eq(sites.isActive, true)))
    .get();
  if (!tenant?.active || !site || !isModuleActiveInSettings(tenant.settings, 'delivery'))
    externalOrderError('missing');
}
