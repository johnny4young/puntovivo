/**
 * Lectura y escritura de los ajustes fiscales del pack
 * México sobre el blob `tenants.settings` (JSON columna).
 *
 * Namespace: `tenants.settings.fiscal.mx.*`. Conviven con el flag
 * `tenants.settings.fiscal_dian_enabled` heredado del pack Colombia
 * el rename a `tenants.settings.fiscal.{country}.enabled` queda
 * capturado para  (cuando el pack CO migre al mismo
 * namespace en lugar de la prosa `fiscal_dian_enabled`).
 *
 * Este módulo expone:
 * - `readMxFiscalSettings(blob)` → forma normalizada con defaults
 * sensatos (enabled=false, environment='sandbox', resto null).
 * - `buildMxFiscalSettingsPatch(partial)` → arma el patch JSON
 * para hacer merge contra `tenants.settings`.
 * - `mergeMxFiscalSettingsIntoTenantSettings(...)` → inmutable
 * merge que respeta otros namespaces (fiscal.co, fiscal.cl, ai,
 * etc.). Sólo este helper sabe la estructura interna del blob.
 *
 * @module services/fiscal/packs/mx/settings
 */

/**
 * Forma resuelta de los ajustes fiscales MX. Todos los campos
 * tienen un default explícito para que el adapter MX pueda leer
 * sin nullchecks anidados.
 */
export interface MxFiscalSettings {
  /** Switch maestro del pack MX. Default `false` para tenants nuevos. */
  enabled: boolean;
  /** RFC del emisor (12 PM o 13 PF). `null` cuando no se ha capturado. */
  rfc: string | null;
  /** Código SAT del régimen fiscal del emisor (ver catálogo regimenFiscal). */
  regimenFiscalCode: string | null;
  /** Código postal de 5 dígitos del lugar de expedición. */
  lugarExpedicion: string | null;
  /** Ambiente del PAC.  traduce esto al naming del proveedor. */
  environment: 'sandbox' | 'production';
}

const DEFAULT_MX_SETTINGS: MxFiscalSettings = {
  enabled: false,
  rfc: null,
  regimenFiscalCode: null,
  lugarExpedicion: null,
  environment: 'sandbox',
};

/**
 * Type guard tolerante: cualquier shape con keys reconocidas se
 * interpreta como un objeto MX; el resto cae a defaults. Esto es
 * importante porque `tenants.settings` es un JSON blob libre y
 * versiones anteriores pudieron haber escrito formas diferentes.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Lee la rama `fiscal.mx` desde el blob de `tenants.settings`.
 * Acepta `null` / `undefined` / shape malformado y devuelve los
 * defaults — nunca tira excepción.
 */
export function readMxFiscalSettings(
  tenantSettings: Record<string, unknown> | null | undefined
): MxFiscalSettings {
  if (!isPlainRecord(tenantSettings)) return { ...DEFAULT_MX_SETTINGS };

  const fiscal = tenantSettings.fiscal;
  if (!isPlainRecord(fiscal)) return { ...DEFAULT_MX_SETTINGS };

  const mx = (fiscal as Record<string, unknown>).mx;
  if (!isPlainRecord(mx)) return { ...DEFAULT_MX_SETTINGS };

  const enabled = typeof mx.enabled === 'boolean' ? mx.enabled : DEFAULT_MX_SETTINGS.enabled;
  const rfc = typeof mx.rfc === 'string' && mx.rfc.length > 0 ? mx.rfc : null;
  const regimenFiscalCode =
    typeof mx.regimenFiscalCode === 'string' && mx.regimenFiscalCode.length > 0
      ? mx.regimenFiscalCode
      : null;
  const lugarExpedicion =
    typeof mx.lugarExpedicion === 'string' && mx.lugarExpedicion.length > 0
      ? mx.lugarExpedicion
      : null;
  const environment = mx.environment === 'production' ? 'production' : 'sandbox';

  return { enabled, rfc, regimenFiscalCode, lugarExpedicion, environment };
}

/**
 * Construye un parche JSON parcial para escribir contra
 * `tenants.settings`. El parche sólo contiene las keys que el
 * caller especificó — los demás campos del blob (fiscal.co,
 * fiscal.cl, ai, etc.) se preservan vía
 * `mergeMxFiscalSettingsIntoTenantSettings`.
 */
export function buildMxFiscalSettingsPatch(
  partial: Partial<MxFiscalSettings>
): Record<string, unknown> {
  const mxPatch: Record<string, unknown> = {};
  if (partial.enabled !== undefined) mxPatch.enabled = partial.enabled;
  if (partial.rfc !== undefined) mxPatch.rfc = partial.rfc;
  if (partial.regimenFiscalCode !== undefined) {
    mxPatch.regimenFiscalCode = partial.regimenFiscalCode;
  }
  if (partial.lugarExpedicion !== undefined) {
    mxPatch.lugarExpedicion = partial.lugarExpedicion;
  }
  if (partial.environment !== undefined) {
    mxPatch.environment = partial.environment;
  }
  return mxPatch;
}

/**
 * Merge inmutable: devuelve un nuevo `tenants.settings` blob con
 * la rama `fiscal.mx` actualizada según el parche. Preserva el
 * resto del blob (otros packs fiscales, AI, locale, etc.) sin
 * tocarlos.
 */
export function mergeMxFiscalSettingsIntoTenantSettings(
  existing: Record<string, unknown> | null | undefined,
  mxPatch: Record<string, unknown>
): Record<string, unknown> {
  const base = isPlainRecord(existing) ? { ...existing } : {};
  const fiscalBranch = isPlainRecord(base.fiscal) ? { ...base.fiscal } : {};
  const mxBranch = isPlainRecord(fiscalBranch.mx) ? { ...fiscalBranch.mx } : {};

  base.fiscal = {
    ...fiscalBranch,
    mx: { ...mxBranch, ...mxPatch },
  };

  return base;
}
