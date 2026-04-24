/**
 * ENG-020 — `FiscalAdapter` interface.
 *
 * Every fiscal-document emitter implements this contract. The
 * `MockAdapter` ships in Fase A for schema validation and CUFE
 * round-trip tests; ENG-021 (Fase B) swaps it for `FactureAdapter`
 * or `HkaAdapter` when a Proveedor Tecnológico contract lands.
 *
 * Methods map 1:1 to DIAN lifecycle events:
 * - `issue(input)` — emit a new document (DEE, FEV, NC, ND).
 * - `voidDocument(...)` — cancel a previously issued DEE/FEV.
 * - `fetchStatus(cufe)` — poll an in-flight document for acceptance.
 *
 * Capability flags let the orchestrator skip methods an adapter does
 * not implement yet (e.g. the MockAdapter reports `supportsVoid=true`
 * because it can compose a NC; Fase B adapters will report whether
 * the PT's fetch-status endpoint is online).
 *
 * @module services/fiscal/adapter
 */

import type {
  FiscalDocumentKind,
  FiscalDocumentSource,
  FiscalDocumentStatus,
} from '../../db/schema.js';
import type { FiscalEnvironment } from './cufe.js';

/** Line on the fiscal document — already includes snapshots. */
export interface FiscalAdapterLine {
  lineNumber: number;
  productName: string;
  productSku: string | null;
  unitMeasureCode: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  taxCategoryCode: string;
  lineTotal: number;
}

/** Frozen buyer identity for the emission. */
export interface FiscalAdapterBuyer {
  taxId: string;
  taxIdTypeCode: string;
  name: string;
  email: string | null;
  address: string | null;
  city: string | null;
  department: string | null;
  country: string | null;
}

/** Consecutive / resolution data the orchestrator already resolved. */
export interface FiscalAdapterResolution {
  id: string;
  resolutionNumber: string;
  prefix: string;
  technicalKey: string;
  consecutive: number;
  documentNumber: string;
}

/** Full input shape for `issue()`. */
export interface FiscalAdapterIssueInput {
  tenantId: string;
  source: FiscalDocumentSource;
  sourceId: string;
  kind: FiscalDocumentKind;
  /** `YYYY-MM-DD` in the tenant's timezone. */
  issueDate: string;
  /** `HH:mm:ssZZ` in the tenant's timezone. */
  issueTime: string;
  environment: FiscalEnvironment;
  issuerNit: string;
  currencyCode: string;
  localeCode: string;
  resolution: FiscalAdapterResolution;
  buyer: FiscalAdapterBuyer;
  /** Header totals — already computed by the orchestrator. */
  subtotal: number;
  ivaAmount: number;
  incAmount: number;
  icaAmount: number;
  discountAmount: number;
  totalAmount: number;
  lines: FiscalAdapterLine[];
  /** Set when `source` is 'void' or 'return'. */
  originalCufe?: string;
  reasonCode?: string;
}

/** Result the orchestrator persists into `fiscal_documents`. */
export interface FiscalAdapterIssueResult {
  cufe: string;
  status: FiscalDocumentStatus;
  providerId: string;
  /** Provider-supplied response payload for observability. */
  providerResponse: Record<string, unknown> | null;
  /** Storage ref for the signed XML. Null until the provider streams it. */
  xmlRef: string | null;
}

export interface FiscalAdapterVoidInput {
  tenantId: string;
  cufe: string;
  reasonCode: string;
}

export interface FiscalAdapterCapabilities {
  supportsVoid: boolean;
  supportsDebitNote: boolean;
  supportsFetchStatus: boolean;
}

/**
 * Implement this interface to plug a new fiscal provider. The
 * orchestrator invokes methods inside the sale transaction, so every
 * implementation MUST be synchronous-friendly (can return `Promise`
 * but must not hold the tx open on network calls — use a queue for
 * real-PT round trips).
 */
export interface FiscalAdapter {
  readonly providerId: string;
  readonly capabilities: FiscalAdapterCapabilities;
  issue(input: FiscalAdapterIssueInput): Promise<FiscalAdapterIssueResult>;
  voidDocument(input: FiscalAdapterVoidInput): Promise<FiscalAdapterIssueResult>;
  fetchStatus(cufe: string): Promise<FiscalDocumentStatus>;
}
