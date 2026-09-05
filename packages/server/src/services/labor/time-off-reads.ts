import type { UserRole } from '@puntovivo/shared/roles';
import { and, desc, eq, gt, lt, ne, or } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { employeeTimeOff, employeeTimeOffEvents, sites, users } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type { ListTimeOffInput } from '../../trpc/schemas/timeOff.js';

/** Bounded manager-facing projections intentionally omit private decision explanations. */
const selection = {
  id: employeeTimeOff.id,
  userId: employeeTimeOff.userId,
  userName: users.name,
  userActive: users.isActive,
  siteId: employeeTimeOff.siteId,
  siteName: sites.name,
  siteActive: sites.isActive,
  kind: employeeTimeOff.kind,
  status: employeeTimeOff.status,
  fromDate: employeeTimeOff.fromDate,
  untilDate: employeeTimeOff.untilDate,
  timeZone: employeeTimeOff.timeZone,
  version: employeeTimeOff.version,
  createdAt: employeeTimeOff.createdAt,
  approvedAt: employeeTimeOff.approvedAt,
  approvedByUserId: employeeTimeOff.approvedByUserId,
};

/** Managers cannot inspect an administrator's request, even after role changes or site archival. */
export function getTimeOff(
  db: DatabaseInstance,
  tenantId: string,
  role: UserRole,
  input: { id: string; siteId: string }
) {
  const row = db
    .select(selection)
    .from(employeeTimeOff)
    .innerJoin(users, and(eq(users.id, employeeTimeOff.userId), eq(users.tenantId, tenantId)))
    .innerJoin(sites, and(eq(sites.id, employeeTimeOff.siteId), eq(sites.tenantId, tenantId)))
    .where(
      and(
        eq(employeeTimeOff.tenantId, tenantId),
        eq(employeeTimeOff.id, input.id),
        eq(employeeTimeOff.siteId, input.siteId),
        ...(role === 'admin' ? [] : [ne(users.role, 'admin')])
      )
    )
    .get();
  if (!row)
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'TIME_OFF_NOT_FOUND',
      message: 'The time-off request is not available',
    });
  return row;
}

/** Stable createdAt/id keyset pagination; dates compare the frozen local calendar requested. */
export function listTimeOff(
  db: DatabaseInstance,
  tenantId: string,
  role: UserRole,
  input: ListTimeOffInput
) {
  const rows = db
    .select(selection)
    .from(employeeTimeOff)
    .innerJoin(users, and(eq(users.id, employeeTimeOff.userId), eq(users.tenantId, tenantId)))
    .innerJoin(sites, and(eq(sites.id, employeeTimeOff.siteId), eq(sites.tenantId, tenantId)))
    .where(
      and(
        eq(employeeTimeOff.tenantId, tenantId),
        ...(role === 'admin' ? [] : [ne(users.role, 'admin')]),
        ...(input.siteId ? [eq(employeeTimeOff.siteId, input.siteId)] : []),
        ...(input.userId ? [eq(employeeTimeOff.userId, input.userId)] : []),
        ...(input.status ? [eq(employeeTimeOff.status, input.status)] : []),
        ...(input.fromDate ? [gt(employeeTimeOff.untilDate, input.fromDate)] : []),
        ...(input.untilDate ? [lt(employeeTimeOff.fromDate, input.untilDate)] : []),
        ...(input.cursor
          ? [
              or(
                lt(employeeTimeOff.createdAt, input.cursor.createdAt),
                and(
                  eq(employeeTimeOff.createdAt, input.cursor.createdAt),
                  lt(employeeTimeOff.id, input.cursor.id)
                )
              ),
            ]
          : [])
      )
    )
    .orderBy(desc(employeeTimeOff.createdAt), desc(employeeTimeOff.id))
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

/** Authorization is repeated for every history page; snapshots never enter generic read transports. */
export function listTimeOffEvents(
  db: DatabaseInstance,
  tenantId: string,
  role: UserRole,
  input: { id: string; siteId: string; beforeVersion?: number | undefined; limit: number }
) {
  getTimeOff(db, tenantId, role, input);
  const rows = db
    .select()
    .from(employeeTimeOffEvents)
    .where(
      and(
        eq(employeeTimeOffEvents.tenantId, tenantId),
        eq(employeeTimeOffEvents.siteId, input.siteId),
        eq(employeeTimeOffEvents.requestId, input.id),
        ...(input.beforeVersion ? [lt(employeeTimeOffEvents.version, input.beforeVersion)] : [])
      )
    )
    .orderBy(desc(employeeTimeOffEvents.version))
    .limit(input.limit + 1)
    .all();
  const items = rows.slice(0, input.limit);
  return { items, nextBeforeVersion: rows.length > input.limit ? items.at(-1)!.version : null };
}
