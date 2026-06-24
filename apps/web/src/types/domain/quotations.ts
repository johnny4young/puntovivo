// ENG-179c — quotation domain shapes (ENG-178 slice 28).

import type { QuotationStatus } from '../ui';

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
