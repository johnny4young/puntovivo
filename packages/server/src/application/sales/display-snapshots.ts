/**
 * Sale-time textual display snapshots.
 *
 * Monetary and quantity evidence already lives on `sales` / `sale_items`.
 * These helpers resolve the mutable related labels that an ordinary receipt
 * needs to reproduce later, without coupling the write path to the receipt
 * renderer. Every lookup is tenant-scoped; nullable results preserve safe
 * behavior for legacy or externally imported rows with incomplete relations.
 *
 * @module application/sales/display-snapshots
 */

import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { customers, sites, users } from '../../db/schema.js';

export interface SaleHeaderDisplaySnapshots {
  customerNameSnapshot: string | null;
  siteNameSnapshot: string | null;
  cashierNameSnapshot: string | null;
}

export async function resolveSaleHeaderDisplaySnapshots(
  db: DatabaseInstance,
  tenantId: string,
  input: {
    customerId: string | null | undefined;
    siteId: string;
    cashierId: string;
  }
): Promise<SaleHeaderDisplaySnapshots> {
  const [customer, site, cashier] = await Promise.all([
    input.customerId
      ? db
          .select({ name: customers.name })
          .from(customers)
          .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, tenantId)))
          .get()
      : Promise.resolve(undefined),
    db
      .select({ name: sites.name })
      .from(sites)
      .where(and(eq(sites.id, input.siteId), eq(sites.tenantId, tenantId)))
      .get(),
    db
      .select({ name: users.name })
      .from(users)
      .where(and(eq(users.id, input.cashierId), eq(users.tenantId, tenantId)))
      .get(),
  ]);

  return {
    customerNameSnapshot: customer?.name ?? null,
    siteNameSnapshot: site?.name ?? null,
    cashierNameSnapshot: cashier?.name ?? null,
  };
}
