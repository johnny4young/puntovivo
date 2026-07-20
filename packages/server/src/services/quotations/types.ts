/**
 * Quotation service — type surface ( split).
 *
 * Public input/result shapes;  marks the explicit `| undefined`
 * on Zod-optional filter fields. Leaf module.
 *
 * @module services/quotations/types
 */
import { type QuotationStatus } from '../../db/schema.js';

export interface QuotationItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
}

export interface CreateQuotationArgs {
  tenantId: string;
  siteId: string;
  customerId: string | null;
  items: readonly QuotationItemInput[];
  validUntil: string | null;
  notes: string | null;
  createdBy: string;
}

export interface ResolvedQuotationLine {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
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
   * `create` produces drafts). Every other status — including `converted` —
   * may be requested, and the ALLOWED_TRANSITIONS map validates against the
   * current status.
   */
  nextStatus: Exclude<QuotationStatus, 'draft'>;
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
  siteId: string;
  siteName: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  itemCount: number;
  validUntil: string | null;
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
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

export interface QuotationDetail {
  id: string;
  quotationNumber: string;
  status: QuotationStatus;
  customerId: string | null;
  customerName: string | null;
  customerTaxId: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
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
  statusChangedAt: string | null;
  statusChangedBy: string | null;
  statusChangedByName: string | null;
  updatedAt: string;
  items: QuotationDetailLine[];
}
