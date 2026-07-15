/** ENG-123a — Structural context and result types for launch imports. */
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
