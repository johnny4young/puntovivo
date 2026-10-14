/**
 * Per-country issuer facts the fiscal hash and documents read from
 * `tenants.settings`, plus the secret fields that must never be frozen
 * into a persisted payload.
 *
 * @module services/fiscal/issuer-context
 */

import type { FiscalEnvironment } from './cufe.js';
import { readClFiscalSettings } from './packs/cl/settings.js';
import { validateNit } from './packs/co/nit.js';
import { readCoFiscalSettings } from './packs/co/settings.js';
import { readMxFiscalSettings } from './packs/mx/settings.js';

type TenantSettings = Record<string, unknown> | null | undefined;

/**
 * Issuer tax id for the country pack. Colombia hashes the NIT digits
 * without the verification digit; a missing or invalid NIT falls back.
 */
export function resolveFiscalIssuerTaxId(
  countryCode: string,
  settings: TenantSettings,
  fallback: string
): string {
  switch (countryCode.toUpperCase()) {
    case 'CO': {
      const nit = readCoFiscalSettings(settings).nit;
      if (!nit) return fallback;
      const parsed = validateNit(nit);
      return parsed.valid ? parsed.nit : fallback;
    }
    case 'MX':
      return readMxFiscalSettings(settings).rfc ?? fallback;
    case 'CL':
      return readClFiscalSettings(settings).rut ?? fallback;
    default:
      return fallback;
  }
}

/** DIAN TipoAmbiente: '1' production, '2' test. Other packs keep '2'. */
export function resolveFiscalHashEnvironment(
  countryCode: string,
  settings: TenantSettings
): FiscalEnvironment {
  if (countryCode.toUpperCase() !== 'CO') return '2';
  return readCoFiscalSettings(settings).environment === 'produccion' ? '1' : '2';
}

const FISCAL_SECRET_FIELDS: ReadonlyArray<readonly [country: string, field: string]> = [
  ['co', 'softwarePin'],
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The part of `tenants.settings` an emission payload freezes: the DIAN
 * master flag and the country's fiscal branch, minus its secrets. Payment
 * credentials and every other namespace stay out of persisted payloads.
 */
export function freezeFiscalSettings(
  settings: Record<string, unknown>,
  countryCode: string
): Record<string, unknown> {
  const countryKey = countryCode.toLowerCase();
  const countrySettings = asRecord(settings.fiscal)?.[countryKey];
  const snapshot: Record<string, unknown> = {};
  if (settings.fiscal_dian_enabled !== undefined) {
    snapshot.fiscal_dian_enabled = settings.fiscal_dian_enabled;
  }
  if (settings.fiscalDianEnabled !== undefined) {
    snapshot.fiscalDianEnabled = settings.fiscalDianEnabled;
  }
  if (countrySettings !== undefined) {
    snapshot.fiscal = { [countryKey]: countrySettings };
  }
  return withoutFiscalSecrets(snapshot);
}

/** Copy of the settings blob without fiscal secrets, safe to persist. */
export function withoutFiscalSecrets(settings: Record<string, unknown>): Record<string, unknown> {
  const fiscal = asRecord(settings.fiscal);
  if (!fiscal) return settings;
  let nextFiscal: Record<string, unknown> | null = null;
  for (const [country, field] of FISCAL_SECRET_FIELDS) {
    const branch = asRecord(fiscal[country]);
    if (!branch || !(field in branch)) continue;
    const rest = { ...branch };
    delete rest[field];
    nextFiscal = { ...(nextFiscal ?? fiscal), [country]: rest };
  }
  return nextFiscal ? { ...settings, fiscal: nextFiscal } : settings;
}

/**
 * Re-attach the live fiscal secrets to a frozen settings snapshot at
 * emission time. Only branches the snapshot already carries are touched.
 */
export function withLiveFiscalSecrets(
  frozen: Record<string, unknown> | undefined,
  live: TenantSettings
): Record<string, unknown> | undefined {
  const frozenFiscal = asRecord(frozen?.fiscal);
  const liveFiscal = asRecord(live?.fiscal);
  if (!frozen || !frozenFiscal || !liveFiscal) return frozen;
  let nextFiscal: Record<string, unknown> | null = null;
  for (const [country, field] of FISCAL_SECRET_FIELDS) {
    const frozenBranch = asRecord(frozenFiscal[country]);
    const liveValue = asRecord(liveFiscal[country])?.[field];
    if (!frozenBranch || liveValue === undefined) continue;
    nextFiscal = {
      ...(nextFiscal ?? frozenFiscal),
      [country]: { ...frozenBranch, [field]: liveValue },
    };
  }
  return nextFiscal ? { ...frozen, fiscal: nextFiscal } : frozen;
}
