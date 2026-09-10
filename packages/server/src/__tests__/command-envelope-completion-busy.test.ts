/**
 * Lock contention on the compatibility completion path.
 *
 * `commandEnvelope` completes the idempotency reservation two ways. Purchases
 * and orders complete inside their own write transaction; every other
 * critical command -- roughly seventy procedures -- falls through to the
 * compatibility `completeKey` call that runs AFTER the command has already
 * committed.
 *
 * That call sat outside the resolver try/catch that translates SQLite lock
 * contention, so a `SQLITE_BUSY` raised there escaped as a raw native
 * database failure for a command that actually succeeded. The client does not
 * recognise a raw driver error as retainable, so it dropped the envelope and
 * left the reservation with no safe way back to it.
 *
 * The service module is mocked here rather than driven through a real lock:
 * a lock wide enough to hit `completeKey` would also block the procedure, and
 * timing one to land between the two is exactly the flake this suite must not
 * introduce.
 */
import { describe, expect, it, beforeAll, vi } from 'vitest';
import { nanoid } from 'nanoid';
import { hash } from 'argon2';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { companies, devices, sites, tenants, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

const completeKeyBehaviour = vi.hoisted(() => ({ throwBusy: false }));

vi.mock('../services/idempotency/idempotencyService.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../services/idempotency/idempotencyService.js')>();
  return {
    ...actual,
    completeKey: async (...args: Parameters<typeof actual.completeKey>) => {
      if (completeKeyBehaviour.throwBusy) {
        // The shape better-sqlite3 raises: the detector walks `cause` looking
        // for a SQLITE_BUSY code, so a bare message would not be recognised.
        throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
      }
      return actual.completeKey(...args);
    },
  };
});

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let targetUserId: string;
let siteId: string;
let deviceId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  tenantId = nanoid();
  userId = nanoid();
  targetUserId = nanoid();
  siteId = nanoid();
  deviceId = nanoid();
  const now = new Date().toISOString();

  await db.insert(tenants).values({
    id: tenantId,
    name: 'Completion Busy Test',
    slug: `busy-${tenantId.slice(0, 6)}`,
    settings: {},
    isActive: true,
  });
  const companyId = nanoid();
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: 'Completion Busy Co',
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values({
    id: siteId,
    tenantId,
    companyId,
    name: 'Main site',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const passwordHash = await hash('TestPassword123!');
  await db.insert(users).values([
    {
      id: userId,
      tenantId,
      email: `admin-${userId.slice(0, 6)}@test.local`,
      passwordHash,
      name: 'Busy Admin',
      role: 'admin',
      isActive: true,
    },
    {
      id: targetUserId,
      tenantId,
      email: `target-${targetUserId.slice(0, 6)}@test.local`,
      passwordHash,
      name: 'Rename Me',
      role: 'cashier',
      isActive: true,
    },
  ]);
  await db.insert(devices).values({
    id: deviceId,
    tenantId,
    kind: 'web',
    name: 'busy-test-device',
    registeredByUserId: userId,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  fresh = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId,
    userId,
    email: `admin-${userId.slice(0, 6)}@test.local`,
    siteId,
    deviceId,
  });
});

describe('compatibility completion under lock contention', () => {
  it('translates a busy completion into COMMAND_DATABASE_BUSY', async () => {
    completeKeyBehaviour.throwBusy = true;
    try {
      await expect(
        appRouter.createCaller(fresh()).users.update({ id: targetUserId, name: 'Renamed Once' })
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'COMMAND_DATABASE_BUSY' }),
        // The raw driver message must not reach the client: that is what the
        // client fails to recognise as retainable.
        message: expect.not.stringContaining('database is locked'),
      });
    } finally {
      completeKeyBehaviour.throwBusy = false;
    }
  });

  it('leaves the completion path untouched when the database is not busy', async () => {
    const result = await appRouter
      .createCaller(fresh())
      .users.update({ id: targetUserId, name: 'Renamed Twice' });
    expect(result).toMatchObject({ id: targetUserId, name: 'Renamed Twice' });
  });
});
