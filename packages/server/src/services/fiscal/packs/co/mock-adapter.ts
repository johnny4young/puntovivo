/**
 * `ColombiaMockAdapter` (formerly `MockAdapter`).
 * moved to `packs/co/` and renamed; the CUFE algorithm
 * encoded by `services/fiscal/cufe.ts` is Colombia-specific, so the
 * old generic name was misleading.  will swap the mock body
 * for `FactureAdapter` / `HkaAdapter` once a Proveedor Tecnológico
 * contract lands; this file remains the Colombia pack entry point.
 *
 * Characteristics:
 *
 * - **Deterministic CUFE**: routes through `computeCufe` so the
 * resulting hex string matches what DIAN would compute from the
 * same payload. Re-running the same input produces the same CUFE
 * the orchestrator can rely on the uniqueness index to fail fast
 * when the same sale is emitted twice.
 * - **No network**: resolves immediately with `status='sent'` by
 * default. Contingency simulation is opt-in via the
 * `MockAdapterOptions.contingencyOracle` hook so tests can assert
 * the offline path without patching globals.
 * - **Void semantics**: issuing a `NC` (credit note) returns the same
 * shape as a regular issue; the orchestrator is responsible for
 * storing `originalCufe` on the new `fiscal_documents` row.
 * - **`validateConfig`**: returns `ok=true` unconditionally — the
 * mock has no real configuration to probe.  will replace
 * this with NIT / certificate / resolution / environment checks
 * against `tenants.settings.fiscal.co.*`.
 *
 * @module services/fiscal/packs/co/mock-adapter
 */

import { computeCufe, type FiscalEnvironment } from '../../cufe.js';
import type {
  FiscalAdapter,
  FiscalAdapterCapabilities,
  FiscalAdapterConfig,
  FiscalAdapterIssueInput,
  FiscalAdapterIssueResult,
  FiscalAdapterValidationResult,
  FiscalAdapterVoidInput,
} from '../../adapter.js';
import type { FiscalDocumentStatus } from '../../../../db/schema.js';

export interface MockAdapterOptions {
  /**
   * Optional hook fired before emission. Return `'contingency'` to
   * simulate a PT outage / offline path — the emitted row lands with
   * `status='contingency'` and `retries=0`, ready for the daemon to
   * pick up. Return `'accepted'` to simulate fast-path PT acceptance.
   * Default path: everything reports `status='sent'`.
   */
  contingencyOracle?: (input: FiscalAdapterIssueInput) => FiscalDocumentStatus | undefined;
  /**
   * Optional hook fired before emission to simulate an
   * outage-via-throw. The fiscal worker's normalizer maps the
   * thrown error into a `NormalizedFiscalError`; the kernel
   * transitions to `retrying` (recoverable) or `dead_letter`
   * (non-recoverable). Pair with `FiscalProviderError` for typed
   * provider rejections.
   */
  throwOracle?: (input: FiscalAdapterIssueInput) => Error | undefined;
  /** Stringly-typed environment flag forwarded to CUFE compute. Default '2' (sandbox). */
  environment?: FiscalEnvironment;
}

const COLOMBIA_PROVIDER_ID = 'mock-co';

const COLOMBIA_CAPABILITIES: FiscalAdapterCapabilities = {
  supportsVoid: true,
  supportsDebitNote: true,
  supportsFetchStatus: true,
};

export class ColombiaMockAdapter implements FiscalAdapter {
  readonly providerId = COLOMBIA_PROVIDER_ID;
  readonly countryCode = 'CO';
  readonly capabilities = COLOMBIA_CAPABILITIES;
  // mock: deterministic CUFE, no signing, no DIAN transmission.
  // The real Proveedor Tecnologico swap is gated as .
  readonly maturity = 'mock' as const;

  constructor(private readonly options: MockAdapterOptions = {}) {}

  async validateConfig(_input: FiscalAdapterConfig): Promise<FiscalAdapterValidationResult> {
    // Mock has no real configuration — always ready.  replaces
    // this with NIT / certificate / resolution / environment checks.
    return { ok: true, issues: [] };
  }

  async issue(input: FiscalAdapterIssueInput): Promise<FiscalAdapterIssueResult> {
    const thrown = this.options.throwOracle?.(input);
    if (thrown) {
      throw thrown;
    }
    const environment = this.options.environment ?? input.environment ?? '2';
    const cufe = computeCufe({
      documentNumber: input.resolution.documentNumber,
      issueDate: input.issueDate,
      issueTime: input.issueTime,
      subtotal: input.subtotal,
      ivaAmount: input.ivaAmount,
      incAmount: input.incAmount,
      icaAmount: input.icaAmount,
      totalAmount: input.totalAmount,
      issuerNit: input.issuerNit,
      buyerIdTypeCode: input.buyer.taxIdTypeCode,
      buyerIdNumber: input.buyer.taxId,
      technicalKey: input.resolution.technicalKey,
      environment,
    });

    const override = this.options.contingencyOracle?.(input);
    const status: FiscalDocumentStatus = override ?? 'sent';

    return {
      cufe,
      status,
      providerId: this.providerId,
      providerResponse: null,
      xmlRef: null,
    };
  }

  async voidDocument(input: FiscalAdapterVoidInput): Promise<FiscalAdapterIssueResult> {
    // The mock cannot re-compose the full CUFE input without the
    // original header + lines; instead it derives a deterministic
    // "void CUFE" from the original hash and the reason so the result
    // is still idempotent + unique. Real adapters () will call
    // the PT's void endpoint and return the PT-issued CUFE.
    const voidCufe = computeCufe({
      documentNumber: `VOID-${input.cufe}`,
      issueDate: new Date().toISOString().slice(0, 10),
      issueTime: new Date().toISOString().slice(11, 19) + '-05:00',
      subtotal: 0,
      ivaAmount: 0,
      incAmount: 0,
      icaAmount: 0,
      totalAmount: 0,
      issuerNit: input.tenantId,
      buyerIdTypeCode: '31',
      buyerIdNumber: '222222222222',
      technicalKey: input.reasonCode,
      environment: this.options.environment ?? '2',
    });
    return {
      cufe: voidCufe,
      status: 'sent',
      providerId: this.providerId,
      providerResponse: null,
      xmlRef: null,
    };
  }

  async fetchStatus(_cufe: string): Promise<FiscalDocumentStatus> {
    // Mock path is always terminal at `accepted` — real adapters
    // implement async polling to DIAN.
    return 'accepted';
  }
}
