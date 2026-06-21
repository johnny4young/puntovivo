/**
 * Quotation service — create (ENG-178 split).
 *
 * `resolveQuotationSequential` + `createQuotation` (tx whole; ENG-176b currency).
 *
 * @module services/quotations/create
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { customers, products, quotationItems, quotations, sequentials, sites, type QuotationStatus } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { resolveTenantCurrency } from '../../lib/currency.js';

import type { CreateQuotationArgs, CreatedQuotation } from './types.js';
import { getTimestamp, computeQuotationTotals } from './pricing.js';


/**
 * Resolve the (siteId, prefix, currentValue) sequential context for the
 * tenant's quotation numbering.
 *
 * Looks up a site-scoped row first, then falls back to the earliest active
 * site that has a quotation sequential configured. Throws
 * `QUOTATION_SEQUENTIAL_MISSING` if none is configured for the tenant.
 */
export function resolveQuotationSequential(
  tx: DatabaseInstance,
  tenantId: string,
  siteId: string
): { id: string; prefix: string; currentValue: number } {
  // Guard the join on both `sequentials.tenantId` AND `sites.tenantId` so
  // the fallback cannot select a row that somehow references a sibling
  // tenant's site (defense in depth — nanoid id collisions are
  // astronomically unlikely but the schema doesn't enforce a cross-table
  // tenant constraint at the DB layer).
  const baseConditions = [
    eq(sequentials.tenantId, tenantId),
    eq(sequentials.documentType, 'quotation'),
    eq(sites.isActive, true),
    eq(sites.tenantId, tenantId),
  ];

  const siteScoped = tx
    .select({
      id: sequentials.id,
      prefix: sequentials.prefix,
      currentValue: sequentials.currentValue,
    })
    .from(sequentials)
    .innerJoin(sites, eq(sequentials.siteId, sites.id))
    .where(and(...baseConditions, eq(sequentials.siteId, siteId)))
    .get();

  if (siteScoped) {
    return siteScoped;
  }

  const fallback = tx
    .select({
      id: sequentials.id,
      prefix: sequentials.prefix,
      currentValue: sequentials.currentValue,
    })
    .from(sequentials)
    .innerJoin(sites, eq(sequentials.siteId, sites.id))
    .where(and(...baseConditions))
    .orderBy(asc(sites.createdAt), asc(sites.id))
    .get();

  if (!fallback) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'QUOTATION_SEQUENTIAL_MISSING',
      message:
        'No active quotation sequential is configured for the current tenant',
      details: { tenantId, siteId },
    });
  }

  return fallback;
}

export function createQuotation(
  db: DatabaseInstance,
  args: CreateQuotationArgs
): CreatedQuotation {
  if (args.items.length === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'QUOTATION_ITEMS_REQUIRED',
      message: 'A quotation must include at least one product line',
    });
  }

  for (const item of args.items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'QUOTATION_QUANTITY_INVALID',
        message: 'Quotation quantity must be greater than zero',
        details: { productId: item.productId, quantity: item.quantity },
      });
    }
  }

  const now = getTimestamp();
  const quotationId = nanoid();
  const productIds = [...new Set(args.items.map(item => item.productId))];

  return db.transaction(tx => {
    // Validate site belongs to tenant and is active.
    const targetSite = tx
      .select({ id: sites.id, isActive: sites.isActive })
      .from(sites)
      .where(and(eq(sites.id, args.siteId), eq(sites.tenantId, args.tenantId)))
      .get();
    if (!targetSite || targetSite.isActive === false) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'QUOTATION_SITE_NOT_FOUND',
        message: 'Quotation site was not found or is inactive',
        details: { siteId: args.siteId },
      });
    }

    if (args.customerId) {
      const customer = tx
        .select({ id: customers.id, isActive: customers.isActive })
        .from(customers)
        .where(
          and(
            eq(customers.id, args.customerId),
            eq(customers.tenantId, args.tenantId)
          )
        )
        .get();
      if (!customer || customer.isActive === false) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'QUOTATION_CUSTOMER_NOT_FOUND',
          message: 'Quotation customer was not found or is inactive',
          details: { customerId: args.customerId },
        });
      }
    }

    const productRows = tx
      .select({
        id: products.id,
        isActive: products.isActive,
        taxRate: products.taxRate,
      })
      .from(products)
      .where(
        and(eq(products.tenantId, args.tenantId), inArray(products.id, productIds))
      )
      .all();
    const productById = new Map(productRows.map(product => [product.id, product]));

    for (const productId of productIds) {
      const product = productById.get(productId);
      if (!product || product.isActive === false) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'QUOTATION_PRODUCT_NOT_FOUND',
          message: 'Quotation product was not found or is inactive',
          details: { productId },
        });
      }
    }

    const productTaxRateById = new Map<string, number>(
      productRows.map(product => [product.id, product.taxRate ?? 0])
    );
    const totals = computeQuotationTotals(args.items, productTaxRateById);

    const sequential = resolveQuotationSequential(tx, args.tenantId, args.siteId);
    const nextValue = sequential.currentValue + 1;
    const quotationNumber = `${sequential.prefix}${String(nextValue).padStart(6, '0')}`;

    tx.update(sequentials)
      .set({ currentValue: nextValue, updatedAt: now })
      .where(eq(sequentials.id, sequential.id))
      .run();

    // ENG-176b — stamp the tenant default currency on the quotation
    // header and on every item. If a future conversion path creates a
    // sale, it can carry this seam verbatim instead of re-resolving.
    const quotationCurrencyCode = resolveTenantCurrency(tx, args.tenantId);

    tx.insert(quotations)
      .values({
        id: quotationId,
        tenantId: args.tenantId,
        siteId: args.siteId,
        quotationNumber,
        customerId: args.customerId,
        status: 'draft',
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        discountAmount: totals.discountAmount,
        total: totals.total,
        currencyCode: quotationCurrencyCode,
        exchangeRateAtSale: 1,
        settleCurrencyCode: null,
        validUntil: args.validUntil,
        notes: args.notes,
        createdBy: args.createdBy,
        statusChangedAt: now,
        statusChangedBy: args.createdBy,
        syncStatus: 'pending',
        syncVersion: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    for (const row of totals.rows) {
      tx.insert(quotationItems)
        .values({
          id: row.id,
          quotationId,
          productId: row.productId,
          quantity: row.quantity,
          unitPrice: row.unitPrice,
          discount: row.discount,
          taxRate: row.taxRate,
          taxAmount: row.taxAmount,
          total: row.total,
          currencyCode: quotationCurrencyCode,
          exchangeRateAtSale: 1,
          settleCurrencyCode: null,
          createdAt: now,
        })
        .run();
    }

    return {
      id: quotationId,
      quotationNumber,
      status: 'draft' as QuotationStatus,
      fromSiteId: args.siteId,
      customerId: args.customerId,
      total: totals.total,
      createdAt: now,
    };
  });
}
