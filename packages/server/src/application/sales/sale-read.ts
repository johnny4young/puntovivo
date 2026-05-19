/**
 * ENG-054 — Post-commit sale reader.
 *
 * `getSaleRecord` is the canonical read used by the sale lifecycle to
 * return a fully-hydrated sale (header + items + payments + return
 * info) to the caller. It used to live as a private helper in
 * `trpc/routers/sales.ts`; ENG-054 moved it here so the application
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
import type { DatabaseInstance } from '../../db/index.js';
import {
  customers,
  fiscalDocuments,
  products,
  salePayments,
  saleItems,
  saleReturns,
  sales,
  tenants,
  units,
  type FiscalDocumentKind,
  type FiscalDocumentSource,
  type FiscalDocumentStatus,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { buildFiscalQrPayload } from '../../services/fiscal/qr-builder.js';
import { readMxFiscalSettings } from '../../services/fiscal/packs/mx/settings.js';
import { resolveTenantLocale } from '../../services/tenant-locale.js';

export async function getSaleRecord(
  db: DatabaseInstance,
  tenantId: string,
  saleId: string
) {
  const sale = await db
    .select({
      id: sales.id,
      tenantId: sales.tenantId,
      saleNumber: sales.saleNumber,
      customerId: sales.customerId,
      customerName: customers.name,
      subtotal: sales.subtotal,
      taxAmount: sales.taxAmount,
      discountAmount: sales.discountAmount,
      // ENG-039d — restaurant tip / propina; surfaced on the read shape
      // so the receipt renderer, history modals, and reporting tiles
      // can render the captured tip without a second round trip.
      tipAmount: sales.tipAmount,
      tipMethod: sales.tipMethod,
      // ENG-039d3 — restaurant service charge / propina sugerida. Mirrors
      // the tip surface so receipt rendering + reporting can reconstruct
      // the line without re-reading the row.
      serviceChargeAmount: sales.serviceChargeAmount,
      serviceChargeRate: sales.serviceChargeRate,
      total: sales.total,
      paymentMethod: sales.paymentMethod,
      paymentStatus: sales.paymentStatus,
      status: sales.status,
      notes: sales.notes,
      createdBy: sales.createdBy,
      // ENG-018 — park-and-resume bookkeeping. Surfacing these on the
      // read side lets the resume panel and the sale-details modal show
      // who suspended the draft without a second round trip.
      suspendedAt: sales.suspendedAt,
      suspendedBy: sales.suspendedBy,
      suspendedLabel: sales.suspendedLabel,
      // ENG-039c — restaurant table FK. The column existed on the row
      // since ENG-039c but the read shape never exposed it; surfaced
      // here so consumers (split-bill UI, future restaurant detail
      // surfaces) can read the FK without a second round-trip.
      tableId: sales.tableId,
      // ENG-019 — reprint counters drive the "reimpresa N veces" banner.
      reprintCount: sales.reprintCount,
      lastReprintedAt: sales.lastReprintedAt,
      lastReprintedBy: sales.lastReprintedBy,
      syncStatus: sales.syncStatus,
      syncVersion: sales.syncVersion,
      createdAt: sales.createdAt,
      updatedAt: sales.updatedAt,
      returnId: saleReturns.id,
      returnReason: saleReturns.reason,
      refundAmount: saleReturns.refundAmount,
      returnedAt: saleReturns.createdAt,
    })
    .from(sales)
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .leftJoin(saleReturns, eq(saleReturns.saleId, sales.id))
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
      quantity: saleItems.quantity,
      unitPrice: saleItems.unitPrice,
      unitId: saleItems.unitId,
      unitEquivalence: saleItems.unitEquivalence,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      discount: saleItems.discount,
      taxRate: saleItems.taxRate,
      taxAmount: saleItems.taxAmount,
      costAtSale: saleItems.costAtSale,
      total: saleItems.total,
      // ENG-039d2 — surface the per-line modifier so the renderer
      // (KDS card, receipt reprint, history detail modal) reads it
      // alongside each item.
      notes: saleItems.notes,
    })
    .from(saleItems)
    .leftJoin(products, eq(saleItems.productId, products.id))
    .leftJoin(units, eq(saleItems.unitId, units.id))
    .where(eq(saleItems.saleId, saleId))
    .all();

  // Phase 2 Tier-2 step 5 — every sale has at least one payment row now.
  const payments = await db
    .select({
      id: salePayments.id,
      method: salePayments.method,
      amount: salePayments.amount,
      reference: salePayments.reference,
      createdAt: salePayments.createdAt,
    })
    .from(salePayments)
    .where(eq(salePayments.saleId, saleId))
    .orderBy(salePayments.createdAt)
    .all();

  const fiscalDocumentsList = await loadFiscalDocumentsForSale(db, tenantId, saleId);

  return { ...sale, items, payments, fiscalDocuments: fiscalDocumentsList };
}

export interface SaleFiscalDocumentRow {
  id: string;
  source: FiscalDocumentSource;
  kind: FiscalDocumentKind;
  cufe: string;
  documentNumber: string;
  status: FiscalDocumentStatus;
  /**
   * Country-specific QR payload string (URL for DIAN/SAT, TED for SII).
   * Null when the document is not in an eligible status, when the
   * CUFE is still a placeholder, or when the country pack is not yet
   * implemented (CL pre-ENG-036b).
   */
  qrPayload: string | null;
  xmlRef: string | null;
  resolution: string | null;
  emittedAt: string;
  countryCode: string;
}

/**
 * ENG-058 — Resolve every fiscal document linked to the sale: the
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
    })
    .from(fiscalDocuments)
    .where(or(...conditions))
    .orderBy(fiscalDocuments.emittedAt)
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
    const countryCode = resolveFiscalDocumentCountryCode(
      doc.localeCode,
      locale.countryCode
    );
    return {
      id: doc.id,
      source: doc.source,
      kind: doc.kind,
      cufe: doc.cufe,
      documentNumber: doc.documentNumber,
      status: doc.status,
      xmlRef: doc.xmlRef,
      resolution: null, // Not in the LIST_SELECT_COLUMNS today; widen if needed
      emittedAt: doc.emittedAt,
      countryCode,
      qrPayload: buildFiscalQrPayload({
        country: countryCode,
        // The current adapter env is sandbox/'2' per ENG-020 Fase A.
        // Habilitación support is wired in ENG-021 (PT contract gate).
        environment: 'production',
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
  if (countryCode.toUpperCase() === 'MX') {
    return readMxFiscalSettings(tenantSettings).rfc ?? fallbackTenantId;
  }
  return fallbackTenantId;
}
