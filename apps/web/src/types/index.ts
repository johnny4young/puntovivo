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
  assignedLocationCount?: number;
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
  logoId?: string | null;
  logoUrl?: string | null;
  logoName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Logo {
  id: string;
  tenantId: string;
  name: string;
  imageUrl: string;
  isActive: boolean;
  assignedCompanyCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Sequential {
  id: string;
  tenantId: string;
  siteId: string;
  documentType: 'sale' | 'purchase' | 'order' | 'quotation';
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
  cityName?: string | null;
  departmentName?: string | null;
  countryName?: string | null;
  contactName?: string | null;
  isActive: boolean;
  assignedCategoryCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderCategoryAssignment {
  id: string;
  categoryId: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Department {
  id: string;
  tenantId: string;
  countryId?: string | null;
  countryCode?: string | null;
  countryName?: string | null;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface City {
  id: string;
  tenantId: string;
  departmentId: string;
  countryId?: string | null;
  countryName?: string | null;
  departmentCode?: string | null;
  departmentName?: string | null;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Country {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Location {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description?: string | null;
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
  locationCode?: string | null;
  locationName?: string | null;
  initialCost: number;
  stock: number;
  minStock: number;
  sellByFraction: boolean;
  fractionStep?: number | null;
  fractionMinimum?: number | null;
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
  syncStatus?: SyncStatus | null;
  syncVersion?: number | null;
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
  commercialActivityId?: string | null;
  notes?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus | null;
  syncVersion?: number;
}

export interface CustomerCatalogItem {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Sale {
  id: string;
  tenantId: string;
  saleNumber: string;
  customerId?: string | null;
  customerName?: string | null;
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

export interface SalePayment {
  id: string;
  method: PaymentMethod;
  amount: number;
  reference?: string | null;
  createdAt: string;
}

export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'credit' | 'other';
export type PaymentStatus = 'pending' | 'paid' | 'partial' | 'refunded';
export type SaleStatus = 'draft' | 'completed' | 'cancelled' | 'voided';
export type CashSessionStatus = 'open' | 'closed';
export type CashMovementType =
  | 'sale'
  | 'refund'
  | 'paid_in'
  | 'paid_out'
  | 'skim'
  | 'replenishment';

export interface CashSessionDenomination {
  value: number;
  count: number;
}

export interface InventoryBalanceListItem {
  id: string;
  tenantId: string;
  siteId: string;
  productId: string;
  productName: string;
  productSku: string;
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

export type TransferHistoryStatus = 'completed' | 'in_transit' | 'void';

export interface TransferHistoryEntry {
  id: string;
  status: TransferHistoryStatus;
  fromSiteId: string;
  fromSiteName: string;
  toSiteId: string;
  toSiteName: string;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  receivedAt: string | null;
  receivedBy: string | null;
  itemCount: number;
  totalQuantity: number;
  hasDiscrepancy: boolean;
  discrepancyNotes: string | null;
}

export interface TransferDetailLine {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  receivedQuantity: number | null;
}

export interface TransferDetail {
  id: string;
  status: TransferHistoryStatus;
  fromSiteId: string;
  fromSiteName: string;
  toSiteId: string;
  toSiteName: string;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  receivedAt: string | null;
  receivedBy: string | null;
  updatedAt: string;
  items: TransferDetailLine[];
  hasDiscrepancy: boolean;
  discrepancyNotes: string | null;
}

// ============================================================================
// QUOTATIONS (Phase 5 / Tier-2 #6)
// ============================================================================

export type QuotationStatus =
  | 'draft'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'converted';

/** Statuses an operator can transition to via the UI today. */
export type QuotationTransitionStatus = Extract<
  QuotationStatus,
  'sent' | 'accepted' | 'rejected' | 'expired' | 'converted'
>;

// ============================================================================
// AUDIT LOGS (Phase 8 / Tier-2 #8)
// ============================================================================

// Mirror of `auditLogActionEnum` in packages/server/src/db/schema.ts. The
// canonical source of truth is the server enum; this duplication exists only
// because the audit-logs page declares <option> arrays and React needs the
// literal union at compile time. Update both when adding a new audited
// action so the picker shows the new entry.
export type AuditLogAction =
  | 'transfer.void'
  | 'quotation.delete'
  | 'quotation.convert'
  | 'sale.void'
  | 'sale.return'
  | 'cash_session.close'
  // ENG-056 — shift-lifecycle parity (open + manual movement audits).
  | 'cash_session.open'
  | 'cash_session.movement'
  | 'inventory.adjust_stock'
  // ENG-007 second wave — admin-surface events.
  | 'purchase.void'
  | 'user.create'
  | 'user.update'
  | 'sale.price_override'
  // ENG-018 — park-and-resume (including discard metadata flag).
  | 'sale.park'
  | 'sale.resume'
  // ENG-019 — receipt reprint.
  | 'sale.reprint'
  // ENG-018c — draft completion (state change on an existing draft).
  | 'sale.complete'
  // ENG-047 — local anomaly detector audit persistence.
  | 'ai.anomaly.detected'
  // ENG-068 — module activation kernel toggle audit row.
  | 'module.toggle';

export type AuditLogResourceType =
  | 'transfer_order'
  | 'quotation'
  | 'sale'
  | 'cash_session'
  // ENG-056 — manual cash movements emit audit rows keyed to the
  // cash_movements row id.
  | 'cash_movement'
  | 'product'
  | 'purchase'
  | 'user'
  | 'cashier'
  // ENG-068 — module activation kernel resource type.
  | 'tenant_module';

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorName: string | null;
  actorEmail: string | null;
  action: AuditLogAction;
  resourceType: AuditLogResourceType;
  resourceId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface QuotationListEntry {
  id: string;
  quotationNumber: string;
  status: QuotationStatus;
  customerId: string | null;
  customerName: string | null;
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
  taxAmount: number;
  total: number;
}

export interface QuotationDetail {
  id: string;
  quotationNumber: string;
  status: QuotationStatus;
  customerId: string | null;
  customerName: string | null;
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

export interface RegisterAssignment {
  id: string;
  tenantId: string;
  siteId: string;
  registerName: string;
  label: string;
  openingFloat: number;
  denominations: CashSessionDenomination[];
  sortOrder: number;
  isActive: boolean;
  isOccupied: boolean;
  activeSessionId?: string | null;
  activeCashierId?: string | null;
  activeCashierName?: string | null;
  openedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CashSession {
  id: string;
  tenantId: string;
  siteId: string;
  siteName?: string | null;
  cashierId: string;
  cashierName?: string | null;
  registerName: string;
  openingFloat: number;
  openingCountDenominations: CashSessionDenomination[];
  expectedBalance: number;
  actualCount?: number | null;
  actualCountDenominations?: CashSessionDenomination[] | null;
  overShort?: number | null;
  status: CashSessionStatus;
  openedAt: string;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CashMovement {
  id: string;
  tenantId: string;
  sessionId: string;
  type: CashMovementType;
  amount: number;
  referenceId?: string | null;
  note?: string | null;
  createdBy: string;
  createdByName?: string | null;
  createdAt: string;
}

export interface CashSessionReportSummary {
  activeSessionCount: number;
  activeRegisterCount: number;
  recentClosureCount: number;
  reviewCount: number;
  netOverShort: number;
  largestDiscrepancy: number;
}

export interface CashSessionReport {
  summary: CashSessionReportSummary;
  activeSessions: CashSession[];
  recentClosures: CashSession[];
}

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

export type PurchaseStatus = 'completed' | 'partial_returned' | 'returned' | 'voided';

export interface PurchaseItem {
  id: string;
  purchaseId: string;
  productId: string;
  sourceOrderItemId?: string | null;
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
  returnedQuantity?: number;
  remainingQuantity?: number;
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

export type OrderStatus = 'submitted' | 'partial_received' | 'received' | 'voided';

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
  /**
   * Either a plain message (legacy IndexedDB offline buffer) or a
   * `NormalizedOutboxError` JSON object (server `sync_outbox` rows
   * via `sync.pull` / `sync.listQueue`). The renderer formats both
   * shapes — see `normalizeSyncLastError` in
   * `apps/web/src/features/company/companySyncDisplay.ts`.
   */
  lastError?: string | Record<string, unknown> | null;
}

export interface SyncConflict {
  id: string;
  entityType: string;
  entityId: string;
  localData: Record<string, unknown>;
  remoteData: Record<string, unknown>;
  localRecordExists?: boolean | null;
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
