// purchasing / order domain shapes ( slice 28).

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
  tracksLots?: boolean;
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
  /**
   * Maximum purchase-unit quantity physically returnable at the receiving
   * site when this record was read. Writes still revalidate inside the
   * server transaction because stock can change after this snapshot.
   */
  returnableQuantity: number;
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
  lots?: Array<{
    id: string;
    purchaseItemId: string;
    inventoryLotId: string;
    lotNumber: string;
    expiresAt: string | null;
    baseQuantity: number;
    unitCost: number;
    currentOnHand: number;
    currentStatus: string;
    returnedBaseQuantity: number;
    remainingBaseQuantity: number;
    availableBaseQuantity: number;
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
  lots?: Array<{
    id: string;
    purchaseItemLotId: string;
    inventoryLotId: string;
    lotNumber: string;
    expiresAt: string | null;
    baseQuantity: number;
    unitCost: number;
  }>;
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
  tracksLots?: boolean;
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
