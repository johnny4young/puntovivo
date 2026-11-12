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
 * Numbering resolutions live only in `fiscal_numbering_resolutions`; the
 * blob no longer carries a resolution, prefix or range, and keys left by
 * older builds are ignored on read and dropped on the next write.
 *
 * Real DIAN transmission, certificate and CUFE/CUDE validation stay
 * mock / gated; `validateCoEmissionConfig` is a presence check, never a
 * cryptographic one.
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

/** Blob keys from builds that stored numbering outside the resolutions table. */
const RETIRED_NUMBERING_KEYS = ['dianResolutionNumber', 'prefix', 'rangeFrom', 'rangeTo'] as const;

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

  for (const key of RETIRED_NUMBERING_KEYS) delete coBranch[key];
  if (patch.nit !== undefined) coBranch.nit = patch.nit;
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
