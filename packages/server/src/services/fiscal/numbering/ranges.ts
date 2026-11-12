/**
 * Registration and lifecycle of DIAN numbering ranges.
 *
 * A range is immutable once registered: mistakes are corrected by retiring it
 * (or deleting it while no number was issued) and registering a new one.
 *
 * @module services/fiscal/numbering/ranges
 */
import { and, asc, count, desc, eq, gte, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../../db/index.js';
import {
  fiscalDocuments,
  fiscalNumberingResolutions,
  sites,
  tenants,
  type FiscalNumberingEnvironment,
  type FiscalNumberingStatus,
} from '../../../db/schema.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { writeAuditLog } from '../../audit-logs.js';
import {
  checkResolutionUsable,
  isCountryFiscalEnabled,
  isDianFlagOn,
} from '../orchestrator/helpers.js';
import {
  numberingEnvironmentFromSettings,
  readTenantNumberingEnvironment,
  type NumberingRange,
} from './select.js';

/** Kinds that need a DIAN authorization; credit and debit notes number internally. */
export const AUTHORIZED_NUMBERING_KINDS = ['DEE', 'FEV'] as const;
export type AuthorizedNumberingKind = (typeof AUTHORIZED_NUMBERING_KINDS)[number];

export const NUMBERING_PREFIX_PATTERN = /^[A-Z0-9]{1,4}$/u;
const MAX_VALIDITY_YEARS = 2;
/** Colombia has a fixed offset (no DST); date-only inputs are read as local days. */
const COLOMBIA_OFFSET = '-05:00';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * A date-only value becomes the first (or last) millisecond of that day in
 * Colombia; a full timestamp passes through. Returns null when unparseable.
 */
export function toColombianDayBoundary(value: string, edge: 'start' | 'end'): string | null {
  const trimmed = value.trim();
  const candidate = DATE_ONLY.test(trimmed)
    ? `${trimmed}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}${COLOMBIA_OFFSET}`
    : trimmed;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** True when `validUntil` is no more than two years after `validFrom`. */
export function withinMaxValidity(validFrom: string, validUntil: string): boolean {
  return Date.parse(validUntil) <= addYears(validFrom, MAX_VALIDITY_YEARS);
}
const USAGE_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;

/** Fields of a new range, in the order of the DIAN authorization. */
export interface CreateNumberingRangeInput {
  siteId: string;
  kind: AuthorizedNumberingKind;
  resolutionNumber: string;
  resolutionDate: string;
  /** Empty only when the tenant has a single active site. */
  prefix: string;
  fromNumber: number;
  toNumber: number;
  validFrom: string;
  validUntil: string;
  /** Required for FEV, ignored for DEE. */
  technicalKey?: string | null | undefined;
  environment: FiscalNumberingEnvironment;
  /** Last number already issued with another system; needs `openingReason`. */
  lastIssuedNumber?: number | null | undefined;
  openingReason?: string | null | undefined;
}

/** Range as the API returns it: technical key masked, consumption derived. */
export interface NumberingRangeView {
  id: string;
  siteId: string;
  siteName: string;
  kind: NumberingRange['kind'];
  resolutionNumber: string;
  resolutionDate: string | null;
  prefix: string;
  fromNumber: number;
  toNumber: number;
  currentNumber: number;
  /** Next consecutive this range would issue, or null once spent. */
  nextNumber: number | null;
  remaining: number;
  environment: FiscalNumberingEnvironment;
  validFrom: string;
  validUntil: string;
  status: FiscalNumberingStatus;
  /** Last four characters only; the full key never leaves the server. */
  technicalKeyHint: string | null;
  issuedCount: number;
  createdAt: string;
  retiredAt: string | null;
  retireReason: string | null;
}

/** Consumption figures behind the expiry and exhaustion alerts. */
export interface NumberingRangeUsage {
  rangeId: string;
  siteId: string;
  kind: NumberingRange['kind'];
  remaining: number;
  /** Share of the range still available, 0..1. */
  remainingRatio: number;
  /** Whole days until `validUntil`; negative once expired. */
  daysUntilExpiry: number;
  /** Documents per day over the last 14 days. */
  dailyAverage: number;
  /** Days of numbers left at `dailyAverage`; null when nothing was issued lately. */
  daysOfStockLeft: number | null;
  /** A scheduled range of the same site and kind that is in force when this one expires. */
  hasScheduledSuccessor: boolean;
  siteName: string;
  /** Null while nothing is due, or while the tenant has DIAN issuing off. */
  alert: NumberingAlert | null;
}

/** Why a range needs attention; `critical` means it can stop issuing within days. */
export interface NumberingAlert {
  level: 'warning' | 'critical';
  reason: 'expiry' | 'consumption';
}

/** Default thresholds for range alerts. */
export const NUMBERING_ALERT_THRESHOLDS = {
  expiryWarningDays: 30,
  /** Lead time DIAN asks for when requesting a new authorization. */
  expiryCriticalBusinessDays: 15,
  remainingWarningRatio: 0.2,
  remainingCriticalRatio: 0.05,
  stockCriticalDays: 3,
} as const;

/** Monday-to-Friday days from `from` up to `until`; public holidays are not discounted. */
export function businessDaysBetween(from: string, until: string): number {
  const end = Date.parse(until);
  let days = 0;
  for (let cursor = Date.parse(from) + DAY_MS; cursor <= end; cursor += DAY_MS) {
    // Weekday as seen in Colombia (UTC-5, no DST).
    const weekday = new Date(cursor - 5 * 3_600_000).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

/** Classify a range against the default thresholds; expiry outranks consumption at equal level. */
export function classifyNumberingAlert(
  usage: Pick<NumberingRangeUsage, 'remainingRatio' | 'daysUntilExpiry' | 'daysOfStockLeft'>,
  businessDaysUntilExpiry: number
): NumberingAlert | null {
  const t = NUMBERING_ALERT_THRESHOLDS;
  if (businessDaysUntilExpiry <= t.expiryCriticalBusinessDays) {
    return { level: 'critical', reason: 'expiry' };
  }
  if (
    usage.remainingRatio < t.remainingCriticalRatio ||
    (usage.daysOfStockLeft !== null && usage.daysOfStockLeft < t.stockCriticalDays)
  ) {
    return { level: 'critical', reason: 'consumption' };
  }
  if (usage.daysUntilExpiry <= t.expiryWarningDays) return { level: 'warning', reason: 'expiry' };
  if (usage.remainingRatio < t.remainingWarningRatio) {
    return { level: 'warning', reason: 'consumption' };
  }
  return null;
}

function invalid(field: string, reason: string): never {
  throwServerError({
    trpcCode: 'BAD_REQUEST',
    errorCode: 'FISCAL_NUMBERING_RANGE_INVALID',
    message: `Numbering range ${field} is invalid`,
    details: { field, reason },
  });
}

function locked(reason: string, details: Record<string, unknown> = {}): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'FISCAL_NUMBERING_RANGE_LOCKED',
    message: 'The numbering range cannot change in its current state',
    details: { reason, ...details },
  });
}

function maskTechnicalKey(key: string | null): string | null {
  if (!key) return null;
  return key.slice(-4);
}

function addYears(iso: string, years: number): number {
  const date = new Date(iso);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.getTime();
}

function countActiveSites(db: DatabaseInstance, tenantId: string): number {
  return (
    db
      .select({ value: count() })
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get()?.value ?? 0
  );
}

/** Numbers a range has issued or may still issue; closed ranges keep only what they issued. */
function claimedInterval(range: {
  status: FiscalNumberingStatus;
  fromNumber: number;
  toNumber: number;
  currentNumber: number;
}): [number, number] | null {
  if (range.status === 'active' || range.status === 'scheduled') {
    return [range.fromNumber, range.toNumber];
  }
  return range.currentNumber >= range.fromNumber ? [range.fromNumber, range.currentNumber] : null;
}

/** Validation 1-8 of the design, against the caller's transaction. */
function validateNewRange(
  tx: DatabaseInstance,
  tenantId: string,
  input: CreateNumberingRangeInput
): { prefix: string; currentNumber: number; technicalKey: string | null } {
  const prefix = input.prefix.trim().toUpperCase();
  if (prefix === '') {
    if (countActiveSites(tx, tenantId) > 1) invalid('prefix', 'required_with_multiple_sites');
  } else if (!NUMBERING_PREFIX_PATTERN.test(prefix)) {
    invalid('prefix', 'format');
  }
  if (!input.resolutionNumber.trim()) invalid('resolutionNumber', 'required');
  if (!Number.isSafeInteger(input.fromNumber) || input.fromNumber < 1) {
    invalid('fromNumber', 'min');
  }
  if (!Number.isSafeInteger(input.toNumber) || input.toNumber < input.fromNumber) {
    invalid('toNumber', 'below_from');
  }

  const resolutionDate = Date.parse(input.resolutionDate);
  const validFrom = Date.parse(input.validFrom);
  const validUntil = Date.parse(input.validUntil);
  if (!Number.isFinite(resolutionDate)) invalid('resolutionDate', 'format');
  if (!Number.isFinite(validFrom)) invalid('validFrom', 'format');
  if (!Number.isFinite(validUntil)) invalid('validUntil', 'format');
  if (validUntil <= validFrom) invalid('validUntil', 'not_after_valid_from');
  if (!withinMaxValidity(input.validFrom, input.validUntil)) {
    invalid('validUntil', 'longer_than_two_years');
  }

  const technicalKey = input.kind === 'FEV' ? (input.technicalKey?.trim() ?? '') : null;
  if (technicalKey === '') invalid('technicalKey', 'required_for_fev');

  let currentNumber = input.fromNumber - 1;
  if (input.lastIssuedNumber !== null && input.lastIssuedNumber !== undefined) {
    if (
      !Number.isSafeInteger(input.lastIssuedNumber) ||
      input.lastIssuedNumber < input.fromNumber ||
      input.lastIssuedNumber >= input.toNumber
    ) {
      invalid('lastIssuedNumber', 'outside_range');
    }
    if (!input.openingReason?.trim()) invalid('openingReason', 'required');
    currentNumber = input.lastIssuedNumber;
  }

  // The new range claims only what it will issue: numbers before the declared
  // last one were issued elsewhere, possibly by a retired range.
  const candidate: [number, number] = [currentNumber + 1, input.toNumber];
  const peers = tx
    .select({
      id: fiscalNumberingResolutions.id,
      status: fiscalNumberingResolutions.status,
      fromNumber: fiscalNumberingResolutions.fromNumber,
      toNumber: fiscalNumberingResolutions.toNumber,
      currentNumber: fiscalNumberingResolutions.currentNumber,
    })
    .from(fiscalNumberingResolutions)
    .where(
      and(
        // Document numbers are unique per tenant, whatever the kind or environment.
        eq(fiscalNumberingResolutions.tenantId, tenantId),
        eq(fiscalNumberingResolutions.prefix, prefix)
      )
    )
    .all();
  for (const peer of peers) {
    const claimed = claimedInterval(peer);
    if (claimed && candidate[0] <= claimed[1] && claimed[0] <= candidate[1]) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'FISCAL_NUMBERING_RANGE_OVERLAP',
        message: 'The range shares consecutives with another registered range',
        details: { conflictingRangeId: peer.id },
      });
    }
  }
  return { prefix, currentNumber, technicalKey };
}

function loadRange(tx: DatabaseInstance, tenantId: string, id: string): NumberingRange {
  const range = tx
    .select()
    .from(fiscalNumberingResolutions)
    .where(
      and(eq(fiscalNumberingResolutions.id, id), eq(fiscalNumberingResolutions.tenantId, tenantId))
    )
    .get();
  if (!range) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'FISCAL_NUMBERING_RANGE_NOT_FOUND',
      message: 'Numbering range not found',
    });
  }
  return range;
}

function activeRangeOf(tx: DatabaseInstance, range: NumberingRange): NumberingRange | undefined {
  return tx
    .select()
    .from(fiscalNumberingResolutions)
    .where(
      and(
        eq(fiscalNumberingResolutions.tenantId, range.tenantId),
        eq(fiscalNumberingResolutions.siteId, range.siteId),
        eq(fiscalNumberingResolutions.kind, range.kind),
        eq(fiscalNumberingResolutions.environment, range.environment),
        eq(fiscalNumberingResolutions.status, 'active')
      )
    )
    .get();
}

/** Audit snapshot without the technical key. */
function auditSnapshot(range: NumberingRange) {
  return {
    siteId: range.siteId,
    kind: range.kind,
    resolutionNumber: range.resolutionNumber,
    resolutionDate: range.resolutionDate,
    prefix: range.prefix,
    fromNumber: range.fromNumber,
    toNumber: range.toNumber,
    currentNumber: range.currentNumber,
    environment: range.environment,
    validFrom: range.validFrom,
    validUntil: range.validUntil,
    status: range.status,
  };
}

/**
 * Register a range. It goes live at once only when the site has no active
 * range of that kind, it is already in force and it matches the tenant's
 * environment; otherwise it waits as `scheduled`.
 */
export function createNumberingRange(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    actorId: string;
    input: CreateNumberingRangeInput;
    now?: string;
    /** Environment the tenant is about to switch to in the same transaction. */
    tenantEnvironment?: FiscalNumberingEnvironment;
  }
): NumberingRange {
  const { tenantId, actorId, input } = args;
  const now = args.now ?? new Date().toISOString();
  const { prefix, currentNumber, technicalKey } = validateNewRange(tx, tenantId, input);

  const draft: NumberingRange = {
    id: nanoid(),
    tenantId,
    siteId: input.siteId,
    kind: input.kind,
    resolutionNumber: input.resolutionNumber.trim(),
    resolutionDate: input.resolutionDate,
    prefix,
    fromNumber: input.fromNumber,
    toNumber: input.toNumber,
    currentNumber,
    technicalKey,
    environment: input.environment,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    status: 'scheduled',
    isActive: false,
    createdBy: actorId,
    retiredBy: null,
    retiredAt: null,
    retireReason: null,
    createdAt: now,
    updatedAt: now,
  };
  const goesLive =
    input.environment ===
      (args.tenantEnvironment ?? readTenantNumberingEnvironment(tx, tenantId)) &&
    !activeRangeOf(tx, draft) &&
    checkResolutionUsable(draft, now).ok;
  const range: NumberingRange = goesLive ? { ...draft, status: 'active', isActive: true } : draft;
  tx.insert(fiscalNumberingResolutions).values(range).run();

  writeAuditLog({
    tx,
    tenantId,
    actorId,
    action: 'fiscal_numbering.create',
    resourceType: 'fiscal_numbering_range',
    resourceId: range.id,
    after: auditSnapshot(range),
    metadata: input.openingReason?.trim()
      ? { openingReason: input.openingReason.trim(), lastIssuedNumber: currentNumber }
      : null,
  });
  return range;
}

/** Put a scheduled range live now, retiring the one it replaces. */
export function activateNumberingRange(
  tx: DatabaseInstance,
  args: { tenantId: string; actorId: string; id: string; now?: string }
): NumberingRange {
  const now = args.now ?? new Date().toISOString();
  const range = loadRange(tx, args.tenantId, args.id);
  if (range.status !== 'scheduled') locked('not_scheduled', { status: range.status });
  if (range.environment !== readTenantNumberingEnvironment(tx, args.tenantId)) {
    locked('environment_mismatch', { environment: range.environment });
  }
  const usability = checkResolutionUsable(range, now);
  if (!usability.ok) locked(usability.reason, usability.details);

  const previous = activeRangeOf(tx, range);
  if (previous) {
    tx.update(fiscalNumberingResolutions)
      .set({
        status: 'retired',
        isActive: false,
        retiredBy: args.actorId,
        retiredAt: now,
        retireReason: 'replaced',
        updatedAt: now,
      })
      .where(
        and(
          eq(fiscalNumberingResolutions.id, previous.id),
          eq(fiscalNumberingResolutions.tenantId, args.tenantId),
          eq(fiscalNumberingResolutions.status, 'active')
        )
      )
      .run();
  }
  tx.update(fiscalNumberingResolutions)
    .set({ status: 'active', isActive: true, updatedAt: now })
    .where(
      and(
        eq(fiscalNumberingResolutions.id, range.id),
        eq(fiscalNumberingResolutions.tenantId, args.tenantId)
      )
    )
    .run();

  writeAuditLog({
    tx,
    tenantId: args.tenantId,
    actorId: args.actorId,
    action: 'fiscal_numbering.activate',
    resourceType: 'fiscal_numbering_range',
    resourceId: range.id,
    before: { status: range.status, replacedRangeId: previous?.id ?? null },
    after: { status: 'active' },
  });
  return { ...range, status: 'active', isActive: true, updatedAt: now };
}

/** Withdraw a scheduled or active range for good. The reason is mandatory. */
export function retireNumberingRange(
  tx: DatabaseInstance,
  args: { tenantId: string; actorId: string; id: string; reason: string; now?: string }
): NumberingRange {
  const now = args.now ?? new Date().toISOString();
  const reason = args.reason.trim();
  if (!reason) invalid('reason', 'required');
  const range = loadRange(tx, args.tenantId, args.id);
  if (range.status !== 'scheduled' && range.status !== 'active') {
    locked('already_closed', { status: range.status });
  }
  tx.update(fiscalNumberingResolutions)
    .set({
      status: 'retired',
      isActive: false,
      retiredBy: args.actorId,
      retiredAt: now,
      retireReason: reason,
      updatedAt: now,
    })
    .where(
      and(
        eq(fiscalNumberingResolutions.id, range.id),
        eq(fiscalNumberingResolutions.tenantId, args.tenantId)
      )
    )
    .run();
  writeAuditLog({
    tx,
    tenantId: args.tenantId,
    actorId: args.actorId,
    action: 'fiscal_numbering.retire',
    resourceType: 'fiscal_numbering_range',
    resourceId: range.id,
    before: { status: range.status },
    after: { status: 'retired' },
    metadata: { reason },
  });
  return {
    ...range,
    status: 'retired',
    isActive: false,
    retiredBy: args.actorId,
    retiredAt: now,
    retireReason: reason,
    updatedAt: now,
  };
}

/** Delete a range that never issued a number and no document references. */
export function removeNumberingRange(
  tx: DatabaseInstance,
  args: { tenantId: string; actorId: string; id: string }
): void {
  const range = loadRange(tx, args.tenantId, args.id);
  const referenced = tx
    .select({ id: fiscalDocuments.id })
    .from(fiscalDocuments)
    .where(
      and(eq(fiscalDocuments.tenantId, args.tenantId), eq(fiscalDocuments.resolutionId, range.id))
    )
    .limit(1)
    .get();
  if (range.currentNumber !== range.fromNumber - 1 || referenced) {
    locked('numbers_issued', { currentNumber: range.currentNumber });
  }
  tx.delete(fiscalNumberingResolutions)
    .where(
      and(
        eq(fiscalNumberingResolutions.id, range.id),
        eq(fiscalNumberingResolutions.tenantId, args.tenantId)
      )
    )
    .run();
  writeAuditLog({
    tx,
    tenantId: args.tenantId,
    actorId: args.actorId,
    action: 'fiscal_numbering.delete',
    resourceType: 'fiscal_numbering_range',
    resourceId: range.id,
    before: auditSnapshot(range),
  });
}

function issuedCounts(
  db: DatabaseInstance,
  tenantId: string,
  rangeIds: string[],
  since?: string
): Map<string, number> {
  if (rangeIds.length === 0) return new Map();
  const rows = db
    .select({ rangeId: fiscalDocuments.resolutionId, value: count() })
    .from(fiscalDocuments)
    .where(
      and(
        eq(fiscalDocuments.tenantId, tenantId),
        inArray(fiscalDocuments.resolutionId, rangeIds),
        ...(since ? [gte(fiscalDocuments.emittedAt, since)] : [])
      )
    )
    .groupBy(fiscalDocuments.resolutionId)
    .all();
  return new Map(rows.map(row => [row.rangeId, row.value]));
}

/** DIAN ranges of the tenant (optionally one site), newest first within each site. */
export function listNumberingRanges(
  db: DatabaseInstance,
  args: { tenantId: string; siteId?: string | undefined }
): NumberingRangeView[] {
  const rows = db
    .select({ range: fiscalNumberingResolutions, siteName: sites.name })
    .from(fiscalNumberingResolutions)
    .innerJoin(
      sites,
      and(eq(sites.id, fiscalNumberingResolutions.siteId), eq(sites.tenantId, args.tenantId))
    )
    .where(
      and(
        eq(fiscalNumberingResolutions.tenantId, args.tenantId),
        inArray(fiscalNumberingResolutions.kind, AUTHORIZED_NUMBERING_KINDS),
        ...(args.siteId ? [eq(fiscalNumberingResolutions.siteId, args.siteId)] : [])
      )
    )
    .orderBy(
      asc(sites.name),
      asc(fiscalNumberingResolutions.kind),
      desc(fiscalNumberingResolutions.createdAt)
    )
    .all();
  const counts = issuedCounts(
    db,
    args.tenantId,
    rows.map(row => row.range.id)
  );
  return rows.map(({ range, siteName }) => {
    const remaining = Math.max(
      0,
      range.toNumber - Math.max(range.currentNumber, range.fromNumber - 1)
    );
    return {
      id: range.id,
      siteId: range.siteId,
      siteName,
      kind: range.kind,
      resolutionNumber: range.resolutionNumber,
      resolutionDate: range.resolutionDate,
      prefix: range.prefix,
      fromNumber: range.fromNumber,
      toNumber: range.toNumber,
      currentNumber: range.currentNumber,
      nextNumber: remaining > 0 ? Math.max(range.currentNumber, range.fromNumber - 1) + 1 : null,
      remaining,
      environment: range.environment,
      validFrom: range.validFrom,
      validUntil: range.validUntil,
      status: range.status,
      technicalKeyHint: maskTechnicalKey(range.technicalKey),
      issuedCount: counts.get(range.id) ?? 0,
      createdAt: range.createdAt,
      retiredAt: range.retiredAt,
      retireReason: range.retireReason,
    };
  });
}

/** Consumption of each active DIAN range in the tenant's environment. */
export function getNumberingUsage(
  db: DatabaseInstance,
  args: { tenantId: string; siteId?: string | undefined; now?: string }
): NumberingRangeUsage[] {
  const now = args.now ?? new Date().toISOString();
  const settings = (db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, args.tenantId))
    .get()?.settings ?? {}) as Record<string, unknown>;
  const environment = numberingEnvironmentFromSettings(settings);
  // A range running out only matters while the tenant issues DIAN documents.
  const alertsOn = isDianFlagOn(settings) && isCountryFiscalEnabled(settings, 'CO');
  const siteNames = new Map(
    db
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(eq(sites.tenantId, args.tenantId))
      .all()
      .map(site => [site.id, site.name])
  );
  const ranges = db
    .select()
    .from(fiscalNumberingResolutions)
    .where(
      and(
        eq(fiscalNumberingResolutions.tenantId, args.tenantId),
        eq(fiscalNumberingResolutions.environment, environment),
        inArray(fiscalNumberingResolutions.kind, AUTHORIZED_NUMBERING_KINDS),
        inArray(fiscalNumberingResolutions.status, ['active', 'scheduled']),
        ...(args.siteId ? [eq(fiscalNumberingResolutions.siteId, args.siteId)] : [])
      )
    )
    .all();
  const active = ranges.filter(range => range.status === 'active');
  const since = new Date(Date.parse(now) - USAGE_WINDOW_DAYS * DAY_MS).toISOString();
  const recent = issuedCounts(
    db,
    args.tenantId,
    active.map(range => range.id),
    since
  );
  return active.map(range => {
    const size = range.toNumber - range.fromNumber + 1;
    const remaining = Math.max(
      0,
      range.toNumber - Math.max(range.currentNumber, range.fromNumber - 1)
    );
    const dailyAverage = (recent.get(range.id) ?? 0) / USAGE_WINDOW_DAYS;
    const figures = {
      remaining,
      remainingRatio: size > 0 ? remaining / size : 0,
      daysUntilExpiry: Math.floor((Date.parse(range.validUntil) - Date.parse(now)) / DAY_MS),
      dailyAverage,
      daysOfStockLeft: dailyAverage > 0 ? remaining / dailyAverage : null,
    };
    return {
      rangeId: range.id,
      siteId: range.siteId,
      siteName: siteNames.get(range.siteId) ?? '',
      kind: range.kind,
      ...figures,
      // A successor counts only if it is in force when this range ends.
      hasScheduledSuccessor: ranges.some(
        other =>
          other.status === 'scheduled' &&
          other.siteId === range.siteId &&
          other.kind === range.kind &&
          other.id !== range.id &&
          other.currentNumber < other.toNumber &&
          Date.parse(other.validFrom) <= Date.parse(range.validUntil) &&
          Date.parse(other.validUntil) > Date.parse(range.validUntil)
      ),
      alert: alertsOn
        ? classifyNumberingAlert(figures, businessDaysBetween(now, range.validUntil))
        : null,
    };
  });
}
