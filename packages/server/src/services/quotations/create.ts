/**
 * Quotation service — create ( split).
 *
 * `resolveQuotationSequential` + `createQuotation` (tx whole;  currency).
 *
 * @module services/quotations/create
 */
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  customers,
  products,
  quotationItems,
  quotationItemTaxComponents,
  quotations,
  sequentials,
  sites,
  type QuotationStatus,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { resolveTenantCurrency } from '../../lib/currency.js';
import { allocateNextSequential } from '../sequential-allocation.js';

import type { CreateQuotationArgs, CreatedQuotation } from './types.js';
import { getTimestamp, computeQuotationTotals } from './pricing.js';
import { assertTaxRateOverrideAllowed, loadAllowedTaxRatesByKind } from '../tax-rate-policy.js';
import {
  assertTaxComponentsRepresentable,
  getProductTaxComponents,
  legacyComponent,
  summarizeTaxComponents,
} from '../tax-components.js';

/**
 * Resolve the (siteId, prefix, currentValue) sequential context for the
 * tenant's quotation numbering.
 *
 * Requires a row for the selected site. Numbering from another branch must
 * never be borrowed because the resulting document would carry the wrong
 * operational identity.
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

  if (!siteScoped) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'QUOTATION_SEQUENTIAL_MISSING',
      message: 'No active quotation sequential is configured for the selected site',
      details: { tenantId, siteId },
    });
  }

  return siteScoped;
}

export function createQuotation(db: DatabaseInstance, args: CreateQuotationArgs): CreatedQuotation {
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

  return db.transaction(
    tx => {
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
          .where(and(eq(customers.id, args.customerId), eq(customers.tenantId, args.tenantId)))
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
          taxKind: products.taxKind,
          vatRateId: products.vatRateId,
        })
        .from(products)
        .where(and(eq(products.tenantId, args.tenantId), inArray(products.id, productIds)))
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

      const storedTaxComponents = getProductTaxComponents(tx, args.tenantId, productIds);
      const productTaxProfileById = new Map(
        productRows.map(product => {
          const components = storedTaxComponents.get(product.id) ?? [
            legacyComponent({
              vatRateId: product.vatRateId,
              taxKind: product.taxKind,
              taxRate: product.taxRate ?? 0,
            }),
          ];
          return [product.id, { components }] as const;
        })
      );
      const allowedTaxRates = loadAllowedTaxRatesByKind(tx, args.tenantId);
      for (const item of args.items) {
        const profile = productTaxProfileById.get(item.productId)!;
        const summary = summarizeTaxComponents(profile.components);
        if (item.taxComponents) {
          const requestedIds = item.taxComponents.map(component => component.vatRateId);
          const catalogIds = profile.components.map(component => component.vatRateId);
          if (
            requestedIds.length !== catalogIds.length ||
            requestedIds.some((id, index) => id !== catalogIds[index])
          ) {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'TAX_COMPONENTS_INVALID',
              message: 'Submitted quotation tax components do not match the product catalog',
              details: { productId: item.productId },
            });
          }
        }
        if (item.taxRate > 0 && profile.components.length > 1 && item.taxRate !== summary.taxRate) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'TAX_COMPONENTS_INVALID',
            message: 'A legacy quotation rate cannot replace multiple tax components',
            details: { productId: item.productId },
          });
        }
        const requestedTaxRate = item.taxRate > 0 ? item.taxRate : summary.taxRate;
        if (item.taxRate > 0) {
          assertTaxRateOverrideAllowed({
            allowedRates: allowedTaxRates,
            catalogTaxRate: summary.taxRate,
            requestedTaxRate,
            taxKind: summary.taxKind,
            productId: item.productId,
          });
        }
        assertTaxComponentsRepresentable(args.countryCode, profile.components);
      }
      const totals = computeQuotationTotals(args.items, productTaxProfileById, {
        priceIncludesTax: args.priceIncludesTax,
      });

      const sequential = resolveQuotationSequential(tx, args.tenantId, args.siteId);
      const quotationNumber = allocateNextSequential(tx, {
        tenantId: args.tenantId,
        sequentialId: sequential.id,
        updatedAt: now,
      }).number;

      // stamp the tenant default currency on the quotation
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
          priceTier: args.priceTier,
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
            taxKind: row.taxKind,
            taxAmount: row.taxAmount,
            total: row.total,
            currencyCode: quotationCurrencyCode,
            exchangeRateAtSale: 1,
            settleCurrencyCode: null,
            createdAt: now,
          })
          .run();
        for (const component of row.taxComponents) {
          tx.insert(quotationItemTaxComponents)
            .values({
              id: nanoid(),
              tenantId: args.tenantId,
              quotationItemId: row.id,
              componentKey: component.componentKey,
              vatRateId: component.vatRateId,
              taxKind: component.taxKind,
              taxRate: component.taxRate,
              taxableAmount: component.taxableAmount,
              taxAmount: component.taxAmount,
              position: component.position,
              createdAt: now,
            })
            .run();
        }
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
    },
    { behavior: 'immediate' }
  );
}
