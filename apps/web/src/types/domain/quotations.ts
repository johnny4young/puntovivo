// quotation domain shapes ( slice 28).

import type { QuotationStatus } from '../ui';

export interface QuotationListEntry {
  id: string;
  quotationNumber: string;
  status: QuotationStatus;
  customerId: string | null;
  customerName: string | null;
  priceTier: 1 | 2 | 3;
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
  taxKind: 'iva' | 'inc';
  taxAmount: number;
  taxComponents?: Array<{
    componentKey: string;
    vatRateId: string | null;
    taxKind: 'iva' | 'inc';
    taxRate: number;
    taxableAmount: number;
    taxAmount: number;
    position: number;
  }>;
  total: number;
}

export interface QuotationDetail {
  id: string;
  quotationNumber: string;
  status: QuotationStatus;
  customerId: string | null;
  customerName: string | null;
  priceTier: 1 | 2 | 3;
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
