// ENG-179c — inventory domain shapes (ENG-178 slice 28).

import type { InitialInventoryMode, MovementType, SyncStatus } from '../ui';
import type { Product } from './products';

export interface InventoryBalanceListItem {
  id: string;
  tenantId: string;
  siteId: string;
  productId: string;
  productName: string;
  productSku: string;
  tracksSerials?: boolean;
  onHand: number;
  reserved: number;
  available: number;
  minStock: number;
  isLowStock: boolean;
  updatedAt: string;
}

export interface InventoryBalancesSummary {
  totalOnHand: number;
  totalReserved: number;
  totalAvailable: number;
  lowStockCount: number;
  productsTracked: number;
}

export interface InventoryBalancesBySiteResult {
  siteId: string;
  items: InventoryBalanceListItem[];
  summary: InventoryBalancesSummary;
}

export interface InventoryMovement {
  id: string;
  tenantId: string;
  productId: string;
  product?: Product;
  productName?: string | null;
  productSku?: string | null;
  categoryName?: string | null;
  type: MovementType;
  quantity: number;
  previousStock: number;
  newStock: number;
  reference?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  syncStatus?: SyncStatus;
  syncVersion?: number;
}

export interface InventoryStockItem {
  id: string;
  tenantId: string;
  name: string;
  sku: string;
  categoryId?: string | null;
  categoryName?: string | null;
  stock: number;
  minStock: number;
  tracksLots: boolean;
  tracksSerials?: boolean | undefined;
  initialCost: number;
  price: number;
  isLowStock: boolean;
  inventoryValue: number;
  updatedAt: string;
}

export interface InitialInventoryEntry {
  id: string;
  tenantId: string;
  productId: string;
  unitId: string;
  siteId?: string | null;
  mode: InitialInventoryMode;
  quantity: number;
  unitEquivalence: number;
  normalizedQuantity: number;
  cost: number;
  previousStock: number;
  newStock: number;
  notes?: string | null;
  createdBy: string;
  syncStatus?: SyncStatus;
  syncVersion?: number;
  createdAt: string;
  productName?: string | null;
  productSku?: string | null;
  unitName?: string | null;
  unitAbbreviation?: string | null;
  siteName?: string | null;
}
