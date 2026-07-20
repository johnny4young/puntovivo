/**
 * Operation journal service tests.
 *
 * Verifies the per-row helpers in
 * `services/operation-journal/journal.ts`:
 *
 * - `recordOperationStart` is idempotent on (tenantId, operationId).
 * - `recordEffect` / `recordError` write FK-linked rows that the
 * trail query can read back.
 * - `markOperationCompleted` refuses to transition out of a
 * terminal state.
 * - Multi-tenant scoping: same `operationId` across two tenants does
 * NOT collide.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  operationEffects,
  operationErrors,
  operationEvents,
  tenants,
  users,
} from '../db/schema.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import {
  getOperationTrail,
  markOperationCompleted,
  recordEffect,
  recordError,
  recordOperationStart,
} from '../services/operation-journal/journal.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let deviceId: string;

let secondTenantId: string;
let secondUserId: string;
let secondDeviceId: string;

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();

  const seededAdmin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!seededAdmin) throw new Error('Expected seeded admin user');
  tenantId = seededAdmin.tenantId;
  userId = seededAdmin.id;
  const reg = await registerDeviceService(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'journal.test.primary',
  });
  deviceId = reg.deviceId;

  // Second tenant — used to assert multi-tenant isolation when the
  // SAME `operationId` value is reused across tenant boundaries.
  secondTenantId = nanoid();
  secondUserId = nanoid();
  const now = new Date().toISOString();
  await db.insert(tenants).values({
    id: secondTenantId,
    name: 'Other Tenant',
    slug: `other-journal-${nanoid(6).toLowerCase()}`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: secondUserId,
    tenantId: secondTenantId,
    email: 'other-journal-admin@localhost',
    passwordHash: 'x',
    name: 'Other Admin',
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const reg2 = await registerDeviceService(db, {
    tenantId: secondTenantId,
    userId: secondUserId,
    kind: 'web',
    name: 'journal.test.other',
  });
  secondDeviceId = reg2.deviceId;
});

afterAll(async () => {
  await server.close();
});

describe('recordOperationStart', () => {
  it('inserts a fresh event with status started', async () => {
    const db = getDatabase();
    const operationId = nanoid();
    const result = await recordOperationStart(db, {
      tenantId,
      operationId,
      operationKind: 'sales.create',
      deviceId,
      userId,
      requestHash: 'hash-001',
    });

    expect(result.isNew).toBe(true);
    expect(result.eventId).toBeTruthy();

    const row = await db
      .select()
      .from(operationEvents)
      .where(eq(operationEvents.id, result.eventId))
      .get();
    expect(row).toBeTruthy();
    expect(row?.status).toBe('started');
    expect(row?.operationKind).toBe('sales.create');
    expect(row?.completedAt).toBeNull();
  });

  it('is idempotent on (tenantId, operationId) — second call returns the same event id', async () => {
    const db = getDatabase();
    const operationId = nanoid();
    const first = await recordOperationStart(db, {
      tenantId,
      operationId,
      operationKind: 'sales.create',
      deviceId,
      userId,
      requestHash: 'hash-002',
    });
    const second = await recordOperationStart(db, {
      tenantId,
      operationId,
      operationKind: 'sales.create',
      deviceId,
      userId,
      requestHash: 'hash-002',
    });

    expect(first.eventId).toBe(second.eventId);
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
  });

  it('does not collide across tenants for the same operationId', async () => {
    const db = getDatabase();
    const operationId = nanoid();
    const inA = await recordOperationStart(db, {
      tenantId,
      operationId,
      operationKind: 'sales.create',
      deviceId,
      userId,
      requestHash: 'hash-A',
    });
    const inB = await recordOperationStart(db, {
      tenantId: secondTenantId,
      operationId,
      operationKind: 'sales.create',
      deviceId: secondDeviceId,
      userId: secondUserId,
      requestHash: 'hash-B',
    });

    expect(inA.eventId).not.toBe(inB.eventId);
    expect(inA.isNew).toBe(true);
    expect(inB.isNew).toBe(true);
  });

  it('persists the optional summary blob', async () => {
    const db = getDatabase();
    const operationId = nanoid();
    const summary = { saleId: 'sale-test', total: 12500 };
    const { eventId } = await recordOperationStart(db, {
      tenantId,
      operationId,
      operationKind: 'sales.create',
      deviceId,
      userId,
      requestHash: 'hash-003',
      summary,
    });
    const row = await db
      .select()
      .from(operationEvents)
      .where(eq(operationEvents.id, eventId))
      .get();
    expect(row?.summary).toEqual(summary);
  });
});

describe('recordEffect', () => {
  it('inserts an effect linked to the parent event', async () => {
    const db = getDatabase();
    const { eventId } = await recordOperationStart(db, {
      tenantId,
      operationId: nanoid(),
      operationKind: 'sales.create',
      deviceId,
      userId,
      requestHash: 'hash-effect-1',
    });
    const { effectId } = await recordEffect(db, {
      operationEventId: eventId,
      kind: 'audit_log',
      resourceType: 'audit_logs',
      resourceId: 'audit-row-1',
      effectData: { action: 'sale.create' },
    });

    const stored = await db
      .select()
      .from(operationEffects)
      .where(eq(operationEffects.id, effectId))
      .get();
    expect(stored?.operationEventId).toBe(eventId);
    expect(stored?.kind).toBe('audit_log');
    expect(stored?.effectData).toEqual({ action: 'sale.create' });
  });

  it('rejects an effect whose parent event does not exist', async () => {
    const db = getDatabase();
    await expect(
      recordEffect(db, {
        operationEventId: 'non-existent-event-id',
        kind: 'audit_log',
        resourceType: 'audit_logs',
        resourceId: 'x',
      })
    ).rejects.toThrow();
  });
});

describe('recordError', () => {
  it('inserts a recoverable error', async () => {
    const db = getDatabase();
    const { eventId } = await recordOperationStart(db, {
      tenantId,
      operationId: nanoid(),
      operationKind: 'sales.create',
      deviceId,
      userId,
      requestHash: 'hash-err-1',
    });
    const { errorId } = await recordError(db, {
      operationEventId: eventId,
      errorCode: 'FISCAL_TRANSIENT',
      message: 'DIAN sandbox replied 503',
      recoverable: true,
      errorData: { providerCode: 'SVC_UNAVAILABLE' },
    });
    const stored = await db
      .select()
      .from(operationErrors)
      .where(eq(operationErrors.id, errorId))
      .get();
    expect(stored?.recoverable).toBe(true);
    expect(stored?.errorCode).toBe('FISCAL_TRANSIENT');
    expect(stored?.errorData).toEqual({ providerCode: 'SVC_UNAVAILABLE' });
  });

  it('inserts a non-recoverable error without optional data', async () => {
    const db = getDatabase();
    const { eventId } = await recordOperationStart(db, {
      tenantId,
      operationId: nanoid(),
      operationKind: 'sales.create',
      deviceId,
      userId,
      requestHash: 'hash-err-2',
    });
    const { errorId } = await recordError(db, {
      operationEventId: eventId,
      errorCode: 'VALIDATION_REJECTED',
      message: 'Provider rejected: invalid RUC',
      recoverable: false,
    });
    const stored = await db
      .select()
      .from(operationErrors)
      .where(eq(operationErrors.id, errorId))
      .get();
    expect(stored?.recoverable).toBe(false);
    expect(stored?.errorData).toBeNull();
  });
});

describe('markOperationCompleted', () => {
  it('transitions started → succeeded with completedAt set', async () => {
    const db = getDatabase();
    const { eventId } = await recordOperationStart(db, {
      tenantId,
      operationId: nanoid(),
      operationKind: 'sales.create',
      deviceId,
      userId,
      requestHash: 'hash-mark-1',
    });
    await markOperationCompleted(db, eventId, 'succeeded');
    const row = await db
      .select()
      .from(operationEvents)
      .where(eq(operationEvents.id, eventId))
      .get();
    expect(row?.status).toBe('succeeded');
    expect(row?.completedAt).toBeTruthy();
  });

  it('transitions started → failed', async () => {
    const db = getDatabase();
    const { eventId } = await recordOperationStart(db, {
      tenantId,
      operationId: nanoid(),
      operationKind: 'sales.create',
      deviceId,
      userId,
      requestHash: 'hash-mark-2',
    });
    await markOperationCompleted(db, eventId, 'failed');
    const row = await db
      .select()
      .from(operationEvents)
      .where(eq(operationEvents.id, eventId))
      .get();
    expect(row?.status).toBe('failed');
  });

  it('transitions started → partial for post-commit failure scenarios', async () => {
    const db = getDatabase();
    const { eventId } = await recordOperationStart(db, {
      tenantId,
      operationId: nanoid(),
      operationKind: 'sales.create',
      deviceId,
      userId,
      requestHash: 'hash-mark-3',
    });
    await markOperationCompleted(db, eventId, 'partial');
    const row = await db
      .select()
      .from(operationEvents)
      .where(eq(operationEvents.id, eventId))
      .get();
    expect(row?.status).toBe('partial');
  });

  it('refuses to transition out of a terminal state — second mark is a no-op', async () => {
    const db = getDatabase();
    const { eventId } = await recordOperationStart(db, {
      tenantId,
      operationId: nanoid(),
      operationKind: 'sales.create',
      deviceId,
      userId,
      requestHash: 'hash-mark-4',
    });
    await markOperationCompleted(db, eventId, 'succeeded');
    const firstSnapshot = await db
      .select()
      .from(operationEvents)
      .where(eq(operationEvents.id, eventId))
      .get();
    await markOperationCompleted(db, eventId, 'failed');
    const secondSnapshot = await db
      .select()
      .from(operationEvents)
      .where(eq(operationEvents.id, eventId))
      .get();
    expect(secondSnapshot?.status).toBe('succeeded');
    expect(secondSnapshot?.completedAt).toBe(firstSnapshot?.completedAt);
  });
});

describe('getOperationTrail', () => {
  it('returns the full trail (event + effects + errors) for a known operationId', async () => {
    const db = getDatabase();
    const operationId = nanoid();
    const { eventId } = await recordOperationStart(db, {
      tenantId,
      operationId,
      operationKind: 'sales.create',
      deviceId,
      userId,
      requestHash: 'hash-trail-1',
    });
    await recordEffect(db, {
      operationEventId: eventId,
      kind: 'audit_log',
      resourceType: 'audit_logs',
      resourceId: 'audit-1',
    });
    await recordEffect(db, {
      operationEventId: eventId,
      kind: 'sale_row',
      resourceType: 'sales',
      resourceId: 'sale-1',
    });
    await recordError(db, {
      operationEventId: eventId,
      errorCode: 'POST_COMMIT_FISCAL',
      message: 'Adapter timed out',
      recoverable: true,
    });
    await markOperationCompleted(db, eventId, 'partial');

    const trail = await getOperationTrail(db, { tenantId, operationId });
    expect(trail).not.toBeNull();
    expect(trail?.event.status).toBe('partial');
    expect(trail?.effects.length).toBe(2);
    expect(trail?.errors.length).toBe(1);
    expect(trail?.errors[0]?.recoverable).toBe(true);
  });

  it('returns null for a missing operationId', async () => {
    const db = getDatabase();
    const trail = await getOperationTrail(db, {
      tenantId,
      operationId: 'never-created',
    });
    expect(trail).toBeNull();
  });
});
