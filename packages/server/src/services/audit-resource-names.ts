import { and, eq, inArray } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { DatabaseInstance } from '../db/index.js';
import {
  categories,
  customers,
  orders,
  products,
  purchases,
  quotations,
  sales,
  sites,
  units,
  users,
  vatRates,
} from '../db/schema.js';

interface NameSource {
  table: SQLiteTable;
  id: SQLiteColumn;
  tenantId: SQLiteColumn;
  label: SQLiteColumn;
}

const NAME_SOURCES: Partial<Record<string, NameSource>> = {
  product: { table: products, id: products.id, tenantId: products.tenantId, label: products.name },
  category: {
    table: categories,
    id: categories.id,
    tenantId: categories.tenantId,
    label: categories.name,
  },
  unit: { table: units, id: units.id, tenantId: units.tenantId, label: units.name },
  vat_rate: { table: vatRates, id: vatRates.id, tenantId: vatRates.tenantId, label: vatRates.name },
  user: { table: users, id: users.id, tenantId: users.tenantId, label: users.name },
  site: { table: sites, id: sites.id, tenantId: sites.tenantId, label: sites.name },
  customer: {
    table: customers,
    id: customers.id,
    tenantId: customers.tenantId,
    label: customers.name,
  },
  sale: { table: sales, id: sales.id, tenantId: sales.tenantId, label: sales.saleNumber },
  purchase: {
    table: purchases,
    id: purchases.id,
    tenantId: purchases.tenantId,
    label: purchases.purchaseNumber,
  },
  order: { table: orders, id: orders.id, tenantId: orders.tenantId, label: orders.orderNumber },
  quotation: {
    table: quotations,
    id: quotations.id,
    tenantId: quotations.tenantId,
    label: quotations.quotationNumber,
  },
};

const keyOf = (resourceType: string, resourceId: string) => `${resourceType}\u0000${resourceId}`;

/** Current display name per audited resource, looked up only inside the tenant. */
export function resolveAuditResourceNames(
  db: DatabaseInstance,
  tenantId: string,
  rows: readonly { resourceType: string; resourceId: string }[]
): Map<string, string> {
  const idsByType = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!NAME_SOURCES[row.resourceType]) continue;
    const ids = idsByType.get(row.resourceType) ?? new Set<string>();
    ids.add(row.resourceId);
    idsByType.set(row.resourceType, ids);
  }

  const names = new Map<string, string>();
  for (const [resourceType, ids] of idsByType) {
    const source = NAME_SOURCES[resourceType]!;
    const found = db
      .select({ id: source.id, label: source.label })
      .from(source.table)
      .where(and(eq(source.tenantId, tenantId), inArray(source.id, [...ids])))
      .all() as { id: string; label: string | null }[];
    for (const row of found) {
      if (row.label) names.set(keyOf(resourceType, row.id), row.label);
    }
  }
  return names;
}

export function auditResourceNameKey(resourceType: string, resourceId: string): string {
  return keyOf(resourceType, resourceId);
}
