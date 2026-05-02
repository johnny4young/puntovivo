/**
 * ENG-035a / ENG-035b — Pack fiscal de México (`MexicoCFDIAdapter`).
 *
 * **ENG-035a (shipped)**: validación de configuración. El adapter
 * lee los settings `tenants.settings.fiscal.mx.*` y reporta
 * problemas accionables (RFC, régimen fiscal, lugar de
 * expedición, ambiente).
 *
 * **ENG-035b (este ticket)**: emisión real de XML CFDI 4.0
 * estructuralmente válido contra Anexo 20. El adapter sale del
 * stub `NotImplementedFiscalAdapter` y pasa a implementar el
 * contract `FiscalAdapter` directamente. `issue()` devuelve un
 * resultado con `cufe = uuid local`, `status = 'pending'`, y
 * `xmlRef = string XML`. Sin firmado CSD ni transmisión a PAC —
 * eso queda para ENG-035c.
 *
 * **ENG-035c (parqueado)**: integración PAC + firmado CSD +
 * complemento Pago 2.0 + cancelación SAT.
 *
 * El adapter es stateless y puro: lee `input.tenantSettings` para
 * extraer los settings MX y `input.issuerName` para el nombre del
 * emisor. El orchestrator es responsable de poblar ambos antes de
 * llamar `issue()`.
 *
 * `voidDocument()` (operación de cancelación SAT explícita, NO la
 * misma cosa que un sale.void en el lifecycle del POS) sigue
 * tirando `FISCAL_PACK_NOT_AVAILABLE` apuntando a ENG-035c —
 * cancelación SAT requiere el endpoint API del PAC, no es una
 * nueva emisión XML. El sale.void del POS, en cambio, sí pasa
 * por `issue()` con source='void' kind='ND' y se trata como CFDI
 * Egreso con CfdiRelacionados.
 *
 * `fetchStatus()` retorna 'pending' — sin PAC no hay status real
 * para reportar. El daemon de contingencia que llega con
 * ENG-035c lo va a usar para polling.
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

/**
 * Ticket que cierra cancelación SAT + PAC + firmado CSD. La
 * emisión XML ya shipa con ENG-035b.
 */
const MX_CANCELACION_GATED_BY = 'ENG-035c';
const MX_PROVIDER_ID = 'cfdi-mx';

const MX_CAPABILITIES: FiscalAdapterCapabilities = {
  // ENG-035b: la emisión está implementada para todos los flows
  // que el orchestrator llama (sale, return, void → todos pasan
  // por issue() con su source). voidDocument explícito (cancelación
  // SAT) sigue parqueado.
  supportsVoid: false,
  supportsDebitNote: false,
  // fetchStatus no hace polling real — retorna 'pending' siempre.
  // ENG-035c lo enchufa al daemon de contingencia.
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

  async validateConfig(
    input: FiscalAdapterConfig
  ): Promise<FiscalAdapterValidationResult> {
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
   * firma digital ni transmisión a PAC — eso llega con ENG-035c.
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
   * una nueva emisión XML. ENG-035c traerá el endpoint del PAC
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
      message: `La cancelación SAT del CFDI 4.0 llega con ${MX_CANCELACION_GATED_BY}.`,
      details: { countryCode: 'MX', availableInTicket: MX_CANCELACION_GATED_BY },
    });
  }

  /**
   * Sin PAC no hay status real para reportar. ENG-035c enchufa el
   * polling al daemon de contingencia.
   */
  async fetchStatus(_cufe: string): Promise<FiscalDocumentStatus> {
    return 'pending';
  }
}
