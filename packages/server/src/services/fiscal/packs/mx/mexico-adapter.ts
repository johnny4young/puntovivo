/**
 * ENG-035a — Pack fiscal de México (`MexicoCFDIAdapter`).
 *
 * Renombrado desde el stub `MexicoNotImplementedAdapter` (ENG-034)
 * a un adapter con `validateConfig` real. La emisión de XML CFDI
 * 4.0 + integración con PAC + firmado CSD siguen parqueados —
 * `issue` / `voidDocument` / `fetchStatus` siguen tirando
 * `FISCAL_PACK_NOT_AVAILABLE` con el mensaje apuntando a
 * `ENG-035b` (modelado XML) / `ENG-035c` (PAC + firma + complemento
 * Pago 2.0).
 *
 * El adapter sigue implementando `NotImplementedFiscalAdapter`
 * porque la emisión real no shipa todavía; `availableInTicket` se
 * actualiza a `'ENG-035b'` para que `listFiscalAdapterCountries()`
 * y la futura card de readiness reflejen la frontera correcta.
 *
 * `validateConfig` ahora hace una probe real:
 *
 * - `MISSING_RFC` cuando el RFC está vacío o falla `validateRfc`.
 * - `MISSING_RESOLUTION` cuando el régimen fiscal no está
 *   capturado o no existe en el catálogo SAT (`regimenFiscal.ts`).
 * - `MISSING_CERTIFICATE` cuando el lugar de expedición no es un
 *   código postal de 5 dígitos.
 * - `INVALID_ENVIRONMENT` cuando el ambiente no es `'sandbox'` ni
 *   `'production'`.
 *
 * El nombre de `MISSING_RESOLUTION` / `MISSING_CERTIFICATE` viene
 * del enum `FiscalValidationIssueCode` de ENG-034: lo reusamos
 * con la traducción semántica obvia para MX (resolución = régimen
 * fiscal en CO terms; certificado = lugar de expedición es el
 * dato más cercano que tenemos antes de que entre el CSD real
 * en ENG-035c).
 *
 * @module services/fiscal/packs/mx/mexico-adapter
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
import { findRegimenFiscal } from './catalogs/index.js';
import { validateRfc } from './rfc.js';
import { readMxFiscalSettings } from './settings.js';

/**
 * Ticket que cierra la emisión real (XML CFDI 4.0 sin firmar).
 * ENG-035c agrega encima la integración PAC + firmado CSD +
 * complemento Pago 2.0.
 */
const MX_AVAILABLE_IN = 'ENG-035b';
const MX_PROVIDER_ID = 'cfdi-mx';

const MX_CAPABILITIES: FiscalAdapterCapabilities = {
  // Las tres capabilities siguen apagadas hasta ENG-035c. Se
  // encienden en ese ticket cuando llegue la emisión real.
  supportsVoid: false,
  supportsDebitNote: false,
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

export class MexicoCFDIAdapter implements NotImplementedFiscalAdapter {
  readonly providerId = MX_PROVIDER_ID;
  readonly countryCode = 'MX';
  readonly notImplemented = true as const;
  readonly availableInTicket = MX_AVAILABLE_IN;
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

    // Probe del régimen fiscal: debe estar capturado y existir en
    // el catálogo SAT. Reusamos el código MISSING_RESOLUTION del
    // enum compartido (ENG-034) con la equivalencia semántica
    // documentada arriba.
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

    // Probe del lugar de expedición: el SAT pide código postal de
    // 5 dígitos. Reusamos MISSING_CERTIFICATE del enum compartido
    // (ENG-035c agregará el probe del CSD real con el mismo código).
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

    // Probe del ambiente. `readMxFiscalSettings` ya normaliza a
    // 'sandbox'/'production' con default sandbox; este branch es
    // defensivo para futuras shape variations.
    if (mx.environment !== 'sandbox' && mx.environment !== 'production') {
      issues.push({
        code: 'INVALID_ENVIRONMENT',
        field: 'fiscal.mx.environment',
        message: MX_VALIDATION_MESSAGES.INVALID_ENVIRONMENT,
      });
    }

    return { ok: issues.length === 0, issues };
  }

  // -------------------------------------------------------------
  // Emisión real: parqueada hasta ENG-035b/c. Cualquier llamada
  // levanta FISCAL_PACK_NOT_AVAILABLE con el mensaje localizable
  // que el web traduce vía errors:server.FISCAL_PACK_NOT_AVAILABLE.
  // -------------------------------------------------------------

  async issue(): Promise<FiscalAdapterIssueResult> {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'FISCAL_PACK_NOT_AVAILABLE',
      message: `La emisión CFDI 4.0 de México llega con ${MX_AVAILABLE_IN}.`,
      details: { countryCode: 'MX', availableInTicket: MX_AVAILABLE_IN },
    });
  }

  async voidDocument(): Promise<FiscalAdapterIssueResult> {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'FISCAL_PACK_NOT_AVAILABLE',
      message: `La emisión CFDI 4.0 de México llega con ${MX_AVAILABLE_IN}.`,
      details: { countryCode: 'MX', availableInTicket: MX_AVAILABLE_IN },
    });
  }

  async fetchStatus(): Promise<FiscalDocumentStatus> {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'FISCAL_PACK_NOT_AVAILABLE',
      message: `La emisión CFDI 4.0 de México llega con ${MX_AVAILABLE_IN}.`,
      details: { countryCode: 'MX', availableInTicket: MX_AVAILABLE_IN },
    });
  }
}
