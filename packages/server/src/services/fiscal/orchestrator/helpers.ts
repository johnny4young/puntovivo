/**
 * Fiscal orchestrator — pure helpers ( split).
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
 * mapping (estado actual limitation —  wires the mapping explicitly).
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
export async function isDianEnabled(tx: DatabaseInstance, tenantId: string): Promise<boolean> {
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

/**
 * Whether a numbering resolution may issue its next consecutive right now.
 *
 * Two conditions, and they were previously checked on ONE of the two paths
 * that advance a resolution. `prepareSaleFiscalIntent` blocked on both;
 * `enqueueFiscalDocument` checked neither, so the same product validated a
 * consecutive on one path and issued an out-of-range or expired one on the
 * other. Same policy, one implementation, both callers.
 *
 * The reasons are returned rather than thrown because the two callers need
 * different shapes: the intent path records a durable blocked intent, and the
 * enqueue path refuses inline.
 */
export type ResolutionUsability =
  | { ok: true }
  | {
      ok: false;
      reason: 'numbering_resolution_not_effective' | 'numbering_resolution_exhausted';
      details: Record<string, unknown>;
    };

export function checkResolutionUsable(
  resolution: {
    id: string;
    validFrom: string;
    validUntil: string;
    currentNumber: number;
    fromNumber: number;
    toNumber: number;
  },
  requestedAt: string
): ResolutionUsability {
  const requested = Date.parse(requestedAt);
  const from = Date.parse(resolution.validFrom);
  const until = Date.parse(resolution.validUntil);
  const effective =
    Number.isFinite(requested) &&
    Number.isFinite(from) &&
    Number.isFinite(until) &&
    requested >= from &&
    requested <= until;
  if (!effective) {
    return {
      ok: false,
      reason: 'numbering_resolution_not_effective',
      details: {
        resolutionId: resolution.id,
        requestedAt,
        validFrom: resolution.validFrom,
        validUntil: resolution.validUntil,
      },
    };
  }
  // `currentNumber` is the LAST issued number, so the next one is
  // `currentNumber + 1`: it must not fall below the range start, and the last
  // issuable value is `toNumber` itself.
  if (
    resolution.currentNumber < resolution.fromNumber - 1 ||
    resolution.currentNumber >= resolution.toNumber
  ) {
    return {
      ok: false,
      reason: 'numbering_resolution_exhausted',
      details: {
        resolutionId: resolution.id,
        currentNumber: resolution.currentNumber,
        fromNumber: resolution.fromNumber,
        toNumber: resolution.toNumber,
      },
    };
  }
  return { ok: true };
}
