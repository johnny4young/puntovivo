/**
 * Fiscal orchestrator — type surface (ENG-020/057 split).
 *
 * The public emit args/result + the internal buyer/line snapshot shapes
 * (frozen at emission per Resolución DIAN 165/2023). ENG-179b marks the
 * explicit `| undefined` on optional args. Leaf module.
 *
 * @module services/fiscal/orchestrator/types
 */
import type { DatabaseInstance } from '../../../db/index.js';
import { type FiscalDocumentKind, type FiscalDocumentSource } from '../../../db/schema.js';
import type { FiscalAdapter } from '../adapter.js';
import { type FiscalEnvironment } from '../cufe.js';


export interface EmitFiscalDocumentArgs {
  /** Database handle used for reads and the local fiscal write transaction. */
  tx: DatabaseInstance;
  tenantId: string;
  userId: string;
  source: FiscalDocumentSource;
  /** Sale id for sale/void sources; saleReturns id for return source. */
  sourceId: string;
  /** Sale id that the document emission is about — matches `sourceId` for sales, the underlying sale for returns/voids. */
  saleId: string;
  kind: FiscalDocumentKind;
  /** When source is void/return, pass the original sale's fiscal doc CUFE. */
  // ENG-179b — explicit `| undefined` so callers can pass
  // `originalCufe: maybeCufe` (built from a nullable DB row) without
  // violating `exactOptionalPropertyTypes`.
  originalCufe?: string | undefined;
  reasonCode?: string | undefined;
  /** Country-specific adapter selected by the sale lifecycle caller. */
  adapter: FiscalAdapter;
  /** Environment flag. Fase A defaults to '2' (sandbox). */
  environment?: FiscalEnvironment | undefined;
}

export interface EmitFiscalDocumentResult {
  id: string;
  cufe: string;
  documentNumber: string;
  status: string;
}

export interface ResolvedBuyer {
  customerId: string | null;
  taxId: string;
  taxIdTypeCode: string;
  name: string;
  email: string | null;
  address: string | null;
  city: string | null;
  department: string | null;
  country: string | null;
}

export interface ResolvedLine {
  lineNumber: number;
  productId: string;
  productName: string;
  productSku: string | null;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
}
