/** Authoritative attendance evidence shared by payroll preparation and calculation. */
import { and, asc, desc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  employeeShiftBreaks,
  employeeShiftCorrections,
  employeeShiftReconciliations,
  employeeShifts,
  sites,
  type PayrollResultSourceKind,
} from '../../db/schema.js';
import { hashCanonicalInput } from '../idempotency/keyHasher.js';
import type { ColombiaPrePayrollBlockerCode } from './calculator.js';

/** One immutable source waiting for the employee-result identity. */
export interface PayrollPreparedSource {
  kind: PayrollResultSourceKind;
  sourceId: string;
  sourceVersion: number | null;
  sourceDigest: string;
  sourceSnapshot: Record<string, unknown>;
}

/** Effective attendance rows and provenance for one employee and period. */
export interface PayrollPreparedAttendance {
  workedSeconds: number;
  attendanceIds: string[];
  correctionVersions: Record<string, number>;
  reconciliationIds: string[];
  sources: PayrollPreparedSource[];
  blockers: ColombiaPrePayrollBlockerCode[];
}

export function payrollPreparedSource(
  kind: PayrollResultSourceKind,
  sourceId: string,
  sourceVersion: number | null,
  sourceSnapshot: Record<string, unknown>
): PayrollPreparedSource {
  return {
    kind,
    sourceId,
    sourceVersion,
    sourceDigest: hashCanonicalInput(sourceSnapshot),
    sourceSnapshot,
  };
}

function durationSeconds(start: string, end: string): number {
  return Math.max(0, Math.floor((Date.parse(end) - Date.parse(start)) / 1_000));
}

function clippedSeconds(
  start: string,
  end: string,
  from: string,
  until: string,
  breaks: readonly { startedAt: string; endedAt: string | null }[]
): { seconds: number; valid: boolean } {
  const effectiveStart = start < from ? from : start;
  const effectiveEnd = end > until ? until : end;
  if (effectiveEnd <= effectiveStart) return { seconds: 0, valid: true };
  const clippedBreaks = breaks
    .map(item => ({
      start: item.startedAt < effectiveStart ? effectiveStart : item.startedAt,
      end: item.endedAt === null || item.endedAt > effectiveEnd ? effectiveEnd : item.endedAt,
      open: item.endedAt === null,
    }))
    .filter(item => item.end > item.start)
    .sort((left, right) => left.start.localeCompare(right.start));
  let previousEnd: string | null = null;
  let breakSeconds = 0;
  for (const item of clippedBreaks) {
    if (item.open || (previousEnd !== null && item.start < previousEnd)) {
      return { seconds: 0, valid: false };
    }
    previousEnd = item.end;
    breakSeconds += durationSeconds(item.start, item.end);
  }
  const elapsed = durationSeconds(effectiveStart, effectiveEnd);
  return breakSeconds <= elapsed
    ? { seconds: elapsed - breakSeconds, valid: true }
    : { seconds: 0, valid: false };
}

export interface PayrollAttendanceWindow {
  userId: string;
  from: string;
  until: string;
}

const MAX_EMPLOYEES = 500;
const MAX_EVIDENCE_ROWS = 25_000;
const SQL_CHUNK_SIZE = 800;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

/** Resolve corrected, clipped attendance in bounded bulk queries for one whole payroll run. */
export function loadPayrollAttendanceForUsers(
  db: DatabaseInstance,
  tenantId: string,
  windows: readonly PayrollAttendanceWindow[]
): Map<string, PayrollPreparedAttendance> {
  if (windows.length > MAX_EMPLOYEES) throw new RangeError('Payroll attendance employee limit');
  const windowsByUser = new Map<string, PayrollAttendanceWindow>();
  for (const window of windows) {
    if (windowsByUser.has(window.userId) || window.from >= window.until) {
      throw new RangeError('Invalid payroll attendance window');
    }
    windowsByUser.set(window.userId, window);
  }
  if (windows.length === 0) return new Map();
  const userIds = [...windowsByUser.keys()];
  const from = windows.map(window => window.from).sort()[0]!;
  const until = windows
    .map(window => window.until)
    .sort()
    .at(-1)!;
  const rawCandidates = db
    .select({ id: employeeShifts.id })
    .from(employeeShifts)
    .innerJoin(sites, and(eq(employeeShifts.siteId, sites.id), eq(sites.tenantId, tenantId)))
    .where(
      and(
        eq(employeeShifts.tenantId, tenantId),
        inArray(employeeShifts.userId, userIds),
        lt(employeeShifts.clockedInAt, until),
        or(isNull(employeeShifts.clockedOutAt), gt(employeeShifts.clockedOutAt, from))
      )
    )
    .limit(MAX_EVIDENCE_ROWS + 1)
    .all();
  const correctionCandidates = db
    .select({ id: employeeShiftCorrections.employeeShiftId })
    .from(employeeShiftCorrections)
    .innerJoin(
      employeeShifts,
      and(
        eq(employeeShiftCorrections.employeeShiftId, employeeShifts.id),
        eq(employeeShifts.tenantId, tenantId),
        inArray(employeeShifts.userId, userIds)
      )
    )
    .innerJoin(sites, and(eq(employeeShifts.siteId, sites.id), eq(sites.tenantId, tenantId)))
    .where(
      and(
        eq(employeeShiftCorrections.tenantId, tenantId),
        lt(employeeShiftCorrections.clockedInAt, until),
        gt(employeeShiftCorrections.clockedOutAt, from)
      )
    )
    .limit(MAX_EVIDENCE_ROWS + 1)
    .all();
  let evidenceLimitExceeded =
    rawCandidates.length > MAX_EVIDENCE_ROWS || correctionCandidates.length > MAX_EVIDENCE_ROWS;
  const candidateIds = new Set([
    ...rawCandidates.map(row => row.id),
    ...correctionCandidates.map(row => row.id),
  ]);
  if (candidateIds.size > MAX_EVIDENCE_ROWS) evidenceLimitExceeded = true;
  const ids = [...candidateIds].sort().slice(0, MAX_EVIDENCE_ROWS);
  const rows: Array<typeof employeeShifts.$inferSelect> = [];
  const corrections: Array<typeof employeeShiftCorrections.$inferSelect> = [];
  const rawBreaks: Array<typeof employeeShiftBreaks.$inferSelect> = [];
  for (const idChunk of chunks(ids, SQL_CHUNK_SIZE)) {
    rows.push(
      ...db
        .select()
        .from(employeeShifts)
        .where(and(eq(employeeShifts.tenantId, tenantId), inArray(employeeShifts.id, idChunk)))
        .orderBy(asc(employeeShifts.clockedInAt), asc(employeeShifts.id))
        .all()
    );
    if (corrections.length <= MAX_EVIDENCE_ROWS) {
      corrections.push(
        ...db
          .select()
          .from(employeeShiftCorrections)
          .where(
            and(
              eq(employeeShiftCorrections.tenantId, tenantId),
              inArray(employeeShiftCorrections.employeeShiftId, idChunk)
            )
          )
          .orderBy(
            asc(employeeShiftCorrections.employeeShiftId),
            desc(employeeShiftCorrections.version)
          )
          .limit(MAX_EVIDENCE_ROWS - corrections.length + 1)
          .all()
      );
    }
    if (rawBreaks.length <= MAX_EVIDENCE_ROWS) {
      rawBreaks.push(
        ...db
          .select()
          .from(employeeShiftBreaks)
          .where(
            and(
              eq(employeeShiftBreaks.tenantId, tenantId),
              inArray(employeeShiftBreaks.employeeShiftId, idChunk)
            )
          )
          .orderBy(asc(employeeShiftBreaks.startedAt), asc(employeeShiftBreaks.id))
          .limit(MAX_EVIDENCE_ROWS - rawBreaks.length + 1)
          .all()
      );
    }
  }
  if (corrections.length > MAX_EVIDENCE_ROWS || rawBreaks.length > MAX_EVIDENCE_ROWS) {
    evidenceLimitExceeded = true;
    corrections.length = Math.min(corrections.length, MAX_EVIDENCE_ROWS);
    rawBreaks.length = Math.min(rawBreaks.length, MAX_EVIDENCE_ROWS);
  }
  rows.sort(
    (left, right) =>
      left.clockedInAt.localeCompare(right.clockedInAt) || left.id.localeCompare(right.id)
  );
  corrections.sort(
    (left, right) =>
      left.employeeShiftId.localeCompare(right.employeeShiftId) || right.version - left.version
  );
  rawBreaks.sort(
    (left, right) =>
      left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id)
  );
  const reconciliationRows = db
    .select()
    .from(employeeShiftReconciliations)
    .innerJoin(
      sites,
      and(eq(employeeShiftReconciliations.siteId, sites.id), eq(sites.tenantId, tenantId))
    )
    .where(
      and(
        eq(employeeShiftReconciliations.tenantId, tenantId),
        inArray(employeeShiftReconciliations.userId, userIds),
        lt(employeeShiftReconciliations.plannedStartsAt, until),
        gt(employeeShiftReconciliations.plannedEndsAt, from)
      )
    )
    .limit(MAX_EVIDENCE_ROWS + 1)
    .all();
  if (reconciliationRows.length > MAX_EVIDENCE_ROWS) evidenceLimitExceeded = true;
  const reconciliations = reconciliationRows
    .slice(0, MAX_EVIDENCE_ROWS)
    .map(row => row.employee_shift_reconciliations)
    .sort(
      (left, right) =>
        left.plannedStartsAt.localeCompare(right.plannedStartsAt) || left.id.localeCompare(right.id)
    );

  const rowsByUser = new Map<string, typeof rows>();
  for (const row of rows) rowsByUser.set(row.userId, [...(rowsByUser.get(row.userId) ?? []), row]);
  const latestCorrection = new Map<string, (typeof corrections)[number]>();
  for (const correction of corrections) {
    const previous = latestCorrection.get(correction.employeeShiftId);
    if (!previous || correction.version > previous.version) {
      latestCorrection.set(correction.employeeShiftId, correction);
    }
  }
  const breaksByShift = new Map<string, typeof rawBreaks>();
  for (const item of rawBreaks) {
    breaksByShift.set(item.employeeShiftId, [
      ...(breaksByShift.get(item.employeeShiftId) ?? []),
      item,
    ]);
  }
  const reconciliationsByUser = new Map<string, typeof reconciliations>();
  for (const row of reconciliations) {
    reconciliationsByUser.set(row.userId, [...(reconciliationsByUser.get(row.userId) ?? []), row]);
  }

  const result = new Map<string, PayrollPreparedAttendance>();
  for (const window of windows) {
    const sources: PayrollPreparedSource[] = [];
    const attendanceIds: string[] = [];
    const correctionVersions: Record<string, number> = {};
    const blockers = new Set<ColombiaPrePayrollBlockerCode>();
    const effectiveIntervals: Array<{ start: string; end: string }> = [];
    if (evidenceLimitExceeded) blockers.add('attendance_evidence_limit_exceeded');
    let workedSeconds = 0;
    for (const row of rowsByUser.get(window.userId) ?? []) {
      const correction = latestCorrection.get(row.id);
      const effectiveStart = correction?.clockedInAt ?? row.clockedInAt;
      const effectiveEnd = correction?.clockedOutAt ?? row.clockedOutAt;
      if (effectiveStart >= window.until || (effectiveEnd !== null && effectiveEnd <= window.from))
        continue;
      const rawBreakRows = breaksByShift.get(row.id) ?? [];
      const effectiveBreaks = correction?.breaks ?? rawBreakRows;
      attendanceIds.push(row.id);
      sources.push(
        payrollPreparedSource('attendance', row.id, null, {
          id: row.id,
          userId: row.userId,
          siteId: row.siteId,
          clockedInAt: row.clockedInAt,
          clockedOutAt: row.clockedOutAt,
          breaks: rawBreakRows.map(item => ({
            id: item.id,
            startedAt: item.startedAt,
            endedAt: item.endedAt,
          })),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })
      );
      if (correction) {
        correctionVersions[row.id] = correction.version;
        sources.push(
          payrollPreparedSource('attendance_correction', correction.id, correction.version, {
            id: correction.id,
            employeeShiftId: correction.employeeShiftId,
            version: correction.version,
            clockedInAt: correction.clockedInAt,
            clockedOutAt: correction.clockedOutAt,
            breaks: correction.breaks,
            reason: correction.reason,
            createdByUserId: correction.createdByUserId,
            createdAt: correction.createdAt,
          })
        );
      }
      if (effectiveEnd === null) {
        blockers.add('attendance_evidence_incomplete');
        continue;
      }
      const clipped = clippedSeconds(
        effectiveStart,
        effectiveEnd,
        window.from,
        window.until,
        effectiveBreaks
      );
      if (!clipped.valid) {
        blockers.add('attendance_evidence_incomplete');
        continue;
      }
      effectiveIntervals.push({
        start: effectiveStart < window.from ? window.from : effectiveStart,
        end: effectiveEnd > window.until ? window.until : effectiveEnd,
      });
      const next = workedSeconds + clipped.seconds;
      if (!Number.isSafeInteger(next)) {
        blockers.add('money_range_exceeded');
        continue;
      }
      workedSeconds = next;
    }
    effectiveIntervals.sort((left, right) => left.start.localeCompare(right.start));
    for (let index = 1; index < effectiveIntervals.length; index += 1) {
      if (effectiveIntervals[index]!.start < effectiveIntervals[index - 1]!.end) {
        blockers.add('attendance_evidence_overlaps');
        break;
      }
    }
    const employeeReconciliations = (reconciliationsByUser.get(window.userId) ?? []).filter(
      row => row.plannedStartsAt < window.until && row.plannedEndsAt > window.from
    );
    for (const row of employeeReconciliations) {
      sources.push(
        payrollPreparedSource('reconciliation', row.id, row.version, {
          id: row.id,
          scheduledShiftId: row.scheduledShiftId,
          employeeShiftId: row.employeeShiftId,
          outcome: row.outcome,
          scheduledShiftVersion: row.scheduledShiftVersion,
          userId: row.userId,
          siteId: row.siteId,
          plannedStartsAt: row.plannedStartsAt,
          plannedEndsAt: row.plannedEndsAt,
          plannedTimeZone: row.plannedTimeZone,
          version: row.version,
        })
      );
    }
    result.set(window.userId, {
      workedSeconds,
      attendanceIds,
      correctionVersions,
      reconciliationIds: employeeReconciliations.map(row => row.id),
      sources,
      blockers: [...blockers].sort(),
    });
  }
  return result;
}

/** Single-employee compatibility wrapper backed by the same bounded bulk implementation. */
export function loadPayrollAttendance(
  db: DatabaseInstance,
  tenantId: string,
  userId: string,
  from: string,
  until: string
): PayrollPreparedAttendance {
  return loadPayrollAttendanceForUsers(db, tenantId, [{ userId, from, until }]).get(userId)!;
}
