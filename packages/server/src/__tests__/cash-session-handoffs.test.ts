import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { TRPCError } from '@trpc/server';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { auditLogs, cashSessionHandoffs, cashSessions, sales, sites, users } from '../db/schema.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { hashStaffPin } from '../security/staffPins.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { computeOperationsToday } from '../services/operations/today.js';
import { appRouter } from '../trpc/router.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let siteId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;
const staff = {
  andres: nanoid(),
  camila: nanoid(),
  diego: nanoid(),
  manager: nanoid(),
  viewer: nanoid(),
};

type Role = 'admin' | 'manager' | 'cashier' | 'viewer';
const roleOf: Record<string, Role> = {
  [staff.andres]: 'cashier',
  [staff.camila]: 'cashier',
  [staff.diego]: 'cashier',
  [staff.manager]: 'manager',
  [staff.viewer]: 'viewer',
};

const as = (userId: string) =>
  appRouter.createCaller(fresh({ userId, role: roleOf[userId]!, email: `${userId}@handoff.test` }));

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (err: unknown) => err
  );
  expect(error).toBeInstanceOf(TRPCError);
  expect(((error as TRPCError).cause as ServerErrorWithCode).errorCode).toBe(code);
}

function parkDraft(sessionId: string, cashierId: string, total: number, label: string) {
  const id = nanoid();
  getDatabase()
    .insert(sales)
    .values({
      id,
      tenantId,
      saleNumber: `PARK-${nanoid(6)}`,
      subtotal: total,
      taxAmount: 0,
      discountAmount: 0,
      total,
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      cashSessionId: sessionId,
      createdBy: cashierId,
      suspendedAt: new Date().toISOString(),
      suspendedBy: cashierId,
      suspendedLabel: label,
    })
    .run();
  return id;
}

async function openRegister(userId: string, registerName: string, float = 200000) {
  return as(userId).cashSessions.open({
    registerName,
    openingFloat: float,
    denominations: [{ value: 50000, count: float / 50000 }],
  });
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const admin = db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!admin) throw new Error('Expected seeded admin user');
  tenantId = admin.tenantId;
  const site = db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();
  if (!site) throw new Error('Expected seeded site');
  siteId = site.id;

  const now = new Date().toISOString();
  const names: Record<string, string> = {
    [staff.andres]: 'Andrés Rojas',
    [staff.camila]: 'Camila Pérez',
    [staff.diego]: 'Diego Díaz',
    [staff.manager]: 'Marta Ríos',
    [staff.viewer]: 'Visor',
  };
  for (const [id, role] of Object.entries(roleOf)) {
    db.insert(users)
      .values({
        id,
        tenantId,
        email: `${id}@handoff.test`,
        passwordHash: 'x',
        name: names[id]!,
        role,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const device = await registerDeviceService(db, {
    tenantId,
    userId: admin.id,
    kind: 'web',
    name: 'cash-session-handoffs.test',
  });
  fresh = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId,
    userId: admin.id,
    email: 'admin@localhost',
    siteId,
    deviceId: device.deviceId,
    defaultRole: 'admin',
  });
});

afterAll(async () => {
  await server.close();
});

describe('register handoff', () => {
  it('hands a counted drawer over and passes the parked sales to the receiver', async () => {
    const opened = await openRegister(staff.andres, 'Caja 2');
    const draftId = parkDraft(opened.id, staff.andres, 86400, 'P2 Cliente espera');

    const handoff = await as(staff.andres).cashSessions.startHandoff({
      actualCount: 250000,
      denominations: [{ value: 50000, count: 5 }],
      note: '  El señor de enfrente viene a las 3 por P2  ',
      toCashierId: staff.camila,
    });

    expect(handoff).toMatchObject({
      registerName: 'Caja 2',
      status: 'pending',
      fromCashierName: 'Andrés Rojas',
      toCashierName: 'Camila Pérez',
      outgoingCount: 250000,
      note: 'El señor de enfrente viene a las 3 por P2',
      fromSignature: 'session',
    });
    expect(handoff).not.toHaveProperty('expectedBalance');
    expect(handoff.drafts.map(draft => draft.id)).toEqual([draftId]);

    const closed = getDatabase()
      .select()
      .from(cashSessions)
      .where(eq(cashSessions.id, opened.id))
      .get();
    expect(closed).toMatchObject({ status: 'closed', actualCount: 250000, overShort: 50000 });

    const pending = await as(staff.camila).cashSessions.pendingHandoffs();
    expect(pending.map(row => row.id)).toEqual([handoff.id]);

    // Parked on another register after the handoff: it stays with Andrés.
    const second = await openRegister(staff.andres, 'Caja 2B');
    const laterDraftId = parkDraft(second.id, staff.andres, 12000, 'Despues del relevo');
    getDatabase()
      .update(sales)
      .set({ suspendedAt: new Date(Date.now() + 60_000).toISOString() })
      .where(eq(sales.id, laterDraftId))
      .run();

    const { handoff: received, session } = await as(staff.camila).cashSessions.receiveHandoff({
      handoffId: handoff.id,
      mode: 'counted_drawer',
      count: 240000,
      denominations: [
        { value: 50000, count: 4 },
        { value: 20000, count: 2 },
      ],
    });

    expect(received).toMatchObject({
      status: 'received',
      toCashierId: staff.camila,
      toSessionId: session.id,
      receiveMode: 'counted_drawer',
      receivedCount: 240000,
      countDifference: -10000,
      reassignedDraftCount: 1,
      drafts: [],
    });
    expect(session).toMatchObject({
      registerName: 'Caja 2',
      cashierId: staff.camila,
      openingFloat: 240000,
      status: 'open',
    });

    const draft = getDatabase().select().from(sales).where(eq(sales.id, draftId)).get();
    expect(draft?.suspendedBy).toBe(staff.camila);
    const laterDraft = getDatabase().select().from(sales).where(eq(sales.id, laterDraftId)).get();
    expect(laterDraft?.suspendedBy).toBe(staff.andres);
    // The sale that passed is no longer the outgoing cashier's to discard or re-park.
    await expect(as(staff.andres).sales.discardDraft({ saleId: draftId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(as(staff.andres).sales.suspend({ saleId: draftId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await as(staff.andres).cashSessions.close({
      actualCount: 200000,
      denominations: [{ value: 50000, count: 4 }],
    });
    const camilaDrafts = await as(staff.camila).sales.listDrafts({ page: 1, perPage: 20 });
    expect(camilaDrafts.items.map(item => item.id)).toContain(draftId);

    const audit = getDatabase()
      .select({ action: auditLogs.action, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceId, handoff.id)))
      .all();
    expect(audit.map(row => row.action).sort()).toEqual([
      'cash_session.handoff',
      'cash_session.handoff_receive',
    ]);

    const today = await computeOperationsToday(getDatabase(), tenantId);
    const register = today.registers.find(row => row.sessionId === session.id);
    expect(register?.lastHandoff).toMatchObject({
      fromUserName: 'Andrés Rojas',
      countDifference: -10000,
    });

    await as(staff.camila).cashSessions.startHandoff({
      actualCount: 240000,
      denominations: [
        { value: 50000, count: 4 },
        { value: 20000, count: 2 },
      ],
    });
  });

  it('starts a new drawer with its own float and records no recount', async () => {
    await openRegister(staff.diego, 'Caja 3');
    const handoff = await as(staff.diego).cashSessions.startHandoff({
      actualCount: 0,
      denominations: [],
    });

    const awaiting = (await computeOperationsToday(getDatabase(), tenantId)).awaitingHandoffs;
    expect(awaiting.find(row => row.id === handoff.id)).toMatchObject({
      registerName: 'Caja 3',
      fromUserName: 'Diego Díaz',
      toUserName: null,
    });

    const { handoff: received, session } = await as(staff.andres).cashSessions.receiveHandoff({
      handoffId: handoff.id,
      mode: 'new_drawer',
      count: 200000,
      denominations: [{ value: 50000, count: 4 }],
    });
    expect(received).toMatchObject({
      receiveMode: 'new_drawer',
      receivedCount: null,
      countDifference: null,
      reassignedDraftCount: 0,
    });
    expect(session.openingFloat).toBe(200000);
    await as(staff.andres).cashSessions.startHandoff({
      actualCount: 200000,
      denominations: [{ value: 50000, count: 4 }],
    });
  });

  it('refuses the wrong receiver, the outgoing cashier and a second receipt', async () => {
    await openRegister(staff.diego, 'Caja 4');
    const handoff = await as(staff.diego).cashSessions.startHandoff({
      actualCount: 200000,
      denominations: [{ value: 50000, count: 4 }],
      toCashierId: staff.camila,
    });
    const receive = { handoffId: handoff.id, mode: 'new_drawer' as const, count: 0 };

    await expectCode(
      as(staff.andres).cashSessions.receiveHandoff(receive),
      'CASH_HANDOFF_RECIPIENT_MISMATCH'
    );
    await expectCode(
      as(staff.diego).cashSessions.receiveHandoff(receive),
      'CASH_HANDOFF_SAME_CASHIER'
    );
    await as(staff.camila).cashSessions.receiveHandoff(receive);
    await expectCode(
      as(staff.camila).cashSessions.receiveHandoff(receive),
      'CASH_HANDOFF_NOT_PENDING'
    );
    await expectCode(
      as(staff.camila).cashSessions.receiveHandoff({ ...receive, handoffId: 'missing' }),
      'CASH_HANDOFF_NOT_FOUND'
    );
    await as(staff.camila).cashSessions.startHandoff({ actualCount: 0, denominations: [] });
  });

  it('rejects a recipient who cannot run a register', async () => {
    await openRegister(staff.diego, 'Caja 5');
    for (const toCashierId of [staff.viewer, staff.diego, 'nobody']) {
      await expectCode(
        as(staff.diego).cashSessions.startHandoff({
          actualCount: 0,
          denominations: [],
          toCashierId,
        }),
        'CASH_HANDOFF_RECIPIENT_INVALID'
      );
    }
    const stillOpen = await as(staff.diego).cashSessions.getActive();
    expect(stillOpen?.registerName).toBe('Caja 5');
    await as(staff.diego).cashSessions.close({ actualCount: 0, denominations: [] });
  });

  it('signs with the staff PIN when the cashier has one', async () => {
    getDatabase()
      .update(users)
      .set({ staffPinHash: await hashStaffPin('482915') })
      .where(eq(users.id, staff.diego))
      .run();
    await openRegister(staff.diego, 'Caja 6');
    const count = { actualCount: 0, denominations: [] };

    await expectCode(as(staff.diego).cashSessions.startHandoff(count), 'CASH_HANDOFF_PIN_REQUIRED');
    await expectCode(
      as(staff.diego).cashSessions.startHandoff({ ...count, pin: '111111' }),
      'CASH_HANDOFF_PIN_INVALID'
    );
    const handoff = await as(staff.diego).cashSessions.startHandoff({ ...count, pin: '482915' });
    expect(handoff.fromSignature).toBe('pin');

    await expectCode(
      as(staff.camila).cashSessions.receiveHandoff({
        handoffId: handoff.id,
        mode: 'new_drawer',
        count: 0,
        pin: '482915',
      }),
      'CASH_HANDOFF_PIN_INVALID'
    );
  });

  it('marks a pending handoff superseded when the register is opened directly', async () => {
    const pending = (await as(staff.camila).cashSessions.pendingHandoffs()).find(
      row => row.registerName === 'Caja 6'
    );
    expect(pending).toBeDefined();

    await openRegister(staff.camila, 'Caja 6');
    const row = getDatabase()
      .select({ status: cashSessionHandoffs.status })
      .from(cashSessionHandoffs)
      .where(eq(cashSessionHandoffs.id, pending!.id))
      .get();
    expect(row?.status).toBe('superseded');
    const audit = getDatabase()
      .select({ action: auditLogs.action, actorId: auditLogs.actorId })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceId, pending!.id)))
      .all();
    expect(audit).toContainEqual({
      action: 'cash_session.handoff_superseded',
      actorId: staff.camila,
    });
    const left = await as(staff.camila).cashSessions.pendingHandoffs();
    expect(left.map(row => row.id)).not.toContain(pending!.id);
    await as(staff.camila).cashSessions.close({ actualCount: 0, denominations: [] });
  });

  it('keeps other sites and tenants out of the handoff', async () => {
    await openRegister(staff.andres, 'Caja 7');
    const handoff = await as(staff.andres).cashSessions.startHandoff({
      actualCount: 0,
      denominations: [],
    });

    const db = getDatabase();
    const mainSite = db.select().from(sites).where(eq(sites.id, siteId)).get()!;
    const otherSiteId = nanoid();
    db.insert(sites)
      .values({ id: otherSiteId, tenantId, companyId: mainSite.companyId, name: 'Sede Sur' })
      .run();
    const atOtherSite = appRouter.createCaller(
      fresh({ userId: staff.camila, role: 'cashier', siteId: otherSiteId })
    );
    expect(await atOtherSite.cashSessions.pendingHandoffs()).toEqual([]);
    await expectCode(
      atOtherSite.cashSessions.receiveHandoff({
        handoffId: handoff.id,
        mode: 'new_drawer',
        count: 0,
      }),
      'CASH_HANDOFF_NOT_FOUND'
    );

    expect((await computeOperationsToday(db, nanoid())).awaitingHandoffs).toEqual([]);
    expect(
      (await computeOperationsToday(db, tenantId)).awaitingHandoffs.map(row => row.id)
    ).toContain(handoff.id);
  });
});

describe('guided close decisions', () => {
  it('lets a manager explain a closed difference and refuses balanced or open drawers', async () => {
    const opened = await openRegister(staff.camila, 'Caja 8');
    await as(staff.camila).cashSessions.close({
      actualCount: 187700,
      denominations: [
        { value: 50000, count: 3 },
        { value: 20000, count: 1 },
        { value: 10000, count: 1 },
        { value: 5000, count: 1 },
        { value: 2000, count: 1 },
        { value: 500, count: 1 },
        { value: 200, count: 1 },
      ],
    });

    await expect(
      as(staff.camila).cashSessions.explainDifference({
        sessionId: opened.id,
        reason: 'wrong_change',
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      as(staff.manager).cashSessions.explainDifference({ sessionId: opened.id, reason: 'other' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const explained = await as(staff.manager).cashSessions.explainDifference({
      sessionId: opened.id,
      reason: 'wrong_change',
      note: ' Vuelto de 12.300 ',
    });
    expect(explained).toMatchObject({
      overShort: -12300,
      differenceReason: 'wrong_change',
      differenceNote: 'Vuelto de 12.300',
      differenceExplainedBy: staff.manager,
    });
    const report = await as(staff.manager).cashSessions.report();
    expect(report.recentClosures.find(row => row.id === opened.id)).toMatchObject({
      differenceReason: 'wrong_change',
    });

    const balanced = await openRegister(staff.camila, 'Caja 9');
    await as(staff.camila).cashSessions.close({
      actualCount: 200000,
      denominations: [{ value: 50000, count: 4 }],
    });
    await expectCode(
      as(staff.manager).cashSessions.explainDifference({
        sessionId: balanced.id,
        reason: 'unrecorded_withdrawal',
      }),
      'CASH_DIFFERENCE_NOT_EXPLAINABLE'
    );
  });

  it('carries a parked sale to tomorrow until it is parked again', async () => {
    const opened = await openRegister(staff.camila, 'Caja 10');
    const draftId = parkDraft(opened.id, staff.camila, 42100, 'P3 Domicilio');

    await expect(as(staff.camila).sales.carryOver({ saleId: draftId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const carried = await as(staff.manager).sales.carryOver({ saleId: draftId });
    expect(carried).toMatchObject({ id: draftId, carriedOverBy: staff.manager });

    const listed = await as(staff.manager).sales.listDrafts({ page: 1, perPage: 50 });
    expect(listed.items.find(item => item.id === draftId)?.carriedOver).toBe(true);

    getDatabase()
      .update(sales)
      .set({ suspendedAt: new Date(Date.now() + 1000).toISOString() })
      .where(eq(sales.id, draftId))
      .run();
    const reparked = await as(staff.manager).sales.listDrafts({ page: 1, perPage: 50 });
    expect(reparked.items.find(item => item.id === draftId)?.carriedOver).toBe(false);

    getDatabase().update(sales).set({ status: 'cancelled' }).where(eq(sales.id, draftId)).run();
    await expectCode(
      as(staff.manager).sales.carryOver({ saleId: draftId }),
      'SALE_CARRY_OVER_INVALID'
    );
    await as(staff.camila).cashSessions.close({
      actualCount: 200000,
      denominations: [{ value: 50000, count: 4 }],
    });
  });
});
