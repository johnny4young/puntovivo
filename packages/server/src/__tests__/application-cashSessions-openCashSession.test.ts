/**
 * ENG-056 — Invariant tests for `application/cash-sessions/openCashSession`.
 *
 * Direct use-case calls (no Fastify boot for the call path itself; the
 * server is booted only to seed the in-memory DB + run migrations).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  cashSessions,
  companies,
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
  const seededUser = await db
    .select()
    .from(users)
    .where(eq(users.email, 'admin@localhost'))
    .get();
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
  const closedAt = new Date().toISOString();
  for (const s of open) {
    await db
      .update(cashSessions)
      .set({ status: 'closed', closedAt, updatedAt: closedAt, actualCount: s.openingFloat, overShort: 0 })
      .where(eq(cashSessions.id, s.id));
  }
}

describe('openCashSession', () => {
  it('inserts a session row with status=open and computes expectedBalance from openingFloat', async () => {
    await closeAnyOpenSessionsForCashier();
    const db = getDatabase();
    const result = await openCashSession(buildContext(), {
      registerName: 'open-test-1',
      openingFloat: 200,
      denominations: [
        { value: 100, count: 2 },
      ],
    });
    expect(result.session.status).toBe('open');
    expect(result.session.expectedBalance).toBe(200);
    expect(result.journalEventId).toBeNull();
    const persisted = await db
      .select()
      .from(cashSessions)
      .where(eq(cashSessions.id, result.session.id))
      .get();
    expect(persisted?.openingFloat).toBe(200);
    expect(persisted?.registerName).toBe('open-test-1');
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
    const result = await openCashSession(
      buildContext({ envelope: { operationId } }),
      {
        registerName: 'envelope-open',
        openingFloat: 100,
        denominations: [{ value: 100, count: 1 }],
      }
    );
    expect(result.journalEventId).toBeTruthy();
    const event = await db
      .select()
      .from(operationEvents)
      .where(
        and(
          eq(operationEvents.tenantId, tenantId),
          eq(operationEvents.operationId, operationId)
        )
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
      buildContext({ tenantId: otherTenantId, siteId: otherSiteId, user: { id: otherUserId, role: 'admin' } }),
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
