// ENG-179c — product / category domain shapes (ENG-178 slice 28).

import type { SyncStatus } from '../ui';

// Domain Models

// ENG-179b — explicit `| undefined` on optional fields.
export interface Product {
  id: string;
  tenantId: string;
  name: string;
  sku: string;
  description?: string | null | undefined;
  categoryId?: string | null | undefined;
  price: number;
  price2: number;
  price3: number;
  cost: number;
  marginPercent1: number;
  marginPercent2: number;
  marginPercent3: number;
  marginAmount1: number;
  marginAmount2: number;
  marginAmount3: number;
  taxRate: number;
  vatRateId?: string | null | undefined;
  providerId?: string | null | undefined;
  locationId?: string | null | undefined;
  locationCode?: string | null | undefined;
  locationName?: string | null | undefined;
  initialCost: number;
  stock: number;
  minStock: number;
  sellByFraction: boolean;
  fractionStep?: number | null | undefined;
  fractionMinimum?: number | null | undefined;
  isActive: boolean;
  barcode?: string | null | undefined;
  imageUrl?: string | null | undefined;
  categoryName?: string | null | undefined;
  providerName?: string | null | undefined;
  vatRateName?: string | null | undefined;
  unitAssignments?: ProductUnitAssignment[] | undefined;
  providerAssignments?: ProductProviderAssignment[] | undefined;
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus | null | undefined;
  syncVersion?: number | null | undefined;
  // ENG-177a — optimistic-concurrency token (round-tripped on update).
  version: number;
}

export interface ProductUnitAssignment {
  id: string;
  productId?: string;
  unitId: string;
  unitName?: string | null;
  unitAbbreviation?: string | null;
  equivalence: number;
  price: number;
  isBase: boolean;
  /** Packaging-level barcode (Auditoría 2026-07 — Tier B); null on base/none. */
  barcode?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductProviderAssignment {
  id: string;
  productId?: string;
  providerId: string;
  providerName?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductSearchItem extends Product {
  baseUnitId?: string | null;
  baseUnitName?: string | null;
  baseUnitAbbreviation?: string | null;
  baseUnitPrice?: number | null;
}

export interface ProductSearchSelection {
  product: ProductSearchItem;
  unit: ProductUnitAssignment;
  price: number;
}

export interface Category {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  // ENG-177a — optimistic-concurrency token (round-tripped on update).
  version: number;
  createdAt: string;
  updatedAt: string;
}
