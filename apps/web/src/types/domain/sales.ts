// sales domain shapes ( slice 28).

import type { PaymentMethod, PaymentStatus, ReturnState, SaleStatus, SyncStatus } from '../ui';
import type { Customer } from './customers';
import type { Product } from './products';

export interface Sale {
  id: string;
  tenantId: string;
  saleNumber: string;
  currencyCode?: string;
  customerId?: string | null;
  /** Catalog tier frozen for this ticket, independent from the customer's current default. */
  priceTier?: 1 | 2 | 3;
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
  /** Return axis, separate from collection state. Null until returned. */
  returnState: ReturnState;
  status: SaleStatus;
  notes?: string | null;
  returnId?: string | null;
  returnReason?: string | null;
  refundAmount?: number | null;
  returnedAt?: string | null;
  returnedAmount?: number;
  returnableAmount?: number;
  returns?: SaleReturn[];
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
  /** Operator-entered discount before promotion snapshots are layered on. */
  manualDiscountRate?: number | null;
  promotionDiscountAmount?: number;
  promotions?: Array<{
    id: string;
    promotionId: string;
    promotionVersion: number;
    nameSnapshot: string;
    discountPct: number;
    discountAmount: number;
    priority: number;
    combinable: boolean;
    position: number;
    source: 'manual' | 'expiry';
    sourceLotId: string | null;
  }>;
  taxRate: number;
  taxKind?: 'iva' | 'inc';
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
  costAtSale?: number;
  total: number;
  serialNumbers?: string[] | undefined;
  returnedQuantity?: number;
  remainingQuantity?: number;
  returnedAmount?: number;
  returnableAmount?: number;
  lots?: SaleItemLotProvenance[];
  serials?: SaleItemSerialProvenance[];
}

export interface SalePayment {
  id: string;
  method: PaymentMethod;
  amount: number;
  loyaltyPoints?: number | null;
  reference?: string | null;
  createdAt: string;
  returnedAmount?: number;
  remainingAmount?: number;
}

export interface SaleItemLotProvenance {
  id: string;
  saleItemId: string;
  lotId: string;
  lotNumber: string;
  expiresAt: string | null;
  status: string;
  quantity: number;
  unitCost: number;
  returnedQuantity: number;
  remainingQuantity: number;
}

export interface SaleItemSerialProvenance {
  id: string;
  saleItemId: string;
  productSerialId: string;
  serialNumber: string;
  currentStatus: string;
  returned: boolean;
}

export interface SaleReturnPaymentAllocation {
  id: string;
  saleReturnId: string;
  salePaymentId: string | null;
  originalMethod: PaymentMethod;
  destination: 'cash' | 'receivable' | 'external' | 'loyalty' | 'store_credit';
  amount: number;
  loyaltyPoints?: number | null;
  externalReference: string | null;
  createdAt: string;
}

export interface SaleReturnItem {
  id: string;
  saleReturnId: string;
  saleItemId: string;
  productId: string;
  /**
   * Null for a return migrated from before returns were normalized: the sale
   * never recorded a sale-time snapshot and the migration refuses to invent
   * one from the current catalog. Render it as unknown provenance.
   */
  productNameSnapshot: string | null;
  productSkuSnapshot: string | null;
  quantity: number;
  baseQuantity: number;
  unitPrice: number;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  serials: Array<{ id: string; serialNumber: string }>;
  lots: Array<{ id: string; lotId: string; quantity: number }>;
}

export interface SaleExchange {
  id: string;
  saleReturnId: string;
  replacementSaleId: string;
  replacementSaleNumber: string | null;
  createdAt: string;
}

export interface SaleReturn {
  id: string;
  saleId: string;
  destination: 'original' | 'store_credit';
  subtotal: number;
  tipAmount: number;
  serviceChargeAmount: number;
  discountAmount: number;
  taxAmount: number;
  refundAmount: number;
  currencyCode: string;
  reason: string | null;
  createdAt: string;
  legacyFullTicket: boolean;
  items: SaleReturnItem[];
  paymentAllocations: SaleReturnPaymentAllocation[];
  exchange: SaleExchange | null;
}
