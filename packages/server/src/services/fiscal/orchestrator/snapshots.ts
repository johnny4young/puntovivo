/**
 * Fiscal orchestrator — buyer + line snapshots (ENG-178 split).
 *
 * Materializes the buyer (customer or CONSUMIDOR_FINAL) + the sale lines at
 * emission time; the document freezes these (DIAN 165/2023 CUFE rule).
 * Tenant-scoped. Called BEFORE the write transaction in emit/enqueue.
 *
 * @module services/fiscal/orchestrator/snapshots
 */
import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../../db/index.js';
import { customers, fiscalIdentificationTypes, identificationTypes, products, saleItems } from '../../../db/schema.js';
import { CONSUMIDOR_FINAL } from '../cufe.js';
import type { ResolvedBuyer, ResolvedLine } from './types.js';
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
  // buyer_tax_id_type_code)` does not fail. ENG-176c — the orchestrator
  // emits DIAN documents (Colombia) today; multi-country support
  // arrives with ENG-156 / ENG-161 when the adapter routes carry the
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
      productName: products.name,
      productSku: products.sku,
      quantity: saleItems.quantity,
      unitPrice: saleItems.unitPrice,
      discount: saleItems.discount,
      taxRate: saleItems.taxRate,
      taxAmount: saleItems.taxAmount,
      total: saleItems.total,
    })
    .from(saleItems)
    .innerJoin(products, eq(saleItems.productId, products.id))
    .where(
      and(
        eq(saleItems.saleId, saleId),
        eq(products.tenantId, tenantId)
      )
    )
    .all();

  return rows.map((row, index) => ({
    lineNumber: index + 1,
    productId: row.productId,
    productName: row.productName ?? 'Unknown product',
    productSku: row.productSku,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    discountAmount: (row.unitPrice * row.quantity * (row.discount ?? 0)) / 100,
    taxRate: row.taxRate ?? 0,
    taxAmount: row.taxAmount ?? 0,
    lineTotal: row.total,
  }));
}
