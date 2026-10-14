/**
 * `ColombiaMockAdapter` (formerly `MockAdapter`). A real Proveedor
 * Tecnológico adapter will replace the mock body; this file remains the
 * Colombia pack entry point.
 *
 * Characteristics:
 *
 * - **Deterministic CUFE / CUDE**: a sales invoice (FEV) gets a CUFE
 * keyed by the resolution technical key; the POS documento equivalente
 * (DEE) and every note get a CUDE keyed by the tenant's DIAN software
 * PIN. Both hash the issuer NIT from `fiscal.co.nit`. Re-running the
 * same input produces the same code, so the orchestrator can rely on
 * the uniqueness index to fail fast when a sale is emitted twice.
 * - **No network**: resolves immediately with `status='sent'` by
 * default. Contingency simulation is opt-in via the
 * `MockAdapterOptions.contingencyOracle` hook so tests can assert
 * the offline path without patching globals.
 * - **Void semantics**: issuing a `NC` (credit note) returns the same
 * shape as a regular issue; the orchestrator is responsible for
 * storing `originalCufe` on the new `fiscal_documents` row.
 * - **`validateConfig`**: requires a valid issuer NIT and the DIAN
 * software ID + PIN, so a sale never mints a code DIAN cannot verify;
 * otherwise the intent stays `blocked`.
 *
 * @module services/fiscal/packs/co/mock-adapter
 */

import { computeCufe, type DianDocumentHashFields, type FiscalEnvironment } from '../../cufe.js';
import { computeCude } from '../../cude.js';
import { FiscalProviderError } from '../../errors.js';
import { resolveFiscalIssuerTaxId } from '../../issuer-context.js';
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
import { splitIssueTimestamp } from '../../orchestrator/helpers.js';
import { validateNit } from './nit.js';
import { readCoFiscalSettings, validateCoEmissionConfig } from './settings.js';
import { buildColombiaUbl21DraftXml } from './ubl21-xml.js';

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
  /** Environment flag forwarded to the CUFE / CUDE hash. Default '2' (test). */
  environment?: FiscalEnvironment;
}

const COLOMBIA_PROVIDER_ID = 'mock-co';
const NIT_ID_TYPE_CODE = '31';

const COLOMBIA_CAPABILITIES: FiscalAdapterCapabilities = {
  supportsVoid: true,
  supportsDebitNote: true,
  supportsFetchStatus: true,
};

export class ColombiaMockAdapter implements FiscalAdapter {
  readonly providerId = COLOMBIA_PROVIDER_ID;
  readonly countryCode = 'CO';
  readonly capabilities = COLOMBIA_CAPABILITIES;
  // mock: deterministic CUFE / CUDE, no signing, no DIAN transmission.
  readonly maturity = 'mock' as const;

  constructor(private readonly options: MockAdapterOptions = {}) {}

  async validateConfig(input: FiscalAdapterConfig): Promise<FiscalAdapterValidationResult> {
    return validateCoEmissionConfig(readCoFiscalSettings(input.settings));
  }

  async issue(input: FiscalAdapterIssueInput): Promise<FiscalAdapterIssueResult> {
    const thrown = this.options.throwOracle?.(input);
    if (thrown) {
      throw thrown;
    }
    const settings = readCoFiscalSettings(input.tenantSettings);
    const fields: DianDocumentHashFields = {
      documentNumber: input.resolution.documentNumber,
      issueDate: input.issueDate,
      issueTime: input.issueTime,
      subtotal: input.subtotal,
      ivaAmount: input.ivaAmount,
      incAmount: input.incAmount,
      icaAmount: input.icaAmount,
      totalAmount: input.totalAmount,
      issuerNit: resolveFiscalIssuerTaxId('CO', input.tenantSettings, input.issuerNit),
      buyerIdNumber: normalizeBuyerId(input.buyer.taxIdTypeCode, input.buyer.taxId),
      environment: this.options.environment ?? input.environment ?? '2',
    };
    // Only the sales invoice is a CUFE document; DIAN keys the POS
    // documento equivalente and every note by the software PIN (CUDE).
    // The PIN is read live at emission, so it can vanish after the intent
    // was validated: refuse rather than persist a code DIAN cannot verify.
    const softwarePin = settings.softwarePin;
    let cufe: string;
    if (input.kind === 'FEV') {
      cufe = computeCufe({ ...fields, technicalKey: input.resolution.technicalKey });
    } else if (softwarePin) {
      cufe = computeCude({ ...fields, softwarePin });
    } else {
      throw new FiscalProviderError('MALFORMED_REQUEST', {
        message: 'DIAN software PIN is missing',
        providerCode: 'MISSING_SOFTWARE',
      });
    }

    const override = this.options.contingencyOracle?.(input);
    const status: FiscalDocumentStatus = override ?? 'sent';

    return {
      cufe,
      status,
      providerId: this.providerId,
      providerResponse: {
        kind: 'local-unsigned-untransmitted-ubl-draft',
        signed: false,
        transmitted: false,
        certified: false,
        ublVersion: '2.1',
      },
      // The draft names the same issuer and buyer the hash covers.
      xmlRef: buildColombiaUbl21DraftXml(
        {
          ...input,
          environment: fields.environment,
          issuerNit: fields.issuerNit,
          buyer: { ...input.buyer, taxId: fields.buyerIdNumber },
        },
        cufe
      ),
    };
  }

  async voidDocument(input: FiscalAdapterVoidInput): Promise<FiscalAdapterIssueResult> {
    // The mock cannot re-compose the full hash input without the
    // original header + lines; instead it derives a deterministic
    // "void CUDE" from the original code and the reason so the result
    // is still idempotent + unique. Real adapters will call the PT's
    // void endpoint and return the PT-issued code.
    const voidCufe = computeCude({
      documentNumber: `VOID-${input.cufe}`,
      ...splitIssueTimestamp(new Date(), 'America/Bogota'),
      subtotal: 0,
      ivaAmount: 0,
      incAmount: 0,
      icaAmount: 0,
      totalAmount: 0,
      issuerNit: input.tenantId,
      buyerIdNumber: '222222222222',
      softwarePin: input.reasonCode,
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

/** DIAN wants the buyer ID without dots, dashes or the NIT verification digit. */
function normalizeBuyerId(taxIdTypeCode: string, taxId: string): string {
  if (taxIdTypeCode === NIT_ID_TYPE_CODE) {
    // A wrong DV still marks where the base number ends.
    const parsed = validateNit(taxId);
    if (parsed.valid || parsed.reason === 'dv_mismatch') return parsed.nit;
  }
  return taxId.replace(/[.\s-]/g, '');
}
