/**
 * Mexico fiscal pack (`MexicoCFDIAdapter`).
 *
 * Validates tenant settings and emits structurally valid CFDI 4.0 XML in
 * `draft` maturity. Documents remain pending because CSD signing, PAC
 * transmission, status polling, and SAT cancellation are not implemented.
 * The adapter is stateless; the orchestrator supplies tenant settings and
 * issuer context.
 *
 * @module services/fiscal/packs/mx/mexico-adapter
 */

import type { FiscalDocumentStatus } from '../../../../db/schema.js';
import { throwServerError } from '../../../../lib/errorCodes.js';
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
import { serializeCfdi40 } from './cfdi40-xml.js';
import { findRegimenFiscal } from './catalogs/index.js';
import { validateRfc } from './rfc.js';
import { readMxFiscalSettings } from './settings.js';

const MX_PROVIDER_ID = 'cfdi-mx';

const MX_CAPABILITIES: FiscalAdapterCapabilities = {
  // Sale, return y void emiten mediante issue(); la cancelación SAT
  // explícita no está disponible.
  supportsVoid: false,
  supportsDebitNote: false,
  // fetchStatus no hace polling real — retorna 'pending' siempre.
  supportsFetchStatus: false,
};

/**
 * Mensajes localizables sólo en server-side. La UI mapea via i18n
 * (`errors:server.FISCAL_RFC_INVALID`); los mensajes aquí son el
 * fallback en español para audit logs y server logs.
 */
const MX_VALIDATION_MESSAGES = {
  MISSING_RFC: 'Captura el RFC del emisor antes de habilitar la emisión.',
  INVALID_RFC: 'El RFC del emisor no es válido según las reglas del SAT.',
  MISSING_REGIMEN: 'Captura el régimen fiscal del emisor.',
  INVALID_REGIMEN: 'El código del régimen fiscal no existe en el catálogo SAT.',
  MISSING_LUGAR: 'Captura el lugar de expedición (código postal de 5 dígitos).',
  INVALID_LUGAR: 'El lugar de expedición debe ser un código postal de 5 dígitos.',
  INVALID_ENVIRONMENT: 'El ambiente debe ser sandbox o production.',
} as const;

export class MexicoCFDIAdapter implements FiscalAdapter {
  readonly providerId = MX_PROVIDER_ID;
  readonly countryCode = 'MX';
  readonly capabilities = MX_CAPABILITIES;
  // draft: structurally-valid CFDI 4.0 XML, but unsigned (no CSD)
  // and not transmitted to a PAC. Signing and cancellation remain unavailable.
  readonly maturity = 'draft' as const;

  async validateConfig(input: FiscalAdapterConfig): Promise<FiscalAdapterValidationResult> {
    const mx = readMxFiscalSettings(input.settings);
    const issues: FiscalAdapterValidationIssue[] = [];

    // Probe del RFC del emisor.
    if (!mx.rfc) {
      issues.push({
        code: 'MISSING_RFC',
        field: 'fiscal.mx.rfc',
        message: MX_VALIDATION_MESSAGES.MISSING_RFC,
      });
    } else {
      const rfcResult = validateRfc(mx.rfc);
      if (!rfcResult.ok) {
        issues.push({
          code: 'MISSING_RFC',
          field: 'fiscal.mx.rfc',
          message: `${MX_VALIDATION_MESSAGES.INVALID_RFC} ${rfcResult.message}`,
        });
      }
    }

    // Probe del régimen fiscal.
    if (!mx.regimenFiscalCode) {
      issues.push({
        code: 'MISSING_RESOLUTION',
        field: 'fiscal.mx.regimenFiscalCode',
        message: MX_VALIDATION_MESSAGES.MISSING_REGIMEN,
      });
    } else if (!findRegimenFiscal(mx.regimenFiscalCode)) {
      issues.push({
        code: 'MISSING_RESOLUTION',
        field: 'fiscal.mx.regimenFiscalCode',
        message: MX_VALIDATION_MESSAGES.INVALID_REGIMEN,
      });
    }

    // Probe del lugar de expedición.
    if (!mx.lugarExpedicion) {
      issues.push({
        code: 'MISSING_CERTIFICATE',
        field: 'fiscal.mx.lugarExpedicion',
        message: MX_VALIDATION_MESSAGES.MISSING_LUGAR,
      });
    } else if (!/^\d{5}$/.test(mx.lugarExpedicion)) {
      issues.push({
        code: 'MISSING_CERTIFICATE',
        field: 'fiscal.mx.lugarExpedicion',
        message: MX_VALIDATION_MESSAGES.INVALID_LUGAR,
      });
    }

    // Probe del ambiente.
    if (mx.environment !== 'sandbox' && mx.environment !== 'production') {
      issues.push({
        code: 'INVALID_ENVIRONMENT',
        field: 'fiscal.mx.environment',
        message: MX_VALIDATION_MESSAGES.INVALID_ENVIRONMENT,
      });
    }

    return { ok: issues.length === 0, issues };
  }

  /**
   * Emite un comprobante CFDI 4.0 estructuralmente válido. Sin
   * firma digital ni transmisión a PAC — eso llega con .
   *
   * Lee los settings MX desde `input.tenantSettings` (poblado por
   * el orchestrator). Si los settings no están listos (RFC,
   * régimen, lugar) levanta `FISCAL_PACK_NOT_AVAILABLE` con guía
   * para el operator.
   */
  async issue(input: FiscalAdapterIssueInput): Promise<FiscalAdapterIssueResult> {
    const settings = readMxFiscalSettings(input.tenantSettings ?? null);

    if (
      !settings.enabled ||
      !settings.rfc ||
      !settings.regimenFiscalCode ||
      !settings.lugarExpedicion
    ) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'FISCAL_PACK_NOT_AVAILABLE',
        message:
          'Activa el pack fiscal MX y captura RFC, régimen fiscal y lugar de expedición en /company → Fiscal antes de emitir.',
        details: {
          countryCode: 'MX',
          disabled: !settings.enabled,
          missingSettings:
            !settings.rfc || !settings.regimenFiscalCode || !settings.lugarExpedicion,
        },
      });
    }

    const emisorName = input.issuerName ?? settings.rfc;
    const serialized = serializeCfdi40(input, settings, emisorName);

    return {
      cufe: serialized.uuid,
      status: 'pending' satisfies FiscalDocumentStatus,
      providerId: this.providerId,
      providerResponse: {
        kind: 'unsigned-draft',
        xmlSize: serialized.xml.length,
        emisorRfc: serialized.emisorRfc,
        receptorRfc: serialized.receptorRfc,
        tipoComprobante: serialized.tipoComprobante,
      },
      xmlRef: serialized.xml,
    };
  }

  /**
   * Cancelación SAT explícita — operación API separada en SAT, NO
   * una nueva emisión XML.  traerá el endpoint del PAC
   * para cancelar; por ahora levanta `FISCAL_PACK_NOT_AVAILABLE`.
   *
   * Importante: el `sales.void` del POS NO llama esta función. El
   * orchestrator dispatcha sale.void → adapter.issue() con
   * source='void', y el serializer trata el caso como CFDI Egreso
   * con CfdiRelacionados al original. La cancelación SAT real es
   * una operación administrativa que el operador inicia desde la
   * UI de fiscal-documents y va por un flow separado.
   */
  async voidDocument(_input: FiscalAdapterVoidInput): Promise<FiscalAdapterIssueResult> {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'FISCAL_PACK_NOT_AVAILABLE',
      message: 'La cancelación SAT todavía no está disponible en el adaptador de México.',
      details: { countryCode: 'MX', unavailableCapability: 'sat_cancellation' },
    });
  }

  /**
   * Sin PAC no hay status real para reportar.  enchufa el
   * polling al daemon de contingencia.
   */
  async fetchStatus(_cufe: string): Promise<FiscalDocumentStatus> {
    return 'pending';
  }
}
