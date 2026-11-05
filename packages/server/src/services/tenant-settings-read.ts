import { eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../db/index.js';
import { tenants } from '../db/schema.js';
import { memoizeInScope } from '../lib/request-memo.js';

/**
 * One `tenants.settings` row shared by every helper inside a request memo.
 * Only for reads that may use the sale-start value: gates checked inside the
 * writer and fiscal emission decisions read the row directly.
 */
export function readTenantSettingsRow(
  db: DatabaseInstance,
  tenantId: string
): { settings: (typeof tenants.$inferSelect)['settings'] } | undefined {
  return memoizeInScope(`tenant-settings:${tenantId}`, () =>
    db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).get()
  );
}
