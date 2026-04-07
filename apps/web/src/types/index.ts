// Core types for the application

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: UserRole;
  tenantId: string;
  isActive?: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = 'admin' | 'manager' | 'cashier' | 'viewer';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  settings: TenantSettings;
  createdAt: string;
  updatedAt: string;
}

export interface TenantSettings {
  currency: string;
  timezone: string;
  dateFormat: string;
  taxRate: number;
  logo?: string;
  theme?: 'light' | 'dark' | 'system';
}

export interface Site {
  id: string;
  tenantId: string;
  companyId: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Company {
  id: string;
  tenantId: string;
  name: string;
  taxId?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Sequential {
  id: string;
  tenantId: string;
  siteId: string;
  documentType: 'sale' | 'purchase' | 'order';
  prefix: string;
  currentValue: number;
  createdAt: string;
  updatedAt: string;
  siteName?: string;
}

export interface Provider {
  id: string;
  tenantId: string;
  name: string;
  taxId?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  cityId?: string | null;
  contactName?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VatRate {
  id: string;
  tenantId: string;
  name: string;
  rate: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Unit {
  id: string;
  tenantId: string;
  name: string;
  abbreviation: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  token: string;
  refreshToken: string;
  tenant: Tenant;
}

// Domain Models

export interface Product {
  id: string;
  tenantId: string;
  name: string;
  sku: string;
  description?: string | null;
  categoryId?: string | null;
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
  vatRateId?: string | null;
  providerId?: string | null;
  locationId?: string | null;
  initialCost: number;
  stock: number;
  minStock: number;
  isActive: boolean;
  barcode?: string | null;
  imageUrl?: string | null;
  categoryName?: string | null;
  providerName?: string | null;
  vatRateName?: string | null;
  unitAssignments?: ProductUnitAssignment[];
  providerAssignments?: ProductProviderAssignment[];
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus;
  syncVersion?: number;
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
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  tenantId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  taxId?: string | null;
  identificationTypeId?: string | null;
  personTypeId?: string | null;
  regimeTypeId?: string | null;
  clientTypeId?: string | null;
  notes?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus;
  syncVersion?: number;
}

export interface Sale {
  id: string;
  tenantId: string;
  saleNumber: string;
  customerId?: string | null;
  customerName?: string | null;
  customer?: Customer;
  items?: SaleItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: SaleStatus;
  notes?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus;
  syncVersion?: number;
}

export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  product?: Product;
  productName?: string | null;
  productSku?: string | null;
  quantity: number;
  unitPrice: number;
  unitId?: string | null;
  unitEquivalence?: number;
  unitName?: string | null;
  unitAbbreviation?: string | null;
  discount: number;
  taxRate: number;
  taxAmount: number;
  costAtSale?: number;
  total: number;
}

export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'credit' | 'other';
export type PaymentStatus = 'pending' | 'paid' | 'partial' | 'refunded';
export type SaleStatus = 'draft' | 'completed' | 'cancelled' | 'voided';

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

export type MovementType = 'purchase' | 'sale' | 'adjustment' | 'transfer' | 'return';

export interface InventoryStockItem {
  id: string;
  tenantId: string;
  name: string;
  sku: string;
  categoryId?: string | null;
  categoryName?: string | null;
  stock: number;
  minStock: number;
  initialCost: number;
  price: number;
  isLowStock: boolean;
  inventoryValue: number;
  updatedAt: string;
}

export type InitialInventoryMode = 'initial' | 'physical';

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

// Sync Types

export type SyncStatus = 'pending' | 'synced' | 'conflict' | 'error';

export interface SyncQueueItem {
  id: string;
  entityType: string;
  entityId: string;
  operation: 'create' | 'update' | 'delete';
  payload: Record<string, unknown>;
  tenantId: string;
  createdAt: string;
  retryCount: number;
  lastError?: string;
}

export interface SyncConflict {
  id: string;
  entityType: string;
  entityId: string;
  localData: Record<string, unknown>;
  remoteData: Record<string, unknown>;
  resolution?: 'local_wins' | 'remote_wins' | 'merged';
  resolvedAt?: string;
  tenantId: string;
}

// API Response Types

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
