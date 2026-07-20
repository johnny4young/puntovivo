/**
 * Country-neutral fiscal adapter contract.
 *
 * Every fiscal-document emitter implements this contract. The
 * Colombia currently uses a deterministic mock; Mexico and Chile emit
 * structurally valid draft XML. Certified authority integrations can
 * replace those adapters without changing the orchestration contract.
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
  /** Legal issuer name; Mexico writes it to `cfdi:Emisor.Nombre`. */
  // Explicit `| undefined` lets callers
  // pass `field: undefined` (typical when destructuring a parent ctx)
  // without violating `exactOptionalPropertyTypes`.
  issuerName?: string | undefined;
  currencyCode: string;
  localeCode: string;
  /**
   * Dominant sale tender from `sales.paymentMethod`. Country packs use
   * this to map to their fiscal payment catalog (MX c_FormaPago, etc.).
   */
  paymentMethod?: string | undefined;
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
  originalCufe?: string | undefined;
  reasonCode?: string | undefined;
  /**
   * Raw `tenants.settings` blob so country packs (MX, CL, ...) can
   * read their pack-specific settings (`fiscal.mx.*`, `fiscal.cl.*`)
   * without coupling the adapter to the DB. `ColombiaMockAdapter`
   * ignores it.
   */
  tenantSettings?: Record<string, unknown> | undefined;
  /**
   * Pre-allocated Chile CAF folio. The orchestrator
   * detects `adapter.countryCode === 'CL'`, runs the CAF allocator
   * inside its write transaction, and embeds the result here so the
   * `ChileSIIAdapter` can serialize the DTE without re-reading the
   * DB. The allocator's atomic cursor advance commits with the rest
   * of the orchestrator's work — if the orchestrator's tx rolls back
   * (dedup hit, downstream insert failure), the folio is NOT burned.
   *
   * Mexico + Colombia adapters ignore this field. The shape is
   * declared as a plain JSON-serializable record so it survives the
   * `fiscal_outbox.payload` round-trip; the actual `ChileFolioAllocation`
   * type lives in `services/fiscal/packs/cl/caf-allocator.ts`.
   */
  chileAllocation?:
    | {
        cafId: string;
        folio: number;
        tipoDte: string;
        rutEmisor: string;
        rawCafXml: string;
        rangeRemaining: number;
      }
    | undefined;
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
 * Fiscal pack maturity is orthogonal to a
 * document's lifecycle status. Tells the UI how real a pack's emission is:
 *   - `mock`      — computes a deterministic CUFE but NEVER signs or
 *                   transmits (Colombia today; the real Proveedor
 *                   Tecnologico integration remains unavailable).
 *   - `draft`     — emits structurally-valid but UNSIGNED, untransmitted
 *                   XML (Mexico CFDI / Chile DTE today; signing +
 *                   transmission remain unavailable).
 *   - `certified` — signs and transmits to the real tax authority. NO pack
 *                   ships this yet; reserved so a surface can read as
 *                   production-ready only when a pack genuinely is.
 * A non-`certified` pack must never be presented as production / accepted.
 */
export type FiscalAdapterMaturity = 'mock' | 'draft' | 'certified';

/**
 * `validateConfig` issue codes. Stable string union so
 * future packs can add new codes without breaking the rest of the
 * matrix. The web layer maps each to a localized hint.
 */
export type FiscalValidationIssueCode =
  | 'PACK_NOT_AVAILABLE'
  | 'MISSING_NIT'
  | 'MISSING_RFC'
  | 'MISSING_RUT'
  | 'MISSING_RESOLUTION'
  | 'MISSING_RANGE'
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
   * production-readiness truth marker (see
   * `FiscalAdapterMaturity`). The registry + UI use it to label demo /
   * draft packs honestly; nothing below `certified` may be shown as
   * production-ready, and unsupported countries never reach an adapter.
   */
  readonly maturity: FiscalAdapterMaturity;
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
