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
import type {
  FiscalAdapter,
  FiscalAdapterCapabilities,
  FiscalAdapterConfig,
  FiscalAdapterIssueInput,
  FiscalAdapterIssueResult,
  FiscalAdapterValidationIssue,
  FiscalAdapterValidationResult,
  FiscalAdapterVoidInput,
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
import { buildColombiaUbl21DraftXml } from './ubl21-xml.js';
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

    let cufe: string;
    if (input.kind === 'FEV') {
      if (!input.resolution.technicalKey) {
        throw new FiscalProviderError('MALFORMED_REQUEST', {
          message: 'DIAN technical key is missing',
          providerCode: 'MISSING_TECHNICAL_KEY',
        });
      }
      cufe = computeCufe({ ...fields, technicalKey: input.resolution.technicalKey });
    } else if (settings.softwarePin) {
      cufe = computeCude({ ...fields, softwarePin: settings.softwarePin });
    } else {
      throw new FiscalProviderError('MALFORMED_REQUEST', {
        message: 'DIAN software PIN is missing',
        providerCode: 'MISSING_SOFTWARE',
      });
    }

    const normalizedInput: FiscalAdapterIssueInput = {
      ...input,
      environment,
      issuerNit,
      buyer: { ...input.buyer, taxId: buyerIdNumber },
    };

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
      return this.handleTransientOutage(
        normalizedInput,
        cufe,
        credentials,
        error instanceof Error ? error.message : 'DIAN SOAP network error'
      );
    }

    if (isTransientHttpStatus(response.httpStatus)) {
      return this.handleTransientOutage(
        normalizedInput,
        cufe,
        credentials,
        `DIAN HTTP ${response.httpStatus}`
      );
    }

    if (useTestSet && response.zipKey && response.httpStatus < 400) {
      return {
        cufe,
        status: 'sent',
        providerId: this.providerId,
        providerResponse: {
          transport: 'dian-soap-1.2',
          action: 'SendTestSetAsync',
          signed: true,
          transmitted: true,
          certified: false,
          zipKey: response.zipKey,
          statusCode: response.statusCode,
          statusDescription: response.statusDescription,
          certificateFingerprintSha256: signed.certificateFingerprintSha256,
        },
        xmlRef: signed.signedXml,
      };
    }

    if (response.isValid) {
      return {
        cufe,
        status: 'accepted',
        providerId: this.providerId,
        providerResponse: {
          transport: 'dian-soap-1.2',
          action: 'SendBillSync',
          signed: true,
          transmitted: true,
          certified: false,
          statusCode: response.statusCode,
          statusDescription: response.statusDescription,
          statusMessage: response.statusMessage,
          certificateFingerprintSha256: signed.certificateFingerprintSha256,
        },
        xmlRef: signed.signedXml,
      };
    }

    const rejectionReason =
      response.errorMessages.join('; ') ||
      response.statusMessage ||
      response.statusDescription ||
      'DIAN rejected document';
    throw new FiscalProviderError('PROVIDER_REJECTED', {
      message: rejectionReason,
      providerCode: response.statusCode ?? 'DIAN_REJECTED',
      details: { httpStatus: response.httpStatus, errorMessages: response.errorMessages },
    });
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
    environment: FiscalEnvironment = '2'
  ): Promise<FiscalDocumentStatus> {
    const credentials = this.options.credentials;
    if (!credentials?.certificatePem || !credentials?.privateKeyPem) {
      throw new FiscalProviderError('MALFORMED_REQUEST', {
        message: 'DIAN X.509 signing credentials are not configured',
        providerCode: 'MISSING_CERTIFICATE',
      });
    }
    const client = this.createClient(environment, credentials);
    const response = await client.getStatus(cufe);
    if (isTransientHttpStatus(response.httpStatus)) {
      throw new FiscalProviderError('PROVIDER_5XX', {
        message: `DIAN GetStatus HTTP ${response.httpStatus}`,
        details: { httpStatus: response.httpStatus },
      });
    }
    if (response.isValid || response.statusCode === '00') return 'accepted';
    if (response.statusCode === '99' || response.errorMessages.length > 0) return 'rejected';
    return 'sent';
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
    reason: string
  ): FiscalAdapterIssueResult {
    const startedAt = this.now();
    const deadlineAt = new Date(startedAt.getTime() + CONTINGENCY_WINDOW_MS);
    const startedAtIso = startedAt.toISOString();
    const deadlineAtIso = deadlineAt.toISOString();

    if (this.options.outageBehavior === 'throw') {
      throw new FiscalProviderError('PROVIDER_5XX', {
        message: `DIAN unreachable (Contingencia tipo 08): ${reason}`,
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
        reason,
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
        contingencyType: '08',
        contingencyReason: reason,
        contingencyStartedAt: startedAtIso,
        contingencyDeadlineAt: deadlineAtIso,
        certificateFingerprintSha256: signedContingency.certificateFingerprintSha256,
      },
      xmlRef: signedContingency.signedXml,
    };
  }
}
