/**
 * Direct Colombia DIAN software-propio adapter (FE 1.9 + DEE POS 1.0 + NC/ND + Contingencia 08).
 *
 * Signs UBL 2.1 XML via XAdES-EPES and submits through WS-Security SOAP 1.2 (`SendBillSync`,
 * `SendTestSetAsync`, `GetStatus`). Keeps `maturity = 'draft'` until live `vpfe-hab`
 * certification evidence is verified.
 *
 * @module services/fiscal/packs/co/dian-adapter
 */

import { createPrivateKey, X509Certificate } from 'node:crypto';
import type { FiscalDocumentStatus } from '../../../../db/schema.js';
import { roundMoney } from '../../../../lib/money.js';
import type {
  FiscalAdapter,
  FiscalAdapterCapabilities,
  FiscalAdapterConfig,
  FiscalAdapterIssueInput,
  FiscalAdapterIssueResult,
  FiscalAdapterValidationIssue,
  FiscalAdapterValidationResult,
  FiscalAdapterVoidInput,
  FiscalStatusContext,
} from '../../adapter.js';
import { computeCude } from '../../cude.js';
import { computeCufe, type DianDocumentHashFields, type FiscalEnvironment } from '../../cufe.js';
import { FiscalProviderError } from '../../errors.js';
import { resolveFiscalIssuerTaxId } from '../../issuer-context.js';
import {
  DianSoapClient,
  type DianSoapCredentials,
  type DianSoapResponse,
} from './dian-soap-client.js';
import { readCoFiscalSettings, validateCoEmissionConfig } from './settings.js';
import { buildColombiaUbl21DraftXml, colombiaTaxSchemeTotals } from './ubl21-xml.js';
import { inspectX509Certificate, signDianUblXml } from './xades-signer.js';

function certificateMatchesKey(credentials: DianSoapCredentials): boolean {
  try {
    return new X509Certificate(credentials.certificatePem).checkPrivateKey(
      createPrivateKey(credentials.privateKeyPem)
    );
  } catch {
    return false;
  }
}

export const COLOMBIA_DIAN_DIRECT_PROVIDER_ID = 'dian-co-direct';
const CONTINGENCY_WINDOW_MS = 48 * 60 * 60 * 1000;
const NIT_ID_TYPE_CODE = '31';

export interface ColombiaDianAdapterOptions {
  /** Certificate + RSA private key PEM material (supplied from secret store or test fixture). */
  credentials?: DianSoapCredentials | undefined;
  /** DIAN habilitación TestSetId; when provided in environment '2', uses SendTestSetAsync. */
  testSetId?: string | undefined;
  /** Override SOAP endpoint URL (used by mock SOAP integration tests). */
  endpointOverride?: string | undefined;
  /** HTTP timeout in ms (default 20_000). */
  timeoutMs?: number | undefined;
  /** Custom fetch implementation for tests. */
  fetchImpl?: typeof fetch | undefined;
  /**
   * How to surface a transient DIAN outage:
   * - 'contingency' (default): signs contingency type 08 XML and returns status='contingency'
   * - 'throw': throws recoverable FiscalProviderError('PROVIDER_5XX') for outbox retry
   */
  outageBehavior?: 'contingency' | 'throw' | undefined;
  /** Clock override for deterministic tests. */
  now?: (() => Date) | undefined;
}

const CAPABILITIES: FiscalAdapterCapabilities = {
  supportsVoid: false,
  supportsDebitNote: true,
  supportsFetchStatus: true,
};

function normalizeBuyerId(taxIdTypeCode: string, taxId: string): string {
  const base = taxIdTypeCode === NIT_ID_TYPE_CODE ? taxId.trim().replace(/\s*-\s*\d$/, '') : taxId;
  return base.replace(/[.\s-]/g, '');
}

function xmlFileNameFor(input: FiscalAdapterIssueInput, issuerNit: string): string {
  const prefixMap = { FEV: 'fv', DEE: 'de', NC: 'nc', ND: 'nd' } as const;
  const nitPadded = issuerNit.replace(/\D/g, '').padStart(10, '0');
  const seqPadded = String(input.resolution.consecutive).padStart(8, '0');
  return `${prefixMap[input.kind]}${nitPadded}${seqPadded}.xml`;
}

function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

type TransportOutcome =
  | { kind: 'ok' }
  | { kind: 'outage'; reasonCode: string; detail: string }
  | { kind: 'error'; error: FiscalProviderError };

/** Separate a DIAN outage from a request DIAN refused at the transport or SOAP layer. */
function classifyTransport(response: DianSoapResponse): TransportOutcome {
  const fault = response.fault;
  if (fault) {
    const code = fault.code.split(':').pop() ?? fault.code;
    const detail = `${fault.code}${fault.subcode ? `/${fault.subcode}` : ''}: ${fault.reason}`;
    if (code === 'Receiver' || code === 'Server') {
      return { kind: 'outage', reasonCode: 'DIAN_SOAP_RECEIVER_FAULT', detail };
    }
    const securityFault = /security|authenticat|token|signature/i.test(
      `${fault.subcode ?? ''} ${fault.reason}`
    );
    return {
      kind: 'error',
      error: new FiscalProviderError(securityFault ? 'AUTH_FAILED' : 'MALFORMED_REQUEST', {
        message: `DIAN SOAP fault ${detail}`,
        providerCode: fault.subcode ?? code,
        details: { httpStatus: response.httpStatus, faultCode: fault.code },
      }),
    };
  }
  if (response.httpStatus === 401 || response.httpStatus === 403) {
    return {
      kind: 'error',
      error: new FiscalProviderError('AUTH_FAILED', {
        message: `DIAN refused the client credentials (HTTP ${response.httpStatus})`,
        providerCode: `HTTP_${response.httpStatus}`,
        details: { httpStatus: response.httpStatus },
      }),
    };
  }
  if (isTransientHttpStatus(response.httpStatus)) {
    return {
      kind: 'outage',
      reasonCode: `DIAN_HTTP_${response.httpStatus}`,
      detail: `DIAN HTTP ${response.httpStatus}`,
    };
  }
  if (response.httpStatus >= 400) {
    return {
      kind: 'error',
      error: new FiscalProviderError('PROVIDER_4XX', {
        message: `DIAN HTTP ${response.httpStatus}`,
        providerCode: `HTTP_${response.httpStatus}`,
        details: { httpStatus: response.httpStatus },
      }),
    };
  }
  return { kind: 'ok' };
}

function statusFromResponse(response: DianSoapResponse): FiscalDocumentStatus {
  if (response.isValid) return 'accepted';
  if (response.statusCode === '99' || response.errorMessages.length > 0) return 'rejected';
  return 'sent';
}

function rejectionError(response: DianSoapResponse): FiscalProviderError {
  return new FiscalProviderError('PROVIDER_REJECTED', {
    message:
      response.errorMessages.join('; ') ||
      response.statusMessage ||
      response.statusDescription ||
      'DIAN rejected document',
    providerCode: response.statusCode ?? 'DIAN_REJECTED',
    details: { httpStatus: response.httpStatus, errorMessages: response.errorMessages },
  });
}

function readEnvironment(value: unknown): FiscalEnvironment | null {
  return value === '1' || value === '2' ? value : null;
}

const TAX_SCHEME_HEADER: ReadonlyArray<[string, 'ivaAmount' | 'incAmount' | 'icaAmount']> = [
  ['01', 'ivaAmount'],
  ['04', 'incAmount'],
  ['03', 'icaAmount'],
];

/** The XML TaxTotal per scheme must equal the header amounts hashed into the CUFE. */
function assertTaxSchemesMatchHashedTotals(input: FiscalAdapterIssueInput): void {
  const xmlTotals = colombiaTaxSchemeTotals(input);
  for (const [schemeCode, field] of TAX_SCHEME_HEADER) {
    const xmlTotal = xmlTotals.get(schemeCode) ?? 0;
    if (xmlTotal !== roundMoney(input[field])) {
      throw new FiscalProviderError('MALFORMED_REQUEST', {
        message: `DIAN tax scheme ${schemeCode} totals ${xmlTotal} but the CUFE hashes ${input[field]}`,
        providerCode: 'TAX_TOTAL_MISMATCH',
        details: { schemeCode, xmlTotal, hashedTotal: input[field] },
      });
    }
  }
}

export class ColombiaDianAdapter implements FiscalAdapter {
  readonly providerId = COLOMBIA_DIAN_DIRECT_PROVIDER_ID;
  readonly countryCode = 'CO';
  readonly capabilities = CAPABILITIES;
  // Stays 'draft' until live vpfe-hab certification evidence is verified.
  readonly maturity = 'draft' as const;

  private readonly now: () => Date;

  constructor(private readonly options: ColombiaDianAdapterOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async validateConfig(input: FiscalAdapterConfig): Promise<FiscalAdapterValidationResult> {
    const base = validateCoEmissionConfig(readCoFiscalSettings(input.settings));
    const issues: FiscalAdapterValidationIssue[] = [...base.issues];

    if (!this.options.credentials?.certificatePem || !this.options.credentials?.privateKeyPem) {
      issues.push({
        code: 'MISSING_CERTIFICATE',
        message: 'DIAN X.509 signing certificate or private key is missing',
        field: 'fiscal.co.certificate',
      });
    } else {
      try {
        const summary = inspectX509Certificate(this.options.credentials.certificatePem, this.now());
        if (!summary.valid) {
          issues.push({
            code: 'MISSING_CERTIFICATE',
            message: summary.expired
              ? 'DIAN X.509 signing certificate is expired'
              : 'DIAN X.509 signing certificate is not yet valid',
            field: 'fiscal.co.certificate',
          });
        }
      } catch {
        issues.push({
          code: 'MISSING_CERTIFICATE',
          message: 'DIAN X.509 signing certificate is malformed',
          field: 'fiscal.co.certificate',
        });
      }
      if (!certificateMatchesKey(this.options.credentials)) {
        issues.push({
          code: 'MISSING_CERTIFICATE',
          message: 'DIAN private key does not match the signing certificate',
          field: 'fiscal.co.certificate',
        });
      }
    }

    return { ok: issues.length === 0, issues };
  }

  async issue(input: FiscalAdapterIssueInput): Promise<FiscalAdapterIssueResult> {
    const credentials = this.options.credentials;
    if (!credentials?.certificatePem || !credentials?.privateKeyPem) {
      throw new FiscalProviderError('MALFORMED_REQUEST', {
        message: 'DIAN X.509 signing credentials are not configured',
        providerCode: 'MISSING_CERTIFICATE',
      });
    }

    const settings = readCoFiscalSettings(input.tenantSettings);
    const environment: FiscalEnvironment = input.environment ?? '2';
    const issuerNit = resolveFiscalIssuerTaxId('CO', input.tenantSettings, input.issuerNit);
    const buyerIdNumber = normalizeBuyerId(input.buyer.taxIdTypeCode, input.buyer.taxId);
    const fields: DianDocumentHashFields = {
      documentNumber: input.resolution.documentNumber,
      issueDate: input.issueDate,
      issueTime: input.issueTime,
      subtotal: input.subtotal,
      ivaAmount: input.ivaAmount,
      incAmount: input.incAmount,
      icaAmount: input.icaAmount,
      totalAmount: input.totalAmount,
      issuerNit,
      buyerIdNumber,
      environment,
    };

    if (!settings.softwareId || !settings.softwarePin) {
      throw new FiscalProviderError('MALFORMED_REQUEST', {
        message: 'DIAN software ID or PIN is missing',
        providerCode: 'MISSING_SOFTWARE',
      });
    }
    if (
      (input.kind === 'NC' || input.kind === 'ND') &&
      (!input.originalCufe || !input.originalDocumentNumber)
    ) {
      throw new FiscalProviderError('MALFORMED_REQUEST', {
        message: 'DIAN note is missing the CUFE or number of the document it corrects',
        providerCode: 'MISSING_BILLING_REFERENCE',
      });
    }

    let cufe: string;
    if (input.kind === 'FEV') {
      if (!input.resolution.technicalKey) {
        throw new FiscalProviderError('MALFORMED_REQUEST', {
          message: 'DIAN technical key is missing',
          providerCode: 'MISSING_TECHNICAL_KEY',
        });
      }
      cufe = computeCufe({ ...fields, technicalKey: input.resolution.technicalKey });
    } else {
      cufe = computeCude({ ...fields, softwarePin: settings.softwarePin });
    }

    const normalizedInput: FiscalAdapterIssueInput = {
      ...input,
      environment,
      issuerNit,
      buyer: { ...input.buyer, taxId: buyerIdNumber },
    };

    assertTaxSchemesMatchHashedTotals(normalizedInput);
    const unsignedXml = buildColombiaUbl21DraftXml(normalizedInput, cufe, { mode: 'dian' });
    const signed = signDianUblXml({
      xml: unsignedXml,
      certificatePem: credentials.certificatePem,
      privateKeyPem: credentials.privateKeyPem,
      signingTimeIso: this.now().toISOString(),
    });

    const client = this.createClient(environment, credentials);
    const fileName = xmlFileNameFor(normalizedInput, issuerNit);
    const useTestSet = environment === '2' && Boolean(this.options.testSetId);

    let response: DianSoapResponse;
    try {
      response = useTestSet
        ? await client.sendTestSetAsync(fileName, signed.signedXml, this.options.testSetId!)
        : await client.sendBillSync(fileName, signed.signedXml);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'DIAN SOAP network error';
      // A timeout can land after DIAN processed the document: ask before re-signing it as contingency.
      if (!useTestSet) {
        const settled = await this.settleUnconfirmedSubmission(client, cufe, environment, signed);
        if (settled) return settled;
      }
      return this.handleTransientOutage(normalizedInput, cufe, credentials, {
        reasonCode: 'DIAN_UNREACHABLE',
        detail,
      });
    }

    const transport = classifyTransport(response);
    if (transport.kind === 'outage') {
      return this.handleTransientOutage(normalizedInput, cufe, credentials, transport);
    }
    if (transport.kind === 'error') throw transport.error;

    const baseResponse = {
      transport: 'dian-soap-1.2',
      environment,
      signed: true,
      transmitted: true,
      certified: false,
      statusCode: response.statusCode,
      statusDescription: response.statusDescription,
      certificateFingerprintSha256: signed.certificateFingerprintSha256,
    };

    if (useTestSet && response.zipKey) {
      return {
        cufe,
        status: 'sent',
        providerId: this.providerId,
        providerResponse: { ...baseResponse, action: 'SendTestSetAsync', zipKey: response.zipKey },
        xmlRef: signed.signedXml,
      };
    }

    if (response.isValid) {
      return {
        cufe,
        status: 'accepted',
        providerId: this.providerId,
        providerResponse: {
          ...baseResponse,
          action: 'SendBillSync',
          statusMessage: response.statusMessage,
        },
        xmlRef: signed.signedXml,
      };
    }

    throw rejectionError(response);
  }

  async voidDocument(_input: FiscalAdapterVoidInput): Promise<FiscalAdapterIssueResult> {
    // Voiding goes through a signed nota credito, not a transmitted cancellation.
    throw new FiscalProviderError('MALFORMED_REQUEST', {
      message: 'DIAN direct adapter cannot void; issue a credit note instead',
      providerCode: 'VOID_NOT_SUPPORTED',
    });
  }

  async fetchStatus(
    cufe: string,
    context: FiscalStatusContext = {}
  ): Promise<FiscalDocumentStatus> {
    const credentials = this.options.credentials;
    if (!credentials?.certificatePem || !credentials?.privateKeyPem) {
      throw new FiscalProviderError('MALFORMED_REQUEST', {
        message: 'DIAN X.509 signing credentials are not configured',
        providerCode: 'MISSING_CERTIFICATE',
      });
    }
    const environment =
      readEnvironment(context.environment) ??
      readEnvironment(context.providerResponse?.environment);
    if (!environment) {
      throw new FiscalProviderError('MALFORMED_REQUEST', {
        message: 'DIAN environment of the document is unknown',
        providerCode: 'MISSING_ENVIRONMENT',
      });
    }
    const zipKey = context.providerResponse?.zipKey;
    const client = this.createClient(environment, credentials);
    const response =
      typeof zipKey === 'string' && zipKey
        ? await client.getStatusZip(zipKey)
        : await client.getStatus(cufe);
    const transport = classifyTransport(response);
    if (transport.kind === 'outage') {
      throw new FiscalProviderError('PROVIDER_5XX', {
        message: `DIAN status lookup unavailable: ${transport.detail}`,
        details: { httpStatus: response.httpStatus },
      });
    }
    if (transport.kind === 'error') throw transport.error;
    return statusFromResponse(response);
  }

  /** Resolve a submission whose response never arrived; null means DIAN does not hold it. */
  private async settleUnconfirmedSubmission(
    client: DianSoapClient,
    cufe: string,
    environment: FiscalEnvironment,
    signed: { signedXml: string; certificateFingerprintSha256: string }
  ): Promise<FiscalAdapterIssueResult | null> {
    let response: DianSoapResponse;
    try {
      response = await client.getStatus(cufe);
    } catch {
      return null;
    }
    if (classifyTransport(response).kind !== 'ok') return null;
    const status = statusFromResponse(response);
    if (status === 'rejected') throw rejectionError(response);
    if (status !== 'accepted') return null;
    return {
      cufe,
      status: 'accepted',
      providerId: this.providerId,
      providerResponse: {
        transport: 'dian-soap-1.2',
        environment,
        action: 'GetStatus',
        signed: true,
        transmitted: true,
        certified: false,
        confirmedAfterTimeout: true,
        statusCode: response.statusCode,
        statusDescription: response.statusDescription,
        certificateFingerprintSha256: signed.certificateFingerprintSha256,
      },
      xmlRef: signed.signedXml,
    };
  }

  private createClient(
    environment: FiscalEnvironment,
    credentials: DianSoapCredentials
  ): DianSoapClient {
    return new DianSoapClient({
      environment,
      credentials,
      endpointOverride: this.options.endpointOverride,
      timeoutMs: this.options.timeoutMs,
      fetchImpl: this.options.fetchImpl,
    });
  }

  private handleTransientOutage(
    input: FiscalAdapterIssueInput,
    cufe: string,
    credentials: DianSoapCredentials,
    outage: { reasonCode: string; detail: string }
  ): FiscalAdapterIssueResult {
    const startedAt = this.now();
    const deadlineAt = new Date(startedAt.getTime() + CONTINGENCY_WINDOW_MS);
    const startedAtIso = startedAt.toISOString();
    const deadlineAtIso = deadlineAt.toISOString();

    if (this.options.outageBehavior === 'throw') {
      throw new FiscalProviderError('PROVIDER_5XX', {
        message: `DIAN unreachable (Contingencia tipo 08): ${outage.detail}`,
        providerCode: 'CONTINGENCY_08',
        details: {
          contingencyType: '08',
          startedAtIso,
          deadlineAtIso,
        },
      });
    }

    const contingencyXml = buildColombiaUbl21DraftXml(input, cufe, {
      mode: 'dian',
      contingency: {
        typeCode: '08',
        // The signed legal document carries a stable code, never raw transport text.
        reason: outage.reasonCode,
        startedAtIso,
        deadlineAtIso,
      },
    });
    const signedContingency = signDianUblXml({
      xml: contingencyXml,
      certificatePem: credentials.certificatePem,
      privateKeyPem: credentials.privateKeyPem,
      signingTimeIso: startedAtIso,
    });

    return {
      cufe,
      status: 'contingency',
      providerId: this.providerId,
      providerResponse: {
        transport: 'dian-soap-1.2',
        signed: true,
        transmitted: false,
        certified: false,
        environment: input.environment,
        contingencyType: '08',
        contingencyReason: outage.reasonCode,
        contingencyDetail: outage.detail,
        contingencyStartedAt: startedAtIso,
        contingencyDeadlineAt: deadlineAtIso,
        certificateFingerprintSha256: signedContingency.certificateFingerprintSha256,
      },
      xmlRef: signedContingency.signedXml,
    };
  }
}
