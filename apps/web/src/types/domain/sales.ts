// sales domain shapes ( slice 28).

import type { PaymentMethod, PaymentStatus, SaleStatus, SyncStatus } from '../ui';
import type { Customer } from './customers';
import type { Product } from './products';

export interface Sale {
  id: string;
  tenantId: string;
  saleNumber: string;
  customerId?: string | null;
  customerName?: string | null;
  customerNameSnapshot?: string | null;
  siteNameSnapshot?: string | null;
  cashierNameSnapshot?: string | null;
  receiptIdentitySnapshotVersion?: number | null;
  companyNameSnapshot?: string | null;
  companyTaxIdSnapshot?: string | null;
  companyAddressSnapshot?: string | null;
  companyPhoneSnapshot?: string | null;
  companyEmailSnapshot?: string | null;
  customerTaxIdSnapshot?: string | null;
  customer?: Customer;
  items?: SaleItem[];
  payments?: SalePayment[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: SaleStatus;
  notes?: string | null;
  returnId?: string | null;
  returnReason?: string | null;
  refundAmount?: number | null;
  returnedAt?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus | null;
  syncVersion?: number | null;
}

export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  product?: Product;
  productName?: string | null;
  productSku?: string | null;
  productNameSnapshot?: string | null;
  productSkuSnapshot?: string | null;
  quantity: number;
  unitPrice: number;
  unitId?: string | null;
  unitEquivalence?: number;
  unitName?: string | null;
  unitAbbreviation?: string | null;
  discount: number;
  taxRate: number;
  taxKind?: 'iva' | 'inc';
  taxAmount: number;
  costAtSale?: number;
  total: number;
  serialNumbers?: string[] | undefined;
}

export interface SalePayment {
  id: string;
  method: PaymentMethod;
  amount: number;
  reference?: string | null;
  createdAt: string;
}
