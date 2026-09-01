/**
 * Post-commit sale reader.
 *
 * `getSaleRecord` is the canonical read used by the sale lifecycle to
 * return a fully-hydrated sale (header + items + payments + return
 * info) to the caller. It used to live as a private helper in
 * `trpc/routers/sales.ts`;  moved it here so the application
 * service can call it without depending on the router file.
 *
 * The function is a pure read — it does not write, does not throw on
 * not-found at the DB layer. It throws `SALE_NOT_FOUND` when the
 * sale row is missing so callers can handle the same error code
 * everywhere.
 *
 * @module application/sales/sale-read
 */

import { and, eq, inArray, or } from 'drizzle-orm';
import { isPriceTier } from '@puntovivo/shared/price-tier';
import type { DatabaseInstance } from '../../db/index.js';
import {
  customers,
  fiscalDocuments,
  fiscalNumberingResolutions,
  products,
  productSerials,
  inventoryLots,
  salePayments,
  saleItems,
  saleItemLots,
  saleItemPromotions,
  saleItemSerials,
  saleItemTaxComponents,
  saleExchanges,
  saleReturnItems,
  saleReturnItemLots,
  saleReturnItemSerials,
  saleReturnItemTaxComponents,
  saleReturnPaymentAllocations,
  saleReturns,
  sales,
  tenants,
  units,
  type FiscalDocumentKind,
  type FiscalDocumentSource,
  type FiscalDocumentStatus,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { detectPriceOverrides } from './item-resolution.js';
import { buildFiscalQrPayload } from '../../services/fiscal/qr-builder.js';
import type { FiscalAdapterMaturity } from '../../services/fiscal/adapter.js';
import { describeFiscalProvider } from '../../services/fiscal/registry.js';
import { readClFiscalSettings } from '../../services/fiscal/packs/cl/settings.js';
import { readCoFiscalSettings } from '../../services/fiscal/packs/co/settings.js';
import { readMxFiscalSettings } from '../../services/fiscal/packs/mx/settings.js';
import { resolveTenantLocale } from '../../services/tenant-locale.js';
import { listSaleItemSerialNumbers } from '../../services/product-serials.js';

export async function getSaleRecord(db: DatabaseInstance, tenantId: string, saleId: string) {
  const sale = await db
    .select({
      id: sales.id,
      tenantId: sales.tenantId,
      saleNumber: sales.saleNumber,
      // exact approval summaries and post-sale UI preserve
      // the currency frozen on the original sale.
      currencyCode: sales.currencyCode,
      customerId: sales.customerId,
      priceTier: sales.priceTier,
      customerName: customers.name,
      customerNameSnapshot: sales.customerNameSnapshot,
      siteNameSnapshot: sales.siteNameSnapshot,
      cashierNameSnapshot: sales.cashierNameSnapshot,
      receiptIdentitySnapshotVersion: sales.receiptIdentitySnapshotVersion,
      companyNameSnapshot: sales.companyNameSnapshot,
      companyTaxIdSnapshot: sales.companyTaxIdSnapshot,
      companyAddressSnapshot: sales.companyAddressSnapshot,
      companyPhoneSnapshot: sales.companyPhoneSnapshot,
      companyEmailSnapshot: sales.companyEmailSnapshot,
      customerTaxIdSnapshot: sales.customerTaxIdSnapshot,
      receiptPresentationSnapshotVersion: sales.receiptPresentationSnapshotVersion,
      receiptTemplateIdSnapshot: sales.receiptTemplateIdSnapshot,
      receiptTemplateKindSnapshot: sales.receiptTemplateKindSnapshot,
      receiptTemplateNameSnapshot: sales.receiptTemplateNameSnapshot,
      receiptTemplateLayoutSnapshot: sales.receiptTemplateLayoutSnapshot,
      receiptLogoUrlSnapshot: sales.receiptLogoUrlSnapshot,
      receiptLocaleSnapshot: sales.receiptLocaleSnapshot,
      subtotal: sales.subtotal,
      taxAmount: sales.taxAmount,
      discountAmount: sales.discountAmount,
      // restaurant tip / propina; surfaced on the read shape
      // so the receipt renderer, history modals, and reporting tiles
      // can render the captured tip without a second round trip.
      tipAmount: sales.tipAmount,
      tipMethod: sales.tipMethod,
      // restaurant service charge / propina sugerida. Mirrors
      // the tip surface so receipt rendering + reporting can reconstruct
      // the line without re-reading the row.
      serviceChargeAmount: sales.serviceChargeAmount,
      serviceChargeRate: sales.serviceChargeRate,
      total: sales.total,
      paymentMethod: sales.paymentMethod,
      paymentStatus: sales.paymentStatus,
      status: sales.status,
      cashSessionId: sales.cashSessionId,
      notes: sales.notes,
      createdBy: sales.createdBy,
      // park-and-resume bookkeeping. Surfacing these on the
      // read side lets the resume panel and the sale-details modal show
      // who suspended the draft without a second round trip.
      suspendedAt: sales.suspendedAt,
      suspendedBy: sales.suspendedBy,
      suspendedLabel: sales.suspendedLabel,
      // restaurant table FK. The column existed on the row
      // since  but the read shape never exposed it; surfaced
      // here so consumers (split-bill UI, future restaurant detail
      // surfaces) can read the FK without a second round-trip.
      tableId: sales.tableId,
      // reprint counters drive the "reimpresa N veces" banner.
      reprintCount: sales.reprintCount,
      lastReprintedAt: sales.lastReprintedAt,
      lastReprintedBy: sales.lastReprintedBy,
      syncStatus: sales.syncStatus,
      syncVersion: sales.syncVersion,
      createdAt: sales.createdAt,
      updatedAt: sales.updatedAt,
    })
    .from(sales)
    .leftJoin(customers, and(eq(sales.customerId, customers.id), eq(customers.tenantId, tenantId)))
    .where(and(eq(sales.id, saleId), eq(sales.tenantId, tenantId)))
    .get();

  if (!sale) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'SALE_NOT_FOUND',
      message: 'Sale not found',
    });
  }

  const items = await db
    .select({
      id: saleItems.id,
      saleId: saleItems.saleId,
      productId: saleItems.productId,
      productName: products.name,
      productSku: products.sku,
      productNameSnapshot: saleItems.productNameSnapshot,
      productSkuSnapshot: saleItems.productSkuSnapshot,
      // lets a resumed cart rebuild a service line without stock
      // semantics. Null on rows written before services shipped.
      tracksStock: saleItems.tracksStockSnapshot,
      quantity: saleItems.quantity,
      unitPrice: saleItems.unitPrice,
      catalogUnitPrice1: saleItems.catalogUnitPrice1,
      catalogUnitPrice2: saleItems.catalogUnitPrice2,
      catalogUnitPrice3: saleItems.catalogUnitPrice3,
      unitId: saleItems.unitId,
      unitEquivalence: saleItems.unitEquivalence,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      manualDiscountRate: saleItems.manualDiscountRate,
      discount: saleItems.discount,
      taxRate: saleItems.taxRate,
      taxKind: saleItems.taxKind,
      taxAmount: saleItems.taxAmount,
      costAtSale: saleItems.costAtSale,
      total: saleItems.total,
      // surface the per-line modifier so the renderer
      // (KDS card, receipt reprint, history detail modal) reads it
      // alongside each item.
      notes: saleItems.notes,
    })
    .from(saleItems)
    .innerJoin(sales, and(eq(saleItems.saleId, sales.id), eq(sales.tenantId, tenantId)))
    .leftJoin(products, and(eq(saleItems.productId, products.id), eq(products.tenantId, tenantId)))
    .leftJoin(units, and(eq(saleItems.unitId, units.id), eq(units.tenantId, tenantId)))
    .where(and(eq(saleItems.saleId, saleId), eq(sales.id, saleId)))
    .orderBy(saleItems.id)
    .all();

  const serialNumbersByItem = listSaleItemSerialNumbers(db, {
    tenantId,
    saleItemIds: items.map(item => item.id),
  });
  const componentRows =
    items.length === 0
      ? []
      : await db
          .select({
            saleItemId: saleItemTaxComponents.saleItemId,
            componentKey: saleItemTaxComponents.componentKey,
            vatRateId: saleItemTaxComponents.vatRateId,
            taxKind: saleItemTaxComponents.taxKind,
            taxRate: saleItemTaxComponents.taxRate,
            taxableAmount: saleItemTaxComponents.taxableAmount,
            taxAmount: saleItemTaxComponents.taxAmount,
            position: saleItemTaxComponents.position,
          })
          .from(saleItemTaxComponents)
          .where(
            and(
              eq(saleItemTaxComponents.tenantId, tenantId),
              inArray(
                saleItemTaxComponents.saleItemId,
                items.map(item => item.id)
              )
            )
          )
          .orderBy(saleItemTaxComponents.saleItemId, saleItemTaxComponents.position)
          .all();
  const componentsByItem = new Map<string, typeof componentRows>();
  for (const component of componentRows) {
    const group = componentsByItem.get(component.saleItemId) ?? [];
    group.push(component);
    componentsByItem.set(component.saleItemId, group);
  }
  const promotionRows =
    items.length === 0
      ? []
      : await db
          .select()
          .from(saleItemPromotions)
          .where(
            and(
              eq(saleItemPromotions.tenantId, tenantId),
              inArray(
                saleItemPromotions.saleItemId,
                items.map(item => item.id)
              )
            )
          )
          .orderBy(saleItemPromotions.saleItemId, saleItemPromotions.position)
          .all();
  const promotionsByItem = new Map<string, typeof promotionRows>();
  for (const promotion of promotionRows) {
    const group = promotionsByItem.get(promotion.saleItemId) ?? [];
    group.push(promotion);
    promotionsByItem.set(promotion.saleItemId, group);
  }
  const salePriceTier = isPriceTier(sale.priceTier) ? sale.priceTier : 1;
  const itemsWithSerials = items.map(item => {
    const hasCompleteCatalogSnapshot =
      item.catalogUnitPrice1 !== null &&
      item.catalogUnitPrice2 !== null &&
      item.catalogUnitPrice3 !== null;
    const referenceUnitPrice =
      salePriceTier === 1
        ? item.catalogUnitPrice1
        : salePriceTier === 2
          ? item.catalogUnitPrice2
          : item.catalogUnitPrice3;
    const priceEdited =
      !hasCompleteCatalogSnapshot ||
      detectPriceOverrides([
        {
          id: item.id,
          productId: item.productId,
          productName: item.productNameSnapshot ?? item.productName ?? item.productId,
          referenceUnitPrice: referenceUnitPrice ?? item.unitPrice,
          retailUnitPrice: item.catalogUnitPrice1 ?? item.unitPrice,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
        },
      ]).length > 0;
    return {
      ...item,
      // Renderer hint only. Completion independently re-resolves the frozen
      // line and requires the exact grant server-side, so a forged false flag
      // cannot bypass authorization. Legacy rows fail closed.
      priceEdited,
      serialNumbers: serialNumbersByItem.get(item.id) ?? [],
      promotions: promotionsByItem.get(item.id) ?? [],
      taxComponents: componentsByItem.get(item.id) ?? [
        {
          saleItemId: item.id,
          componentKey: `legacy:${item.taxKind}:${Number(item.taxRate).toFixed(6)}`,
          vatRateId: null,
          taxKind: item.taxKind,
          taxRate: item.taxRate,
          taxableAmount: roundMoney(item.total - item.taxAmount),
          taxAmount: item.taxAmount,
          position: 0,
        },
      ],
    };
  });

  const returnHeaders = await db
    .select()
    .from(saleReturns)
    .where(and(eq(saleReturns.tenantId, tenantId), eq(saleReturns.saleId, saleId)))
    .orderBy(saleReturns.createdAt, saleReturns.id)
    .all();
  const returnIds = returnHeaders.map(row => row.id);
  const returnedLineRows =
    returnIds.length === 0
      ? []
      : await db
          .select()
          .from(saleReturnItems)
          .where(
            and(
              eq(saleReturnItems.tenantId, tenantId),
              inArray(saleReturnItems.saleReturnId, returnIds)
            )
          )
          .orderBy(saleReturnItems.createdAt, saleReturnItems.id)
          .all();
  const returnedLineIds = returnedLineRows.map(row => row.id);
  const returnedTaxRows =
    returnedLineIds.length === 0
      ? []
      : await db
          .select()
          .from(saleReturnItemTaxComponents)
          .where(
            and(
              eq(saleReturnItemTaxComponents.tenantId, tenantId),
              inArray(saleReturnItemTaxComponents.saleReturnItemId, returnedLineIds)
            )
          )
          .orderBy(
            saleReturnItemTaxComponents.saleReturnItemId,
            saleReturnItemTaxComponents.position
          )
          .all();
  const returnedLotRows =
    returnedLineIds.length === 0
      ? []
      : await db
          .select()
          .from(saleReturnItemLots)
          .where(
            and(
              eq(saleReturnItemLots.tenantId, tenantId),
              inArray(saleReturnItemLots.saleReturnItemId, returnedLineIds)
            )
          )
          .orderBy(saleReturnItemLots.saleReturnItemId, saleReturnItemLots.id)
          .all();
  const returnedSerialRows =
    returnedLineIds.length === 0
      ? []
      : await db
          .select()
          .from(saleReturnItemSerials)
          .where(
            and(
              eq(saleReturnItemSerials.tenantId, tenantId),
              inArray(saleReturnItemSerials.saleReturnItemId, returnedLineIds)
            )
          )
          .orderBy(saleReturnItemSerials.saleReturnItemId, saleReturnItemSerials.id)
          .all();
  const returnedPaymentRows =
    returnIds.length === 0
      ? []
      : await db
          .select()
          .from(saleReturnPaymentAllocations)
          .where(
            and(
              eq(saleReturnPaymentAllocations.tenantId, tenantId),
              inArray(saleReturnPaymentAllocations.saleReturnId, returnIds)
            )
          )
          .orderBy(saleReturnPaymentAllocations.saleReturnId, saleReturnPaymentAllocations.id)
          .all();
  const taxByReturnLine = new Map<string, typeof returnedTaxRows>();
  for (const row of returnedTaxRows) {
    const group = taxByReturnLine.get(row.saleReturnItemId) ?? [];
    group.push(row);
    taxByReturnLine.set(row.saleReturnItemId, group);
  }
  const lotsByReturnLine = new Map<string, typeof returnedLotRows>();
  for (const row of returnedLotRows) {
    const group = lotsByReturnLine.get(row.saleReturnItemId) ?? [];
    group.push(row);
    lotsByReturnLine.set(row.saleReturnItemId, group);
  }
  const serialsByReturnLine = new Map<string, typeof returnedSerialRows>();
  for (const row of returnedSerialRows) {
    const group = serialsByReturnLine.get(row.saleReturnItemId) ?? [];
    group.push(row);
    serialsByReturnLine.set(row.saleReturnItemId, group);
  }
  const linesByReturn = new Map<
    string,
    Array<
      (typeof returnedLineRows)[number] & {
        taxComponents: typeof returnedTaxRows;
        lots: typeof returnedLotRows;
        serials: typeof returnedSerialRows;
      }
    >
  >();
  for (const row of returnedLineRows) {
    const group = linesByReturn.get(row.saleReturnId) ?? [];
    group.push({
      ...row,
      taxComponents: taxByReturnLine.get(row.id) ?? [],
      lots: lotsByReturnLine.get(row.id) ?? [],
      serials: serialsByReturnLine.get(row.id) ?? [],
    });
    linesByReturn.set(row.saleReturnId, group);
  }
  const paymentsByReturn = new Map<string, typeof returnedPaymentRows>();
  for (const row of returnedPaymentRows) {
    const group = paymentsByReturn.get(row.saleReturnId) ?? [];
    group.push(row);
    paymentsByReturn.set(row.saleReturnId, group);
  }
  const exchangeRows =
    returnIds.length === 0
      ? []
      : await db
          .select()
          .from(saleExchanges)
          .where(
            and(
              eq(saleExchanges.tenantId, tenantId),
              inArray(saleExchanges.saleReturnId, returnIds)
            )
          )
          .orderBy(saleExchanges.saleReturnId, saleExchanges.id)
          .all();
  const replacementSaleIds = exchangeRows.map(row => row.replacementSaleId);
  const replacementSaleRows =
    replacementSaleIds.length === 0
      ? []
      : await db
          .select({ id: sales.id, saleNumber: sales.saleNumber })
          .from(sales)
          .where(and(eq(sales.tenantId, tenantId), inArray(sales.id, replacementSaleIds)))
          .all();
  const replacementSaleNumberById = new Map<string, string>(
    replacementSaleRows.map(row => [row.id, row.saleNumber] as const)
  );
  const exchangeByReturn = new Map(
    exchangeRows.map(row => [
      row.saleReturnId,
      {
        ...row,
        replacementSaleNumber: replacementSaleNumberById.get(row.replacementSaleId) ?? null,
      },
    ])
  );
  const returns = returnHeaders.map(header => {
    const returnLines = linesByReturn.get(header.id) ?? [];
    return {
      ...header,
      legacyFullTicket: returnLines.length === 0,
      items: returnLines,
      paymentAllocations: paymentsByReturn.get(header.id) ?? [],
      exchange: exchangeByReturn.get(header.id) ?? null,
    };
  });

  const originalLotRows =
    items.length === 0
      ? []
      : await db
          .select({
            id: saleItemLots.id,
            saleItemId: saleItemLots.saleItemId,
            lotId: saleItemLots.lotId,
            lotNumber: inventoryLots.lotNumber,
            expiresAt: inventoryLots.expiresAt,
            status: inventoryLots.status,
            quantity: saleItemLots.quantity,
            unitCost: saleItemLots.unitCost,
          })
          .from(saleItemLots)
          .innerJoin(
            inventoryLots,
            and(eq(saleItemLots.lotId, inventoryLots.id), eq(inventoryLots.tenantId, tenantId))
          )
          .where(
            and(
              eq(saleItemLots.tenantId, tenantId),
              inArray(
                saleItemLots.saleItemId,
                items.map(item => item.id)
              )
            )
          )
          .orderBy(saleItemLots.saleItemId, saleItemLots.id)
          .all();
  const originalLotsByItem = new Map<string, typeof originalLotRows>();
  for (const row of originalLotRows) {
    const group = originalLotsByItem.get(row.saleItemId) ?? [];
    group.push(row);
    originalLotsByItem.set(row.saleItemId, group);
  }
  const returnedByOriginalLot = new Map<string, number>();
  for (const row of returnedLotRows) {
    returnedByOriginalLot.set(
      row.saleItemLotId,
      (returnedByOriginalLot.get(row.saleItemLotId) ?? 0) + row.quantity
    );
  }
  const originalSerialRows =
    items.length === 0
      ? []
      : await db
          .select({
            id: saleItemSerials.id,
            saleItemId: saleItemSerials.saleItemId,
            productSerialId: saleItemSerials.productSerialId,
            serialNumber: saleItemSerials.serialNumber,
            currentStatus: productSerials.status,
          })
          .from(saleItemSerials)
          .innerJoin(
            productSerials,
            and(
              eq(saleItemSerials.productSerialId, productSerials.id),
              eq(productSerials.tenantId, tenantId)
            )
          )
          .where(
            and(
              eq(saleItemSerials.tenantId, tenantId),
              inArray(
                saleItemSerials.saleItemId,
                items.map(item => item.id)
              )
            )
          )
          .orderBy(saleItemSerials.saleItemId, saleItemSerials.id)
          .all();
  const originalSerialsByItem = new Map<string, typeof originalSerialRows>();
  for (const row of originalSerialRows) {
    const group = originalSerialsByItem.get(row.saleItemId) ?? [];
    group.push(row);
    originalSerialsByItem.set(row.saleItemId, group);
  }
  const returnedOriginalSerialIds = new Set(returnedSerialRows.map(row => row.saleItemSerialId));
  const returnedBySaleItem = new Map<string, { quantity: number; total: number }>();
  for (const row of returnedLineRows) {
    const current = returnedBySaleItem.get(row.saleItemId) ?? { quantity: 0, total: 0 };
    current.quantity += row.quantity;
    current.total = roundMoney(current.total + row.total);
    returnedBySaleItem.set(row.saleItemId, current);
  }
  const enrichedItems = itemsWithSerials.map(item => {
    const returned = returnedBySaleItem.get(item.id) ?? { quantity: 0, total: 0 };
    return {
      ...item,
      returnedQuantity: returned.quantity,
      remainingQuantity: Math.max(0, item.quantity - returned.quantity),
      returnedAmount: returned.total,
      returnableAmount: roundMoney(Math.max(0, item.total - returned.total)),
      lots: (originalLotsByItem.get(item.id) ?? []).map(row => ({
        ...row,
        returnedQuantity: returnedByOriginalLot.get(row.id) ?? 0,
        remainingQuantity: Math.max(0, row.quantity - (returnedByOriginalLot.get(row.id) ?? 0)),
      })),
      serials: (originalSerialsByItem.get(item.id) ?? []).map(row => ({
        ...row,
        returned: returnedOriginalSerialIds.has(row.id),
      })),
    };
  });

  // every sale has at least one payment row now.
  const paymentRows = await db
    .select({
      id: salePayments.id,
      method: salePayments.method,
      amount: salePayments.amount,
      loyaltyPoints: salePayments.loyaltyPoints,
      reference: salePayments.reference,
      createdAt: salePayments.createdAt,
    })
    .from(salePayments)
    .where(and(eq(salePayments.tenantId, tenantId), eq(salePayments.saleId, saleId)))
    .orderBy(salePayments.createdAt, salePayments.id)
    .all();
  const returnedByPayment = new Map<string, number>();
  for (const allocation of returnedPaymentRows) {
    if (!allocation.salePaymentId) continue;
    returnedByPayment.set(
      allocation.salePaymentId,
      roundMoney((returnedByPayment.get(allocation.salePaymentId) ?? 0) + allocation.amount)
    );
  }
  const payments = paymentRows.map(payment => ({
    ...payment,
    returnedAmount: returnedByPayment.get(payment.id) ?? 0,
    remainingAmount: roundMoney(
      Math.max(0, payment.amount - (returnedByPayment.get(payment.id) ?? 0))
    ),
  }));

  const fiscalDocumentsList = await loadFiscalDocumentsForSale(db, tenantId, saleId);

  const latestReturn = returns.at(-1) ?? null;
  const returnedAmount = returnHeaders.reduce((sum, row) => roundMoney(sum + row.refundAmount), 0);
  return {
    ...sale,
    priceTier: salePriceTier,
    // Compatibility aliases keep older receipt/history consumers readable;
    // the normalized `returns` array is authoritative for new code.
    returnId: latestReturn?.id ?? null,
    returnReason: latestReturn?.reason ?? null,
    refundAmount: latestReturn?.refundAmount ?? null,
    returnedAt: latestReturn?.createdAt ?? null,
    returnedAmount,
    returnableAmount: roundMoney(Math.max(0, sale.total - returnedAmount)),
    returns,
    items: enrichedItems,
    payments,
    fiscalDocuments: fiscalDocumentsList,
  };
}

/**
 * Concrete persisted sale shape returned by `completeSale`. Lives next to
 * `getSaleRecord` (its source) so the two sale paths can import it without
 * depending on the `completeSale` orchestrator. Checkout-only metadata such
 * as cash change belongs to `CompleteSaleResult`, never this resource.
 */
export type CompleteSaleSaleRecord = Awaited<ReturnType<typeof getSaleRecord>>;

export interface SaleFiscalDocumentRow {
  id: string;
  source: FiscalDocumentSource;
  kind: FiscalDocumentKind;
  cufe: string;
  documentNumber: string;
  status: FiscalDocumentStatus;
  maturity: FiscalAdapterMaturity;
  /**
   * Country-specific QR payload string (URL for DIAN/SAT, TED for SII).
   * Null unless the provider pack is certified and the document is in
   * an authority-verifiable status with a finalized identifier.
   */
  qrPayload: string | null;
  xmlRef: string | null;
  resolution: string | null;
  emittedAt: string;
  countryCode: string;
}

/**
 * Resolve every fiscal document linked to the sale: the
 * original DEE/FEV (source='sale'), any void NC (source='void',
 * sourceId=saleId), and any return NCs (source='return', sourceId
 * IN saleReturns.id).
 *
 * Returns an empty array when no fiscal documents exist (DIAN
 * disabled tenant, sale predates fiscal pack activation, etc).
 * Tenant-scoped via the explicit `tenantId` filter.
 */
async function loadFiscalDocumentsForSale(
  db: DatabaseInstance,
  tenantId: string,
  saleId: string
): Promise<SaleFiscalDocumentRow[]> {
  // Step 1: gather candidate sourceIds. DEE/FEV + void NC both key on
  // saleId; return NCs key on the saleReturns.id row(s) for the sale.
  const returnIdRows = await db
    .select({ id: saleReturns.id })
    .from(saleReturns)
    .where(and(eq(saleReturns.tenantId, tenantId), eq(saleReturns.saleId, saleId)))
    .all();
  const returnIds = returnIdRows.map(row => row.id);

  // Step 2: query fiscal_documents in a single round-trip. The OR
  // clause covers all three source types. Index hits on
  // idx_fiscal_documents_source (source, sourceId).
  const conditions = [
    and(
      eq(fiscalDocuments.tenantId, tenantId),
      inArray(fiscalDocuments.source, ['sale', 'void'] as FiscalDocumentSource[]),
      eq(fiscalDocuments.sourceId, saleId)
    ),
  ];
  if (returnIds.length > 0) {
    conditions.push(
      and(
        eq(fiscalDocuments.tenantId, tenantId),
        eq(fiscalDocuments.source, 'return' as FiscalDocumentSource),
        inArray(fiscalDocuments.sourceId, returnIds)
      )
    );
  }

  const docs = await db
    .select({
      id: fiscalDocuments.id,
      source: fiscalDocuments.source,
      kind: fiscalDocuments.kind,
      cufe: fiscalDocuments.cufe,
      documentNumber: fiscalDocuments.documentNumber,
      status: fiscalDocuments.status,
      xmlRef: fiscalDocuments.xmlRef,
      providerResponse: fiscalDocuments.providerResponse,
      buyerTaxId: fiscalDocuments.buyerTaxId,
      totalAmount: fiscalDocuments.totalAmount,
      emittedAt: fiscalDocuments.emittedAt,
      consecutive: fiscalDocuments.consecutive,
      localeCode: fiscalDocuments.localeCode,
      providerId: fiscalDocuments.providerId,
      resolutionNumber: fiscalNumberingResolutions.resolutionNumber,
      resolutionPrefix: fiscalNumberingResolutions.prefix,
      resolutionFrom: fiscalNumberingResolutions.fromNumber,
      resolutionTo: fiscalNumberingResolutions.toNumber,
      resolutionValidFrom: fiscalNumberingResolutions.validFrom,
      resolutionValidUntil: fiscalNumberingResolutions.validUntil,
    })
    .from(fiscalDocuments)
    .innerJoin(
      fiscalNumberingResolutions,
      and(
        eq(fiscalNumberingResolutions.id, fiscalDocuments.resolutionId),
        eq(fiscalNumberingResolutions.tenantId, tenantId)
      )
    )
    .where(or(...conditions))
    .orderBy(fiscalDocuments.emittedAt, fiscalDocuments.id)
    .all();

  if (docs.length === 0) return [];

  // Step 3: resolve country code + tenant tax id once for the QR
  // builder. The locale resolver is cached internally; cost is
  // negligible compared to the per-row map.
  const locale = await resolveTenantLocale(db, tenantId);
  const tenantRow = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const tenantSettings = (tenantRow?.settings ?? {}) as Record<string, unknown>;

  return docs.map(doc => {
    const provider = describeFiscalProvider(doc.providerId);
    const countryCode =
      provider?.countryCode ?? resolveFiscalDocumentCountryCode(doc.localeCode, locale.countryCode);
    const maturity = provider?.maturity ?? 'mock';
    return {
      id: doc.id,
      source: doc.source,
      kind: doc.kind,
      cufe: doc.cufe,
      documentNumber: doc.documentNumber,
      status: doc.status,
      maturity,
      xmlRef: doc.xmlRef,
      resolution: formatFiscalResolution({
        number: doc.resolutionNumber,
        prefix: doc.resolutionPrefix,
        from: doc.resolutionFrom,
        to: doc.resolutionTo,
        validFrom: doc.resolutionValidFrom,
        validUntil: doc.resolutionValidUntil,
      }),
      emittedAt: doc.emittedAt,
      countryCode,
      qrPayload: buildFiscalQrPayload({
        country: countryCode,
        maturity,
        environment: resolveFiscalVerificationEnvironment(countryCode, tenantSettings),
        doc: {
          cufe: doc.cufe,
          status: doc.status,
          documentNumber: doc.documentNumber,
          buyerTaxId: doc.buyerTaxId,
          totalAmount: doc.totalAmount,
          xmlRef: doc.xmlRef,
          providerResponse: doc.providerResponse,
        },
        tenant: {
          taxId: resolveIssuerTaxId(countryCode, tenantSettings, tenantId),
        },
      }),
    };
  });
}

function resolveFiscalDocumentCountryCode(
  localeCode: string | null,
  fallbackCountryCode: string
): string {
  const match = localeCode?.match(/-([A-Za-z]{2})(?:-|$)/);
  return (match?.[1] ?? fallbackCountryCode).toUpperCase();
}

function resolveIssuerTaxId(
  countryCode: string,
  tenantSettings: Record<string, unknown>,
  fallbackTenantId: string
): string {
  switch (countryCode.toUpperCase()) {
    case 'CO':
      return readCoFiscalSettings(tenantSettings).nit ?? fallbackTenantId;
    case 'MX':
      return readMxFiscalSettings(tenantSettings).rfc ?? fallbackTenantId;
    case 'CL':
      return readClFiscalSettings(tenantSettings).rut ?? fallbackTenantId;
    default:
      return fallbackTenantId;
  }
}

function resolveFiscalVerificationEnvironment(
  countryCode: string,
  tenantSettings: Record<string, unknown>
): 'production' | 'habilitation' {
  switch (countryCode.toUpperCase()) {
    case 'CO':
      return readCoFiscalSettings(tenantSettings).environment === 'produccion'
        ? 'production'
        : 'habilitation';
    case 'MX':
      return readMxFiscalSettings(tenantSettings).environment === 'production'
        ? 'production'
        : 'habilitation';
    case 'CL':
      return readClFiscalSettings(tenantSettings).environment === 'produccion'
        ? 'production'
        : 'habilitation';
    default:
      return 'habilitation';
  }
}

function formatFiscalResolution(input: {
  number: string;
  prefix: string;
  from: number;
  to: number;
  validFrom: string;
  validUntil: string;
}): string {
  return `${input.number} | ${input.prefix} ${input.from}-${input.to} | ${input.validFrom} - ${input.validUntil}`;
}
