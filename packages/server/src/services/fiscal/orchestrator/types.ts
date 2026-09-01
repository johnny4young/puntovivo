/**
 * Fiscal orchestrator — type surface ( split).
 *
 * The public emit args/result + the internal buyer/line snapshot shapes
 * (frozen at emission per Resolución DIAN 165/2023).  marks the
 * explicit `| undefined` on optional args. Leaf module.
 *
 * @module services/fiscal/orchestrator/types
 */
import type { DatabaseInstance } from '../../../db/index.js';
import type { TaxKind } from '../../../db/schema.js';
import { type FiscalDocumentKind, type FiscalDocumentSource } from '../../../db/schema.js';
import type { FiscalAdapter } from '../adapter.js';
import { type FiscalEnvironment } from '../cufe.js';
import type { TaxComponentSnapshot } from '../../tax-components.js';

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
  // explicit `| undefined` so callers can pass
  // `originalCufe: maybeCufe` (built from a nullable DB row) without
  // violating `exactOptionalPropertyTypes`.
  originalCufe?: string | undefined;
  reasonCode?: string | undefined;
  /** Country-specific adapter selected by the sale lifecycle caller. */
  adapter: FiscalAdapter;
  /** Environment flag. estado actual defaults to '2' (sandbox). */
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
  /** Null for immutable non-catalog adjustments such as tip/service charge. */
  productId: string | null;
  productName: string;
  productSku: string | null;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxRate: number;
  /** The sale line's frozen tax kind; classifies the DIAN category. */
  taxKind: TaxKind;
  taxAmount: number;
  /** Immutable normalized components from the sale line. */
  taxComponents?: TaxComponentSnapshot[] | undefined;
  lineTotal: number;
  /**
   * UN/ECE Rec 20 code of the line's unit (KGM, LTR, H87...),
   * from the unit catalog's standardCode. Feeds the UBL unitCode /
   * CFDI ClaveUnidad instead of a hardcoded EA. Null when the unit
   * predates the units foundation and carries no code.
   */
  unitStandardCode: string | null;
}
