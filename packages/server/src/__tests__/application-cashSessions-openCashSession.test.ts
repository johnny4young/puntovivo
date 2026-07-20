/**
 * Invariant tests for `application/cash-sessions/openCashSession`.
 *
 * Direct use-case calls (no Fastify boot for the call path itself; the
 * server is booted only to seed the in-memory DB + run migrations).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  cashSessions,
  companies,
  employeeShiftBreaks,
  employeeShifts,
  operationEffects,
  operationEvents,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { recordOperationStart } from '../services/operation-journal/journal.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { openCashSession } from '../application/cash-sessions/openCashSession.js';
import type { CashSessionContext } from '../application/cash-sessions/types.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let testDeviceId: string;

function buildContext(overrides: Partial<CashSessionContext> = {}): CashSessionContext {
  return {
    db: getDatabase(),
    tenantId,
    siteId,
    user: { id: userId, role: 'admin' },
    envelope: null,
    deviceId: null,
    log: undefined,
    ...overrides,
  };
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const seededUser = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!seededUser) throw new Error('Expected seeded admin user');
  tenantId = seededUser.tenantId;
  userId = seededUser.id;
  const seededSite = await db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();
  if (!seededSite) throw new Error('Expected seeded site');
  siteId = seededSite.id;

  const reg = await registerDevice(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'application-cashSessions-openCashSession.test',
  });
  testDeviceId = reg.deviceId;
});

afterAll(async () => {
  await server.close();
});

async function closeAnyOpenSessionsForCashier() {
  const db = getDatabase();
  const open = await db
    .select()
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.tenantId, tenantId),
        eq(cashSessions.cashierId, userId),
        eq(cashSessions.status, 'open')
      )
    )
    .all();
  // Break evidence requires a strictly later end boundary, even when cleanup
  // runs in the same millisecond as the test-created start.
  const closedAt = new Date(Date.now() + 1_000).toISOString();
  for (const s of open) {
    await db
      .update(cashSessions)
      .set({
        status: 'closed',
        closedAt,
        updatedAt: closedAt,
        actualCount: s.openingFloat,
        overShort: 0,
      })
      .where(eq(cashSessions.id, s.id));
  }
  await db
    .update(employeeShiftBreaks)
    .set({ endedAt: closedAt, endedByUserId: userId, updatedAt: closedAt })
    .where(
      and(
        eq(employeeShiftBreaks.tenantId, tenantId),
        eq(employeeShiftBreaks.userId, userId),
        isNull(employeeShiftBreaks.endedAt)
      )
    );
  await db
    .update(employeeShifts)
    .set({ clockedOutAt: closedAt, updatedAt: closedAt })
    .where(
      and(
        eq(employeeShifts.tenantId, tenantId),
        eq(employeeShifts.userId, userId),
        isNull(employeeShifts.clockedOutAt)
      )
    );
}

describe('openCashSession', () => {
  it('inserts a session row with status=open and computes expectedBalance from openingFloat', async () => {
    await closeAnyOpenSessionsForCashier();
    const db = getDatabase();
    const result = await openCashSession(buildContext(), {
      registerName: 'open-test-1',
      openingFloat: 200,
      denominations: [{ value: 100, count: 2 }],
    });
    expect(result.session.status).toBe('open');
    expect(result.session.expectedBalance).toBe(200);
    expect(result.journalEventId).toBeNull();
    expect(result.attendanceShiftStarted).toBe(true);
    expect(result.session.employeeShiftId).toBeTruthy();
    const persisted = await db
      .select()
      .from(cashSessions)
      .where(eq(cashSessions.id, result.session.id))
      .get();
    expect(persisted?.openingFloat).toBe(200);
    expect(persisted?.registerName).toBe('open-test-1');
    const linkedShift = await db
      .select()
      .from(employeeShifts)
      .where(eq(employeeShifts.id, result.session.employeeShiftId!))
      .get();
    expect(linkedShift).toMatchObject({
      tenantId,
      userId,
      siteId,
      clockedOutAt: null,
    });
  });

  it('reuses an open same-site attendance shift without duplicating clock-in evidence', async () => {
    await closeAnyOpenSessionsForCashier();
    const db = getDatabase();
    const shiftId = nanoid();
    const now = new Date().toISOString();
    await db.insert(employeeShifts).values({
      id: shiftId,
      tenantId,
      userId,
      siteId,
      clockedInAt: now,
      clockedOutAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const result = await openCashSession(buildContext(), {
      registerName: 'reuse-attendance-shift',
      openingFloat: 0,
      denominations: [],
    });

    expect(result.attendanceShiftStarted).toBe(false);
    expect(result.session.employeeShiftId).toBe(shiftId);
    expect(
      await db
        .select({ id: employeeShifts.id })
        .from(employeeShifts)
        .where(
          and(
            eq(employeeShifts.tenantId, tenantId),
            eq(employeeShifts.userId, userId),
            isNull(employeeShifts.clockedOutAt)
          )
        )
        .all()
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.resourceId, shiftId),
            eq(auditLogs.action, 'employee_shift.clock_in')
          )
        )
        .all()
    ).toHaveLength(0);
  });

  it('rejects opening at another site while attendance is already open', async () => {
    await closeAnyOpenSessionsForCashier();
    const db = getDatabase();
    const company = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.tenantId, tenantId))
      .get();
    if (!company) throw new Error('Expected seeded company');
    const otherSiteId = nanoid();
    const now = new Date().toISOString();
    await db.insert(sites).values({
      id: otherSiteId,
      tenantId,
      companyId: company.id,
      name: 'Other attendance site',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(employeeShifts).values({
      id: nanoid(),
      tenantId,
      userId,
      siteId: otherSiteId,
      clockedInAt: now,
      clockedOutAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      openCashSession(buildContext(), {
        registerName: 'wrong-site-register',
        openingFloat: 0,
        denominations: [],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'CASH_SESSION_SHIFT_SITE_MISMATCH' } });
    expect(
      await db
        .select()
        .from(cashSessions)
        .where(
          and(
            eq(cashSessions.tenantId, tenantId),
            eq(cashSessions.registerName, 'wrong-site-register')
          )
        )
        .get()
    ).toBeUndefined();
  });

  it('rejects opening a register during an active break', async () => {
    await closeAnyOpenSessionsForCashier();
    const db = getDatabase();
    const shiftId = nanoid();
    const now = new Date().toISOString();
    await db.insert(employeeShifts).values({
      id: shiftId,
      tenantId,
      userId,
      siteId,
      clockedInAt: now,
      clockedOutAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(employeeShiftBreaks).values({
      id: nanoid(),
      tenantId,
      employeeShiftId: shiftId,
      userId,
      startedAt: now,
      endedAt: null,
      startedByUserId: userId,
      endedByUserId: null,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      openCashSession(buildContext(), {
        registerName: 'break-register',
        openingFloat: 0,
        denominations: [],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'CASH_SESSION_EMPLOYEE_BREAK_ACTIVE' } });
  });

  it('enforces linked-shift scope and active-state invariants at the database layer', async () => {
    await closeAnyOpenSessionsForCashier();
    const db = getDatabase();
    const shiftId = nanoid();
    const breakId = nanoid();
    const otherUserId = nanoid();
    const now = new Date().toISOString();
    await db.insert(users).values({
      id: otherUserId,
      tenantId,
      email: `scope-${otherUserId}@localhost`,
      passwordHash: 'unused',
      name: 'Scope Cashier',
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(employeeShifts).values({
      id: shiftId,
      tenantId,
      userId,
      siteId,
      clockedInAt: now,
      clockedOutAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(employeeShiftBreaks).values({
      id: breakId,
      tenantId,
      employeeShiftId: shiftId,
      userId,
      startedAt: now,
      endedAt: null,
      startedByUserId: userId,
      endedByUserId: null,
      createdAt: now,
      updatedAt: now,
    });

    const rawSession = (overrides: Partial<typeof cashSessions.$inferInsert> = {}) => ({
      id: nanoid(),
      tenantId,
      siteId,
      cashierId: userId,
      employeeShiftId: shiftId,
      registerName: `raw-${nanoid(6)}`,
      openingFloat: 0,
      openingCountDenominations: [],
      expectedBalance: 0,
      status: 'open' as const,
      openedAt: now,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });

    expect(() => db.insert(cashSessions).values(rawSession()).run()).toThrow(
      /CASH_SESSION_EMPLOYEE_SHIFT_INACTIVE/
    );

    const endedAt = new Date(Date.now() + 1_000).toISOString();
    await db
      .update(employeeShiftBreaks)
      .set({ endedAt, endedByUserId: userId, updatedAt: endedAt })
      .where(eq(employeeShiftBreaks.id, breakId));
    expect(() =>
      db
        .insert(cashSessions)
        .values(rawSession({ cashierId: otherUserId, status: 'closed', closedAt: endedAt }))
        .run()
    ).toThrow(/CASH_SESSION_EMPLOYEE_SHIFT_SCOPE/);

    await db
      .update(employeeShifts)
      .set({ clockedOutAt: endedAt, updatedAt: endedAt })
      .where(eq(employeeShifts.id, shiftId));
    expect(() => db.insert(cashSessions).values(rawSession()).run()).toThrow(
      /CASH_SESSION_EMPLOYEE_SHIFT_INACTIVE/
    );
  });

  it('writes a cash_session.open audit log row inside the transaction', async () => {
    await closeAnyOpenSessionsForCashier();
    const db = getDatabase();
    const result = await openCashSession(buildContext(), {
      registerName: 'open-test-audit',
      openingFloat: 50,
      denominations: [{ value: 50, count: 1 }],
    });
    const audit = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.action, 'cash_session.open'),
          eq(auditLogs.resourceId, result.session.id)
        )
      )
      .get();
    expect(audit).toBeTruthy();
    expect(audit?.actorId).toBe(userId);
  });

  it('throws CASH_SESSION_ALREADY_OPEN_FOR_CASHIER when the cashier has an existing open session', async () => {
    await closeAnyOpenSessionsForCashier();
    await openCashSession(buildContext(), {
      registerName: 'open-collide-cashier-A',
      openingFloat: 100,
      denominations: [{ value: 100, count: 1 }],
    });
    await expect(
      openCashSession(buildContext(), {
        registerName: 'open-collide-cashier-B',
        openingFloat: 100,
        denominations: [{ value: 100, count: 1 }],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'CASH_SESSION_ALREADY_OPEN_FOR_CASHIER' } });
  });

  it('throws CASH_SESSION_ALREADY_OPEN_FOR_REGISTER when another cashier holds the register', async () => {
    await closeAnyOpenSessionsForCashier();
    const db = getDatabase();
    // Seed a second cashier on the same tenant.
    const otherUserId = nanoid();
    const now = new Date().toISOString();
    await db.insert(users).values({
      id: otherUserId,
      tenantId,
      email: `cashier-${otherUserId}@localhost`,
      passwordHash: 'unused',
      name: 'Other Cashier',
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await openCashSession(buildContext({ user: { id: otherUserId, role: 'cashier' } }), {
      registerName: 'register-collide',
      openingFloat: 100,
      denominations: [{ value: 100, count: 1 }],
    });
    await expect(
      openCashSession(buildContext(), {
        registerName: 'register-collide',
        openingFloat: 100,
        denominations: [{ value: 100, count: 1 }],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'CASH_SESSION_ALREADY_OPEN_FOR_REGISTER' } });
  });

  it('throws CASH_SESSION_OPENING_FLOAT_MISMATCH when denominations do not match the float', async () => {
    await closeAnyOpenSessionsForCashier();
    await expect(
      openCashSession(buildContext(), {
        registerName: 'mismatch-test',
        openingFloat: 100,
        denominations: [{ value: 50, count: 1 }],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'CASH_SESSION_OPENING_FLOAT_MISMATCH' } });
  });

  it('throws CASH_SESSION_SITE_REQUIRED when ctx.siteId is missing', async () => {
    await closeAnyOpenSessionsForCashier();
    await expect(
      openCashSession(buildContext({ siteId: null }), {
        registerName: 'no-site',
        openingFloat: 0,
        denominations: [],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'CASH_SESSION_SITE_REQUIRED' } });
  });

  it('emits session_open + audit_log journal effects when the envelope carries an operationId', async () => {
    await closeAnyOpenSessionsForCashier();
    const db = getDatabase();
    const operationId = nanoid();
    await recordOperationStart(db, {
      tenantId,
      operationId,
      operationKind: 'cashSessions.open',
      deviceId: testDeviceId,
      userId,
      requestHash: 'hash-' + operationId,
    });
    const result = await openCashSession(buildContext({ envelope: { operationId } }), {
      registerName: 'envelope-open',
      openingFloat: 100,
      denominations: [{ value: 100, count: 1 }],
    });
    expect(result.journalEventId).toBeTruthy();
    const event = await db
      .select()
      .from(operationEvents)
      .where(
        and(eq(operationEvents.tenantId, tenantId), eq(operationEvents.operationId, operationId))
      )
      .get();
    expect(event).toBeTruthy();
    const effects = await db
      .select()
      .from(operationEffects)
      .where(eq(operationEffects.operationEventId, event!.id))
      .orderBy(desc(operationEffects.createdAt))
      .all();
    const kinds = effects.map(e => e.kind).sort();
    expect(kinds).toContain('session_open');
    expect(kinds).toContain('audit_log');
  });

  it('skips journal effects when no envelope is supplied (silent best-effort)', async () => {
    await closeAnyOpenSessionsForCashier();
    const db = getDatabase();
    const result = await openCashSession(buildContext(), {
      registerName: 'no-envelope',
      openingFloat: 0,
      denominations: [],
    });
    expect(result.journalEventId).toBeNull();
    // Nothing to assert on operation_effects — no event row was minted.
    expect(result.session.status).toBe('open');
  });

  it('isolates open sessions across tenants', async () => {
    await closeAnyOpenSessionsForCashier();
    const db = getDatabase();
    const otherTenantId = nanoid();
    const otherUserId = nanoid();
    const otherSiteId = nanoid();
    const otherCompanyId = nanoid();
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: otherTenantId,
      name: 'Tenant B',
      slug: `tenant-b-${otherTenantId.slice(0, 6)}`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: otherCompanyId,
      tenantId: otherTenantId,
      name: 'Tenant B Company',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: otherSiteId,
      tenantId: otherTenantId,
      companyId: otherCompanyId,
      name: 'B HQ',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: otherUserId,
      tenantId: otherTenantId,
      email: `tb-${otherUserId}@localhost`,
      passwordHash: 'unused',
      name: 'Tenant B cashier',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await openCashSession(
      buildContext({
        tenantId: otherTenantId,
        siteId: otherSiteId,
        user: { id: otherUserId, role: 'admin' },
      }),
      {
        registerName: 'tb-register',
        openingFloat: 0,
        denominations: [],
      }
    );
    const tenantASessions = await db
      .select()
      .from(cashSessions)
      .where(eq(cashSessions.tenantId, tenantId))
      .all();
    const tenantBSessions = await db
      .select()
      .from(cashSessions)
      .where(eq(cashSessions.tenantId, otherTenantId))
      .all();
    expect(tenantASessions.find(s => s.tenantId === otherTenantId)).toBeUndefined();
    expect(tenantBSessions.find(s => s.tenantId === tenantId)).toBeUndefined();
  });
});
