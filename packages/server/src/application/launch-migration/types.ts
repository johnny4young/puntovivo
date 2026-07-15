/** ENG-123a/ENG-123b — Structural context and result types for launch imports. */
import type { DatabaseInstance } from '../../db/index.js';
import type { UserRole } from '@puntovivo/shared/roles';

export interface LaunchMigrationContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string | null;
  user: { id: string; role: UserRole };
  envelope?: { operationId: string; idempotencyKey?: string } | null;
  deviceId?: string | null;
}

export const PRODUCT_IMPORT_FIELDS = [
  'name',
  'sku',
  'description',
  'barcode',
  'price',
  'cost',
  'stock',
  'minStock',
  'taxRate',
] as const;

export type ProductImportField = (typeof PRODUCT_IMPORT_FIELDS)[number];

export type ProductImportIssueCode =
  | 'required'
  | 'too_long'
  | 'invalid_number'
  | 'out_of_range'
  | 'duplicate_file_sku'
  | 'duplicate_existing_sku'
  | 'duplicate_file_barcode'
  | 'duplicate_existing_barcode'
  | 'concurrent_duplicate'
  | 'import_failed'
  | 'stock_failed';

export interface ProductImportIssue {
  code: ProductImportIssueCode;
  field: ProductImportField;
}

export interface NormalizedLaunchProduct {
  name: string;
  sku: string;
  description: string | null;
  barcode: string | null;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  taxRate: number;
}

export type ProductImportPreviewStatus = 'ready' | 'invalid' | 'duplicate';

export interface ProductImportPreviewRow {
  rowNumber: number;
  status: ProductImportPreviewStatus;
  normalized: NormalizedLaunchProduct;
  issues: ProductImportIssue[];
}

export const CUSTOMER_IMPORT_FIELDS = [
  'name',
  'taxId',
  'email',
  'phone',
  'address',
  'city',
  'state',
  'postalCode',
  'country',
  'notes',
] as const;

export const PROVIDER_IMPORT_FIELDS = [
  'name',
  'taxId',
  'email',
  'phone',
  'address',
  'contactName',
  'cityCode',
] as const;

export type CustomerImportField = (typeof CUSTOMER_IMPORT_FIELDS)[number];
export type ProviderImportField = (typeof PROVIDER_IMPORT_FIELDS)[number];
export type PartyImportField = CustomerImportField | ProviderImportField;

export type PartyImportIssueCode =
  | 'required'
  | 'too_long'
  | 'invalid_email'
  | 'city_not_found'
  | 'duplicate_file_name'
  | 'duplicate_existing_name'
  | 'duplicate_file_tax_id'
  | 'duplicate_existing_tax_id'
  | 'duplicate_file_email'
  | 'duplicate_existing_email'
  | 'concurrent_duplicate'
  | 'import_failed';

export interface PartyImportIssue {
  code: PartyImportIssueCode;
  field: PartyImportField;
}

export interface NormalizedLaunchCustomer {
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  notes: string | null;
}

export interface NormalizedLaunchProvider {
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  contactName: string | null;
  cityCode: string | null;
  cityId: string | null;
}

export type PartyImportPreviewStatus = 'ready' | 'invalid' | 'duplicate';

export interface CustomerImportPreviewRow {
  rowNumber: number;
  status: PartyImportPreviewStatus;
  normalized: NormalizedLaunchCustomer;
  issues: PartyImportIssue[];
}

export interface ProviderImportPreviewRow {
  rowNumber: number;
  status: PartyImportPreviewStatus;
  normalized: NormalizedLaunchProvider;
  issues: PartyImportIssue[];
}

export const CUSTOMER_BALANCE_IMPORT_FIELDS = ['taxId', 'email', 'openingBalance', 'note'] as const;

export type CustomerBalanceImportField = (typeof CUSTOMER_BALANCE_IMPORT_FIELDS)[number];

export type CustomerBalanceImportIssueCode =
  | 'identity_required'
  | 'invalid_email'
  | 'invalid_number'
  | 'balance_must_be_positive'
  | 'out_of_range'
  | 'too_long'
  | 'customer_not_found'
  | 'ambiguous_customer'
  | 'identifier_conflict'
  | 'duplicate_file_customer'
  | 'duplicate_existing_balance'
  | 'import_failed';

export interface CustomerBalanceImportIssue {
  code: CustomerBalanceImportIssueCode;
  field: CustomerBalanceImportField;
}

export interface NormalizedLaunchCustomerBalance {
  customerId: string | null;
  customerName: string | null;
  taxId: string | null;
  email: string | null;
  openingBalance: number;
  note: string | null;
}

export interface CustomerBalanceImportPreviewRow {
  rowNumber: number;
  status: PartyImportPreviewStatus;
  normalized: NormalizedLaunchCustomerBalance;
  issues: CustomerBalanceImportIssue[];
}
