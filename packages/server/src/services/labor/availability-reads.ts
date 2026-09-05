/** Authorized bounded read model, without pay, reasons or administrative employee fields. */
import type { UserRole } from '@puntovivo/shared/roles';
import { and, desc, eq, lt, ne, or } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { employeeAvailability, employeeAvailabilityEvents, users } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type { ListAvailabilityInput } from '../../trpc/schemas/availability.js';
const selection = {
  id: employeeAvailability.id,
  userId: employeeAvailability.userId,
  userName: users.name,
  userActive: users.isActive,
  status: employeeAvailability.status,
  fromDate: employeeAvailability.fromDate,
  untilDate: employeeAvailability.untilDate,
  timeZone: employeeAvailability.timeZone,
  slots: employeeAvailability.slots,
  replacesId: employeeAvailability.replacesId,
  version: employeeAvailability.version,
  createdAt: employeeAvailability.createdAt,
};
export function getAvailability(
  db: DatabaseInstance,
  tenantId: string,
  role: UserRole,
  id: string
) {
  const row = db
    .select(selection)
    .from(employeeAvailability)
    .innerJoin(users, and(eq(users.id, employeeAvailability.userId), eq(users.tenantId, tenantId)))
    .where(
      and(
        eq(employeeAvailability.tenantId, tenantId),
        eq(employeeAvailability.id, id),
        ...(role === 'admin' ? [] : [ne(users.role, 'admin')])
      )
    )
    .get();
  if (!row)
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'AVAILABILITY_NOT_FOUND',
      message: 'The availability policy is not available',
    });
  return row;
}
export function listAvailability(
  db: DatabaseInstance,
  tenantId: string,
  role: UserRole,
  input: ListAvailabilityInput
) {
  const rows = db
    .select(selection)
    .from(employeeAvailability)
    .innerJoin(users, and(eq(users.id, employeeAvailability.userId), eq(users.tenantId, tenantId)))
    .where(
      and(
        eq(employeeAvailability.tenantId, tenantId),
        ...(role === 'admin' ? [] : [ne(users.role, 'admin')]),
        ...(input.userId ? [eq(employeeAvailability.userId, input.userId)] : []),
        ...(!input.includeVoided ? [eq(employeeAvailability.status, 'active')] : []),
        ...(input.cursor
          ? [
              or(
                lt(employeeAvailability.createdAt, input.cursor.createdAt),
                and(
                  eq(employeeAvailability.createdAt, input.cursor.createdAt),
                  lt(employeeAvailability.id, input.cursor.id)
                )
              ),
            ]
          : [])
      )
    )
    .orderBy(desc(employeeAvailability.createdAt), desc(employeeAvailability.id))
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
export function listAvailabilityEvents(
  db: DatabaseInstance,
  tenantId: string,
  role: UserRole,
  input: { id: string; beforeVersion?: number | undefined; limit: number }
) {
  getAvailability(db, tenantId, role, input.id);
  const rows = db
    .select()
    .from(employeeAvailabilityEvents)
    .where(
      and(
        eq(employeeAvailabilityEvents.tenantId, tenantId),
        eq(employeeAvailabilityEvents.availabilityId, input.id),
        ...(input.beforeVersion
          ? [lt(employeeAvailabilityEvents.version, input.beforeVersion)]
          : [])
      )
    )
    .orderBy(desc(employeeAvailabilityEvents.version))
    .limit(input.limit + 1)
    .all();
  const items = rows.slice(0, input.limit);
  return { items, nextBeforeVersion: rows.length > input.limit ? items.at(-1)!.version : null };
}
