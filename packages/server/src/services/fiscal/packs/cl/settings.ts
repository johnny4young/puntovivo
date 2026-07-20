/**
 * Lectura y escritura de los ajustes fiscales del pack
 * Chile sobre el blob `tenants.settings` (JSON columna).
 *
 * Namespace: `tenants.settings.fiscal.cl.*`. Espejo del helper de
 * MX (`packs/mx/settings.ts`); convive con `fiscal.mx.*` y con el
 * flag `fiscal_dian_enabled` heredado del pack Colombia. El rename
 * a un namespace country-aware completo se queda parqueado para
 * (cuando el pack CO migre al mismo namespace en lugar
 * de la prosa `fiscal_dian_enabled`).
 *
 * @module services/fiscal/packs/cl/settings
 */

/**
 * Forma resuelta de los ajustes fiscales CL. Todos los campos
 * tienen un default explícito para que el adapter CL pueda leer
 * sin nullchecks anidados.
 */
export interface ClFiscalSettings {
  /** Switch maestro del pack CL. Default `false` para tenants nuevos. */
  enabled: boolean;
  /** RUT del emisor (formato `NNNNNNNN-X`). `null` cuando no se ha capturado. */
  rut: string | null;
  /** Código CIIU.cl rev 4 del giro principal del emisor. */
  giroCode: string | null;
  /** Código SUBDERE de la comuna del lugar de emisión. */
  comunaCode: number | null;
  /** Dirección de la casa matriz (texto libre). */
  casaMatriz: string | null;
  /**
   * Ambiente del SII.  lo traduce al naming del proveedor
   * de timbraje al ship time.
   */
  environment: 'certificacion' | 'produccion';
}

const DEFAULT_CL_SETTINGS: ClFiscalSettings = {
  enabled: false,
  rut: null,
  giroCode: null,
  comunaCode: null,
  casaMatriz: null,
  environment: 'certificacion',
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Lee la rama `fiscal.cl` desde el blob de `tenants.settings`.
 * Acepta `null` / `undefined` / shape malformado y devuelve los
 * defaults — nunca tira excepción.
 */
export function readClFiscalSettings(
  tenantSettings: Record<string, unknown> | null | undefined
): ClFiscalSettings {
  if (!isPlainRecord(tenantSettings)) return { ...DEFAULT_CL_SETTINGS };

  const fiscal = tenantSettings.fiscal;
  if (!isPlainRecord(fiscal)) return { ...DEFAULT_CL_SETTINGS };

  const cl = (fiscal as Record<string, unknown>).cl;
  if (!isPlainRecord(cl)) return { ...DEFAULT_CL_SETTINGS };

  const enabled = typeof cl.enabled === 'boolean' ? cl.enabled : DEFAULT_CL_SETTINGS.enabled;
  const rut = typeof cl.rut === 'string' && cl.rut.length > 0 ? cl.rut : null;
  const giroCode = typeof cl.giroCode === 'string' && cl.giroCode.length > 0 ? cl.giroCode : null;
  const comunaCode =
    typeof cl.comunaCode === 'number' && Number.isFinite(cl.comunaCode) ? cl.comunaCode : null;
  const casaMatriz =
    typeof cl.casaMatriz === 'string' && cl.casaMatriz.length > 0 ? cl.casaMatriz : null;
  const environment = cl.environment === 'produccion' ? 'produccion' : 'certificacion';

  return { enabled, rut, giroCode, comunaCode, casaMatriz, environment };
}

/**
 * Construye un parche JSON parcial para escribir contra
 * `tenants.settings`. El parche sólo contiene las keys que el
 * caller especificó.
 */
export function buildClFiscalSettingsPatch(
  partial: Partial<ClFiscalSettings>
): Record<string, unknown> {
  const clPatch: Record<string, unknown> = {};
  if (partial.enabled !== undefined) clPatch.enabled = partial.enabled;
  if (partial.rut !== undefined) clPatch.rut = partial.rut;
  if (partial.giroCode !== undefined) clPatch.giroCode = partial.giroCode;
  if (partial.comunaCode !== undefined) clPatch.comunaCode = partial.comunaCode;
  if (partial.casaMatriz !== undefined) clPatch.casaMatriz = partial.casaMatriz;
  if (partial.environment !== undefined) clPatch.environment = partial.environment;
  return clPatch;
}

/**
 * Merge inmutable: devuelve un nuevo `tenants.settings` blob con
 * la rama `fiscal.cl` actualizada según el parche. Preserva el
 * resto del blob (fiscal.mx, fiscal_dian_enabled, ai, locale,
 * etc.) sin tocarlos.
 */
export function mergeClFiscalSettingsIntoTenantSettings(
  existing: Record<string, unknown> | null | undefined,
  clPatch: Record<string, unknown>
): Record<string, unknown> {
  const base = isPlainRecord(existing) ? { ...existing } : {};
  const fiscalBranch = isPlainRecord(base.fiscal) ? { ...base.fiscal } : {};
  const clBranch = isPlainRecord(fiscalBranch.cl) ? { ...fiscalBranch.cl } : {};

  base.fiscal = {
    ...fiscalBranch,
    cl: { ...clBranch, ...clPatch },
  };

  return base;
}
