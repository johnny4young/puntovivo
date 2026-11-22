/**
 * The manager's day across every site in one read: what sold against the
 * same weekday last week, how sales moved hour by hour, which registers are
 * open, who works when, and the pending queue ordered by what blocks the close.
 *
 * @module services/operations/today
 */
import { CHECKOUT_APPROVAL_RESOURCE_TYPE } from '@puntovivo/shared/checkout-approval';
import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

import type { DatabaseInstance } from '../../db/index.js';
import {
  cashSessionHandoffs,
  cashSessions,
  managerApprovalRequests,
  sales,
  scheduledShifts,
  sites,
  users,
} from '../../db/schema.js';
import { resolveTenantBusinessClock } from '../pharmacy/business-clock.js';
import { addCalendarDays, resolveUtcDayWindow } from '../reports/day-window.js';
import { dailyDatedRevenueSql, type DailyRevenueRow } from '../reports/net-sales.js';
import { listOpenRegisterIncidents, type RegisterIncidentRow } from '../register-incidents.js';
import { roundMoney } from '../../lib/money.js';
import { computeNeedsAttention, type OperationsAttentionArea } from './attention.js';

export type PendingSeverity = 'blocks' | 'beforeClose' | 'whenPossible';
const SEVERITY_ORDER: Record<PendingSeverity, number> = {
  blocks: 0,
  beforeClose: 1,
  whenPossible: 2,
};

export type TodayPendingItem =
  | {
      kind: 'approval';
      id: string;
      severity: 'blocks';
      origin: 'cashier';
      at: string;
      action: string;
      /** Null when only the action names the request (checkout approvals). */
      label: string | null;
      amount: number | null;
      reason: string;
      requesterId: string;
      requesterName: string;
      siteName: string;
    }
  | {
      kind: 'staleSession';
      id: string;
      severity: 'blocks';
      origin: 'system';
      at: string;
      registerName: string;
      cashierName: string;
    }
  | {
      kind: 'incident';
      id: string;
      severity: 'beforeClose';
      origin: 'cashier';
      at: string;
      incident: RegisterIncidentRow;
    }
  | {
      kind: 'attention';
      id: string;
      severity: 'beforeClose' | 'whenPossible';
      origin: 'system';
      at: string;
      area: OperationsAttentionArea;
      count: number;
    };

export interface TodayRegister {
  sessionId: string;
  registerName: string;
  cashierId: string;
  cashierName: string;
  siteId: string;
  siteName: string;
  openedAt: string;
  openedBeforeToday: boolean;
  salesTotal: number;
  salesCount: number;
  /** End of the cashier's scheduled shift today, the planned handoff. */
  scheduledEndAt: string | null;
  /** The handoff this session received the drawer from, if any. */
  lastHandoff: { receivedAt: string; fromUserName: string; countDifference: number | null } | null;
}

/** A register handed over and not received yet: its cash sits counted, without a session. */
export interface TodayAwaitingHandoff {
  id: string;
  siteId: string;
  registerName: string;
  fromUserName: string;
  toUserName: string | null;
  handedOverAt: string;
}

export interface TodayShift {
  userId: string;
  userName: string;
  siteId: string;
  startsAt: string;
  endsAt: string;
}

export interface OperationsToday {
  businessDate: string;
  timezone: string;
  /** UTC instant where the business day starts; hourly[0] begins here. */
  dayStartIso: string;
  generatedAt: string;
  sales: {
    total: number;
    orders: number;
    averageTicket: number;
    comparisonDate: string;
    comparisonTotal: number;
  };
  hourly: Array<{ hour: number; today: number; comparison: number }>;
  registers: TodayRegister[];
  shifts: TodayShift[];
  nextHandoff: {
    at: string;
    registerName: string | null;
    fromUserName: string;
    /** Who is scheduled to start at that site around the handoff, if anyone. */
    toUserName: string | null;
  } | null;
  awaitingHandoffs: TodayAwaitingHandoff[];
  pending: TodayPendingItem[];
}

function hourWindows(date: string, timezone: string) {
  const { startIso, endExclusiveIso } = resolveUtcDayWindow(date, timezone);
  const start = Date.parse(startIso);
  const end = Date.parse(endExclusiveIso);
  // DST days are 23 or 25 hours long; derive the count instead of assuming 24.
  const hours = Math.round((end - start) / 3_600_000);
  return Array.from({ length: hours }, (_, hour) => ({
    date: String(hour),
    startIso: new Date(start + hour * 3_600_000).toISOString(),
    endExclusiveIso: new Date(Math.min(end, start + (hour + 1) * 3_600_000)).toISOString(),
  }));
}

export interface DayCurve {
  date: string;
  /** UTC instant where the business day starts; hourly[0] begins here. */
  dayStartIso: string;
  hourly: Array<{ hour: number; revenue: number }>;
}

/** Revenue and orders per hour of one business day; the definition Hoy and the day curve share. */
function revenueByHour(db: DatabaseInstance, tenantId: string, date: string, timezone: string) {
  const hours = hourWindows(date, timezone);
  const byHour = new Map(
    db
      .all<DailyRevenueRow>(dailyDatedRevenueSql(tenantId, hours))
      .filter(row => row.date !== null)
      .map(row => [Number(row.date), row])
  );
  return { hours, byHour };
}

/** Revenue per hour of any business day. */
export async function computeDayCurve(
  db: DatabaseInstance,
  tenantId: string,
  date: string
): Promise<DayCurve> {
  const { timezone } = await resolveTenantBusinessClock(db, tenantId);
  const { hours, byHour } = revenueByHour(db, tenantId, date, timezone);
  return {
    date,
    dayStartIso: resolveUtcDayWindow(date, timezone).startIso,
    hourly: hours.map((_, hour) => ({ hour, revenue: byHour.get(hour)?.revenue ?? 0 })),
  };
}

export async function computeOperationsToday(
  db: DatabaseInstance,
  tenantId: string,
  now: Date = new Date()
): Promise<OperationsToday> {
  const { businessDate, timezone } = await resolveTenantBusinessClock(db, tenantId, now);
  const comparisonDate = addCalendarDays(businessDate, -7);
  const today = resolveUtcDayWindow(businessDate, timezone);

  const { hours: todayHours, byHour: todayByHour } = revenueByHour(
    db,
    tenantId,
    businessDate,
    timezone
  );
  const { byHour: comparisonByHour } = revenueByHour(db, tenantId, comparisonDate, timezone);
  const hourly = todayHours.map((_, hour) => ({
    hour,
    today: todayByHour.get(hour)?.revenue ?? 0,
    comparison: comparisonByHour.get(hour)?.revenue ?? 0,
  }));
  const total = hourly.reduce((sum, row) => sum + row.today, 0);
  const orders = [...todayByHour.values()].reduce((sum, row) => sum + row.orders, 0);
  const comparisonTotal = hourly.reduce((sum, row) => sum + row.comparison, 0);

  const fromUser = alias(users, 'handoff_from_user');
  const toUser = alias(users, 'handoff_to_user');
  const sessionRows = db
    .select({
      sessionId: cashSessions.id,
      registerName: cashSessions.registerName,
      cashierId: cashSessions.cashierId,
      cashierName: users.name,
      siteId: cashSessions.siteId,
      siteName: sites.name,
      openedAt: cashSessions.openedAt,
      handoffReceivedAt: cashSessionHandoffs.receivedAt,
      handoffFromUserName: fromUser.name,
      handoffOutgoingCount: cashSessionHandoffs.outgoingCount,
      handoffReceivedCount: cashSessionHandoffs.receivedCount,
    })
    .from(cashSessions)
    .innerJoin(users, eq(users.id, cashSessions.cashierId))
    .innerJoin(sites, eq(sites.id, cashSessions.siteId))
    .leftJoin(
      cashSessionHandoffs,
      and(
        eq(cashSessionHandoffs.tenantId, tenantId),
        eq(cashSessionHandoffs.toSessionId, cashSessions.id)
      )
    )
    .leftJoin(fromUser, eq(fromUser.id, cashSessionHandoffs.fromCashierId))
    .where(and(eq(cashSessions.tenantId, tenantId), eq(cashSessions.status, 'open')))
    .orderBy(asc(cashSessions.registerName))
    .all();

  const sessionIds = sessionRows.map(row => row.sessionId);
  const salesBySession = new Map(
    sessionIds.length === 0
      ? []
      : db
          .select({
            sessionId: sales.cashSessionId,
            total: sql<number>`coalesce(sum(${sales.total}), 0)`,
            count: sql<number>`count(*)`,
          })
          .from(sales)
          .where(
            and(
              eq(sales.tenantId, tenantId),
              eq(sales.status, 'completed'),
              inArray(sales.cashSessionId, sessionIds)
            )
          )
          .groupBy(sales.cashSessionId)
          .all()
          .map(row => [row.sessionId, row])
  );

  const shifts = db
    .select({
      userId: scheduledShifts.userId,
      userName: users.name,
      siteId: scheduledShifts.siteId,
      startsAt: scheduledShifts.startsAt,
      endsAt: scheduledShifts.endsAt,
    })
    .from(scheduledShifts)
    .innerJoin(users, eq(users.id, scheduledShifts.userId))
    .where(
      and(
        eq(scheduledShifts.tenantId, tenantId),
        ne(scheduledShifts.status, 'cancelled'),
        lt(scheduledShifts.startsAt, today.endExclusiveIso),
        gte(scheduledShifts.endsAt, today.startIso)
      )
    )
    .orderBy(asc(scheduledShifts.startsAt))
    .all();

  const awaitingHandoffs: TodayAwaitingHandoff[] = db
    .select({
      id: cashSessionHandoffs.id,
      siteId: cashSessionHandoffs.siteId,
      registerName: cashSessionHandoffs.registerName,
      fromUserName: fromUser.name,
      toUserName: toUser.name,
      handedOverAt: cashSessionHandoffs.handedOverAt,
    })
    .from(cashSessionHandoffs)
    .innerJoin(sites, eq(sites.id, cashSessionHandoffs.siteId))
    .innerJoin(fromUser, eq(fromUser.id, cashSessionHandoffs.fromCashierId))
    .leftJoin(toUser, eq(toUser.id, cashSessionHandoffs.toCashierId))
    .where(
      and(
        eq(cashSessionHandoffs.tenantId, tenantId),
        eq(cashSessionHandoffs.status, 'pending'),
        eq(sites.isActive, true)
      )
    )
    .orderBy(desc(cashSessionHandoffs.handedOverAt))
    .all();

  const registers: TodayRegister[] = sessionRows.map(handoffRow => {
    const {
      handoffReceivedAt,
      handoffFromUserName,
      handoffOutgoingCount,
      handoffReceivedCount,
      ...row
    } = handoffRow;
    const sold = salesBySession.get(row.sessionId);
    const shiftEnd = shifts.find(
      shift => shift.userId === row.cashierId && shift.endsAt > now.toISOString()
    )?.endsAt;
    return {
      ...row,
      openedBeforeToday: row.openedAt < today.startIso,
      salesTotal: sold?.total ?? 0,
      salesCount: sold?.count ?? 0,
      scheduledEndAt: shiftEnd ?? null,
      lastHandoff:
        handoffReceivedAt && handoffFromUserName && handoffOutgoingCount !== null
          ? {
              receivedAt: handoffReceivedAt,
              fromUserName: handoffFromUserName,
              countDifference:
                handoffReceivedCount === null
                  ? null
                  : roundMoney(handoffReceivedCount - handoffOutgoingCount),
            }
          : null,
    };
  });

  const nextHandoffRegister = registers
    .filter(register => register.scheduledEndAt)
    .sort((a, b) => a.scheduledEndAt!.localeCompare(b.scheduledEndAt!))[0];
  const nextHandoff = nextHandoffRegister
    ? {
        at: nextHandoffRegister.scheduledEndAt!,
        registerName: nextHandoffRegister.registerName,
        fromUserName: nextHandoffRegister.cashierName,
        toUserName: handoffReceiver(shifts, nextHandoffRegister, registers),
      }
    : null;

  const pending = collectPending(db, { tenantId, now, registers });

  return {
    businessDate,
    timezone,
    dayStartIso: today.startIso,
    generatedAt: now.toISOString(),
    sales: {
      total,
      orders,
      averageTicket: orders > 0 ? Math.round((total / orders) * 100) / 100 : 0,
      comparisonDate,
      comparisonTotal,
    },
    hourly,
    registers,
    shifts,
    nextHandoff,
    awaitingHandoffs,
    pending: await pending,
  };
}

const RECEIVER_WINDOW_MS = 60 * 60_000;

/**
 * The shift at the same site that starts closest to the handoff, within an hour of it,
 * skipping anyone already running a register.
 */
function handoffReceiver(
  shifts: TodayShift[],
  register: TodayRegister,
  registers: TodayRegister[]
): string | null {
  const at = Date.parse(register.scheduledEndAt!);
  const busy = new Set(registers.map(open => open.cashierId));
  let best: { name: string; distance: number } | null = null;
  for (const shift of shifts) {
    if (shift.siteId !== register.siteId || busy.has(shift.userId)) continue;
    const distance = Math.abs(Date.parse(shift.startsAt) - at);
    if (distance <= RECEIVER_WINDOW_MS && (!best || distance < best.distance)) {
      best = { name: shift.userName, distance };
    }
  }
  return best?.name ?? null;
}

async function collectPending(
  db: DatabaseInstance,
  args: { tenantId: string; now: Date; registers: TodayRegister[] }
): Promise<TodayPendingItem[]> {
  const { tenantId, now, registers } = args;
  const items: TodayPendingItem[] = [];

  const approvals = db
    .select({
      id: managerApprovalRequests.id,
      action: managerApprovalRequests.action,
      resourceType: managerApprovalRequests.resourceType,
      summary: managerApprovalRequests.summary,
      reason: managerApprovalRequests.reason,
      requestedAt: managerApprovalRequests.requestedAt,
      requesterId: managerApprovalRequests.requesterId,
      requesterName: users.name,
      siteName: sites.name,
    })
    .from(managerApprovalRequests)
    .innerJoin(
      users,
      and(eq(users.id, managerApprovalRequests.requesterId), eq(users.tenantId, tenantId))
    )
    .innerJoin(
      sites,
      and(eq(sites.id, managerApprovalRequests.siteId), eq(sites.tenantId, tenantId))
    )
    .where(
      and(
        eq(managerApprovalRequests.tenantId, tenantId),
        eq(managerApprovalRequests.status, 'pending'),
        gte(managerApprovalRequests.expiresAt, now.toISOString())
      )
    )
    .orderBy(asc(managerApprovalRequests.requestedAt))
    .all();
  for (const approval of approvals) {
    items.push({
      kind: 'approval',
      id: approval.id,
      severity: 'blocks',
      origin: 'cashier',
      at: approval.requestedAt,
      action: approval.action,
      label:
        approval.resourceType === CHECKOUT_APPROVAL_RESOURCE_TYPE ? null : approval.summary.label,
      amount: approval.summary.amount ?? null,
      reason: approval.reason,
      requesterId: approval.requesterId,
      requesterName: approval.requesterName,
      siteName: approval.siteName,
    });
  }

  for (const register of registers.filter(item => item.openedBeforeToday)) {
    items.push({
      kind: 'staleSession',
      id: register.sessionId,
      severity: 'blocks',
      origin: 'system',
      at: register.openedAt,
      registerName: register.registerName,
      cashierName: register.cashierName,
    });
  }

  for (const incident of listOpenRegisterIncidents(db, tenantId)) {
    items.push({
      kind: 'incident',
      id: incident.id,
      severity: 'beforeClose',
      origin: 'cashier',
      at: incident.createdAt,
      incident,
    });
  }

  const attention = await computeNeedsAttention(db, tenantId);
  for (const entry of attention.areas) {
    items.push({
      kind: 'attention',
      id: `attention:${entry.area}`,
      // DIAN rejections must be fixed before the day is signed; the rest can wait.
      severity: entry.area === 'fiscal' ? 'beforeClose' : 'whenPossible',
      origin: 'system',
      at: now.toISOString(),
      area: entry.area,
      count: entry.count,
    });
  }

  return items.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.at.localeCompare(b.at)
  );
}
