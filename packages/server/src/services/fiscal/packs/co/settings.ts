/**
 * Read/write of the Colombia fiscal config over the
 * `tenants.settings` JSON blob, plus a presence-only readiness probe.
 *
 * Namespace nuance (deliberate, non-obvious): Colombia is the LEGACY
 * fiscal pack. Its master kill-switch has always lived at the
 * top-level `tenants.settings.fiscal_dian_enabled` (read by the fiscal
 * orchestrator's emission gate AND by `setupReadiness`). The MX/CL
 * packs instead nest `enabled` under `fiscal.<country>.enabled`.
 * does NOT migrate CO to that nested flag (the rename is
 * 's job) — it keeps writing the legacy top-level flag so the
 * config card and the emission path never disagree. The CO-specific
 * issuer fields live under `tenants.settings.fiscal.co.*`, mirroring
 * where MX/CL keep theirs.
 *
 * Real DIAN transmission, certificate and CUFE/CUDE validation stay
 * mock / gated — `validateCoFiscalConfig` here is a
 * PRESENCE probe only (are NIT / resolution / numbering range filled?),
 * never a cryptographic check.
 *
 * @module services/fiscal/packs/co/settings
 */

import type { FiscalAdapterValidationIssue, FiscalAdapterValidationResult } from '../../adapter.js';
import { validateNit } from './nit.js';

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
   * (hash TipoAmbiente `2`); `produccion` = live (TipoAmbiente `1`).
   */
  environment: 'habilitacion' | 'produccion';
  /** Software identifier registered with DIAN. `null` until captured. */
  softwareId: string | null;
  /**
   * Software PIN registered with DIAN; the CUDE security code. Restricted
   * value: never return it to a client. `null` until captured.
   */
  softwarePin: string | null;
}

const DEFAULT_CO_SETTINGS: CoFiscalSettings = {
  enabled: false,
  nit: null,
  dianResolutionNumber: null,
  prefix: null,
  rangeFrom: null,
  rangeTo: null,
  environment: 'habilitacion',
  softwareId: null,
  softwarePin: null,
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readPositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
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
    softwareId: readString(co.softwareId),
    softwarePin: readString(co.softwarePin),
  };
}

/** Client-safe view: the software PIN is reduced to a presence flag. */
export type CoFiscalSettingsView = Omit<CoFiscalSettings, 'softwarePin'> & {
  softwarePinConfigured: boolean;
};

export function toCoFiscalSettingsView(settings: CoFiscalSettings): CoFiscalSettingsView {
  const { softwarePin, ...rest } = settings;
  return { ...rest, softwarePinConfigured: softwarePin !== null };
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
  if (patch.softwareId !== undefined) coBranch.softwareId = patch.softwareId;
  if (patch.softwarePin !== undefined) coBranch.softwarePin = patch.softwarePin;

  base.fiscal = { ...fiscalBranch, co: coBranch };
  return base;
}

/**
 * What emission itself needs: a valid issuer NIT (hashed as NitOFE) and
 * the DIAN software ID + PIN (the CUDE security code). Missing either
 * blocks the intent instead of minting an identifier DIAN cannot verify.
 */
export function validateCoEmissionConfig(
  settings: CoFiscalSettings
): FiscalAdapterValidationResult {
  const issues: FiscalAdapterValidationIssue[] = [];
  if (!settings.nit || !validateNit(settings.nit).valid) {
    issues.push({
      code: 'MISSING_NIT',
      message: 'Issuer NIT is missing or invalid',
      field: 'fiscal.co.nit',
    });
  }
  const software = missingSoftwareIssue(settings);
  if (software) issues.push(software);
  return { ok: issues.length === 0, issues };
}

function missingSoftwareIssue(settings: CoFiscalSettings): FiscalAdapterValidationIssue | null {
  if (settings.softwareId && settings.softwarePin) return null;
  return {
    code: 'MISSING_SOFTWARE',
    message: 'DIAN software ID or PIN is missing',
    field: settings.softwareId ? 'fiscal.co.softwarePin' : 'fiscal.co.softwareId',
  };
}

/**
 * Presence-only readiness probe for the Colombia fiscal config. Reports
 * which mandatory issuer fields are still missing so the config card
 * can paint an honest badge. This is NOT a cryptographic / transmission
 * check — certificate, signing and provider connectivity are not probed.
 * `ok` is true once NIT + resolution + a valid numbering range + the
 * DIAN software ID and PIN are captured (independent of the `enabled` toggle: the merchant can
 * complete the config before flipping DIAN on).
 */
export function validateCoFiscalConfig(settings: CoFiscalSettings): FiscalAdapterValidationResult {
  const issues: FiscalAdapterValidationIssue[] = [];

  // Same NIT rule emission applies, so the badge never reads ready while
  // every sale would be blocked.
  if (!settings.nit || !validateNit(settings.nit).valid) {
    issues.push({
      code: 'MISSING_NIT',
      message: 'Issuer NIT is missing or invalid',
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
  const software = missingSoftwareIssue(settings);
  if (software) issues.push(software);

  return { ok: issues.length === 0, issues };
}
