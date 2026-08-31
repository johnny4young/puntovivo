/**
 * Quotation service — reads ( split).
 *
 * `listQuotations` + `getQuotationById` (tenant-scoped selects).
 *
 * @module services/quotations/read
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  customers,
  inventoryBalances,
  products,
  quotationItemTaxComponents,
  quotationItems,
  quotationSaleLinks,
  quotations,
  sales,
  sites,
  units,
  users,
} from '../../db/schema.js';
import { isPriceTier } from '@puntovivo/shared/price-tier';
import { roundMoney } from '../../lib/money.js';

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
      priceTier: quotations.priceTier,
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
    priceTier: isPriceTier(row.priceTier) ? row.priceTier : 1,
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
      priceTier: quotations.priceTier,
      customerTaxId: customers.taxId,
      customerEmail: customers.email,
      customerPhone: customers.phone,
      customerCreditLimit: customers.creditLimit,
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
      unitId: quotationItems.unitId,
      unitEquivalence: quotationItems.unitEquivalence,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      quantity: quotationItems.quantity,
      unitPrice: quotationItems.unitPrice,
      discount: quotationItems.discount,
      taxRate: quotationItems.taxRate,
      taxKind: quotationItems.taxKind,
      taxAmount: quotationItems.taxAmount,
      total: quotationItems.total,
      productName: products.name,
      productSku: products.sku,
      tracksStock: products.tracksStock,
      tracksSerials: products.tracksSerials,
      sellByFraction: products.sellByFraction,
      fractionStep: products.fractionStep,
      fractionMinimum: products.fractionMinimum,
    })
    .from(quotationItems)
    .innerJoin(products, eq(quotationItems.productId, products.id))
    .leftJoin(units, eq(quotationItems.unitId, units.id))
    .where(eq(quotationItems.quotationId, quotationId))
    .orderBy(asc(quotationItems.createdAt), asc(quotationItems.id))
    .all();

  const stockRows =
    items.length === 0
      ? []
      : db
          .select({
            productId: inventoryBalances.productId,
            onHand: inventoryBalances.onHand,
            reserved: inventoryBalances.reserved,
          })
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, tenantId),
              eq(inventoryBalances.siteId, header.siteId),
              inArray(
                inventoryBalances.productId,
                items.map(item => item.productId)
              )
            )
          )
          .all();
  const availableStockByProduct = new Map(
    stockRows.map(row => [row.productId, Math.max(row.onHand - row.reserved, 0)] as const)
  );

  const componentRows =
    items.length === 0
      ? []
      : db
          .select({
            quotationItemId: quotationItemTaxComponents.quotationItemId,
            componentKey: quotationItemTaxComponents.componentKey,
            vatRateId: quotationItemTaxComponents.vatRateId,
            taxKind: quotationItemTaxComponents.taxKind,
            taxRate: quotationItemTaxComponents.taxRate,
            taxableAmount: quotationItemTaxComponents.taxableAmount,
            taxAmount: quotationItemTaxComponents.taxAmount,
            position: quotationItemTaxComponents.position,
          })
          .from(quotationItemTaxComponents)
          .where(
            and(
              eq(quotationItemTaxComponents.tenantId, tenantId),
              inArray(
                quotationItemTaxComponents.quotationItemId,
                items.map(item => item.id)
              )
            )
          )
          .orderBy(quotationItemTaxComponents.quotationItemId, quotationItemTaxComponents.position)
          .all();
  const componentsByItem = new Map<string, typeof componentRows>();
  for (const component of componentRows) {
    const group = componentsByItem.get(component.quotationItemId) ?? [];
    group.push(component);
    componentsByItem.set(component.quotationItemId, group);
  }
  const itemsWithComponents = items.map(item => ({
    ...item,
    // The POS hydrates an accepted quotation for its original site. Expose
    // that site's current sellable balance instead of the tenant-wide rollup
    // so the cart preview and serial/stock preflight describe the same place.
    availableStock: availableStockByProduct.get(item.productId) ?? 0,
    taxComponents: componentsByItem.get(item.id) ?? [
      {
        quotationItemId: item.id,
        componentKey: `legacy:${item.taxKind}:${Number(item.taxRate).toFixed(6)}`,
        vatRateId: null,
        taxKind: item.taxKind,
        taxRate: item.taxRate,
        taxableAmount: roundMoney(item.total - item.taxAmount),
        taxAmount: item.taxAmount,
        position: 0,
      },
    ],
  }));

  const saleLink = db
    .select({
      saleId: quotationSaleLinks.saleId,
      saleNumber: sales.saleNumber,
      convertedAt: quotationSaleLinks.createdAt,
    })
    .from(quotationSaleLinks)
    .innerJoin(sales, eq(quotationSaleLinks.saleId, sales.id))
    .where(
      and(
        eq(quotationSaleLinks.tenantId, tenantId),
        eq(quotationSaleLinks.quotationId, quotationId),
        eq(sales.tenantId, tenantId)
      )
    )
    .get();

  return {
    ...header,
    priceTier: isPriceTier(header.priceTier) ? header.priceTier : 1,
    statusChangedByName,
    convertedSaleId: saleLink?.saleId ?? null,
    convertedSaleNumber: saleLink?.saleNumber ?? null,
    convertedAt: saleLink?.convertedAt ?? null,
    items: itemsWithComponents,
  };
}
