/**
 * Fiscal orchestrator — pure helpers (ENG-178 split).
 *
 * Timestamp split, DIAN id-type code mapping, the plain-record guard, the
 * per-country fiscal-enabled check, and the tenant DIAN-enabled flag read.
 *
 * @module services/fiscal/orchestrator/helpers
 */
import { eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../../db/index.js';
import { tenants } from '../../../db/schema.js';


/** ISO `YYYY-MM-DD` + `HH:mm:ssZZ` pair for the emission timestamp. */
export function splitIssueTimestamp(now: Date): { issueDate: string; issueTime: string } {
  const iso = now.toISOString();
  return {
    issueDate: iso.slice(0, 10),
    issueTime: iso.slice(11, 19) + 'Z',
  };
}

/**
 * Maps an identification-type abbreviation to the DIAN 2-digit code.
 * Used when the tenant's own catalog does not carry a DIAN code
 * mapping (Fase A limitation — ENG-021 wires the mapping explicitly).
 */
export function abbrToDianCode(abbr: string | null | undefined): string {
  switch ((abbr ?? '').toUpperCase()) {
    case 'CC':
      return '13';
    case 'NIT':
      return '31';
    case 'TI':
      return '12';
    case 'CE':
      return '22';
    case 'PA':
      return '41';
    case 'RC':
      return '11';
    case 'NUIP':
      return '91';
    default:
      return '13';
  }
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Country-aware fiscal toggles live under `settings.fiscal.<country>.enabled`.
 * When the namespace is absent we preserve the legacy `fiscal_dian_enabled`
 * behavior so Colombia and older tenants keep working.
 */
export function isCountryFiscalEnabled(
  settings: Record<string, unknown>,
  countryCode: string
): boolean {
  const fiscal = settings.fiscal;
  if (!isPlainRecord(fiscal)) return true;

  const countrySettings = fiscal[countryCode.toLowerCase()];
  if (!isPlainRecord(countrySettings)) return true;

  return countrySettings.enabled !== false;
}

/**
 * Check whether the tenant has opted into DIAN emission. Stored in the
 * JSON settings blob to avoid a migration until the feature is widely
 * adopted. `true`, `"true"`, or `1` all count as enabled.
 */
export async function isDianEnabled(
  tx: DatabaseInstance,
  tenantId: string
): Promise<boolean> {
  const row = await tx
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  if (!row) return false;
  const settings = (row.settings ?? {}) as Record<string, unknown>;
  const flag = settings.fiscal_dian_enabled ?? settings.fiscalDianEnabled;
  return flag === true || flag === 'true' || flag === 1;
}
