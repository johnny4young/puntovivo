import type { UserRole } from '@puntovivo/shared/roles';
import { and, asc, desc, eq, exists, inArray, lt, notExists, or, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  employeeScheduleOccurrences,
  employeeSchedulePlans,
  sites,
  users,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type { ListSchedulePlansInput } from '../../trpc/schemas/schedulePlans.js';
import {
  managerCanTarget,
  SCHEDULE_ROLES,
  throwEmployeeNotFound,
} from './scheduled-shift-policy.js';

export function schedulePlanNotFound(): never {
  throwServerError({
    trpcCode: 'NOT_FOUND',
    errorCode: 'SCHEDULE_PLAN_NOT_FOUND',
    message: 'The schedule plan is not available',
  });
}
/** Actor authority is fenced by the workforce writer; this checks the current target and site. */
export function assertSchedulePlanTargets(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  siteId: string,
  userIds: string[],
  activeOnly: boolean
): void {
  const site = db
    .select({ id: sites.id })
    .from(sites)
    .where(
      and(
        eq(sites.tenantId, tenantId),
        eq(sites.id, siteId),
        ...(activeOnly ? [eq(sites.isActive, true)] : [])
      )
    )
    .get();
  if (!site) schedulePlanNotFound();
  const ids = [...new Set(userIds)];
  // Every occurrence comes from at most 100 rules. Never build an unbounded SQL IN list.
  if (ids.length < 1 || ids.length > 100) schedulePlanNotFound();
  const employees = db
    .select({ id: users.id, role: users.role, active: users.isActive })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), inArray(users.id, ids)))
    .all();
  if (
    employees.length !== ids.length ||
    employees.some(
      employee => !managerCanTarget(actorRole, employee.role) || (activeOnly && !employee.active)
    )
  )
    throwEmployeeNotFound();
}

/** Complete bounded draft or final snapshot; missing children never become an empty success. */
function readSchedulePlanSnapshot(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  id: string
) {
  const plan = db
    .select()
    .from(employeeSchedulePlans)
    .where(and(eq(employeeSchedulePlans.tenantId, tenantId), eq(employeeSchedulePlans.id, id)))
    .get();
  if (!plan) schedulePlanNotFound();
  const occurrences = db
    .select()
    .from(employeeScheduleOccurrences)
    .where(
      and(
        eq(employeeScheduleOccurrences.tenantId, tenantId),
        eq(employeeScheduleOccurrences.planId, id)
      )
    )
    .orderBy(asc(employeeScheduleOccurrences.id))
    .limit(1001)
    .all();
  if (
    occurrences.length !== plan.occurrenceCount ||
    occurrences.length < 1 ||
    occurrences.length > 1000
  )
    schedulePlanNotFound();
  assertSchedulePlanTargets(
    db,
    tenantId,
    actorRole,
    plan.siteId,
    [...occurrences.map(row => row.userId), ...plan.rules.map(rule => rule.userId)],
    false
  );
  return { plan, occurrences };
}

/** Header, children and role ownership must belong to one SQLite snapshot, including shared dev DB readers. */
export function getSchedulePlan(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  id: string
) {
  return db.transaction(
    raw => readSchedulePlanSnapshot(raw as unknown as DatabaseInstance, tenantId, actorRole, id),
    { behavior: 'deferred' }
  );
}

/** Current display names are separate from frozen intent and read under the same authority snapshot. */
export function getSchedulePlanDisplay(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  id: string
) {
  return db.transaction(
    raw => {
      const tx = raw as unknown as DatabaseInstance;
      const snapshot = readSchedulePlanSnapshot(tx, tenantId, actorRole, id);
      const ids = [...new Set(snapshot.plan.rules.map(rule => rule.userId))];
      const employees = tx
        .select({ id: users.id, name: users.name, isActive: users.isActive })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), inArray(users.id, ids)))
        .orderBy(asc(users.id))
        .all();
      const site = tx
        .select({ id: sites.id, name: sites.name, isActive: sites.isActive })
        .from(sites)
        .where(and(eq(sites.tenantId, tenantId), eq(sites.id, snapshot.plan.siteId)))
        .get();
      if (!site) schedulePlanNotFound();
      return { ...snapshot, display: { employees, site } };
    },
    { behavior: 'deferred' }
  );
}

export function listSchedulePlans(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  input: ListSchedulePlansInput
) {
  const p = employeeSchedulePlans,
    o = employeeScheduleOccurrences;
  // A mixed admin/worker draft is one decision. Hide the entire aggregate from
  // managers rather than leaking the hidden employee through its header or count.
  const roles = SCHEDULE_ROLES.filter(role => actorRole === 'admin' || role !== 'admin');
  const allowed = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.id, o.userId), inArray(users.role, roles)));
  const forbiddenChild = db
    .select({ id: o.id })
    .from(o)
    .where(and(eq(o.tenantId, tenantId), eq(o.planId, p.id), notExists(allowed)));
  // Even a rule with no occurrence in the selected range belongs to the private intent.
  const forbiddenRule = sql`(SELECT 1 FROM json_each(${p.rules}) AS rule WHERE NOT EXISTS (SELECT 1 FROM ${users} WHERE ${users.tenantId}=${tenantId} AND ${users.id}=json_extract(rule.value,'$.userId') AND ${inArray(users.role, roles)}))`;
  const rows = db
    .select({
      id: p.id,
      title: p.title,
      siteId: p.siteId,
      fromDate: p.fromDate,
      untilDate: p.untilDate,
      timeZone: p.timeZone,
      status: p.status,
      version: p.version,
      occurrenceCount: p.occurrenceCount,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      decidedAt: p.decidedAt,
    })
    .from(p)
    .where(
      and(
        eq(p.tenantId, tenantId),
        eq(p.siteId, input.siteId),
        notExists(forbiddenChild),
        notExists(forbiddenRule),
        exists(
          db
            .select({ id: o.id })
            .from(o)
            .where(and(eq(o.tenantId, tenantId), eq(o.planId, p.id)))
        ),
        ...(input.status ? [eq(p.status, input.status)] : []),
        ...(input.cursor
          ? [
              or(
                lt(p.createdAt, input.cursor.createdAt),
                and(eq(p.createdAt, input.cursor.createdAt), lt(p.id, input.cursor.id))
              ),
            ]
          : [])
      )
    )
    .orderBy(desc(p.createdAt), desc(p.id))
    .limit(input.limit + 1)
    .all();
  const items = rows.slice(0, input.limit),
    last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > input.limit && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}
