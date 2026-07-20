import type { UserRole } from '@puntovivo/shared/roles';
import { and, asc, desc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  employeeShiftBreaks,
  employeeShiftCorrections,
  employeeShifts,
  sites,
  users,
  type EmployeeShiftCorrectionBreak,
} from '../../db/schema.js';
import { SCHEDULE_ROLES } from './scheduled-shift-policy.js';

const evidenceSelection = {
  id: employeeShifts.id,
  userId: employeeShifts.userId,
  userName: users.name,
  userRole: users.role,
  siteId: employeeShifts.siteId,
  siteName: sites.name,
  clockedInAt: employeeShifts.clockedInAt,
  clockedOutAt: employeeShifts.clockedOutAt,
} as const;

interface EvidenceFilters {
  from: string;
  to: string;
  siteId?: string;
  userId?: string;
  userIds?: string[];
}

function visibilityCondition(actorRole: UserRole) {
  return inArray(
    users.role,
    actorRole === 'admin' ? [...SCHEDULE_ROLES] : (['manager', 'cashier'] as const)
  );
}

/**
 * load the effective attendance interval for report/payroll reads.
 *
 * Candidate discovery considers both raw intervals and every correction
 * interval so a corrected shift can move into a requested range. Only the
 * latest correction is then applied and the effective interval is filtered
 * again, preventing an older superseded version from leaking into results.
 */
export async function loadEffectiveAttendanceRows(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  filters: EvidenceFilters
) {
  const rawConditions = [
    eq(employeeShifts.tenantId, tenantId),
    lt(employeeShifts.clockedInAt, filters.to),
    or(isNull(employeeShifts.clockedOutAt), gt(employeeShifts.clockedOutAt, filters.from))!,
    visibilityCondition(actorRole),
  ];
  if (filters.siteId) rawConditions.push(eq(employeeShifts.siteId, filters.siteId));
  if (filters.userId) rawConditions.push(eq(employeeShifts.userId, filters.userId));
  if (filters.userIds) {
    if (filters.userIds.length === 0) return [];
    rawConditions.push(inArray(employeeShifts.userId, filters.userIds));
  }

  const correctionConditions = [
    eq(employeeShiftCorrections.tenantId, tenantId),
    lt(employeeShiftCorrections.clockedInAt, filters.to),
    gt(employeeShiftCorrections.clockedOutAt, filters.from),
    visibilityCondition(actorRole),
  ];
  if (filters.siteId) correctionConditions.push(eq(employeeShifts.siteId, filters.siteId));
  if (filters.userId) correctionConditions.push(eq(employeeShifts.userId, filters.userId));
  if (filters.userIds) {
    if (filters.userIds.length === 0) return [];
    correctionConditions.push(inArray(employeeShifts.userId, filters.userIds));
  }

  const [rawCandidates, correctionCandidates] = await Promise.all([
    db
      .select({ id: employeeShifts.id })
      .from(employeeShifts)
      .innerJoin(users, and(eq(employeeShifts.userId, users.id), eq(users.tenantId, tenantId)))
      .innerJoin(sites, and(eq(employeeShifts.siteId, sites.id), eq(sites.tenantId, tenantId)))
      .where(and(...rawConditions))
      .all(),
    db
      .select({ id: employeeShiftCorrections.employeeShiftId })
      .from(employeeShiftCorrections)
      .innerJoin(
        employeeShifts,
        and(
          eq(employeeShiftCorrections.employeeShiftId, employeeShifts.id),
          eq(employeeShifts.tenantId, tenantId)
        )
      )
      .innerJoin(users, and(eq(employeeShifts.userId, users.id), eq(users.tenantId, tenantId)))
      .innerJoin(sites, and(eq(employeeShifts.siteId, sites.id), eq(sites.tenantId, tenantId)))
      .where(and(...correctionConditions))
      .all(),
  ]);
  const candidateIds = [
    ...new Set([...rawCandidates.map(row => row.id), ...correctionCandidates.map(row => row.id)]),
  ];
  if (candidateIds.length === 0) return [];

  const [rows, corrections, rawBreaks] = await Promise.all([
    db
      .select(evidenceSelection)
      .from(employeeShifts)
      .innerJoin(users, and(eq(employeeShifts.userId, users.id), eq(users.tenantId, tenantId)))
      .innerJoin(sites, and(eq(employeeShifts.siteId, sites.id), eq(sites.tenantId, tenantId)))
      .where(and(eq(employeeShifts.tenantId, tenantId), inArray(employeeShifts.id, candidateIds)))
      .all(),
    db
      .select({
        id: employeeShiftCorrections.id,
        employeeShiftId: employeeShiftCorrections.employeeShiftId,
        version: employeeShiftCorrections.version,
        clockedInAt: employeeShiftCorrections.clockedInAt,
        clockedOutAt: employeeShiftCorrections.clockedOutAt,
        breaks: employeeShiftCorrections.breaks,
        reason: employeeShiftCorrections.reason,
        createdByUserId: employeeShiftCorrections.createdByUserId,
        createdAt: employeeShiftCorrections.createdAt,
      })
      .from(employeeShiftCorrections)
      .where(
        and(
          eq(employeeShiftCorrections.tenantId, tenantId),
          inArray(employeeShiftCorrections.employeeShiftId, candidateIds)
        )
      )
      .orderBy(
        asc(employeeShiftCorrections.employeeShiftId),
        desc(employeeShiftCorrections.version)
      )
      .all(),
    db
      .select({
        id: employeeShiftBreaks.id,
        employeeShiftId: employeeShiftBreaks.employeeShiftId,
        startedAt: employeeShiftBreaks.startedAt,
        endedAt: employeeShiftBreaks.endedAt,
      })
      .from(employeeShiftBreaks)
      .where(
        and(
          eq(employeeShiftBreaks.tenantId, tenantId),
          inArray(employeeShiftBreaks.employeeShiftId, candidateIds)
        )
      )
      .orderBy(asc(employeeShiftBreaks.startedAt), asc(employeeShiftBreaks.id))
      .all(),
  ]);

  const latestByShift = new Map<string, (typeof corrections)[number]>();
  for (const correction of corrections) {
    if (!latestByShift.has(correction.employeeShiftId)) {
      latestByShift.set(correction.employeeShiftId, correction);
    }
  }
  const creatorIds = [...new Set([...latestByShift.values()].map(row => row.createdByUserId))];
  const creators =
    creatorIds.length === 0
      ? []
      : await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(and(eq(users.tenantId, tenantId), inArray(users.id, creatorIds)))
          .all();
  const creatorNames = new Map(creators.map(row => [row.id, row.name]));

  const rawBreaksByShift = new Map<string, typeof rawBreaks>();
  for (const breakRow of rawBreaks) {
    const grouped = rawBreaksByShift.get(breakRow.employeeShiftId) ?? [];
    grouped.push(breakRow);
    rawBreaksByShift.set(breakRow.employeeShiftId, grouped);
  }

  return rows
    .map(row => {
      const correction = latestByShift.get(row.id);
      const originalBreaks = rawBreaksByShift.get(row.id) ?? [];
      const effectiveBreaks: Array<{
        id: string;
        employeeShiftId: string;
        startedAt: string;
        endedAt: string | null;
      }> = correction
        ? correction.breaks.map((item: EmployeeShiftCorrectionBreak) => ({
            ...item,
            employeeShiftId: row.id,
          }))
        : originalBreaks;
      const effectiveClockedInAt = correction?.clockedInAt ?? row.clockedInAt;
      const effectiveClockedOutAt = correction?.clockedOutAt ?? row.clockedOutAt;
      return {
        ...row,
        clockedInAt: effectiveClockedInAt,
        clockedOutAt: effectiveClockedOutAt,
        breaks: effectiveBreaks,
        original: {
          clockedInAt: row.clockedInAt,
          clockedOutAt: row.clockedOutAt,
          breaks: originalBreaks,
        },
        correction: correction
          ? {
              id: correction.id,
              version: correction.version,
              reason: correction.reason,
              createdByUserId: correction.createdByUserId,
              createdByName:
                creatorNames.get(correction.createdByUserId) ?? correction.createdByUserId,
              createdAt: correction.createdAt,
            }
          : null,
      };
    })
    .filter(row => row.clockedInAt < filters.to && (row.clockedOutAt ?? filters.to) > filters.from)
    .sort(
      (left, right) =>
        left.clockedInAt.localeCompare(right.clockedInAt) ||
        left.userName.localeCompare(right.userName) ||
        left.id.localeCompare(right.id)
    );
}
