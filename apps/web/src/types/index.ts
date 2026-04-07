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
  description?: string;
  categoryId: string;
  price: number;
  cost: number;
  taxRate: number;
  stock: number;
  minStock: number;
  isActive: boolean;
  barcode?: string;
  imageUrl?: string;
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus;
  syncVersion?: number;
}

export interface Category {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  tenantId: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  taxId?: string;
  notes?: string;
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
  customerId?: string;
  customer?: Customer;
  items: SaleItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: SaleStatus;
  notes?: string;
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
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
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
