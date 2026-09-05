/**
 * Fiscal orchestrator — buyer + line snapshots ( split).
 *
 * Materializes the buyer (customer or CONSUMIDOR_FINAL) + the sale lines at
 * emission time; the document freezes these (DIAN 165/2023 CUFE rule).
 * Tenant-scoped. Called BEFORE the write transaction in emit/enqueue.
 *
 * @module services/fiscal/orchestrator/snapshots
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { DatabaseInstance } from '../../../db/index.js';
import {
  customers,
  fiscalIdentificationTypes,
  identificationTypes,
  products,
  saleReturnItems,
  saleReturnItemTaxComponents,
  saleReturns,
  saleItems,
  saleItemTaxComponents,
  units,
} from '../../../db/schema.js';
import { roundMoney } from '../../../lib/money.js';
import { CONSUMIDOR_FINAL } from '../cufe.js';
import type { ResolvedBuyer, ResolvedLine } from './types.js';
import type { FiscalDocumentSource } from '../../../db/schema.js';
import { abbrToDianCode } from './helpers.js';

export async function resolveBuyer(
  tx: DatabaseInstance,
  tenantId: string,
  customerId: string | null
): Promise<ResolvedBuyer> {
  if (!customerId) {
    return {
      customerId: null,
      taxId: CONSUMIDOR_FINAL.taxId,
      taxIdTypeCode: CONSUMIDOR_FINAL.taxIdTypeCode,
      name: CONSUMIDOR_FINAL.name,
      email: null,
      address: null,
      city: null,
      department: null,
      country: null,
    };
  }

  const row = await tx
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      address: customers.address,
      city: customers.city,
      state: customers.state,
      country: customers.country,
      taxId: customers.taxId,
      identificationTypeId: customers.identificationTypeId,
    })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
    .get();

  if (!row) {
    // Customer was deleted between sale creation and emission; fall
    // back to consumidor final so the emission does not block the
    // sale lifecycle.
    return {
      customerId: null,
      taxId: CONSUMIDOR_FINAL.taxId,
      taxIdTypeCode: CONSUMIDOR_FINAL.taxIdTypeCode,
      name: CONSUMIDOR_FINAL.name,
      email: null,
      address: null,
      city: null,
      department: null,
      country: null,
    };
  }

  let taxIdTypeCode = '13';
  if (row.identificationTypeId) {
    const idType = await tx
      .select({ code: identificationTypes.code })
      .from(identificationTypes)
      .where(eq(identificationTypes.id, row.identificationTypeId))
      .get();
    taxIdTypeCode = abbrToDianCode(idType?.code ?? null);
  }

  // Sanity: confirm the resolved code exists in the global catalog so
  // the composite FK on `fiscal_documents.(buyer_country_code,
  // buyer_tax_id_type_code)` does not fail.  — the orchestrator
  // emits DIAN documents (Colombia) today; multi-country support
  // arrives with  /  when the adapter routes carry the
  // tenant locale through. Until then, hard-code 'CO' for the lookup.
  const buyerCountryCode = 'CO';
  const catalog = await tx
    .select({ code: fiscalIdentificationTypes.code })
    .from(fiscalIdentificationTypes)
    .where(
      and(
        eq(fiscalIdentificationTypes.countryCode, buyerCountryCode),
        eq(fiscalIdentificationTypes.code, taxIdTypeCode)
      )
    )
    .get();
  if (!catalog) {
    taxIdTypeCode = '13';
  }

  return {
    customerId: row.id,
    taxId: row.taxId ?? CONSUMIDOR_FINAL.taxId,
    taxIdTypeCode,
    name: row.name,
    email: row.email,
    address: row.address,
    city: row.city,
    department: row.state,
    country: row.country,
  };
}

export async function resolveLines(
  tx: DatabaseInstance,
  tenantId: string,
  saleId: string
): Promise<ResolvedLine[]> {
  const rows = await tx
    .select({
      id: saleItems.id,
      productId: saleItems.productId,
      productNameSnapshot: saleItems.productNameSnapshot,
      productSkuSnapshot: saleItems.productSkuSnapshot,
      // Historical rows predating sale-time label snapshots may still carry
      // nulls. Only those rows fall back to the tenant-scoped live catalog.
      liveProductName: products.name,
      liveProductSku: products.sku,
      quantity: saleItems.quantity,
      unitPrice: saleItems.unitPrice,
      discount: saleItems.discount,
      taxRate: saleItems.taxRate,
      taxKind: saleItems.taxKind,
      taxAmount: saleItems.taxAmount,
      total: saleItems.total,
      // UN/ECE unit code for the UBL unitCode / CFDI ClaveUnidad.
      // The sale-time snapshot wins; the live unit catalog is only the
      // fallback for pre-snapshot rows. LEFT join: a missing or legacy
      // unit must not drop the line from a legal document - it just
      // falls back to the EA default.
      frozenUnitStandardCode: saleItems.unitStandardCode,
      liveUnitStandardCode: units.standardCode,
    })
    .from(saleItems)
    .innerJoin(products, eq(saleItems.productId, products.id))
    // The tenant predicate lives in the ON clause, NOT the WHERE: in the
    // WHERE it would degrade the LEFT join to INNER and drop lines with
    // a null/legacy unit from a legal document. In the ON clause a
    // corrupt cross-tenant unitId simply degrades to the EA fallback.
    .leftJoin(units, and(eq(saleItems.unitId, units.id), eq(units.tenantId, tenantId)))
    .where(and(eq(saleItems.saleId, saleId), eq(products.tenantId, tenantId)))
    // Line numbers on a legal document must not depend on scan order;
    // sale_items has no createdAt, so the id is the stable tiebreaker.
    .orderBy(saleItems.id)
    .all();

  const componentRows =
    rows.length === 0
      ? []
      : await tx
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
                rows.map(row => row.id)
              )
            )
          )
          .orderBy(saleItemTaxComponents.saleItemId, saleItemTaxComponents.position)
          .all();
  const componentsByLine = new Map<string, typeof componentRows>();
  for (const component of componentRows) {
    const group = componentsByLine.get(component.saleItemId) ?? [];
    group.push(component);
    componentsByLine.set(component.saleItemId, group);
  }

  return rows.map((row, index) => {
    // Same gross-first rounding order as splitLineTax, so the frozen
    // document discount reconciles with the line total AND satisfies the
    // 2-decimal CHECK on fiscal_document_items - a raw float here would
    // abort the whole enqueue transaction for any non-cent-clean percent.
    const gross = roundMoney(row.unitPrice * row.quantity);
    return {
      lineNumber: index + 1,
      productId: row.productId,
      productName: row.productNameSnapshot ?? row.liveProductName ?? 'Unknown product',
      productSku: row.productSkuSnapshot ?? row.liveProductSku,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      discountAmount: roundMoney((gross * (row.discount ?? 0)) / 100),
      taxRate: row.taxRate ?? 0,
      taxKind: row.taxKind,
      taxAmount: row.taxAmount ?? 0,
      taxComponents: componentsByLine.get(row.id) ?? [
        {
          saleItemId: row.id,
          componentKey: `legacy:${row.taxKind}:${Number(row.taxRate ?? 0).toFixed(6)}`,
          vatRateId: null,
          taxKind: row.taxKind,
          taxRate: row.taxRate ?? 0,
          taxableAmount: roundMoney(row.total - (row.taxAmount ?? 0)),
          taxAmount: row.taxAmount ?? 0,
          position: 0,
        },
      ],
      lineTotal: row.total,
      unitStandardCode: row.frozenUnitStandardCode ?? row.liveUnitStandardCode ?? null,
    };
  });
}

async function resolveReturnLines(
  tx: DatabaseInstance,
  tenantId: string,
  saleReturnId: string,
  adjustments: { tipAmount: number; serviceChargeAmount: number }
): Promise<ResolvedLine[]> {
  const rows = await tx
    .select()
    .from(saleReturnItems)
    .where(
      and(eq(saleReturnItems.tenantId, tenantId), eq(saleReturnItems.saleReturnId, saleReturnId))
    )
    .orderBy(saleReturnItems.id)
    .all();
  if (rows.length === 0) return [];
  const components = await tx
    .select()
    .from(saleReturnItemTaxComponents)
    .where(
      and(
        eq(saleReturnItemTaxComponents.tenantId, tenantId),
        inArray(
          saleReturnItemTaxComponents.saleReturnItemId,
          rows.map(row => row.id)
        )
      )
    )
    .orderBy(saleReturnItemTaxComponents.saleReturnItemId, saleReturnItemTaxComponents.position)
    .all();
  const byLine = new Map<string, typeof components>();
  for (const component of components) {
    const group = byLine.get(component.saleReturnItemId) ?? [];
    group.push(component);
    byLine.set(component.saleReturnItemId, group);
  }
  const lines: ResolvedLine[] = rows.map((row, index) => ({
    lineNumber: index + 1,
    productId: row.productId,
    productName: row.productNameSnapshot,
    productSku: row.productSkuSnapshot,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    discountAmount: row.discountAmount,
    taxRate: row.taxRate,
    taxKind: row.taxKind,
    taxAmount: row.taxAmount,
    taxComponents: (byLine.get(row.id) ?? []).map(component => ({
      saleItemId: row.saleItemId,
      componentKey: component.componentKey,
      vatRateId: component.vatRateId,
      taxKind: component.taxKind,
      taxRate: component.taxRate,
      taxableAmount: component.taxableAmount,
      taxAmount: component.taxAmount,
      position: component.position,
    })),
    lineTotal: row.total,
    unitStandardCode: row.unitStandardCode,
  }));
  const appendAdjustment = (kind: 'tip' | 'service_charge', amount: number) => {
    if (amount <= 0) return;
    lines.push({
      lineNumber: lines.length + 1,
      productId: null,
      productName: kind === 'tip' ? 'Propina' : 'Cargo por servicio',
      productSku: null,
      quantity: 1,
      unitPrice: amount,
      discountAmount: 0,
      taxRate: 0,
      taxKind: 'iva',
      taxAmount: 0,
      taxComponents: [
        {
          componentKey: `return-adjustment:${kind}`,
          vatRateId: null,
          taxKind: 'iva',
          taxRate: 0,
          taxableAmount: amount,
          taxAmount: 0,
          position: 0,
        },
      ],
      lineTotal: amount,
      unitStandardCode: 'EA',
    });
  };
  appendAdjustment('tip', adjustments.tipAmount);
  appendAdjustment('service_charge', adjustments.serviceChargeAmount);
  return lines;
}

export interface FiscalMonetarySnapshot {
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
}

/**
 * Resolve the frozen amounts and lines for one fiscal source. Normalized
 * returns consume their own snapshot. Migration 0052 backfills every legacy
 * full-ticket return, so a return header without lines is incomplete evidence
 * and must never fall back to the original full sale (which could over-credit
 * a partial return).
 */
export async function resolveFiscalDocumentSnapshot(
  tx: DatabaseInstance,
  input: {
    tenantId: string;
    source: FiscalDocumentSource;
    sourceId: string;
    saleId: string;
    sale: FiscalMonetarySnapshot;
  }
): Promise<{ amounts: FiscalMonetarySnapshot; lines: ResolvedLine[] }> {
  if (input.source !== 'return') {
    return {
      amounts: input.sale,
      lines: await resolveLines(tx, input.tenantId, input.saleId),
    };
  }
  const header = await tx
    .select({
      subtotal: saleReturns.subtotal,
      tipAmount: saleReturns.tipAmount,
      serviceChargeAmount: saleReturns.serviceChargeAmount,
      taxAmount: saleReturns.taxAmount,
      discountAmount: saleReturns.discountAmount,
      total: saleReturns.refundAmount,
    })
    .from(saleReturns)
    .where(
      and(
        eq(saleReturns.tenantId, input.tenantId),
        eq(saleReturns.id, input.sourceId),
        eq(saleReturns.saleId, input.saleId)
      )
    )
    .get();
  if (!header) return { amounts: input.sale, lines: [] };
  const lines = await resolveReturnLines(tx, input.tenantId, input.sourceId, {
    tipAmount: header.tipAmount,
    serviceChargeAmount: header.serviceChargeAmount,
  });
  if (lines.length === 0) {
    return {
      amounts: {
        subtotal: header.subtotal,
        taxAmount: header.taxAmount,
        discountAmount: header.discountAmount,
        total: header.total,
      },
      lines: [],
    };
  }
  return {
    amounts: {
      // Reconstruct the tax-exclusive subtotal from the immutable normalized
      // lines. Newly written return headers already store this value, while
      // migrated restaurant returns retain the legacy header meaning where
      // tip and service charge lived only in their dedicated columns. Reading
      // the frozen lines keeps both generations reconcilable without rewriting
      // historical accounting evidence during migration.
      subtotal: lines.reduce((sum, line) => roundMoney(sum + line.lineTotal - line.taxAmount), 0),
      taxAmount: header.taxAmount,
      discountAmount: header.discountAmount,
      total: header.total,
    },
    lines,
  };
}
