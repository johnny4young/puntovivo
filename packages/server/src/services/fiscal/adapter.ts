/**
 * ENG-020 — `FiscalAdapter` interface.
 * ENG-034 — extended with `validateConfig` + `countryCode` + the
 * `NotImplementedFiscalAdapter` stub flag so the typed factory in
 * `registry.ts` can dispatch by country code (CO, MX, CL, ...).
 *
 * Every fiscal-document emitter implements this contract. The
 * `ColombiaMockAdapter` ships in Fase A for schema validation and
 * CUFE round-trip tests; ENG-021 (Fase B) swaps it for
 * `FactureAdapter` or `HkaAdapter` when a Proveedor Tecnológico
 * contract lands. Mexico (`ENG-035`) and Chile (`ENG-036`) packs
 * land as new files implementing the same contract.
 *
 * Methods map 1:1 to DIAN-style lifecycle events:
 * - `validateConfig(input)` — pre-flight check: does the tenant
 *   carry every setting the pack needs (NIT for CO, RFC for MX,
 *   RUT for CL, certificate, resolution, environment)?
 * - `issue(input)` — emit a new document (DEE, FEV, NC, ND for CO;
 *   CFDI for MX; boleta/factura for CL).
 * - `voidDocument(...)` — cancel a previously issued document.
 * - `fetchStatus(cufe)` — poll an in-flight document for acceptance.
 *
 * Capability flags let the orchestrator skip methods an adapter does
 * not implement yet (e.g. the Colombia mock reports
 * `supportsVoid=true` because it can compose a NC; Fase B adapters
 * will report whether the PT's fetch-status endpoint is online).
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
 * ENG-034 — `validateConfig` issue codes. Stable string union so
 * future packs can add new codes without breaking the rest of the
 * matrix. The web layer maps each to a localized hint.
 */
export type FiscalValidationIssueCode =
  | 'PACK_NOT_AVAILABLE'
  | 'MISSING_NIT'
  | 'MISSING_RFC'
  | 'MISSING_RUT'
  | 'MISSING_RESOLUTION'
  | 'MISSING_CERTIFICATE'
  | 'INVALID_ENVIRONMENT';

export interface FiscalAdapterValidationIssue {
  code: FiscalValidationIssueCode;
  /** Operator-facing message; localized at the web layer. */
  message: string;
  /** Tenant settings field path the admin must fix, e.g. `fiscal.co.nit`. */
  field: string;
}

export interface FiscalAdapterValidationResult {
  ok: boolean;
  issues: FiscalAdapterValidationIssue[];
}

export interface FiscalAdapterConfig {
  tenantId: string;
  /** ISO 3166-1 alpha-2 country code from `tenantLocaleSettings`. */
  countryCode: string;
  /** Pass-through of `tenants.settings` so the adapter can probe pack-specific fields. */
  settings: Record<string, unknown>;
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
  /** ISO 3166-1 alpha-2 country code this adapter serves. */
  readonly countryCode: string;
  readonly capabilities: FiscalAdapterCapabilities;
  /**
   * Pre-flight readiness check. ColombiaMockAdapter returns ok=true
   * unconditionally; real adapters probe required settings (NIT,
   * RFC, RUT, certificate, resolution, environment) and report
   * missing fields so the admin UI can render a friendly hint.
   */
  validateConfig(input: FiscalAdapterConfig): Promise<FiscalAdapterValidationResult>;
  issue(input: FiscalAdapterIssueInput): Promise<FiscalAdapterIssueResult>;
  voidDocument(input: FiscalAdapterVoidInput): Promise<FiscalAdapterIssueResult>;
  fetchStatus(cufe: string): Promise<FiscalDocumentStatus>;
}

/**
 * ENG-034 — stub flag that lets the registry list adapters that exist
 * for type completeness but throw `FISCAL_PACK_NOT_AVAILABLE` on use
 * (Mexico parked for ENG-035, Chile parked for ENG-036). Mirrors the
 * AI provider `notImplemented` pattern from `services/ai/providers/`.
 */
export interface NotImplementedFiscalAdapter extends FiscalAdapter {
  readonly notImplemented: true;
  readonly availableInTicket: string;
}
