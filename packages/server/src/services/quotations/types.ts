/**
 * Quotation service — type surface ( split).
 *
 * Public input/result shapes;  marks the explicit `| undefined`
 * on Zod-optional filter fields. Leaf module.
 *
 * @module services/quotations/types
 */
import { type QuotationStatus, type TaxKind } from '../../db/schema.js';
import type { PriceTier } from '@puntovivo/shared/price-tier';
import type { TaxComponentSnapshot } from '../tax-components.js';

export interface QuotationItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxComponents?: Array<{ vatRateId: string }> | undefined;
}

export interface CreateQuotationArgs {
  tenantId: string;
  siteId: string;
  customerId: string | null;
  priceTier: PriceTier;
  items: readonly QuotationItemInput[];
  validUntil: string | null;
  notes: string | null;
  createdBy: string;
  /**
   * Tenant pricing mode, resolved by the async caller (the create
   * function itself is a synchronous better-sqlite3 transaction).
   * Omitted means tax-inclusive, the historical behavior.
   */
  /**
   * REQUIRED: createQuotation is a synchronous transaction and cannot
   * resolve the tenant pricing mode itself, so every caller must resolve
   * it (resolvePricingSettings) and pass it explicitly - an optional
   * default here would turn a forgotten argument into a wrong-money bug.
   */
  priceIncludesTax: boolean;
  /** Country whose fiscal pack must represent every quoted combination. */
  countryCode: string;
}

export interface ResolvedQuotationLine {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxKind: TaxKind;
  taxAmount: number;
  taxComponents: TaxComponentSnapshot[];
  total: number;
}

export interface QuotationTotals {
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  rows: ResolvedQuotationLine[];
}

export interface CreatedQuotation {
  id: string;
  quotationNumber: string;
  status: QuotationStatus;
  fromSiteId: string;
  customerId: string | null;
  total: number;
  createdAt: string;
}

export interface UpdateQuotationStatusArgs {
  tenantId: string;
  quotationId: string;
  /**
   * `draft` is the entry state and cannot be set via the status API (only
   * `create` produces drafts). `converted` is reserved for the atomic sale
   * transaction and cannot be requested through the generic status API.
   */
  nextStatus: Exclude<QuotationStatus, 'draft' | 'converted'>;
  actorId: string;
}

export interface DeleteQuotationArgs {
  tenantId: string;
  quotationId: string;
  /**
   * The user requesting the delete; recorded against the audit row. The
   * current caller in the tRPC layer passes the authenticated user id.
   */
  actorId: string;
}

export interface QuotationListEntry {
  id: string;
  quotationNumber: string;
  status: QuotationStatus;
  customerId: string | null;
  customerName: string | null;
  priceTier: PriceTier;
  siteId: string;
  siteName: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  itemCount: number;
  validUntil: string | null;
  /**
   * Server-computed conversion eligibility. The client must not re-derive
   * this from its own clock — see services/quotations/eligibility.
   */
  convertible: boolean;
  createdAt: string;
  createdBy: string;
}

// explicit `| undefined` on Zod-optional filter fields.
export interface ListQuotationsOptions {
  limit?: number | undefined;
  status?: QuotationStatus | undefined;
  customerId?: string | undefined;
}

export interface QuotationDetailLine {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  unitId: string | null;
  unitEquivalence: number | null;
  unitName: string | null;
  unitAbbreviation: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxKind: TaxKind;
  taxAmount: number;
  taxComponents: TaxComponentSnapshot[];
  total: number;
  /** Current on-hand minus reserved quantity at the quotation's site. */
  availableStock: number;
  tracksStock: boolean | null;
  tracksSerials: boolean | null;
  sellByFraction: boolean | null;
  fractionStep: number | null;
  fractionMinimum: number | null;
}

export interface QuotationDetail {
  id: string;
  quotationNumber: string;
  status: QuotationStatus;
  customerId: string | null;
  customerName: string | null;
  priceTier: PriceTier;
  customerTaxId: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerCreditLimit: number | null;
  siteId: string;
  siteName: string;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  validUntil: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: string;
  createdByName: string | null;
  /** Server-computed conversion eligibility — see services/quotations/eligibility. */
  convertible: boolean;
  statusChangedAt: string | null;
  statusChangedBy: string | null;
  statusChangedByName: string | null;
  updatedAt: string;
  convertedSaleId: string | null;
  convertedSaleNumber: string | null;
  convertedAt: string | null;
  items: QuotationDetailLine[];
}
