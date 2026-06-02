/**
 * ENG-184 — Read/write of the Colombia fiscal config over the
 * `tenants.settings` JSON blob, plus a presence-only readiness probe.
 *
 * Namespace nuance (deliberate, non-obvious): Colombia is the LEGACY
 * fiscal pack. Its master kill-switch has always lived at the
 * top-level `tenants.settings.fiscal_dian_enabled` (read by the fiscal
 * orchestrator's emission gate AND by `setupReadiness`). The MX/CL
 * packs instead nest `enabled` under `fiscal.<country>.enabled`.
 * ENG-184 does NOT migrate CO to that nested flag (the rename is
 * ENG-035c's job) — it keeps writing the legacy top-level flag so the
 * config card and the emission path never disagree. The CO-specific
 * issuer fields live under `tenants.settings.fiscal.co.*`, mirroring
 * where MX/CL keep theirs.
 *
 * Real DIAN transmission, certificate and CUFE crypto validation stay
 * mock / gated behind ENG-021 — `validateCoFiscalConfig` here is a
 * PRESENCE probe only (are NIT / resolution / numbering range filled?),
 * never a cryptographic check.
 *
 * @module services/fiscal/packs/co/settings
 */

import type {
  FiscalAdapterValidationIssue,
  FiscalAdapterValidationResult,
} from '../../adapter.js';

/**
 * Resolved Colombia fiscal config. `enabled` mirrors the legacy
 * top-level `fiscal_dian_enabled` flag; the issuer fields come from
 * `tenants.settings.fiscal.co.*`. Every field carries an explicit
 * default so callers read without nested null-checks. `null` on a
 * string/number field means "not captured yet".
 */
export interface CoFiscalSettings {
  /** DIAN electronic-invoicing master switch (legacy `fiscal_dian_enabled`). */
  enabled: boolean;
  /** Issuer NIT (9-10 digits, optional verification digit). `null` until captured. */
  nit: string | null;
  /** DIAN numbering resolution number authorising the range. `null` until captured. */
  dianResolutionNumber: string | null;
  /** Invoice prefix granted by the resolution (e.g. `SETP`, `FE`). `null` until captured. */
  prefix: string | null;
  /** First consecutive authorised by the resolution. `null` until captured. */
  rangeFrom: number | null;
  /** Last consecutive authorised by the resolution. `null` until captured. */
  rangeTo: number | null;
  /**
   * DIAN environment. `habilitacion` = the DIAN test/enablement set
   * (CUFE environment `2`); `produccion` = live (CUFE environment `1`).
   * ENG-021 maps this to the provider's naming at transmission time.
   */
  environment: 'habilitacion' | 'produccion';
}

const DEFAULT_CO_SETTINGS: CoFiscalSettings = {
  enabled: false,
  nit: null,
  dianResolutionNumber: null,
  prefix: null,
  rangeFrom: null,
  rangeTo: null,
  environment: 'habilitacion',
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readPositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

/**
 * Read the Colombia fiscal config from a `tenants.settings` blob.
 * Tolerates `null` / `undefined` / malformed shapes and returns the
 * defaults — never throws. `enabled` reads the top-level legacy flag;
 * issuer fields read the `fiscal.co` branch.
 */
export function readCoFiscalSettings(
  tenantSettings: Record<string, unknown> | null | undefined
): CoFiscalSettings {
  if (!isPlainRecord(tenantSettings)) return { ...DEFAULT_CO_SETTINGS };

  const enabled = tenantSettings.fiscal_dian_enabled === true;

  const fiscal = tenantSettings.fiscal;
  const co = isPlainRecord(fiscal) && isPlainRecord(fiscal.co) ? fiscal.co : null;
  if (!co) {
    return { ...DEFAULT_CO_SETTINGS, enabled };
  }

  const environment = co.environment === 'produccion' ? 'produccion' : 'habilitacion';

  return {
    enabled,
    nit: readString(co.nit),
    dianResolutionNumber: readString(co.dianResolutionNumber),
    prefix: readString(co.prefix),
    rangeFrom: readPositiveInt(co.rangeFrom),
    rangeTo: readPositiveInt(co.rangeTo),
    environment,
  };
}

/**
 * Partial patch the caller can pass to the merge helper. Only keys
 * present here are written; absent keys preserve the prior value. The
 * `enabled` key is handled specially by the merge (top-level flag).
 */
export type CoFiscalSettingsPatch = Partial<CoFiscalSettings>;

/**
 * Immutable merge: returns a new `tenants.settings` blob with the
 * legacy `fiscal_dian_enabled` flag and the `fiscal.co` branch updated
 * per the patch. Preserves every other namespace (fiscal.mx, fiscal.cl,
 * ai, modules, locale, ...) untouched.
 */
export function mergeCoFiscalSettingsIntoTenantSettings(
  existing: Record<string, unknown> | null | undefined,
  patch: CoFiscalSettingsPatch
): Record<string, unknown> {
  const base = isPlainRecord(existing) ? { ...existing } : {};

  // Legacy top-level master flag (kept in lockstep with the card toggle
  // so the emission gate and readiness never diverge).
  if (patch.enabled !== undefined) {
    base.fiscal_dian_enabled = patch.enabled;
  }

  const fiscalBranch = isPlainRecord(base.fiscal) ? { ...base.fiscal } : {};
  const coBranch = isPlainRecord(fiscalBranch.co) ? { ...fiscalBranch.co } : {};

  if (patch.nit !== undefined) coBranch.nit = patch.nit;
  if (patch.dianResolutionNumber !== undefined) {
    coBranch.dianResolutionNumber = patch.dianResolutionNumber;
  }
  if (patch.prefix !== undefined) coBranch.prefix = patch.prefix;
  if (patch.rangeFrom !== undefined) coBranch.rangeFrom = patch.rangeFrom;
  if (patch.rangeTo !== undefined) coBranch.rangeTo = patch.rangeTo;
  if (patch.environment !== undefined) coBranch.environment = patch.environment;

  base.fiscal = { ...fiscalBranch, co: coBranch };
  return base;
}

/**
 * Presence-only readiness probe for the Colombia fiscal config. Reports
 * which mandatory issuer fields are still missing so the config card
 * can paint an honest badge. This is NOT a cryptographic / transmission
 * check — certificate, CUFE signing and provider connectivity land with
 * ENG-021. `ok` is true once NIT + resolution + a valid numbering range
 * are captured (independent of the `enabled` toggle: the merchant can
 * complete the config before flipping DIAN on).
 */
export function validateCoFiscalConfig(
  settings: CoFiscalSettings
): FiscalAdapterValidationResult {
  const issues: FiscalAdapterValidationIssue[] = [];

  if (!settings.nit) {
    issues.push({
      code: 'MISSING_NIT',
      message: 'Issuer NIT is missing',
      field: 'fiscal.co.nit',
    });
  }
  if (!settings.dianResolutionNumber) {
    issues.push({
      code: 'MISSING_RESOLUTION',
      message: 'DIAN numbering resolution is missing',
      field: 'fiscal.co.dianResolutionNumber',
    });
  }
  if (
    settings.rangeFrom === null ||
    settings.rangeTo === null ||
    settings.rangeFrom > settings.rangeTo
  ) {
    issues.push({
      code: 'MISSING_RANGE',
      message: 'DIAN numbering range is missing or invalid',
      field: 'fiscal.co.rangeFrom',
    });
  }

  return { ok: issues.length === 0, issues };
}
