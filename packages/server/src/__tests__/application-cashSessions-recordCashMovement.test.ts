/**
 * ENG-056 — Invariant tests for `application/cash-sessions/recordCashMovement`.
 *
 * Verifies:
 *   - Movement insertion routes through `insertCashMovement` (no
 *     duplicate INSERT path), so `expectedBalance` updates correctly.
 *   - Signed-amount math: paid_in / replenishment add; paid_out / skim
 *     subtract.
 *   - Audit log row + journal effects emitted symmetrically with
 *     openCashSession / closeCashSession.
 *   - Cross-tenant isolation.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  cashMovements,
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
import { recordCashMovement } from '../application/cash-sessions/recordCashMovement.js';
import type { CashSessionContext } from '../application/cash-sessions/types.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let activeSessionId: string;
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
    name: 'application-cashSessions-recordCashMovement.test',
  });
  testDeviceId = reg.deviceId;

  const open = await openCashSession(buildContext(), {
    registerName: 'recordMovement-test register',
    openingFloat: 100,
    denominations: [{ value: 100, count: 1 }],
  });
  activeSessionId = open.session.id;
});

afterAll(async () => {
  await server.close();
});

async function readSessionExpectedBalance(): Promise<number> {
  const row = await getDatabase()
    .select({ expectedBalance: cashSessions.expectedBalance })
    .from(cashSessions)
    .where(eq(cashSessions.id, activeSessionId))
    .get();
  return row?.expectedBalance ?? 0;
}

describe('recordCashMovement', () => {
  it('paid_in increases expectedBalance and inserts cash_movements row via insertCashMovement', async () => {
    const before = await readSessionExpectedBalance();
    const result = await recordCashMovement(buildContext(), {
      type: 'paid_in',
      amount: 25,
      note: 'Petty cash top up',
    });
    expect(result.movement.type).toBe('paid_in');
    expect(result.movement.amount).toBe(25);
    expect(result.movement.referenceId).toBeNull();
    const after = await readSessionExpectedBalance();
    expect(after - before).toBeCloseTo(25, 2);
  });

  it('rounds sub-cent movement input before cash CHECK writes', async () => {
    const before = await readSessionExpectedBalance();
    const result = await recordCashMovement(buildContext(), {
      type: 'paid_in',
      amount: 0.1 + 0.2,
      note: 'Floating point drift top up',
    });

    expect(result.movement.amount).toBe(0.3);
    const after = await readSessionExpectedBalance();
    expect(after - before).toBeCloseTo(0.3, 2);
  });

  it('paid_out decreases expectedBalance', async () => {
    const before = await readSessionExpectedBalance();
    await recordCashMovement(buildContext(), {
      type: 'paid_out',
      amount: 10,
      note: 'Vendor delivery payment',
    });
    const after = await readSessionExpectedBalance();
    expect(after - before).toBeCloseTo(-10, 2);
  });

  it('skim decreases expectedBalance', async () => {
    const before = await readSessionExpectedBalance();
    await recordCashMovement(buildContext(), {
      type: 'skim',
      amount: 5,
      note: 'Drawer skim mid-shift',
    });
    const after = await readSessionExpectedBalance();
    expect(after - before).toBeCloseTo(-5, 2);
  });

  it('replenishment increases expectedBalance', async () => {
    const before = await readSessionExpectedBalance();
    await recordCashMovement(buildContext(), {
      type: 'replenishment',
      amount: 20,
      note: 'Replenish from safe',
    });
    const after = await readSessionExpectedBalance();
    expect(after - before).toBeCloseTo(20, 2);
  });

  it('writes a cash_session.movement audit log keyed to the cash_movements row', async () => {
    const result = await recordCashMovement(buildContext(), {
      type: 'paid_in',
      amount: 7,
      note: 'Audit test inflow',
    });
    const audit = await getDatabase()
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.action, 'cash_session.movement'),
          eq(auditLogs.resourceId, result.movement.id)
        )
      )
      .get();
    expect(audit).toBeTruthy();
    expect(audit?.resourceType).toBe('cash_movement');
  });

  it('emits cash_movement + audit_log journal effects when an envelope is supplied', async () => {
    const db = getDatabase();
    const operationId = nanoid();
    await recordOperationStart(db, {
      tenantId,
      operationId,
      operationKind: 'cashSessions.recordMovement',
      deviceId: testDeviceId,
      userId,
      requestHash: 'hash-' + operationId,
    });
    const result = await recordCashMovement(
      buildContext({ envelope: { operationId } }),
      { type: 'paid_in', amount: 3, note: 'Envelope-tagged inflow' }
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
      .all();
    const kinds = effects.map(e => e.kind).sort();
    expect(kinds).toContain('cash_movement');
    expect(kinds).toContain('audit_log');
  });

  it('throws CASH_SESSION_REQUIRED when no active session exists', async () => {
    const db = getDatabase();
    // Create a brand-new cashier with no session.
    const otherUserId = nanoid();
    const now = new Date().toISOString();
    await db.insert(users).values({
      id: otherUserId,
      tenantId,
      email: `noSession-${otherUserId}@localhost`,
      passwordHash: 'unused',
      name: 'No Session',
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await expect(
      recordCashMovement(
        buildContext({ user: { id: otherUserId, role: 'cashier' } }),
        { type: 'paid_in', amount: 5, note: 'no-session test' }
      )
    ).rejects.toMatchObject({ cause: { errorCode: 'CASH_SESSION_REQUIRED' } });
  });

  it('throws CASH_SESSION_SITE_REQUIRED when ctx.siteId is missing', async () => {
    await expect(
      recordCashMovement(buildContext({ siteId: null }), {
        type: 'paid_in',
        amount: 1,
        note: 'no-site test',
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'CASH_SESSION_SITE_REQUIRED' } });
  });

  it('isolates movements across tenants', async () => {
    const db = getDatabase();
    const otherTenantId = nanoid();
    const otherUserId = nanoid();
    const otherSiteId = nanoid();
    const otherCompanyId = nanoid();
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: otherTenantId,
      name: 'Iso B',
      slug: `iso-b-${otherTenantId.slice(0, 6)}`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: otherCompanyId,
      tenantId: otherTenantId,
      name: 'Iso B Company',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: otherSiteId,
      tenantId: otherTenantId,
      companyId: otherCompanyId,
      name: 'Iso B HQ',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: otherUserId,
      tenantId: otherTenantId,
      email: `iso-${otherUserId}@localhost`,
      passwordHash: 'unused',
      name: 'Iso B admin',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await openCashSession(
      buildContext({ tenantId: otherTenantId, siteId: otherSiteId, user: { id: otherUserId, role: 'admin' } }),
      {
        registerName: 'iso-register',
        openingFloat: 0,
        denominations: [],
      }
    );
    await recordCashMovement(
      buildContext({ tenantId: otherTenantId, siteId: otherSiteId, user: { id: otherUserId, role: 'admin' } }),
      { type: 'paid_in', amount: 9, note: 'tenant B paid in' }
    );
    const tenantAMovements = await db
      .select()
      .from(cashMovements)
      .where(and(eq(cashMovements.tenantId, tenantId), eq(cashMovements.amount, 9)))
      .all();
    const tenantBMovements = await db
      .select()
      .from(cashMovements)
      .where(and(eq(cashMovements.tenantId, otherTenantId), eq(cashMovements.amount, 9)))
      .all();
    expect(tenantAMovements.length).toBe(0);
    expect(tenantBMovements.length).toBe(1);
  });
});
