// ENG-179c — purchasing / order domain shapes (ENG-178 slice 28).

import type { OrderStatus, PurchaseStatus, SyncStatus } from '../ui';

export interface Purchase {
  id: string;
  tenantId: string;
  purchaseNumber: string;
  providerId: string;
  providerName?: string | null;
  orderId?: string | null;
  sourceOrderNumber?: string | null;
  siteId: string;
  siteName?: string | null;
  status: PurchaseStatus;
  items?: PurchaseItem[];
  returnedAmount?: number | null;
  returnedAt?: string | null;
  latestReturnReason?: string | null;
  latestReturnCreatedByName?: string | null;
  returnCount?: number;
  returns?: PurchaseReturn[];
  subtotal: number;
  total: number;
  notes?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus | null;
  syncVersion?: number | null;
}

export interface PurchaseItem {
  id: string;
  purchaseId: string;
  productId: string;
  sourceOrderItemId?: string | null;
  productName?: string | null;
  productSku?: string | null;
  tracksSerials?: boolean;
  quantity: number;
  unitId: string;
  unitEquivalence: number;
  unitName?: string | null;
  unitAbbreviation?: string | null;
  costPerUnit: number;
  baseUnitCost: number;
  total: number;
  returnedQuantity?: number;
  remainingQuantity?: number;
  serials?: Array<{
    id: string;
    serialNumber: string;
    status:
      | 'in_stock'
      | 'in_transit'
      | 'reserved'
      | 'sold'
      | 'returned'
      | 'returned_to_supplier'
      | 'defective';
    currentSiteId: string;
  }>;
}

export interface PurchaseReturn {
  id: string;
  purchaseId: string;
  returnAmount: number;
  reason?: string | null;
  createdBy: string;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
  items?: PurchaseReturnItem[];
}

export interface PurchaseReturnItem {
  id: string;
  purchaseReturnId: string;
  purchaseItemId: string;
  productId: string;
  productName?: string | null;
  productSku?: string | null;
  quantity: number;
  unitId: string;
  unitEquivalence: number;
  unitName?: string | null;
  unitAbbreviation?: string | null;
  costPerUnit: number;
  baseUnitCost: number;
  total: number;
}

export interface Order {
  id: string;
  tenantId: string;
  orderNumber: string;
  providerId: string;
  providerName?: string | null;
  linkedPurchaseCount?: number;
  linkedPurchases?: LinkedOrderPurchase[];
  receivedPurchaseId?: string | null;
  receivedPurchaseNumber?: string | null;
  siteId: string;
  siteName?: string | null;
  status: OrderStatus;
  items?: OrderItem[];
  subtotal: number;
  total: number;
  notes?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus | null;
  syncVersion?: number | null;
}

export interface LinkedOrderPurchase {
  id: string;
  purchaseNumber: string;
  status: PurchaseStatus;
  total: number;
  createdAt: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  productName?: string | null;
  productSku?: string | null;
  tracksSerials?: boolean;
  quantity: number;
  unitId: string;
  unitEquivalence: number;
  unitName?: string | null;
  unitAbbreviation?: string | null;
  costPerUnit: number;
  baseUnitCost: number;
  total: number;
  receivedQuantity?: number;
  remainingQuantity?: number;
}
