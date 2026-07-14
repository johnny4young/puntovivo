/**
 * ENG-129b — Allowlist-only customer personal-data export.
 *
 * The document intentionally excludes tenant configuration, employee
 * identities, sync metadata, provider payloads, secrets, claim tokens and
 * internal retry state. Every included record is either the customer profile
 * itself or is directly linked to that customer through a tenant-scoped
 * parent query.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  auditLogs,
  customerLedgerEntries,
  customers,
  deliveryOrders,
  fiscalDocumentItems,
  fiscalDocuments,
  paymentOutbox,
  products,
  quotationItems,
  quotations,
  saleItems,
  salePayments,
  saleReturns,
  sales,
} from '../../db/schema.js';

export const CUSTOMER_PERSONAL_DATA_SCHEMA = 'puntovivo.customer-personal-data';
export const CUSTOMER_PERSONAL_DATA_SCHEMA_VERSION = 1;

function readNumber(value: Record<string, unknown> | null, key: string): number | null {
  const candidate = value?.[key];
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

function readNullableString(value: Record<string, unknown> | null, key: string): string | null {
  const candidate = value?.[key];
  return typeof candidate === 'string' ? candidate : null;
}

export function buildCustomerPersonalDataExport(
  db: DatabaseInstance,
  tenantId: string,
  customerId: string,
  generatedAt = new Date().toISOString()
) {
  const subject = db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      address: customers.address,
      city: customers.city,
      state: customers.state,
      postalCode: customers.postalCode,
      country: customers.country,
      taxId: customers.taxId,
      identificationTypeId: customers.identificationTypeId,
      personTypeId: customers.personTypeId,
      regimeTypeId: customers.regimeTypeId,
      clientTypeId: customers.clientTypeId,
      commercialActivityId: customers.commercialActivityId,
      notes: customers.notes,
      creditLimit: customers.creditLimit,
      creditLimitCurrencyCode: customers.creditLimitCurrencyCode,
      isActive: customers.isActive,
      createdAt: customers.createdAt,
      updatedAt: customers.updatedAt,
    })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)))
    .get();

  if (!subject) {
    return null;
  }

  const salesRecords = db
    .select({
      id: sales.id,
      saleNumber: sales.saleNumber,
      subtotal: sales.subtotal,
      taxAmount: sales.taxAmount,
      discountAmount: sales.discountAmount,
      tipAmount: sales.tipAmount,
      serviceChargeAmount: sales.serviceChargeAmount,
      total: sales.total,
      currencyCode: sales.currencyCode,
      exchangeRateAtSale: sales.exchangeRateAtSale,
      settleCurrencyCode: sales.settleCurrencyCode,
      paymentMethod: sales.paymentMethod,
      paymentStatus: sales.paymentStatus,
      status: sales.status,
      notes: sales.notes,
      checkoutStartedAt: sales.checkoutStartedAt,
      checkoutCompletedAt: sales.checkoutCompletedAt,
      createdAt: sales.createdAt,
      updatedAt: sales.updatedAt,
    })
    .from(sales)
    .where(and(eq(sales.tenantId, tenantId), eq(sales.customerId, customerId)))
    .orderBy(asc(sales.createdAt), asc(sales.id))
    .all();

  const saleItemRecords = db
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
      discount: saleItems.discount,
      taxRate: saleItems.taxRate,
      taxAmount: saleItems.taxAmount,
      total: saleItems.total,
      currencyCode: saleItems.currencyCode,
      exchangeRateAtSale: saleItems.exchangeRateAtSale,
      settleCurrencyCode: saleItems.settleCurrencyCode,
      notes: saleItems.notes,
    })
    .from(saleItems)
    .innerJoin(sales, and(eq(saleItems.saleId, sales.id), eq(sales.tenantId, tenantId)))
    .leftJoin(products, and(eq(saleItems.productId, products.id), eq(products.tenantId, tenantId)))
    .where(eq(sales.customerId, customerId))
    .orderBy(asc(sales.createdAt), asc(saleItems.id))
    .all();

  const salePaymentRecords = db
    .select({
      id: salePayments.id,
      saleId: salePayments.saleId,
      method: salePayments.method,
      amount: salePayments.amount,
      reference: salePayments.reference,
      createdAt: salePayments.createdAt,
    })
    .from(salePayments)
    .innerJoin(sales, and(eq(salePayments.saleId, sales.id), eq(sales.tenantId, tenantId)))
    .where(and(eq(salePayments.tenantId, tenantId), eq(sales.customerId, customerId)))
    .orderBy(asc(salePayments.createdAt), asc(salePayments.id))
    .all();

  const paymentProviderRecords = db
    .select({
      id: paymentOutbox.id,
      salePaymentId: paymentOutbox.salePaymentId,
      railId: paymentOutbox.railId,
      kind: paymentOutbox.kind,
      status: paymentOutbox.status,
      amount: paymentOutbox.amount,
      currencyCode: paymentOutbox.currencyCode,
      reference: paymentOutbox.reference,
      providerTransactionId: paymentOutbox.providerTransactionId,
      createdAt: paymentOutbox.createdAt,
      updatedAt: paymentOutbox.updatedAt,
    })
    .from(paymentOutbox)
    .innerJoin(
      salePayments,
      and(eq(paymentOutbox.salePaymentId, salePayments.id), eq(salePayments.tenantId, tenantId))
    )
    .innerJoin(sales, and(eq(salePayments.saleId, sales.id), eq(sales.tenantId, tenantId)))
    .where(and(eq(paymentOutbox.tenantId, tenantId), eq(sales.customerId, customerId)))
    .orderBy(asc(paymentOutbox.createdAt), asc(paymentOutbox.id))
    .all();

  const saleReturnRecords = db
    .select({
      id: saleReturns.id,
      saleId: saleReturns.saleId,
      refundAmount: saleReturns.refundAmount,
      reason: saleReturns.reason,
      createdAt: saleReturns.createdAt,
      updatedAt: saleReturns.updatedAt,
    })
    .from(saleReturns)
    .innerJoin(sales, and(eq(saleReturns.saleId, sales.id), eq(sales.tenantId, tenantId)))
    .where(and(eq(saleReturns.tenantId, tenantId), eq(sales.customerId, customerId)))
    .orderBy(asc(saleReturns.createdAt), asc(saleReturns.id))
    .all();

  const quotationRecords = db
    .select({
      id: quotations.id,
      quotationNumber: quotations.quotationNumber,
      status: quotations.status,
      subtotal: quotations.subtotal,
      taxAmount: quotations.taxAmount,
      discountAmount: quotations.discountAmount,
      total: quotations.total,
      currencyCode: quotations.currencyCode,
      exchangeRateAtSale: quotations.exchangeRateAtSale,
      settleCurrencyCode: quotations.settleCurrencyCode,
      validUntil: quotations.validUntil,
      notes: quotations.notes,
      createdAt: quotations.createdAt,
      updatedAt: quotations.updatedAt,
    })
    .from(quotations)
    .where(and(eq(quotations.tenantId, tenantId), eq(quotations.customerId, customerId)))
    .orderBy(asc(quotations.createdAt), asc(quotations.id))
    .all();

  const quotationItemRecords = db
    .select({
      id: quotationItems.id,
      quotationId: quotationItems.quotationId,
      productId: quotationItems.productId,
      productName: products.name,
      productSku: products.sku,
      quantity: quotationItems.quantity,
      unitPrice: quotationItems.unitPrice,
      discount: quotationItems.discount,
      taxRate: quotationItems.taxRate,
      taxAmount: quotationItems.taxAmount,
      total: quotationItems.total,
      currencyCode: quotationItems.currencyCode,
      exchangeRateAtSale: quotationItems.exchangeRateAtSale,
      settleCurrencyCode: quotationItems.settleCurrencyCode,
      createdAt: quotationItems.createdAt,
    })
    .from(quotationItems)
    .innerJoin(
      quotations,
      and(eq(quotationItems.quotationId, quotations.id), eq(quotations.tenantId, tenantId))
    )
    .leftJoin(
      products,
      and(eq(quotationItems.productId, products.id), eq(products.tenantId, tenantId))
    )
    .where(eq(quotations.customerId, customerId))
    .orderBy(asc(quotations.createdAt), asc(quotationItems.id))
    .all();

  const ledgerRecords = db
    .select({
      id: customerLedgerEntries.id,
      occurredAt: customerLedgerEntries.occurredAt,
      kind: customerLedgerEntries.kind,
      amount: customerLedgerEntries.amount,
      referenceSaleId: customerLedgerEntries.referenceSaleId,
      note: customerLedgerEntries.note,
      createdAt: customerLedgerEntries.createdAt,
    })
    .from(customerLedgerEntries)
    .where(
      and(
        eq(customerLedgerEntries.tenantId, tenantId),
        eq(customerLedgerEntries.customerId, customerId)
      )
    )
    .orderBy(asc(customerLedgerEntries.occurredAt), asc(customerLedgerEntries.id))
    .all();

  const deliveryRecords = db
    .select({
      id: deliveryOrders.id,
      customerName: deliveryOrders.customerName,
      customerPhone: deliveryOrders.customerPhone,
      address: deliveryOrders.address,
      addressNotes: deliveryOrders.addressNotes,
      status: deliveryOrders.status,
      totalAmount: deliveryOrders.totalAmount,
      itemsSnapshot: deliveryOrders.itemsSnapshot,
      saleId: deliveryOrders.saleId,
      acceptedAt: deliveryOrders.acceptedAt,
      preparingAt: deliveryOrders.preparingAt,
      dispatchedAt: deliveryOrders.dispatchedAt,
      deliveredAt: deliveryOrders.deliveredAt,
      cancelledAt: deliveryOrders.cancelledAt,
      createdAt: deliveryOrders.createdAt,
      updatedAt: deliveryOrders.updatedAt,
    })
    .from(deliveryOrders)
    .where(and(eq(deliveryOrders.tenantId, tenantId), eq(deliveryOrders.customerId, customerId)))
    .orderBy(asc(deliveryOrders.acceptedAt), asc(deliveryOrders.id))
    .all();

  const fiscalDocumentRecords = db
    .select({
      id: fiscalDocuments.id,
      source: fiscalDocuments.source,
      sourceId: fiscalDocuments.sourceId,
      kind: fiscalDocuments.kind,
      documentNumber: fiscalDocuments.documentNumber,
      cufe: fiscalDocuments.cufe,
      status: fiscalDocuments.status,
      buyerTaxId: fiscalDocuments.buyerTaxId,
      buyerCountryCode: fiscalDocuments.buyerCountryCode,
      buyerTaxIdTypeCode: fiscalDocuments.buyerTaxIdTypeCode,
      buyerName: fiscalDocuments.buyerName,
      buyerEmail: fiscalDocuments.buyerEmail,
      buyerAddress: fiscalDocuments.buyerAddress,
      buyerCity: fiscalDocuments.buyerCity,
      buyerDepartment: fiscalDocuments.buyerDepartment,
      buyerCountry: fiscalDocuments.buyerCountry,
      subtotal: fiscalDocuments.subtotal,
      taxAmount: fiscalDocuments.taxAmount,
      discountAmount: fiscalDocuments.discountAmount,
      totalAmount: fiscalDocuments.totalAmount,
      currencyCode: fiscalDocuments.currencyCode,
      localeCode: fiscalDocuments.localeCode,
      originalCufe: fiscalDocuments.originalCufe,
      reasonCode: fiscalDocuments.reasonCode,
      emittedAt: fiscalDocuments.emittedAt,
      updatedAt: fiscalDocuments.updatedAt,
    })
    .from(fiscalDocuments)
    .where(and(eq(fiscalDocuments.tenantId, tenantId), eq(fiscalDocuments.customerId, customerId)))
    .orderBy(asc(fiscalDocuments.emittedAt), asc(fiscalDocuments.id))
    .all();

  const fiscalItemRecords = db
    .select({
      id: fiscalDocumentItems.id,
      fiscalDocumentId: fiscalDocumentItems.fiscalDocumentId,
      lineNumber: fiscalDocumentItems.lineNumber,
      productId: fiscalDocumentItems.productId,
      productName: fiscalDocumentItems.productName,
      productSku: fiscalDocumentItems.productSku,
      unitMeasureCode: fiscalDocumentItems.unitMeasureCode,
      quantity: fiscalDocumentItems.quantity,
      unitPrice: fiscalDocumentItems.unitPrice,
      discountAmount: fiscalDocumentItems.discountAmount,
      taxRate: fiscalDocumentItems.taxRate,
      taxAmount: fiscalDocumentItems.taxAmount,
      taxCategoryCode: fiscalDocumentItems.taxCategoryCode,
      lineTotal: fiscalDocumentItems.lineTotal,
    })
    .from(fiscalDocumentItems)
    .innerJoin(
      fiscalDocuments,
      and(
        eq(fiscalDocumentItems.fiscalDocumentId, fiscalDocuments.id),
        eq(fiscalDocuments.tenantId, tenantId)
      )
    )
    .where(eq(fiscalDocuments.customerId, customerId))
    .orderBy(asc(fiscalDocuments.emittedAt), asc(fiscalDocumentItems.lineNumber))
    .all();

  const auditRecords = db
    .select({
      action: auditLogs.action,
      before: auditLogs.before,
      after: auditLogs.after,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.tenantId, tenantId),
        eq(auditLogs.resourceType, 'customer'),
        eq(auditLogs.resourceId, customerId)
      )
    )
    .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id))
    .all()
    .map(record => ({
      action: record.action,
      createdAt: record.createdAt,
      details: {
        creditLimitBefore: readNumber(record.before, 'creditLimit'),
        creditLimitAfter: readNumber(record.after, 'creditLimit'),
        customerNameAtEvent: readNullableString(record.metadata, 'customerName'),
        customerEmailAtEvent: readNullableString(record.metadata, 'customerEmail'),
      },
    }));

  return {
    schema: CUSTOMER_PERSONAL_DATA_SCHEMA,
    schemaVersion: CUSTOMER_PERSONAL_DATA_SCHEMA_VERSION,
    generatedAt,
    subject,
    records: {
      sales: salesRecords,
      saleItems: saleItemRecords,
      salePayments: salePaymentRecords,
      paymentProviderTransactions: paymentProviderRecords,
      saleReturns: saleReturnRecords,
      quotations: quotationRecords,
      quotationItems: quotationItemRecords,
      ledgerEntries: ledgerRecords,
      deliveryOrders: deliveryRecords,
      fiscalDocuments: fiscalDocumentRecords,
      fiscalDocumentItems: fiscalItemRecords,
      customerAuditEvents: auditRecords,
    },
  };
}

export type CustomerPersonalDataExport = NonNullable<
  ReturnType<typeof buildCustomerPersonalDataExport>
>;

export function getCustomerPersonalDataRecordCounts(document: CustomerPersonalDataExport) {
  return Object.fromEntries(
    Object.entries(document.records).map(([section, records]) => [section, records.length])
  );
}
