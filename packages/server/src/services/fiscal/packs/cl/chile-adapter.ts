/**
 * ENG-036a — Pack fiscal de Chile (`ChileSIIAdapter`).
 *
 * Renombrado desde el stub `ChileNotImplementedAdapter` (ENG-034)
 * a un adapter con `validateConfig` real. La emisión de DTE
 * (Documento Tributario Electrónico) + integración con SII +
 * firmado XAdES + entrega digital siguen parqueados —
 * `issue` / `voidDocument` / `fetchStatus` siguen tirando
 * `FISCAL_PACK_NOT_AVAILABLE` con el mensaje apuntando a
 * `ENG-036b` (modelado XML DTE) / `ENG-036c` (certificación SII +
 * firma + entrega digital).
 *
 * El adapter sigue implementando `NotImplementedFiscalAdapter`
 * porque la emisión real no shipa todavía; `availableInTicket` se
 * actualiza a `'ENG-036b'` para que `listFiscalAdapterCountries()`
 * y la futura card de readiness reflejen la frontera correcta.
 *
 * `validateConfig` ahora hace una probe real:
 *
 * - `MISSING_RUT` cuando el RUT está vacío o falla `validateRut`.
 * - `MISSING_RESOLUTION` cuando el giro no está capturado o no
 *   existe en el catálogo CIIU.cl curado (mapeo semántico: el
 *   giro chileno equivale al régimen mexicano para efectos del
 *   probe; reusamos el code del enum compartido).
 * - `MISSING_CERTIFICATE` cuando la casa matriz está vacía o
 *   cuando la comuna no es válida — el SII pide ambos como dato
 *   de identificación del emisor; los agrupamos bajo este code
 *   porque cuando ENG-036c agregue el certificado digital del
 *   emisor (CSD-equivalente chileno), el probe va a usar el
 *   mismo code.
 * - `INVALID_ENVIRONMENT` cuando el ambiente no es `'certificacion'`
 *   ni `'produccion'`.
 *
 * @module services/fiscal/packs/cl/chile-adapter
 */

import type { FiscalDocumentStatus } from '../../../../db/schema.js';
import { throwServerError } from '../../../../lib/errorCodes.js';
import type {
  FiscalAdapterCapabilities,
  FiscalAdapterConfig,
  FiscalAdapterIssueResult,
  FiscalAdapterValidationIssue,
  FiscalAdapterValidationResult,
  NotImplementedFiscalAdapter,
} from '../../adapter.js';
import { findGiroComercial, findComuna } from './catalogs/index.js';
import { validateRut } from './rut.js';
import { readClFiscalSettings } from './settings.js';

/**
 * Ticket que cierra la emisión real (XML DTE 1.0 sin firmar).
 * ENG-036c agrega encima la integración SII + firmado XAdES +
 * entrega digital + retry daemon.
 */
const CL_AVAILABLE_IN = 'ENG-036b';
const CL_PROVIDER_ID = 'sii-cl';

const CL_CAPABILITIES: FiscalAdapterCapabilities = {
  // Las tres capabilities siguen apagadas hasta ENG-036c.
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

export class ChileSIIAdapter implements NotImplementedFiscalAdapter {
  readonly providerId = CL_PROVIDER_ID;
  readonly countryCode = 'CL';
  readonly notImplemented = true as const;
  readonly availableInTicket = CL_AVAILABLE_IN;
  readonly capabilities = CL_CAPABILITIES;

  async validateConfig(
    input: FiscalAdapterConfig
  ): Promise<FiscalAdapterValidationResult> {
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
    // del enum compartido (ENG-034) con la equivalencia semántica
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
    // porque ENG-036c va a extender este probe con el certificado
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
    if (
      cl.environment !== 'certificacion' &&
      cl.environment !== 'produccion'
    ) {
      issues.push({
        code: 'INVALID_ENVIRONMENT',
        field: 'fiscal.cl.environment',
        message: CL_VALIDATION_MESSAGES.INVALID_ENVIRONMENT,
      });
    }

    return { ok: issues.length === 0, issues };
  }

  // -------------------------------------------------------------
  // Emisión real: parqueada hasta ENG-036b/c. Cualquier llamada
  // levanta FISCAL_PACK_NOT_AVAILABLE con el mensaje localizable
  // que el web traduce vía errors:server.FISCAL_PACK_NOT_AVAILABLE.
  // -------------------------------------------------------------

  async issue(): Promise<FiscalAdapterIssueResult> {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'FISCAL_PACK_NOT_AVAILABLE',
      message: `La emisión SII de Chile llega con ${CL_AVAILABLE_IN}.`,
      details: { countryCode: 'CL', availableInTicket: CL_AVAILABLE_IN },
    });
  }

  async voidDocument(): Promise<FiscalAdapterIssueResult> {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'FISCAL_PACK_NOT_AVAILABLE',
      message: `La emisión SII de Chile llega con ${CL_AVAILABLE_IN}.`,
      details: { countryCode: 'CL', availableInTicket: CL_AVAILABLE_IN },
    });
  }

  async fetchStatus(): Promise<FiscalDocumentStatus> {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'FISCAL_PACK_NOT_AVAILABLE',
      message: `La emisión SII de Chile llega con ${CL_AVAILABLE_IN}.`,
      details: { countryCode: 'CL', availableInTicket: CL_AVAILABLE_IN },
    });
  }
}
