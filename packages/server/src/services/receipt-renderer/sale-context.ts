/**
 * Runtime sale-receipt context.
 *
 * Resolves the active tenant template plus the sale read model, current
 * company/site metadata, and immutable fiscal snapshots for both system HTML
 * and ESC/POS printing. Keeping this read model server-side prevents the editor
 * preview, server printer, and hub-client printer from drifting into three
 * independent receipt implementations.
 *
 * @module services/receipt-renderer/sale-context
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  cashSessions,
  companies,
  countryCatalog,
  currencyCatalog,
  customers,
  fiscalDocumentItems,
  fiscalDocumentItemTaxComponents,
  fiscalDocuments,
  sites,
  users,
  type FiscalDocumentStatus,
} from '../../db/schema.js';
import type { getSaleRecord, SaleFiscalDocumentRow } from '../../application/sales/sale-read.js';
import { receiptLayoutSchema } from '../../trpc/schemas/receiptTemplates.js';
import type { FiscalAdapterMaturity } from '../fiscal/adapter.js';
import type { EscPosCharset } from '../peripherals/escpos/byte-builder.js';
import { listReceiptTemplates, type ReceiptTemplateRecord } from '../receipt-templates/index.js';
import { resolveTenantLocale } from '../tenant-locale.js';
import type { ReceiptRenderLabels, RenderData, RenderFiscal } from './types.js';
import { renderReceipt } from './render.js';
import { renderReceiptPlainText } from './plain-text.js';
import { summarizeItemTaxBreakdown } from './tax-breakdown.js';

type RuntimeSale = Awaited<ReturnType<typeof getSaleRecord>>;

const STATUS_LABELS: Record<'en' | 'es', Record<FiscalDocumentStatus, string>> = {
  en: {
    pending: 'Pending',
    sent: 'Sent',
    accepted: 'Accepted',
    rejected: 'Rejected',
    contingency: 'Contingency',
    voided: 'Voided',
    notified_correction: 'Correction notified',
    partial_send: 'Partially sent',
  },
  es: {
    pending: 'Pendiente',
    sent: 'Enviado',
    accepted: 'Aceptado',
    rejected: 'Rechazado',
    contingency: 'Contingencia',
    voided: 'Anulado',
    notified_correction: 'Corrección notificada',
    partial_send: 'Enviado parcialmente',
  },
};

const RECEIPT_LABELS: Record<'en' | 'es', ReceiptRenderLabels> = {
  en: {
    documentTitle: 'Receipt',
    itemColumns: {
      name: 'Item',
      qty: 'Qty',
      unitPrice: 'Price',
      taxPercent: 'Tax %',
      discount: 'Discount',
      total: 'Total',
    },
    totalsLines: {
      subtotal: 'Subtotal',
      discount: 'Discount',
      taxTotal: 'Tax',
      taxIva: 'IVA',
      taxInc: 'INC',
      tip: 'Tip',
      serviceCharge: 'Service',
      grandTotal: 'Total',
    },
    tendersTable: {
      method: 'Method',
      reference: 'Reference',
      amount: 'Amount',
      change: 'Change',
      methods: {
        cash: 'Cash',
        card: 'Card',
        transfer: 'Transfer',
        credit: 'Credit',
        other: 'Other',
      },
    },
  },
  es: {
    documentTitle: 'Recibo',
    itemColumns: {
      name: 'Ítem',
      qty: 'Cant.',
      unitPrice: 'Precio',
      taxPercent: 'Imp. %',
      discount: 'Descuento',
      total: 'Total',
    },
    totalsLines: {
      subtotal: 'Subtotal',
      discount: 'Descuento',
      taxTotal: 'Impuesto',
      taxIva: 'IVA',
      taxInc: 'INC',
      tip: 'Propina',
      serviceCharge: 'Servicio',
      grandTotal: 'Total',
    },
    tendersTable: {
      method: 'Método',
      reference: 'Referencia',
      amount: 'Monto',
      change: 'Cambio',
      methods: {
        cash: 'Efectivo',
        card: 'Tarjeta',
        transfer: 'Transferencia',
        credit: 'Crédito',
        other: 'Otro',
      },
    },
  },
};

function supportedLanguage(language: string): 'en' | 'es' {
  return language === 'es' ? 'es' : 'en';
}

function fiscalAuthority(countryCode: string): string {
  if (countryCode === 'CO') return 'DIAN';
  if (countryCode === 'MX') return 'SAT';
  if (countryCode === 'CL') return 'SII';
  return countryCode;
}

function isPlaceholderIdentifier(value: string): boolean {
  return value.startsWith('pending-');
}

function languageFromLocale(locale: string): 'en' | 'es' {
  return supportedLanguage(locale.split(/[-_]/, 1)[0]?.toLowerCase() ?? 'en');
}

function countryFromLocale(locale: string): string | null {
  return locale.match(/[-_]([A-Za-z]{2})(?:[-_]|$)/)?.[1]?.toUpperCase() ?? null;
}

export function localizeRenderFiscal(
  document: SaleFiscalDocumentRow,
  language: string
): RenderFiscal {
  const lang = supportedLanguage(language);
  const authority = fiscalAuthority(document.countryCode);
  const maturityLabels: Record<'en' | 'es', Record<FiscalAdapterMaturity, string>> = {
    en: { mock: 'Demo only', draft: 'Unsigned draft', certified: 'Certified' },
    es: { mock: 'Solo demostración', draft: 'Borrador sin firma', certified: 'Certificado' },
  };
  const notices: Record<
    'en' | 'es',
    Record<Exclude<FiscalAdapterMaturity, 'certified'>, string>
  > = {
    en: {
      mock: `Demo only — this document was not transmitted to ${authority} and cannot be verified there.`,
      draft: `Unsigned draft — this document was not transmitted to ${authority} and cannot be verified there.`,
    },
    es: {
      mock: `Solo demostración — este documento no se transmitió a ${authority} y no puede verificarse allí.`,
      draft: `Borrador sin firma — este documento no se transmitió a ${authority} y no puede verificarse allí.`,
    },
  };
  const evidenceLabels =
    lang === 'es'
      ? {
          document: 'Documento',
          status: 'Estado',
          maturity: 'Modo fiscal',
          resolution: 'Resolución',
          identifier: 'Identificador fiscal local',
        }
      : {
          document: 'Document',
          status: 'Status',
          maturity: 'Fiscal mode',
          resolution: 'Resolution',
          identifier: 'Local fiscal identifier',
        };

  return {
    cufe: isPlaceholderIdentifier(document.cufe) ? null : document.cufe,
    qrUrl: document.maturity === 'certified' ? document.qrPayload : null,
    resolution: document.resolution,
    documentNumber: document.documentNumber,
    status: document.status,
    statusLabel: STATUS_LABELS[lang][document.status],
    maturity: document.maturity,
    maturityLabel: maturityLabels[lang][document.maturity],
    nonCertifiedNotice: document.maturity === 'certified' ? null : notices[lang][document.maturity],
    countryCode: document.countryCode,
    evidenceLabels,
  };
}

function selectTemplate(
  db: DatabaseInstance,
  tenantId: string,
  hasFiscalDocuments: boolean
): ReceiptTemplateRecord | null {
  const preferredKind = hasFiscalDocuments ? 'fiscal_dee' : 'sale';
  const preferred = listReceiptTemplates(db, tenantId, {
    kind: preferredKind,
    includeInactive: false,
  })[0];
  if (preferred) return preferred;
  if (preferredKind !== 'sale') {
    return (
      listReceiptTemplates(db, tenantId, {
        kind: 'sale',
        includeInactive: false,
      })[0] ?? null
    );
  }
  return null;
}

/**
 * Resolve the immutable ordinary-sale template when the completion row carries
 * the presentation contract. `undefined` means the sale predates presentation
 * snapshots (or is fiscal and follows the fiscal-document path); `null` means
 * the sale deliberately had no active template and must retain legacy output.
 */
function selectOrdinaryTemplateSnapshot(
  sale: RuntimeSale
): ReceiptTemplateRecord | null | undefined {
  if (sale.fiscalDocuments.length > 0 || (sale.receiptPresentationSnapshotVersion ?? 0) < 1) {
    return undefined;
  }

  const hasAnyTemplateField =
    sale.receiptTemplateIdSnapshot !== null ||
    sale.receiptTemplateKindSnapshot !== null ||
    sale.receiptTemplateNameSnapshot !== null ||
    sale.receiptTemplateLayoutSnapshot !== null;
  if (!hasAnyTemplateField) return null;

  const parsedLayout = receiptLayoutSchema.safeParse(sale.receiptTemplateLayoutSnapshot);
  if (
    !sale.receiptTemplateIdSnapshot ||
    sale.receiptTemplateKindSnapshot !== 'sale' ||
    !sale.receiptTemplateNameSnapshot ||
    !parsedLayout.success
  ) {
    throw new Error(`Invalid receipt presentation snapshot for sale ${sale.id}`);
  }

  return {
    id: sale.receiptTemplateIdSnapshot,
    tenantId: sale.tenantId,
    kind: sale.receiptTemplateKindSnapshot,
    name: sale.receiptTemplateNameSnapshot,
    paperWidth: parsedLayout.data.paperWidth,
    layout: parsedLayout.data,
    isDefault: true,
    isActive: true,
    createdBy: sale.createdBy,
    updatedBy: null,
    createdAt: sale.createdAt,
    updatedAt: sale.createdAt,
  };
}

async function loadPrimaryFiscalSnapshot(
  db: DatabaseInstance,
  tenantId: string,
  documents: SaleFiscalDocumentRow[]
) {
  const primary = documents.find(document => document.source === 'sale') ?? documents[0];
  if (!primary) return null;

  const header = await db
    .select({
      id: fiscalDocuments.id,
      buyerName: fiscalDocuments.buyerName,
      buyerTaxId: fiscalDocuments.buyerTaxId,
      subtotal: fiscalDocuments.subtotal,
      taxAmount: fiscalDocuments.taxAmount,
      discountAmount: fiscalDocuments.discountAmount,
      totalAmount: fiscalDocuments.totalAmount,
      currencyCode: fiscalDocuments.currencyCode,
      localeCode: fiscalDocuments.localeCode,
      emittedAt: fiscalDocuments.emittedAt,
    })
    .from(fiscalDocuments)
    .where(and(eq(fiscalDocuments.id, primary.id), eq(fiscalDocuments.tenantId, tenantId)))
    .get();
  if (!header) return null;

  const items = await db
    .select({
      id: fiscalDocumentItems.id,
      productName: fiscalDocumentItems.productName,
      productSku: fiscalDocumentItems.productSku,
      quantity: fiscalDocumentItems.quantity,
      unitPrice: fiscalDocumentItems.unitPrice,
      discountAmount: fiscalDocumentItems.discountAmount,
      taxRate: fiscalDocumentItems.taxRate,
      taxAmount: fiscalDocumentItems.taxAmount,
      taxCategoryCode: fiscalDocumentItems.taxCategoryCode,
      lineTotal: fiscalDocumentItems.lineTotal,
    })
    .from(fiscalDocumentItems)
    .where(eq(fiscalDocumentItems.fiscalDocumentId, header.id))
    .orderBy(asc(fiscalDocumentItems.lineNumber))
    .all();

  const componentRows =
    items.length === 0
      ? []
      : await db
          .select({
            fiscalDocumentItemId: fiscalDocumentItemTaxComponents.fiscalDocumentItemId,
            taxKind: fiscalDocumentItemTaxComponents.taxKind,
            taxAmount: fiscalDocumentItemTaxComponents.taxAmount,
            position: fiscalDocumentItemTaxComponents.position,
          })
          .from(fiscalDocumentItemTaxComponents)
          .where(
            and(
              eq(fiscalDocumentItemTaxComponents.tenantId, tenantId),
              inArray(
                fiscalDocumentItemTaxComponents.fiscalDocumentItemId,
                items.map(item => item.id)
              )
            )
          )
          .orderBy(
            fiscalDocumentItemTaxComponents.fiscalDocumentItemId,
            fiscalDocumentItemTaxComponents.position
          )
          .all();
  const componentsByItem = new Map<string, typeof componentRows>();
  for (const component of componentRows) {
    const group = componentsByItem.get(component.fiscalDocumentItemId) ?? [];
    group.push(component);
    componentsByItem.set(component.fiscalDocumentItemId, group);
  }
  const itemsWithComponents = items.map(item => ({
    ...item,
    taxComponents: componentsByItem.get(item.id) ?? [
      {
        taxKind: item.taxCategoryCode === '04' ? ('inc' as const) : ('iva' as const),
        taxAmount: item.taxAmount,
      },
    ],
  }));

  return { header, items: itemsWithComponents };
}

export interface SaleReceiptTemplateContext {
  template: ReceiptTemplateRecord;
  data: RenderData;
  labels: ReceiptRenderLabels;
}

export function renderSaleReceiptTemplate(
  context: SaleReceiptTemplateContext,
  options: {
    paperWidth?: '58mm' | '80mm';
    characterSet?: EscPosCharset;
    kickDrawer?: boolean;
  } = {}
) {
  const layout = options.paperWidth
    ? { ...context.template.layout, paperWidth: options.paperWidth }
    : context.template.layout;
  const rendered = renderReceipt(
    layout,
    context.data,
    context.labels,
    options.characterSet ? { characterSet: options.characterSet } : {}
  );
  if (!options.kickDrawer) return rendered;

  // ESC p 0 25 250 belongs before the final GS V 0 cut command. The
  // declarative renderer always emits that three-byte cut suffix.
  const cutOffset = Math.max(0, rendered.escpos.length - 3);
  const escpos = new Uint8Array(rendered.escpos.length + 5);
  escpos.set(rendered.escpos.subarray(0, cutOffset), 0);
  escpos.set([0x1b, 0x70, 0x00, 0x19, 0xfa], cutOffset);
  escpos.set(rendered.escpos.subarray(cutOffset), cutOffset + 5);
  return { ...rendered, escpos };
}

/** Customer-facing HTML and text from the exact same sale-time context. */
export function renderSaleReceiptShare(context: SaleReceiptTemplateContext) {
  const rendered = renderSaleReceiptTemplate(context);
  return {
    html: rendered.html,
    text: renderReceiptPlainText(context.template.layout, context.data, context.labels),
    locale: context.data.locale?.locale ?? 'en',
  };
}

export async function resolveSaleReceiptTemplateContext(args: {
  db: DatabaseInstance;
  tenantId: string;
  fallbackSiteId: string;
  sale: RuntimeSale;
}): Promise<SaleReceiptTemplateContext | null> {
  const { db, tenantId, sale } = args;
  const ordinaryTemplateSnapshot = selectOrdinaryTemplateSnapshot(sale);
  const template =
    ordinaryTemplateSnapshot !== undefined
      ? ordinaryTemplateSnapshot
      : selectTemplate(db, tenantId, sale.fiscalDocuments.length > 0);
  if (!template) return null;

  const session = sale.cashSessionId
    ? await db
        .select({ siteId: cashSessions.siteId })
        .from(cashSessions)
        .where(and(eq(cashSessions.id, sale.cashSessionId), eq(cashSessions.tenantId, tenantId)))
        .get()
    : null;
  const saleSiteId = session?.siteId ?? args.fallbackSiteId;
  const siteCompany = await db
    .select({
      siteName: sites.name,
      companyName: companies.name,
      companyTaxId: companies.taxId,
      companyAddress: companies.address,
      companyPhone: companies.phone,
      companyEmail: companies.email,
      companyLogoUrl: companies.logoUrl,
    })
    .from(sites)
    .innerJoin(companies, and(eq(companies.id, sites.companyId), eq(companies.tenantId, tenantId)))
    .where(and(eq(sites.id, saleSiteId), eq(sites.tenantId, tenantId)))
    .get();
  if (!siteCompany) return null;

  const [cashier, customer, tenantLocale, fiscalSnapshot] = await Promise.all([
    db
      .select({ name: users.name })
      .from(users)
      .where(and(eq(users.id, sale.createdBy), eq(users.tenantId, tenantId)))
      .get(),
    sale.customerId
      ? db
          .select({ taxId: customers.taxId })
          .from(customers)
          .where(and(eq(customers.id, sale.customerId), eq(customers.tenantId, tenantId)))
          .get()
      : Promise.resolve(undefined),
    resolveTenantLocale(db, tenantId),
    loadPrimaryFiscalSnapshot(db, tenantId, sale.fiscalDocuments),
  ]);

  const hasOrdinaryPresentationSnapshot =
    sale.fiscalDocuments.length === 0 && (sale.receiptPresentationSnapshotVersion ?? 0) >= 1;
  if (hasOrdinaryPresentationSnapshot && !sale.receiptLocaleSnapshot) {
    throw new Error(`Missing receipt locale snapshot for sale ${sale.id}`);
  }
  const receiptLocaleCode =
    fiscalSnapshot?.header.localeCode ??
    (hasOrdinaryPresentationSnapshot ? sale.receiptLocaleSnapshot! : tenantLocale.locale);
  const receiptLanguage = languageFromLocale(receiptLocaleCode);
  const receiptCurrencyCode = fiscalSnapshot?.header.currencyCode ?? sale.currencyCode;
  const receiptCountryCode = countryFromLocale(receiptLocaleCode);
  const [saleCurrency, receiptCountry] = await Promise.all([
    db
      .select({
        legalDecimals: currencyCatalog.decimals,
        displayDecimals: currencyCatalog.displayDecimals,
      })
      .from(currencyCatalog)
      .where(eq(currencyCatalog.code, receiptCurrencyCode))
      .get(),
    receiptCountryCode
      ? db
          .select({ dateFormatShort: countryCatalog.dateFormatShort })
          .from(countryCatalog)
          .where(eq(countryCatalog.code, receiptCountryCode))
          .get()
      : Promise.resolve(undefined),
  ]);
  const renderFiscalDocuments = sale.fiscalDocuments.map(document =>
    localizeRenderFiscal(document, receiptLanguage)
  );
  const primaryFiscalRow =
    sale.fiscalDocuments.find(document => document.source === 'sale') ?? sale.fiscalDocuments[0];
  const primaryFiscal = primaryFiscalRow
    ? localizeRenderFiscal(primaryFiscalRow, receiptLanguage)
    : null;
  const tenderTotal = sale.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const receiptItems = fiscalSnapshot
    ? fiscalSnapshot.items.map(item => {
        const grossAmount = item.quantity * item.unitPrice;
        return {
          name: item.productName,
          sku: item.productSku,
          qty: item.quantity,
          unitPrice: item.unitPrice,
          taxPercent: item.taxRate,
          discount: grossAmount > 0 ? (item.discountAmount / grossAmount) * 100 : 0,
          total: item.lineTotal,
        };
      })
    : sale.items.map(item => ({
        name:
          item.productNameSnapshot ??
          item.productName ??
          item.productSkuSnapshot ??
          item.productSku ??
          '—',
        sku: item.productSkuSnapshot ?? item.productSku,
        qty: item.quantity,
        unitPrice: item.unitPrice,
        taxPercent: item.taxRate,
        discount: item.discount,
        total: item.total,
      }));
  const receiptHeader = fiscalSnapshot?.header;
  const taxBreakdown = fiscalSnapshot
    ? summarizeItemTaxBreakdown(fiscalSnapshot.items)
    : summarizeItemTaxBreakdown(sale.items);
  const hasReceiptIdentitySnapshot = (sale.receiptIdentitySnapshotVersion ?? 0) >= 1;
  const data: RenderData = {
    company: {
      name: hasReceiptIdentitySnapshot ? (sale.companyNameSnapshot ?? '') : siteCompany.companyName,
      taxId: hasReceiptIdentitySnapshot
        ? (sale.companyTaxIdSnapshot ?? '')
        : (siteCompany.companyTaxId ?? ''),
      address: hasReceiptIdentitySnapshot
        ? sale.companyAddressSnapshot
        : siteCompany.companyAddress,
      phone: hasReceiptIdentitySnapshot ? sale.companyPhoneSnapshot : siteCompany.companyPhone,
      email: hasReceiptIdentitySnapshot ? sale.companyEmailSnapshot : siteCompany.companyEmail,
      city: null,
    },
    sale: {
      saleNumber: sale.saleNumber,
      cashier: sale.cashierNameSnapshot ?? cashier?.name ?? null,
      site: sale.siteNameSnapshot ?? siteCompany.siteName,
      customer: receiptHeader?.buyerName ?? sale.customerNameSnapshot ?? sale.customerName,
      customerTaxId:
        receiptHeader?.buyerTaxId ??
        (hasReceiptIdentitySnapshot ? sale.customerTaxIdSnapshot : (customer?.taxId ?? null)),
      createdAt: receiptHeader?.emittedAt ?? sale.createdAt,
      subtotal: receiptHeader?.subtotal ?? sale.subtotal,
      discount: receiptHeader?.discountAmount ?? sale.discountAmount,
      taxTotal: receiptHeader?.taxAmount ?? sale.taxAmount,
      taxBreakdown,
      tip: sale.tipAmount,
      serviceCharge: sale.serviceChargeAmount,
      serviceChargeRate: sale.serviceChargeRate,
      grandTotal: receiptHeader?.totalAmount ?? sale.total,
      changeDue: Math.max(0, tenderTotal - sale.total),
      notes: sale.notes,
      items: receiptItems,
      tenders: sale.payments.map(payment => ({
        method: payment.method,
        amount: payment.amount,
        reference: payment.reference,
      })),
    },
    ...(primaryFiscal ? { fiscal: primaryFiscal } : {}),
    fiscalDocuments: renderFiscalDocuments,
    logoDataUrl: hasOrdinaryPresentationSnapshot
      ? sale.receiptLogoUrlSnapshot
      : siteCompany.companyLogoUrl,
    locale: {
      locale: receiptLocaleCode,
      currency: receiptCurrencyCode,
      legalDecimals: saleCurrency?.legalDecimals ?? tenantLocale.legalDecimals,
      displayDecimals: saleCurrency?.displayDecimals ?? tenantLocale.displayDecimals,
      dateFormat: receiptCountry?.dateFormatShort ?? tenantLocale.dateFormatShort,
    },
  };

  return {
    template,
    data,
    labels: RECEIPT_LABELS[receiptLanguage],
  };
}
