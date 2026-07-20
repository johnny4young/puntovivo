/**
 * Tests for the idempotency service + keyHasher.
 */
import { describe, expect, it, beforeEach, beforeAll } from 'vitest';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { devices, tenants, users } from '../db/schema.js';
import { hash } from 'argon2';
import { hashCanonicalInput, __test_canonicalize } from '../services/idempotency/keyHasher.js';
import {
  IDEMPOTENCY_DEFAULT_TTL_MS,
  cleanupExpired,
  completeKey,
  failKey,
  reserveKey,
} from '../services/idempotency/idempotencyService.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let deviceId: string;

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  tenantId = nanoid();
  userId = nanoid();
  deviceId = nanoid();
  await db.insert(tenants).values({
    id: tenantId,
    name: 'Idempotency Test',
    slug: `idem-${tenantId.slice(0, 6)}`,
    settings: {},
    isActive: true,
  });
  await db.insert(users).values({
    id: userId,
    tenantId,
    email: `idem-${userId.slice(0, 6)}@test.local`,
    passwordHash: await hash('TestPassword123!'),
    name: 'Idempotency Tester',
    role: 'admin',
    isActive: true,
  });
  await db.insert(devices).values({
    id: deviceId,
    tenantId,
    kind: 'web',
    name: 'idem-test-device',
    registeredByUserId: userId,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});

describe('keyHasher canonicalize', () => {
  it('produces identical hash regardless of object key order', () => {
    const a = hashCanonicalInput({ foo: 1, bar: 2 });
    const b = hashCanonicalInput({ bar: 2, foo: 1 });
    expect(a).toBe(b);
  });

  it('produces different hash for nested re-shape', () => {
    const a = hashCanonicalInput({ items: [{ qty: 1, sku: 'A' }] });
    const b = hashCanonicalInput({ items: [{ qty: 2, sku: 'A' }] });
    expect(a).not.toBe(b);
  });

  it('preserves array order (semantic for line items)', () => {
    const a = hashCanonicalInput({ items: ['x', 'y'] });
    const b = hashCanonicalInput({ items: ['y', 'x'] });
    expect(a).not.toBe(b);
  });

  it('treats null and undefined identically', () => {
    const a = hashCanonicalInput({ x: null });
    const b = hashCanonicalInput({ x: undefined });
    expect(a).toBe(b);
  });

  it('canonical form sorts deeply nested keys', () => {
    const canonical = __test_canonicalize({ b: { y: 1, x: 2 }, a: 0 });
    expect(canonical).toBe('{"a":0,"b":{"x":2,"y":1}}');
  });
});

describe('idempotencyService reservation lifecycle', () => {
  it('first call reserves a key before the command runs', async () => {
    const result = await reserveKey(getDatabase(), {
      tenantId,
      deviceId,
      idempotencyKey: nanoid(),
      operationKind: 'sales.create',
      requestHash: 'hash-A',
    });
    expect(result.state).toBe('reserved');
    if (result.state === 'reserved') {
      expect(result.reservationId).toBeTruthy();
      expect(result.requestHash).toBe('hash-A');
    }
  });

  it('completeKey + reserveKey replay returns the cached payload', async () => {
    const key = nanoid();
    const reservation = await reserveKey(getDatabase(), {
      tenantId,
      deviceId,
      idempotencyKey: key,
      operationKind: 'sales.create',
      requestHash: 'hash-A',
    });
    expect(reservation.state).toBe('reserved');
    if (reservation.state !== 'reserved') throw new Error('expected reservation');

    await completeKey(getDatabase(), {
      tenantId,
      deviceId,
      idempotencyKey: key,
      operationKind: 'sales.create',
      reservationId: reservation.reservationId,
      requestHash: 'hash-A',
      resultRef: { saleId: 'sale-1', total: 100 },
    });

    const hit = await reserveKey(getDatabase(), {
      tenantId,
      deviceId,
      idempotencyKey: key,
      operationKind: 'sales.create',
      requestHash: 'hash-A',
    });
    expect(hit.state).toBe('cached');
    if (hit.state === 'cached') {
      expect(hit.requestHash).toBe('hash-A');
      expect(hit.resultRef).toMatchObject({ saleId: 'sale-1', total: 100 });
    }
  });

  it('same key while the first command is running returns processing', async () => {
    const key = nanoid();
    const first = await reserveKey(getDatabase(), {
      tenantId,
      deviceId,
      idempotencyKey: key,
      operationKind: 'sales.create',
      requestHash: 'hash-X',
    });
    const second = await reserveKey(getDatabase(), {
      tenantId,
      deviceId,
      idempotencyKey: key,
      operationKind: 'sales.create',
      requestHash: 'hash-X',
    });
    expect(first.state).toBe('reserved');
    expect(second.state).toBe('processing');
  });

  it('concurrent same-key reservations allow only one caller to run', async () => {
    const key = nanoid();
    const [first, second] = await Promise.all([
      reserveKey(getDatabase(), {
        tenantId,
        deviceId,
        idempotencyKey: key,
        operationKind: 'sales.create',
        requestHash: 'hash-concurrent',
      }),
      reserveKey(getDatabase(), {
        tenantId,
        deviceId,
        idempotencyKey: key,
        operationKind: 'sales.create',
        requestHash: 'hash-concurrent',
      }),
    ]);
    expect([first.state, second.state].sort()).toEqual(['processing', 'reserved']);
  });

  it('same key with different input returns conflict', async () => {
    const key = nanoid();
    await reserveKey(getDatabase(), {
      tenantId,
      deviceId,
      idempotencyKey: key,
      operationKind: 'sales.create',
      requestHash: 'hash-A',
    });
    const conflict = await reserveKey(getDatabase(), {
      tenantId,
      deviceId,
      idempotencyKey: key,
      operationKind: 'sales.create',
      requestHash: 'hash-B',
    });
    expect(conflict.state).toBe('conflict');
    if (conflict.state === 'conflict') {
      expect(conflict.storedHash).toBe('hash-A');
      expect(conflict.providedHash).toBe('hash-B');
    }
  });

  it('expired processing rows can be reserved again for the same payload', async () => {
    const key = nanoid();
    const first = await reserveKey(getDatabase(), {
      tenantId,
      deviceId,
      idempotencyKey: key,
      operationKind: 'sales.create',
      requestHash: 'hash',
      ttlMs: 100,
    });
    expect(first.state).toBe('reserved');
    const retry = await reserveKey(
      getDatabase(),
      {
        tenantId,
        deviceId,
        idempotencyKey: key,
        operationKind: 'sales.create',
        requestHash: 'hash',
        ttlMs: 60_000,
      },
      new Date(Date.now() + 5_000)
    );
    expect(retry.state).toBe('reserved');
    if (first.state === 'reserved' && retry.state === 'reserved') {
      expect(retry.reservationId).not.toBe(first.reservationId);
    }
  });

  it('expired rows can be reused by a different payload', async () => {
    const key = nanoid();
    const first = await reserveKey(getDatabase(), {
      tenantId,
      deviceId,
      idempotencyKey: key,
      operationKind: 'sales.create',
      requestHash: 'hash-old',
      ttlMs: 100,
    });
    expect(first.state).toBe('reserved');

    const retry = await reserveKey(
      getDatabase(),
      {
        tenantId,
        deviceId,
        idempotencyKey: key,
        operationKind: 'sales.create',
        requestHash: 'hash-new',
        ttlMs: 60_000,
      },
      new Date(Date.now() + 5_000)
    );
    expect(retry.state).toBe('reserved');
  });

  it('failed rows can be reserved again for the same payload', async () => {
    const key = nanoid();
    const first = await reserveKey(getDatabase(), {
      tenantId,
      deviceId,
      idempotencyKey: key,
      operationKind: 'sales.create',
      requestHash: 'hash-failed',
    });
    expect(first.state).toBe('reserved');
    if (first.state !== 'reserved') throw new Error('expected reservation');
    await failKey(getDatabase(), {
      tenantId,
      deviceId,
      idempotencyKey: key,
      operationKind: 'sales.create',
      reservationId: first.reservationId,
      requestHash: 'hash-failed',
    });

    const retry = await reserveKey(getDatabase(), {
      tenantId,
      deviceId,
      idempotencyKey: key,
      operationKind: 'sales.create',
      requestHash: 'hash-failed',
    });
    expect(retry.state).toBe('reserved');
  });

  it('multi-tenant isolation: same key on different tenant does not collide', async () => {
    const key = nanoid();
    const otherTenantId = nanoid();
    const otherUserId = nanoid();
    const otherDeviceId = nanoid();
    await getDatabase()
      .insert(tenants)
      .values({
        id: otherTenantId,
        name: 'Other',
        slug: `other-${otherTenantId.slice(0, 6)}`,
        settings: {},
        isActive: true,
      });
    await getDatabase()
      .insert(users)
      .values({
        id: otherUserId,
        tenantId: otherTenantId,
        email: `other-${otherUserId.slice(0, 6)}@test.local`,
        passwordHash: await hash('TestPassword123!'),
        name: 'Other',
        role: 'admin',
        isActive: true,
      });
    await getDatabase().insert(devices).values({
      id: otherDeviceId,
      tenantId: otherTenantId,
      kind: 'web',
      name: 'other-device',
      registeredByUserId: otherUserId,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const first = await reserveKey(getDatabase(), {
      tenantId,
      deviceId,
      idempotencyKey: key,
      operationKind: 'sales.create',
      requestHash: 'a',
    });
    expect(first.state).toBe('reserved');

    const otherHit = await reserveKey(getDatabase(), {
      tenantId: otherTenantId,
      deviceId: otherDeviceId,
      idempotencyKey: key,
      operationKind: 'sales.create',
      requestHash: 'a',
    });
    expect(otherHit.state).toBe('reserved');
  });

  it('cleanupExpired removes only expired rows', async () => {
    const survivor = nanoid();
    const survivorReservation = await reserveKey(getDatabase(), {
      tenantId,
      deviceId,
      idempotencyKey: survivor,
      operationKind: 'sales.create',
      requestHash: 'survivor',
      ttlMs: 60_000,
    });
    expect(survivorReservation.state).toBe('reserved');
    if (survivorReservation.state !== 'reserved') throw new Error('expected reservation');
    await completeKey(getDatabase(), {
      tenantId,
      deviceId,
      idempotencyKey: survivor,
      operationKind: 'sales.create',
      reservationId: survivorReservation.reservationId,
      requestHash: 'survivor',
      resultRef: { v: 1 },
      ttlMs: 60_000,
    });
    const expired = nanoid();
    await reserveKey(getDatabase(), {
      tenantId,
      deviceId,
      idempotencyKey: expired,
      operationKind: 'sales.create',
      requestHash: 'expired',
      ttlMs: 100,
    });
    const removed = await cleanupExpired(getDatabase(), new Date(Date.now() + 5_000));
    expect(removed).toBeGreaterThanOrEqual(1);
    const stillThere = await reserveKey(getDatabase(), {
      tenantId,
      deviceId,
      idempotencyKey: survivor,
      operationKind: 'sales.create',
      requestHash: 'survivor',
    });
    expect(stillThere.state).toBe('cached');
  });

  it('default TTL is 24 hours', () => {
    expect(IDEMPOTENCY_DEFAULT_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
