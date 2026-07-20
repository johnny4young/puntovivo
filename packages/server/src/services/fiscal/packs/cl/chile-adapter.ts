/**
 * Chile fiscal pack (`ChileSIIAdapter`).
 *
 * Validates tenant settings and emits structurally valid DTE 1.0 XML in
 * `draft` maturity. The orchestrator allocates the CAF folio atomically and
 * supplies it to this stateless adapter. XAdES signing, SII transmission,
 * status polling, digital delivery, and explicit cancellation are not
 * implemented.
 *
 * @module services/fiscal/packs/cl/chile-adapter
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
import { findGiroComercial, findComuna } from './catalogs/index.js';
import { serializeDte10 } from './dte10-xml.js';
import { validateRut } from './rut.js';
import { readClFiscalSettings } from './settings.js';

const CL_PROVIDER_ID = 'sii-cl';

const CL_CAPABILITIES: FiscalAdapterCapabilities = {
  // Emisión implementada. voidDocument explícito (anulación
  // SII) sigue parqueado. fetchStatus retorna 'pending' siempre.
  supportsVoid: false,
  supportsDebitNote: false,
  supportsFetchStatus: false,
};

/**
 * Mensajes localizables sólo en server-side. La UI mapea via i18n
 * (`errors:server.FISCAL_RUT_INVALID`); estos mensajes son el
 * fallback para audit logs y server logs.
 */
const CL_VALIDATION_MESSAGES = {
  MISSING_RUT: 'Captura el RUT del emisor antes de habilitar la emisión.',
  INVALID_RUT: 'El RUT del emisor no es válido según las reglas del SII.',
  MISSING_GIRO: 'Captura el giro comercial del emisor.',
  INVALID_GIRO: 'El código del giro comercial no existe en el catálogo CIIU.cl.',
  MISSING_CASA_MATRIZ: 'Captura la dirección de la casa matriz.',
  MISSING_COMUNA: 'Captura la comuna del lugar de emisión.',
  INVALID_COMUNA: 'El código de la comuna no existe en el catálogo SUBDERE.',
  INVALID_ENVIRONMENT: 'El ambiente debe ser certificacion o produccion.',
} as const;

export class ChileSIIAdapter implements FiscalAdapter {
  readonly providerId = CL_PROVIDER_ID;
  readonly countryCode = 'CL';
  readonly capabilities = CL_CAPABILITIES;
  // draft: structurally-valid DTE 1.0 XML with a CAF folio, but
  // unsigned (no XAdES) and not transmitted to the SII. Signing + SII
  // delivery + cancelación are gated as .
  readonly maturity = 'draft' as const;

  async validateConfig(input: FiscalAdapterConfig): Promise<FiscalAdapterValidationResult> {
    const cl = readClFiscalSettings(input.settings);
    const issues: FiscalAdapterValidationIssue[] = [];

    // Probe del RUT del emisor.
    if (!cl.rut) {
      issues.push({
        code: 'MISSING_RUT',
        field: 'fiscal.cl.rut',
        message: CL_VALIDATION_MESSAGES.MISSING_RUT,
      });
    } else {
      const rutResult = validateRut(cl.rut);
      if (!rutResult.ok) {
        issues.push({
          code: 'MISSING_RUT',
          field: 'fiscal.cl.rut',
          message: `${CL_VALIDATION_MESSAGES.INVALID_RUT} ${rutResult.message}`,
        });
      }
    }

    // Probe del giro comercial. Reusamos el code MISSING_RESOLUTION
    // del enum compartido () con la equivalencia semántica
    // documentada — el giro chileno cumple el rol del régimen
    // fiscal mexicano: "actividad económica declarada al SII".
    if (!cl.giroCode) {
      issues.push({
        code: 'MISSING_RESOLUTION',
        field: 'fiscal.cl.giroCode',
        message: CL_VALIDATION_MESSAGES.MISSING_GIRO,
      });
    } else if (!findGiroComercial(cl.giroCode)) {
      issues.push({
        code: 'MISSING_RESOLUTION',
        field: 'fiscal.cl.giroCode',
        message: CL_VALIDATION_MESSAGES.INVALID_GIRO,
      });
    }

    // Probe de la casa matriz: el SII pide la dirección como dato
    // de identificación del emisor. Usamos MISSING_CERTIFICATE
    // porque  va a extender este probe con el certificado
    // digital del emisor (mismo code, dato de identificación
    // ampliado).
    if (!cl.casaMatriz || cl.casaMatriz.trim().length === 0) {
      issues.push({
        code: 'MISSING_CERTIFICATE',
        field: 'fiscal.cl.casaMatriz',
        message: CL_VALIDATION_MESSAGES.MISSING_CASA_MATRIZ,
      });
    }

    // Probe de la comuna: el SII pide el código SUBDERE del lugar
    // de emisión. La comuna y la casa matriz son ambas datos del
    // emisor; los agrupamos bajo MISSING_CERTIFICATE para que la
    // UI muestre un solo issue en vez de dos.
    if (!cl.comunaCode) {
      issues.push({
        code: 'MISSING_CERTIFICATE',
        field: 'fiscal.cl.comunaCode',
        message: CL_VALIDATION_MESSAGES.MISSING_COMUNA,
      });
    } else if (!findComuna(cl.comunaCode)) {
      issues.push({
        code: 'MISSING_CERTIFICATE',
        field: 'fiscal.cl.comunaCode',
        message: CL_VALIDATION_MESSAGES.INVALID_COMUNA,
      });
    }

    // Probe del ambiente. `readClFiscalSettings` ya normaliza a
    // 'certificacion' / 'produccion' con default certificacion;
    // este branch es defensivo para futuras shape variations.
    if (cl.environment !== 'certificacion' && cl.environment !== 'produccion') {
      issues.push({
        code: 'INVALID_ENVIRONMENT',
        field: 'fiscal.cl.environment',
        message: CL_VALIDATION_MESSAGES.INVALID_ENVIRONMENT,
      });
    }

    return { ok: issues.length === 0, issues };
  }

  /**
   * Emite un DTE 1.0 estructuralmente válido. Sin firma digital ni
   * transmisión SII — eso llega con .
   *
   * Lee los settings CL desde `input.tenantSettings` (poblado por el
   * orchestrator). Lee la pre-allocación del folio CAF desde
   * `input.chileAllocation` (poblado por el orchestrator dentro de
   * su write transaction). Si los settings no están listos o el
   * allocation falta, levanta `FISCAL_PACK_NOT_AVAILABLE` con guía
   * para el operador.
   */
  async issue(input: FiscalAdapterIssueInput): Promise<FiscalAdapterIssueResult> {
    const settings = readClFiscalSettings(input.tenantSettings ?? null);

    if (
      !settings.enabled ||
      !settings.rut ||
      !settings.giroCode ||
      !settings.comunaCode ||
      !settings.casaMatriz
    ) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'FISCAL_PACK_NOT_AVAILABLE',
        message:
          'Activa el pack fiscal CL y captura RUT, giro, comuna y casa matriz en /company → Fiscal antes de emitir.',
        details: {
          countryCode: 'CL',
          disabled: !settings.enabled,
          missingSettings:
            !settings.rut || !settings.giroCode || !settings.comunaCode || !settings.casaMatriz,
        },
      });
    }

    if (!input.chileAllocation) {
      // Defensive: in production the orchestrator MUST allocate the
      // folio before calling this adapter. Surfacing this as a
      // dedicated error gives the operator + diagnostic workflow a clean
      // signal instead of a generic XML serialization failure.
      throwServerError({
        trpcCode: 'INTERNAL_SERVER_ERROR',
        errorCode: 'FISCAL_PACK_NOT_AVAILABLE',
        message:
          'CL fiscal emission requires a pre-allocated CAF folio in input.chileAllocation. Orchestrator must populate before adapter call.',
        details: { countryCode: 'CL' },
      });
    }

    const emisorName = input.issuerName ?? settings.rut;
    const serialized = serializeDte10(input, settings, emisorName, input.chileAllocation);

    // CUFE shape: `sii-cl:<RUT>:<TipoDTE>:<F>`. Determinístico,
    // colisión imposible cross-tenant porque RUT es único por
    // emisor + folio único por (RUT, TipoDTE). El SII no asigna
    // UUIDs como SAT — el documento se identifica por la tupla
    // (emisor, tipoDTE, folio).
    const cufe = `sii-cl:${serialized.emisorRut}:${serialized.tipoDte}:${serialized.folio}`;

    return {
      cufe,
      status: 'pending' satisfies FiscalDocumentStatus,
      providerId: this.providerId,
      providerResponse: {
        kind: 'unsigned-draft',
        cafId: input.chileAllocation.cafId,
        folio: serialized.folio,
        tipoDte: serialized.tipoDte,
        rangeRemaining: input.chileAllocation.rangeRemaining,
        emisorRut: serialized.emisorRut,
        receptorRut: serialized.receptorRut,
        mntTotal: serialized.mntTotal,
        xmlSize: serialized.xml.length,
      },
      xmlRef: serialized.xml,
    };
  }

  /**
   * Anulación SII explícita — operación API separada en el SII, NO
   * la misma cosa que un sale.void en el lifecycle del POS.
   * traerá el endpoint SII para anular; por ahora levanta
   * `FISCAL_PACK_NOT_AVAILABLE`.
   *
   * Importante: el `sales.void` del POS NO llama esta función. El
   * orchestrator dispatcha sale.void → adapter.issue() con
   * source='void', y el serializer trata el caso como NC con
   * Referencia.CodRef='1' (anula documento de referencia). La
   * anulación SII real es una operación administrativa que el
   * operador inicia desde la UI fiscal-documents y va por un flow
   * separado.
   */
  async voidDocument(_input: FiscalAdapterVoidInput): Promise<FiscalAdapterIssueResult> {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'FISCAL_PACK_NOT_AVAILABLE',
      message: 'La anulación SII todavía no está disponible en el adaptador de Chile.',
      details: { countryCode: 'CL', unavailableCapability: 'sii_cancellation' },
    });
  }

  /**
   * Sin SII no hay status real para reportar.  lo enchufa al
   * daemon de status polling con el endpoint del SII.
   */
  async fetchStatus(_cufe: string): Promise<FiscalDocumentStatus> {
    return 'pending';
  }
}
