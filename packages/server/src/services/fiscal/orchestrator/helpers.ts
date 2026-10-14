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

/**
 * Wall-clock `YYYY-MM-DD` + `HH:mm:ss±HH:MM` pair for the emission
 * timestamp in the tenant's timezone (DIAN expects Colombian legal time,
 * e.g. `10:53:10-05:00`). An unknown timezone falls back to UTC (`Z`).
 */
export function splitIssueTimestamp(
  now: Date,
  timeZone = 'UTC'
): { issueDate: string; issueTime: string } {
  const instant = Math.floor(now.getTime() / 1000) * 1000;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(instant));
  } catch {
    const iso = new Date(instant).toISOString();
    return { issueDate: iso.slice(0, 10), issueTime: iso.slice(11, 19) + 'Z' };
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(entry => entry.type === type)?.value ?? '00';
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  const time = `${part('hour')}:${part('minute')}:${part('second')}`;
  const wallMs = Date.parse(`${date}T${time}Z`);
  const offsetMinutes = Math.round((wallMs - instant) / 60_000);
  if (offsetMinutes === 0) return { issueDate: date, issueTime: `${time}Z` };
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return { issueDate: date, issueTime: `${time}${offset}` };
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

/** Current `tenants.settings` blob, `{}` when the tenant row is missing. */
export async function readLiveTenantSettings(
  tx: DatabaseInstance,
  tenantId: string
): Promise<Record<string, unknown>> {
  const row = await tx
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  return (row?.settings ?? {}) as Record<string, unknown>;
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
