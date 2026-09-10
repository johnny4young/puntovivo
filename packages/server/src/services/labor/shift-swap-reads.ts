/** Bounded shift-exchange projections. Employee reads never reuse manager schedule rows or notes. */
import type { UserRole } from '@puntovivo/shared/roles';
import { and, asc, desc, eq, gt, inArray, lt, ne, notExists, or } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  employeeShiftSwapClaims,
  employeeShiftSwapEvents,
  employeeShiftSwaps,
  scheduledShifts,
  sites,
  users,
  type EmployeeShiftSwap,
  type ShiftSwapIntent,
} from '../../db/schema.js';
import type {
  ListManagerShiftSwapsInput,
  ListMyShiftSwapsInput,
  ListMySwappableShiftsInput,
  ListShiftSwapCandidatesInput,
  ListShiftSwapEventsInput,
} from '../../trpc/schemas/shiftSwaps.js';
import { canManageSwap, swapChanged, swapNotFound } from './shift-swap-policy.js';

const SWAP_HORIZON_MS = 120 * 24 * 60 * 60_000;
const shiftProjection = {
  id: scheduledShifts.id,
  userId: scheduledShifts.userId,
  userName: users.name,
  siteId: scheduledShifts.siteId,
  siteName: sites.name,
  startsAt: scheduledShifts.startsAt,
  endsAt: scheduledShifts.endsAt,
  timeZone: scheduledShifts.timeZone,
  version: scheduledShifts.version,
} as const;
const requestProjection = {
  id: employeeShiftSwaps.id,
  requesterId: employeeShiftSwaps.requesterId,
  recipientId: employeeShiftSwaps.recipientId,
  status: employeeShiftSwaps.status,
  version: employeeShiftSwaps.version,
  intent: employeeShiftSwaps.intent,
  createdAt: employeeShiftSwaps.createdAt,
  updatedAt: employeeShiftSwaps.updatedAt,
} as const;

function publicIntent(intent: ShiftSwapIntent) {
  const map = (shift: ShiftSwapIntent['offered']) => ({
    id: shift.id,
    userId: shift.userId,
    siteId: shift.siteId,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    timeZone: shift.timeZone,
    version: shift.version,
  });
  return { offered: map(intent.offered), requested: map(intent.requested) };
}

function shiftCursorCondition(cursor: { startsAt: string; id: string } | undefined) {
  return cursor
    ? or(
        gt(scheduledShifts.startsAt, cursor.startsAt),
        and(eq(scheduledShifts.startsAt, cursor.startsAt), gt(scheduledShifts.id, cursor.id))
      )
    : undefined;
}

function requestCursorCondition(cursor: { createdAt: string; id: string } | undefined) {
  return cursor
    ? or(
        lt(employeeShiftSwaps.createdAt, cursor.createdAt),
        and(
          eq(employeeShiftSwaps.createdAt, cursor.createdAt),
          lt(employeeShiftSwaps.id, cursor.id)
        )
      )
    : undefined;
}

function futureWindow() {
  const now = new Date().toISOString();
  return { now, upper: new Date(Date.parse(now) + SWAP_HORIZON_MS).toISOString() };
}

function activeClaim(db: DatabaseInstance, tenantId: string) {
  return db
    .select({ shiftId: employeeShiftSwapClaims.shiftId })
    .from(employeeShiftSwapClaims)
    .where(
      and(
        eq(employeeShiftSwapClaims.tenantId, tenantId),
        eq(employeeShiftSwapClaims.shiftId, scheduledShifts.id)
      )
    );
}

/** Own future assignments only; cancelled, elapsed, archived-site and already-claimed rows disappear. */
export function listMySwappableShifts(
  db: DatabaseInstance,
  tenantId: string,
  userId: string,
  input: ListMySwappableShiftsInput
) {
  const { now, upper } = futureWindow();
  const rows = db
    .select(shiftProjection)
    .from(scheduledShifts)
    .innerJoin(
      users,
      and(
        eq(users.id, scheduledShifts.userId),
        eq(users.tenantId, tenantId),
        eq(users.isActive, true)
      )
    )
    .innerJoin(
      sites,
      and(
        eq(sites.id, scheduledShifts.siteId),
        eq(sites.tenantId, tenantId),
        eq(sites.isActive, true)
      )
    )
    .where(
      and(
        eq(scheduledShifts.tenantId, tenantId),
        eq(scheduledShifts.userId, userId),
        eq(scheduledShifts.status, 'scheduled'),
        gt(scheduledShifts.startsAt, now),
        lt(scheduledShifts.startsAt, upper),
        notExists(activeClaim(db, tenantId)),
        shiftCursorCondition(input.cursor)
      )
    )
    .orderBy(asc(scheduledShifts.startsAt), asc(scheduledShifts.id))
    .limit(input.limit + 1)
    .all();
  const items = rows.slice(0, input.limit),
    last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > input.limit && last ? { startsAt: last.startsAt, id: last.id } : null,
  };
}

/** Peer visibility is limited to an explicit offered assignment and a bounded future window. */
export function listShiftSwapCandidates(
  db: DatabaseInstance,
  tenantId: string,
  actor: { id: string; role: UserRole },
  input: ListShiftSwapCandidatesInput
) {
  const offered = db
    .select({
      id: scheduledShifts.id,
      version: scheduledShifts.version,
      status: scheduledShifts.status,
      startsAt: scheduledShifts.startsAt,
    })
    .from(scheduledShifts)
    .innerJoin(
      sites,
      and(
        eq(sites.id, scheduledShifts.siteId),
        eq(sites.tenantId, tenantId),
        eq(sites.isActive, true)
      )
    )
    .where(
      and(
        eq(scheduledShifts.tenantId, tenantId),
        eq(scheduledShifts.id, input.offeredShiftId),
        eq(scheduledShifts.userId, actor.id),
        notExists(activeClaim(db, tenantId))
      )
    )
    .get();
  const { now, upper } = futureWindow();
  if (!offered) swapNotFound();
  if (
    offered.version !== input.offeredVersion ||
    offered.status !== 'scheduled' ||
    offered.startsAt <= now ||
    offered.startsAt >= upper
  )
    swapChanged();
  const rows = db
    .select(shiftProjection)
    .from(scheduledShifts)
    .innerJoin(
      users,
      and(
        eq(users.id, scheduledShifts.userId),
        eq(users.tenantId, tenantId),
        eq(users.isActive, true)
      )
    )
    .innerJoin(
      sites,
      and(
        eq(sites.id, scheduledShifts.siteId),
        eq(sites.tenantId, tenantId),
        eq(sites.isActive, true)
      )
    )
    .where(
      and(
        eq(scheduledShifts.tenantId, tenantId),
        ne(scheduledShifts.userId, actor.id),
        eq(scheduledShifts.status, 'scheduled'),
        gt(scheduledShifts.startsAt, now),
        lt(scheduledShifts.startsAt, upper),
        ...(actor.role === 'admin' ? [] : [ne(users.role, 'admin')]),
        notExists(activeClaim(db, tenantId)),
        shiftCursorCondition(input.cursor)
      )
    )
    .orderBy(asc(scheduledShifts.startsAt), asc(scheduledShifts.id))
    .limit(input.limit + 1)
    .all();
  const items = rows.slice(0, input.limit),
    last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > input.limit && last ? { startsAt: last.startsAt, id: last.id } : null,
  };
}

function requestPage(
  db: DatabaseInstance,
  tenantId: string,
  conditions: Array<ReturnType<typeof eq> | ReturnType<typeof or> | undefined>,
  cursor: { createdAt: string; id: string } | undefined,
  limit: number
) {
  const rows = db
    .select(requestProjection)
    .from(employeeShiftSwaps)
    .where(
      and(eq(employeeShiftSwaps.tenantId, tenantId), ...conditions, requestCursorCondition(cursor))
    )
    .orderBy(desc(employeeShiftSwaps.createdAt), desc(employeeShiftSwaps.id))
    .limit(limit + 1)
    .all();
  const items = rows.slice(0, limit);
  return { rows, items };
}

function enrichRequestPage(
  db: DatabaseInstance,
  tenantId: string,
  rows: Array<
    Pick<
      EmployeeShiftSwap,
      | 'id'
      | 'requesterId'
      | 'recipientId'
      | 'status'
      | 'version'
      | 'intent'
      | 'createdAt'
      | 'updatedAt'
    >
  >,
  hasMore: boolean
) {
  const userIds = [...new Set(rows.flatMap(row => [row.requesterId, row.recipientId]))];
  const siteIds = [
    ...new Set(rows.flatMap(row => [row.intent.offered.siteId, row.intent.requested.siteId])),
  ];
  const displayUsers = userIds.length
    ? db
        .select({ id: users.id, name: users.name, isActive: users.isActive })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), inArray(users.id, userIds)))
        .all()
    : [];
  const displaySites = siteIds.length
    ? db
        .select({ id: sites.id, name: sites.name, isActive: sites.isActive })
        .from(sites)
        .where(and(eq(sites.tenantId, tenantId), inArray(sites.id, siteIds)))
        .all()
    : [];
  const userMap = new Map(displayUsers.map(row => [row.id, row]));
  const siteMap = new Map(displaySites.map(row => [row.id, row]));
  const items = rows.map(row => {
    const requester = userMap.get(row.requesterId),
      recipient = userMap.get(row.recipientId),
      intent = publicIntent(row.intent),
      offeredSite = siteMap.get(intent.offered.siteId),
      requestedSite = siteMap.get(intent.requested.siteId);
    if (!requester || !recipient || !offeredSite || !requestedSite) swapNotFound();
    return {
      id: row.id,
      status: row.status,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      requester,
      recipient,
      offered: { ...intent.offered, siteName: offeredSite.name, siteActive: offeredSite.isActive },
      requested: {
        ...intent.requested,
        siteName: requestedSite.name,
        siteActive: requestedSite.isActive,
      },
    };
  });
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}

/** A participant sees only requests involving their current authenticated user id. */
export function listMyShiftSwaps(
  db: DatabaseInstance,
  tenantId: string,
  userId: string,
  input: ListMyShiftSwapsInput
) {
  return db.transaction(
    raw => {
      const tx = raw as unknown as DatabaseInstance;
      const page = requestPage(
        tx,
        tenantId,
        [
          or(
            eq(employeeShiftSwaps.requesterId, userId),
            eq(employeeShiftSwaps.recipientId, userId)
          ),
          input.status ? eq(employeeShiftSwaps.status, input.status) : undefined,
        ],
        input.cursor,
        input.limit
      );
      return enrichRequestPage(tx, tenantId, page.items, page.rows.length > input.limit);
    },
    { behavior: 'deferred' }
  );
}

/** Managers never receive an exchange with an administrator participant. */
export function listManagerShiftSwaps(
  db: DatabaseInstance,
  tenantId: string,
  actor: { id: string; role: UserRole },
  input: ListManagerShiftSwapsInput
) {
  return db.transaction(
    raw => {
      const tx = raw as unknown as DatabaseInstance;
      const adminParticipant = tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.tenantId, tenantId),
            eq(users.role, 'admin'),
            or(
              eq(users.id, employeeShiftSwaps.requesterId),
              eq(users.id, employeeShiftSwaps.recipientId)
            )
          )
        );
      const page = requestPage(
        tx,
        tenantId,
        [
          input.status
            ? eq(employeeShiftSwaps.status, input.status)
            : inArray(employeeShiftSwaps.status, ['requested', 'accepted']),
          ne(employeeShiftSwaps.requesterId, actor.id),
          ne(employeeShiftSwaps.recipientId, actor.id),
          actor.role === 'admin' ? undefined : notExists(adminParticipant),
        ],
        input.cursor,
        input.limit
      );
      return enrichRequestPage(tx, tenantId, page.items, page.rows.length > input.limit);
    },
    { behavior: 'deferred' }
  );
}

function authorizedRequest(
  db: DatabaseInstance,
  tenantId: string,
  actor: { id: string; role: UserRole },
  id: string
) {
  const row = db
    .select()
    .from(employeeShiftSwaps)
    .where(and(eq(employeeShiftSwaps.tenantId, tenantId), eq(employeeShiftSwaps.id, id)))
    .get();
  if (!row) swapNotFound();
  if (
    ![row.requesterId, row.recipientId].includes(actor.id) &&
    !canManageSwap(db, tenantId, actor.role, row)
  )
    swapNotFound();
  return row;
}

/** History exposes reason text only to participants or current authorized management, never snapshots. */
export function listShiftSwapEvents(
  db: DatabaseInstance,
  tenantId: string,
  actor: { id: string; role: UserRole },
  input: ListShiftSwapEventsInput
) {
  authorizedRequest(db, tenantId, actor, input.id);
  const rows = db
    .select({
      id: employeeShiftSwapEvents.id,
      version: employeeShiftSwapEvents.version,
      status: employeeShiftSwapEvents.status,
      actorId: employeeShiftSwapEvents.actorId,
      actorName: users.name,
      reason: employeeShiftSwapEvents.reason,
      createdAt: employeeShiftSwapEvents.createdAt,
    })
    .from(employeeShiftSwapEvents)
    .innerJoin(
      users,
      and(eq(users.id, employeeShiftSwapEvents.actorId), eq(users.tenantId, tenantId))
    )
    .where(
      and(
        eq(employeeShiftSwapEvents.tenantId, tenantId),
        eq(employeeShiftSwapEvents.requestId, input.id),
        input.beforeVersion ? lt(employeeShiftSwapEvents.version, input.beforeVersion) : undefined
      )
    )
    .orderBy(desc(employeeShiftSwapEvents.version))
    .limit(input.limit + 1)
    .all();
  const items = rows.slice(0, input.limit);
  return {
    items,
    nextBeforeVersion: rows.length > input.limit ? items.at(-1)!.version : null,
  };
}
