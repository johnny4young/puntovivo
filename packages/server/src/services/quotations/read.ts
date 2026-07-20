/**
 * Quotation service — reads ( split).
 *
 * `listQuotations` + `getQuotationById` (tenant-scoped selects).
 *
 * @module services/quotations/read
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { customers, products, quotationItems, quotations, sites, users } from '../../db/schema.js';

import type { QuotationListEntry, ListQuotationsOptions, QuotationDetail } from './types.js';

export function listQuotations(
  db: DatabaseInstance,
  tenantId: string,
  options: ListQuotationsOptions = {}
): QuotationListEntry[] {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));

  const conditions = [eq(quotations.tenantId, tenantId)];
  if (options.status) {
    conditions.push(eq(quotations.status, options.status));
  }
  if (options.customerId) {
    conditions.push(eq(quotations.customerId, options.customerId));
  }

  const rows = db
    .select({
      id: quotations.id,
      quotationNumber: quotations.quotationNumber,
      status: quotations.status,
      customerId: quotations.customerId,
      customerName: customers.name,
      siteId: quotations.siteId,
      siteName: sites.name,
      subtotal: quotations.subtotal,
      taxAmount: quotations.taxAmount,
      total: quotations.total,
      validUntil: quotations.validUntil,
      createdAt: quotations.createdAt,
      createdBy: quotations.createdBy,
    })
    .from(quotations)
    .leftJoin(customers, eq(quotations.customerId, customers.id))
    .innerJoin(sites, eq(quotations.siteId, sites.id))
    .where(and(...conditions))
    .orderBy(desc(quotations.createdAt))
    .limit(limit)
    .all();

  if (rows.length === 0) {
    return [];
  }

  // Single grouped lookup for line-item counts — keeps the read path O(1)
  // queries regardless of page size and avoids the misleading async fan-out
  // pattern that better-sqlite3 (synchronous driver) cannot actually
  // parallelize.
  const itemCountRows = db
    .select({
      quotationId: quotationItems.quotationId,
      count: sql<number>`count(*)`,
    })
    .from(quotationItems)
    .where(
      inArray(
        quotationItems.quotationId,
        rows.map(row => row.id)
      )
    )
    .groupBy(quotationItems.quotationId)
    .all();
  const itemCountById = new Map<string, number>(
    itemCountRows.map(row => [row.quotationId, Number(row.count)])
  );

  return rows.map(row => ({
    ...row,
    itemCount: itemCountById.get(row.id) ?? 0,
  }));
}

export function getQuotationById(
  db: DatabaseInstance,
  tenantId: string,
  quotationId: string
): QuotationDetail | null {
  const header = db
    .select({
      id: quotations.id,
      quotationNumber: quotations.quotationNumber,
      status: quotations.status,
      customerId: quotations.customerId,
      customerName: customers.name,
      customerTaxId: customers.taxId,
      customerEmail: customers.email,
      customerPhone: customers.phone,
      siteId: quotations.siteId,
      siteName: sites.name,
      subtotal: quotations.subtotal,
      taxAmount: quotations.taxAmount,
      discountAmount: quotations.discountAmount,
      total: quotations.total,
      validUntil: quotations.validUntil,
      notes: quotations.notes,
      createdAt: quotations.createdAt,
      createdBy: quotations.createdBy,
      createdByName: users.name,
      statusChangedAt: quotations.statusChangedAt,
      statusChangedBy: quotations.statusChangedBy,
      updatedAt: quotations.updatedAt,
    })
    .from(quotations)
    .leftJoin(customers, eq(quotations.customerId, customers.id))
    .innerJoin(sites, eq(quotations.siteId, sites.id))
    .leftJoin(users, eq(quotations.createdBy, users.id))
    .where(and(eq(quotations.id, quotationId), eq(quotations.tenantId, tenantId)))
    .get();

  if (!header) {
    return null;
  }

  // Resolve the status-change actor with a single point lookup. A second
  // `leftJoin(users, …)` in the main query would require an explicit alias
  // (Drizzle disallows joining the same table twice without one), and the
  // 99% case is `statusChangedBy === createdBy` so the lookup is essentially
  // free.
  let statusChangedByName: string | null = null;
  if (header.statusChangedBy) {
    if (header.statusChangedBy === header.createdBy) {
      statusChangedByName = header.createdByName;
    } else {
      const actor = db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, header.statusChangedBy))
        .get();
      statusChangedByName = actor?.name ?? null;
    }
  }

  const items = db
    .select({
      id: quotationItems.id,
      productId: quotationItems.productId,
      quantity: quotationItems.quantity,
      unitPrice: quotationItems.unitPrice,
      discount: quotationItems.discount,
      taxRate: quotationItems.taxRate,
      taxAmount: quotationItems.taxAmount,
      total: quotationItems.total,
      productName: products.name,
      productSku: products.sku,
    })
    .from(quotationItems)
    .innerJoin(products, eq(quotationItems.productId, products.id))
    .where(eq(quotationItems.quotationId, quotationId))
    .orderBy(asc(quotationItems.createdAt), asc(quotationItems.id))
    .all();

  return {
    ...header,
    statusChangedByName,
    items,
  };
}
