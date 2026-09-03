import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { devices, idempotencyKeys, sites, users } from '../db/schema.js';
import { router } from '../trpc/init.js';
import {
  criticalCommandAdminProcedure,
  criticalCommandProcedure,
} from '../trpc/middleware/criticalCommand.js';
import { claimActiveDeviceIdentity, registerDevice } from '../services/devices/devicesService.js';
import { freshCriticalContext } from './utils/criticalCommandFixture.js';
import { __withExpectedTestLogs } from '../logging/logger.js';
import * as commandResults from '../services/idempotency/commandResultRef.js';

describe('command identity across replay and revocation', () => {
  let server: PuntovivoServer;
  let actor: typeof users.$inferSelect;
  let siteId: string;
  let deviceId: string;
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    actor = getDatabase().select().from(users).where(eq(users.email, 'admin@localhost')).get()!;
    siteId = getDatabase().select().from(sites).where(eq(sites.tenantId, actor.tenantId)).get()!.id;
  });
  beforeEach(async () => {
    getDatabase()
      .update(users)
      .set({ role: 'admin', sessionVersion: actor.sessionVersion })
      .where(eq(users.id, actor.id))
      .run();
    deviceId = (
      await registerDevice(getDatabase(), {
        tenantId: actor.tenantId,
        userId: actor.id,
        kind: 'web',
        name: 'identity-replay',
      })
    ).deviceId;
  });
  afterAll(async () => {
    await server.close();
  });

  function context(user = actor, key = randomUUID()) {
    return freshCriticalContext({
      db: getDatabase(),
      serverApp: server.app,
      tenantId: actor.tenantId,
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionVersion: user.sessionVersion,
      siteId,
      deviceId,
      envelope: {
        operationId: key,
        idempotencyKey: key,
        clientCreatedAt: new Date().toISOString(),
      },
    });
  }

  it('does not return a prior admins cached result to a viewer or a different admin', async () => {
    let executions = 0;
    const api = router({
      secret: criticalCommandAdminProcedure.mutation(() => ({ secret: ++executions })),
    });
    const key = randomUUID();
    expect(await api.createCaller(context(actor, key)).secret()).toEqual({ secret: 1 });
    expect(await api.createCaller(context(actor, key)).secret()).toEqual({ secret: 1 });
    const next = {
      ...actor,
      id: randomUUID(),
      email: `${randomUUID()}@test.local`,
      role: 'viewer' as const,
    };
    getDatabase().insert(users).values(next).run();
    getDatabase()
      .update(devices)
      .set({ activeUserId: next.id, identityVersion: 2 })
      .where(eq(devices.id, deviceId))
      .run();
    await expect(api.createCaller(context(next, key)).secret()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    getDatabase().update(users).set({ role: 'admin' }).where(eq(users.id, next.id)).run();
    await expect(
      __withExpectedTestLogs(
        [
          {
            level: 'warn',
            module: 'commandEnvelope',
            message: 'idempotency key replayed with mismatched canonical input hash',
          },
        ],
        () => api.createCaller(context({ ...next, role: 'admin' }, key)).secret()
      )
    ).rejects.toMatchObject({ cause: { errorCode: 'IDEMPOTENCY_KEY_CONFLICT' } });
    expect(executions).toBe(1);
  });

  it('rolls back a privileged write if the actor is demoted while it awaits', async () => {
    const started = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const api = router({
      sales: router({
        void: criticalCommandAdminProcedure.mutation(async ({ ctx }) => {
          started.resolve();
          await resume.promise;
          return ctx.db.transaction(tx => {
            tx.update(users).set({ name: 'must roll back' }).where(eq(users.id, actor.id)).run();
            ctx.completeInTransaction(tx, { ok: true });
            return { ok: true };
          });
        }),
      }),
    });
    const pending = api.createCaller(context()).sales.void();
    const assertion = expect(pending).rejects.toMatchObject({
      cause: { errorCode: 'AUTH_IDENTITY_CHANGED' },
    });
    await started.promise;
    getDatabase().update(users).set({ role: 'viewer' }).where(eq(users.id, actor.id)).run();
    resume.resolve();
    await assertion;
    expect(getDatabase().select().from(users).where(eq(users.id, actor.id)).get()!.name).toBe(
      actor.name
    );
  });

  it('does not rebind an unbound device from a stale pre-logout JWT', async () => {
    getDatabase()
      .update(devices)
      .set({ activeUserId: null, identityVersion: 2 })
      .where(eq(devices.id, deviceId))
      .run();
    getDatabase()
      .update(users)
      .set({ sessionVersion: actor.sessionVersion + 1 })
      .where(eq(users.id, actor.id))
      .run();
    await expect(
      claimActiveDeviceIdentity(getDatabase(), {
        tenantId: actor.tenantId,
        deviceId,
        userId: actor.id,
        expectedIdentity: { sessionVersion: actor.sessionVersion, role: actor.role },
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'AUTH_IDENTITY_CHANGED' } });
    expect(
      getDatabase().select().from(devices).where(eq(devices.id, deviceId)).get()
    ).toMatchObject({ activeUserId: null, identityVersion: 2 });
  });

  it('rejects a cache hit if the operator is revoked during result hydration', async () => {
    const key = randomUUID();
    const api = router({
      probe: criticalCommandProcedure.mutation(() => ({ privateResult: true })),
    });
    await api.createCaller(context(actor, key)).probe();
    const started = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const original = commandResults.resolveCommandResultRef;
    const spy = vi
      .spyOn(commandResults, 'resolveCommandResultRef')
      .mockImplementationOnce(async (...args) => {
        started.resolve();
        await resume.promise;
        return original(...args);
      });
    try {
      const pending = api.createCaller(context(actor, key)).probe();
      const assertion = expect(pending).rejects.toMatchObject({
        cause: { errorCode: 'AUTH_IDENTITY_CHANGED' },
      });
      await started.promise;
      getDatabase().update(users).set({ role: 'viewer' }).where(eq(users.id, actor.id)).run();
      resume.resolve();
      await assertion;
    } finally {
      spy.mockRestore();
      resume.resolve();
    }
  });

  it('does not reclaim another actors expired processing lease', async () => {
    const key = randomUUID();
    const api = router({ probe: criticalCommandProcedure.mutation(() => ({ ok: true })) });
    await api.createCaller(context(actor, key)).probe();
    getDatabase()
      .update(idempotencyKeys)
      .set({ status: 'processing', lockedAt: new Date(Date.now() - 120_000).toISOString() })
      .where(eq(idempotencyKeys.idempotencyKey, key))
      .run();
    getDatabase().update(devices).set({ identityVersion: 3 }).where(eq(devices.id, deviceId)).run();
    await expect(
      __withExpectedTestLogs(
        [
          {
            level: 'warn',
            module: 'commandEnvelope',
            message: 'idempotency key replayed with mismatched canonical input hash',
          },
        ],
        () => api.createCaller(context(actor, key)).probe()
      )
    ).rejects.toMatchObject({ cause: { errorCode: 'IDEMPOTENCY_KEY_CONFLICT' } });
    expect(
      getDatabase()
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.idempotencyKey, key))
        .get()!.status
    ).toBe('processing');
  });
});
