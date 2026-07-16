export interface InventoryBalanceListItem {
  id: string;
  tenantId: string;
  siteId: string;
  productId: string;
  productName: string;
  productSku: string;
  tracksSerials: boolean;
  onHand: number;
  reserved: number;
  available: number;
  minStock: number;
  isLowStock: boolean;
  updatedAt: string;
}

export interface InventoryDiscrepancyRow {
  productId: string;
  productName: string;
  productSku: string | null;
  cachedStock: number;
  sumOfBalances: number;
  delta: number;
  siteCount: number;
}

export interface InventoryBalancesSummary {
  totalOnHand: number;
  totalReserved: number;
  totalAvailable: number;
  lowStockCount: number;
  productsTracked: number;
}
