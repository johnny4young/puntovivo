import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { TRPCError } from '@trpc/server';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  cashSessionHandoffs,
  cashSessions,
  sales,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { detectLowChange } from '../application/cash-sessions/handoff.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { hashStaffPin } from '../security/staffPins.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { computeOperationsToday } from '../services/operations/today.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { makeEnvelopeHeadersProxy } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let siteId: string;
let deviceId: string;

interface Actor {
  id: string;
  email: string;
  role: 'admin' | 'manager' | 'cashier' | 'viewer';
  tenantId?: string;
  siteId?: string;
}

function contextFor(actor: Actor): Context {
  const scope = { tenantId: actor.tenantId ?? tenantId, siteId: actor.siteId ?? siteId };
  const user = { email: actor.email, role: actor.role, tenantId: scope.tenantId };
  return {
    req: {
      server: server.app,
      headers: makeEnvelopeHeadersProxy({
        getDeviceId: () => deviceId,
        getSiteId: () => scope.siteId,
      }),
      user: { userId: actor.id, ...user },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db: getDatabase(),
    user: { id: actor.id, ...user },
    tenantId: scope.tenantId,
    siteId: scope.siteId,
  };
}

const callerFor = (actor: Actor) => appRouter.createCaller(contextFor(actor));

async function createUser(
  role: Actor['role'],
  options: { pin?: string; tenantId?: string } = {}
): Promise<Actor> {
  const id = nanoid();
  const email = `handoff-${id}@example.com`;
  const now = new Date().toISOString();
  await getDatabase()
    .insert(users)
    .values({
      id,
      tenantId: options.tenantId ?? tenantId,
      email,
      name: `Handoff ${role} ${id.slice(0, 4)}`,
      passwordHash: 'hash',
      staffPinHash: options.pin ? await hashStaffPin(options.pin) : null,
      role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  return { id, email, role, ...(options.tenantId ? { tenantId: options.tenantId } : {}) };
}

function parkDraft(owner: Actor, total: number, label: string): string {
  const id = nanoid();
  const now = new Date().toISOString();
  getDatabase()
    .insert(sales)
    .values({
      id,
      tenantId,
      saleNumber: `HND-${nanoid(6)}`,
      subtotal: total,
      taxAmount: 0,
      discountAmount: 0,
      total,
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      createdBy: owner.id,
      suspendedAt: now,
      suspendedBy: owner.id,
      suspendedLabel: label,
      createdAt: now,
    })
    .run();
  return id;
}

function expectErrorCode(error: unknown, errorCode: string) {
  expect(error).toBeInstanceOf(TRPCError);
  const cause = (error as TRPCError).cause;
  expect(cause).toBeInstanceOf(ServerErrorWithCode);
  expect((cause as ServerErrorWithCode).errorCode).toBe(errorCode);
}

const COUNT = [
  { value: 50000, count: 2 },
  { value: 500, count: 1 },
  { value: 200, count: 1 },
];
const COUNT_TOTAL = 100700;

async function openAndHandOut(outgoing: Actor, registerName: string, note: string | null = null) {
  const caller = callerFor(outgoing);
  await caller.cashSessions.open({
    registerName,
    openingFloat: 50000,
    denominations: [{ value: 50000, count: 1 }],
  });
  return caller.shiftHandoffs.handOut({ actualCount: COUNT_TOTAL, denominations: COUNT, note });
}

describe('shift handoff', () => {
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
    if (!site) throw new Error('Expected a seeded site');
    siteId = site.id;
    deviceId = (
      await registerDeviceService(db, {
        tenantId,
        userId: admin.id,
        kind: 'web',
        name: 'shift-handoff.test',
      })
    ).deviceId;
  });

  afterAll(async () => {
    await server.close();
  });

  it('flags the smallest denominations that are short of change', () => {
    expect(detectLowChange(COUNT)).toEqual([200, 500]);
    expect(
      detectLowChange([
        { value: 100, count: 9 },
        { value: 200, count: 2 },
        { value: 500, count: 0 },
      ])
    ).toEqual([200]);
    expect(detectLowChange([])).toEqual([]);
  });

  it('previews the shift without the expected balance and closes it with a signed handoff', async () => {
    const outgoing = await createUser('cashier');
    const caller = callerFor(outgoing);
    await caller.cashSessions.open({
      registerName: 'Caja preview',
      openingFloat: 50000,
      denominations: [{ value: 50000, count: 1 }],
    });
    const draftId = parkDraft(outgoing, 86400, 'Cliente espera');

    const preview = await caller.shiftHandoffs.handOutPreview({ denominations: COUNT });
    expect(preview).toMatchObject({
      registerName: 'Caja preview',
      countedTotal: COUNT_TOTAL,
      salesCount: 0,
      drafts: [{ id: draftId, label: 'Cliente espera', total: 86400 }],
      notices: [{ kind: 'low_change', values: [200, 500] }],
    });
    expect(JSON.stringify(preview)).not.toContain('expectedBalance');

    const handed = await caller.shiftHandoffs.handOut({
      actualCount: COUNT_TOTAL,
      denominations: COUNT,
      note: '  Vienen por el pedido a las 3  ',
    });
    expect(handed).toMatchObject({ countedTotal: COUNT_TOTAL, carriedSaleIds: [draftId] });
    expect(handed).not.toHaveProperty('overShort');

    const db = getDatabase();
    const session = db
      .select()
      .from(cashSessions)
      .where(eq(cashSessions.id, handed.sessionId))
      .get();
    expect(session).toMatchObject({ status: 'closed', actualCount: COUNT_TOTAL });
    const row = db
      .select()
      .from(cashSessionHandoffs)
      .where(eq(cashSessionHandoffs.id, handed.handoffId))
      .get();
    expect(row).toMatchObject({
      fromSessionId: handed.sessionId,
      fromUserId: outgoing.id,
      toSessionId: null,
      note: 'Vienen por el pedido a las 3',
      carriedSaleIds: [draftId],
    });
    const audit = db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'cash_session.handoff_out'),
          eq(auditLogs.resourceId, handed.sessionId)
        )
      )
      .get();
    expect(audit?.actorId).toBe(outgoing.id);
  });

  it('needs an open session to hand out', async () => {
    const idle = await createUser('cashier');
    await expect(
      callerFor(idle).shiftHandoffs.handOut({ actualCount: 0, denominations: [], note: null })
    ).rejects.toSatisfy(error => {
      expectErrorCode(error, 'CASH_SESSION_REQUIRED');
      return true;
    });
  });

  it('receives the counted drawer, stores the difference between counts and moves the parked sales', async () => {
    const outgoing = await createUser('cashier');
    const incoming = await createUser('cashier', { pin: '135790' });
    const draftId = parkDraft(outgoing, 42100, 'Domicilio');
    const takenOverId = parkDraft(outgoing, 9000, 'Otro');
    const handed = await openAndHandOut(outgoing, 'Caja recibir', 'Nota de entrega');

    // A draft a manager took over after the handoff must stay with the manager.
    const manager = await createUser('manager');
    getDatabase()
      .update(sales)
      .set({ suspendedBy: manager.id })
      .where(eq(sales.id, takenOverId))
      .run();

    const incomingCaller = callerFor(incoming);
    const pending = await incomingCaller.shiftHandoffs.pending();
    expect(pending.pinRequired).toBe(true);
    expect(pending.handoffs.find(item => item.id === handed.handoffId)).toMatchObject({
      registerName: 'Caja recibir',
      note: 'Nota de entrega',
      countedTotal: COUNT_TOTAL,
    });
    expect((await incomingCaller.sales.listDrafts({})).items.map(item => item.id)).not.toContain(
      draftId
    );

    const recount = [
      { value: 50000, count: 2 },
      { value: 500, count: 1 },
    ];
    await expect(
      incomingCaller.shiftHandoffs.receive({
        handoffId: handed.handoffId,
        mode: 'counted_drawer',
        denominations: recount,
        pin: '000000',
      })
    ).rejects.toSatisfy(error => {
      expectErrorCode(error, 'CASH_HANDOFF_PIN_INVALID');
      return true;
    });

    const received = await incomingCaller.shiftHandoffs.receive({
      handoffId: handed.handoffId,
      mode: 'counted_drawer',
      denominations: recount,
      pin: '135790',
    });
    expect(received).toMatchObject({
      registerName: 'Caja recibir',
      recountDifference: -200,
      matches: false,
      reassignedSaleIds: [draftId],
    });

    const db = getDatabase();
    const session = db
      .select()
      .from(cashSessions)
      .where(eq(cashSessions.id, received.sessionId))
      .get();
    expect(session).toMatchObject({
      status: 'open',
      cashierId: incoming.id,
      openingFloat: 100500,
      expectedBalance: 100500,
    });
    // The difference lives on the handoff; the outgoing session keeps its own over/short.
    const outgoingSession = db
      .select()
      .from(cashSessions)
      .where(eq(cashSessions.id, handed.sessionId))
      .get();
    expect(outgoingSession?.overShort).toBe(50700);
    expect(
      db
        .select()
        .from(cashSessionHandoffs)
        .where(eq(cashSessionHandoffs.id, handed.handoffId))
        .get()
    ).toMatchObject({
      toSessionId: received.sessionId,
      toUserId: incoming.id,
      receiveMode: 'counted_drawer',
      recountTotal: 100500,
      recountDifference: -200,
    });

    const visible = (await incomingCaller.sales.listDrafts({})).items.map(item => item.id);
    expect(visible).toContain(draftId);
    expect(visible).not.toContain(takenOverId);
    expect(
      (await callerFor(outgoing).sales.listDrafts({})).items.map(item => item.id)
    ).not.toContain(draftId);

    const again = await createUser('cashier');
    await expect(
      callerFor(again).shiftHandoffs.receive({
        handoffId: handed.handoffId,
        mode: 'counted_drawer',
        denominations: recount,
      })
    ).rejects.toSatisfy(error => {
      expectErrorCode(error, 'CASH_HANDOFF_ALREADY_RECEIVED');
      return true;
    });
    await incomingCaller.cashSessions.close({ actualCount: 100500, denominations: recount });
  });

  it('opens a new float without a recount and lets a cashier without PIN confirm by session', async () => {
    const outgoing = await createUser('cashier');
    const incoming = await createUser('cashier');
    const handed = await openAndHandOut(outgoing, 'Caja fondo');

    const incomingCaller = callerFor(incoming);
    expect((await incomingCaller.shiftHandoffs.pending()).pinRequired).toBe(false);
    const received = await incomingCaller.shiftHandoffs.receive({
      handoffId: handed.handoffId,
      mode: 'new_float',
      denominations: [{ value: 20000, count: 10 }],
    });
    expect(received).toMatchObject({ recountDifference: null, matches: true });
    const row = getDatabase()
      .select()
      .from(cashSessionHandoffs)
      .where(eq(cashSessionHandoffs.id, handed.handoffId))
      .get();
    expect(row).toMatchObject({ receiveMode: 'new_float', recountTotal: null });
    await incomingCaller.cashSessions.close({
      actualCount: 200000,
      denominations: [{ value: 20000, count: 10 }],
    });
  });

  it('refuses the outgoing cashier, viewers, other sites and other tenants', async () => {
    const outgoing = await createUser('cashier');
    const handed = await openAndHandOut(outgoing, 'Caja guardas');
    const input = {
      handoffId: handed.handoffId,
      mode: 'new_float' as const,
      denominations: [{ value: 1000, count: 1 }],
    };

    await expect(callerFor(outgoing).shiftHandoffs.receive(input)).rejects.toSatisfy(error => {
      expectErrorCode(error, 'CASH_HANDOFF_SAME_CASHIER');
      return true;
    });
    expect(
      (await callerFor(outgoing).shiftHandoffs.pending()).handoffs.map(item => item.id)
    ).not.toContain(handed.handoffId);

    const viewer = await createUser('viewer');
    await expect(callerFor(viewer).shiftHandoffs.receive(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(callerFor(viewer).shiftHandoffs.pending()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const db = getDatabase();
    const mainSite = db.select().from(sites).where(eq(sites.id, siteId)).get();
    const otherSiteId = nanoid();
    db.insert(sites)
      .values({ id: otherSiteId, tenantId, companyId: mainSite!.companyId, name: 'Sede handoff' })
      .run();
    const elsewhere = await createUser('cashier');
    await expect(
      callerFor({ ...elsewhere, siteId: otherSiteId }).shiftHandoffs.receive(input)
    ).rejects.toSatisfy(error => {
      expectErrorCode(error, 'CASH_HANDOFF_NOT_FOUND');
      return true;
    });

    // Another tenant forging this site id must see nothing and receive nothing.
    const otherTenantId = nanoid();
    db.insert(tenants)
      .values({ id: otherTenantId, name: 'Otro negocio', slug: `handoff-${otherTenantId}` })
      .run();
    const foreigner = await createUser('cashier', { tenantId: otherTenantId });
    expect((await callerFor(foreigner).shiftHandoffs.pending()).handoffs).toEqual([]);
    expect(await callerFor(foreigner).shiftHandoffs.handOutPreview()).toBeNull();
  });

  it('stops waiting once the register is opened again without the handoff', async () => {
    const outgoing = await createUser('cashier');
    const handed = await openAndHandOut(outgoing, 'Caja reabierta');
    const opener = await createUser('cashier');
    const openerCaller = callerFor(opener);
    await openerCaller.cashSessions.open({
      registerName: 'Caja reabierta',
      openingFloat: 1000,
      denominations: [{ value: 1000, count: 1 }],
    });
    await openerCaller.cashSessions.close({
      actualCount: 1000,
      denominations: [{ value: 1000, count: 1 }],
    });

    const late = await createUser('cashier');
    expect(
      (await callerFor(late).shiftHandoffs.pending()).handoffs.map(item => item.id)
    ).not.toContain(handed.handoffId);
    await expect(
      callerFor(late).shiftHandoffs.receive({
        handoffId: handed.handoffId,
        mode: 'new_float',
        denominations: [{ value: 1000, count: 1 }],
      })
    ).rejects.toSatisfy(error => {
      expectErrorCode(error, 'CASH_HANDOFF_ALREADY_RECEIVED');
      return true;
    });
    // A refused receive must not leave a session open for the late cashier.
    expect(await callerFor(late).cashSessions.getActive()).toBeNull();
  });

  it('lists the day handoffs for the manager', async () => {
    const today = await computeOperationsToday(getDatabase(), tenantId);
    const received = today.handoffs.find(item => item.registerName === 'Caja recibir');
    expect(received?.toUserName).toMatch(/^Handoff cashier/);
    expect(received?.receivedAt).not.toBeNull();
    expect(today.handoffs.find(item => item.registerName === 'Caja guardas')).toMatchObject({
      toUserName: null,
      receivedAt: null,
    });
  });
});
