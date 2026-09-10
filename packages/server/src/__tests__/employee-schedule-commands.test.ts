/** Real schedule transactions and replay recovery; no HTTP or production data. */
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '../db/index.js';
import { createServer, type PuntovivoServer } from '../index.js';
import { appRouter } from '../trpc/router.js';
import {
  createCriticalCommandFixture,
  freshCriticalContext,
} from './utils/criticalCommandFixture.js';
import * as commands from '../services/labor/scheduled-shifts.js';
import * as clock from '../services/pharmacy/business-clock.js';
import { isRemoteSyncApplyBlocked, resolveSyncTransportPolicy } from '../services/sync/contract.js';

let server: PuntovivoServer, deviceId: string;
let directory: string | undefined;
const sqlite = () => (getDatabase() as unknown as { $client: Database.Database }).$client;
const context = () =>
  freshCriticalContext({
    db: getDatabase(),
    serverApp: server.app,
    tenantId: 'tenant',
    userId: 'manager',
    email: 'manager@example.test',
    role: 'manager',
    siteId: 'site',
    deviceId,
    sessionVersion: 1,
  });
const caller = () => appRouter.createCaller(context()).employeeShifts.schedule;
const input = () => ({
  userId: 'worker',
  siteId: 'site',
  startDate: '2026-09-07',
  startTime: '08:00',
  endDate: '2026-09-07',
  endTime: '16:00',
  notes: 'Operational counter assignment',
});
function state() {
  return {
    rows: sqlite().prepare('SELECT * FROM scheduled_shifts ORDER BY id').all(),
    audit: sqlite()
      .prepare("SELECT * FROM audit_logs WHERE resource_type='scheduled_shift' ORDER BY id")
      .all(),
    outbox: sqlite()
      .prepare("SELECT * FROM sync_outbox WHERE entity_type='scheduled_shifts' ORDER BY id")
      .all(),
  };
}

beforeEach(async ({ task }) => {
  directory = task.name.includes('SQLITE_BUSY')
    ? mkdtempSync(join(tmpdir(), 'puntovivo-schedule-busy-'))
    : undefined;
  server = await createServer({
    dbPath: directory ? join(directory, 'schedule.db') : ':memory:',
    seedData: false,
    verbose: false,
  });
  sqlite().exec(`
    INSERT INTO tenants(id,name,slug,default_currency_code) VALUES ('tenant','Tenant','tenant','COP');
    INSERT INTO companies(id,tenant_id,name) VALUES ('company','tenant','Company');
    INSERT INTO sites(id,tenant_id,company_id,name) VALUES ('site','tenant','company','Central');
    INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES
      ('manager','tenant','Manager','manager@example.test','unused','manager'),
      ('worker','tenant','Worker','worker@example.test','unused','viewer');
    INSERT INTO tenant_locale_settings(tenant_id,country_code) VALUES ('tenant','CO');
  `);
  deviceId = (
    await createCriticalCommandFixture({
      db: getDatabase(),
      serverApp: server.app,
      tenantId: 'tenant',
      userId: 'manager',
      email: 'manager@example.test',
      role: 'manager',
      siteId: 'site',
      sessionVersion: 1,
    })
  ).deviceId;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

/** Prepare one actual router command with a stable envelope for both original and replay. */
async function prepare(kind: 'create' | 'update' | 'cancel') {
  const api = caller();
  if (kind === 'create')
    return {
      invoke: () => api.create(input()),
      crash: () => {
        const original = commands.createScheduledShift;
        return vi
          .spyOn(commands, 'createScheduledShift')
          .mockImplementationOnce(async (...args) => {
            await original(...args);
            throw new Error('INTERNAL_POST_COMMIT_FAULT');
          });
      },
    };
  const row = await caller().create(input());
  if (kind === 'update')
    return {
      invoke: () => api.update({ ...input(), id: row.id, version: row.version, endTime: '17:00' }),
      crash: () => {
        const original = commands.updateScheduledShift;
        return vi
          .spyOn(commands, 'updateScheduledShift')
          .mockImplementationOnce(async (...args) => {
            await original(...args);
            throw new Error('INTERNAL_POST_COMMIT_FAULT');
          });
      },
    };
  return {
    invoke: () => api.cancel({ id: row.id, version: row.version }),
    crash: () => {
      const original = commands.cancelScheduledShift;
      return vi.spyOn(commands, 'cancelScheduledShift').mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new Error('INTERNAL_POST_COMMIT_FAULT');
      });
    },
  };
}

describe('schedule command atomicity and recovery', () => {
  it.each(['create', 'update', 'cancel'] as const)(
    'recovers %s after a post-commit resolver crash exactly once',
    async kind => {
      const command = await prepare(kind),
        fault = command.crash();
      const result = await command.invoke();
      expect(await command.invoke()).toEqual(result);
      expect(fault).toHaveBeenCalledOnce();
      const expected = kind === 'create' ? 1 : 2;
      expect(state().rows).toHaveLength(1);
      expect(state().audit).toHaveLength(expected);
      expect(state().outbox).toHaveLength(expected);
      expect(sqlite().prepare('SELECT status FROM idempotency_keys').all()).toEqual(
        Array.from({ length: expected }, () => ({ status: 'succeeded' }))
      );
      expect(state().outbox).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 'local_only', conflict_policy: 'manual' }),
        ])
      );
      expect(JSON.stringify(state().outbox)).not.toContain(input().notes);
      expect(isRemoteSyncApplyBlocked('scheduled_shifts')).toBe(true);
      expect(resolveSyncTransportPolicy('scheduled_shifts')).toBe('local_only');
    }
  );

  it.each([
    ['reservation', 'BEFORE INSERT ON idempotency_keys'],
    ['completion', "BEFORE UPDATE ON idempotency_keys WHEN NEW.status='succeeded'"],
    ['outbox', "BEFORE INSERT ON sync_outbox WHEN NEW.entity_type='scheduled_shifts'"],
    ['audit', "BEFORE INSERT ON audit_logs WHEN NEW.resource_type='scheduled_shift'"],
  ])(
    'rolls back a real %s storage failure and retries the same command',
    async (_name, trigger) => {
      const command = await prepare('create');
      sqlite().exec(
        `CREATE TRIGGER fail_schedule ${trigger} BEGIN SELECT RAISE(ABORT, 'PRIVATE_STORAGE_DETAIL'); END`
      );
      await expect(command.invoke()).rejects.toMatchObject({
        cause: { errorCode: 'SCHEDULE_TEMPORARILY_UNAVAILABLE' },
        message: 'Schedules are temporarily unavailable; retry the same operation',
      });
      expect(state()).toEqual({ rows: [], audit: [], outbox: [] });
      sqlite().exec('DROP TRIGGER fail_schedule');
      const result = await command.invoke();
      expect(await command.invoke()).toEqual(result);
      expect(state().rows).toHaveLength(1);
      expect(state().outbox).toHaveLength(1);
      expect(state().audit).toHaveLength(1);
    }
  );

  it.each(['update', 'cancel'] as const)(
    'rolls back %s and its audit/outbox if the completion fence fails',
    async kind => {
      const command = await prepare(kind),
        before = state();
      sqlite().exec(
        "CREATE TRIGGER fail_schedule BEFORE UPDATE ON idempotency_keys WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'PRIVATE_COMPLETION'); END"
      );
      await expect(command.invoke()).rejects.toMatchObject({
        cause: { errorCode: 'SCHEDULE_TEMPORARILY_UNAVAILABLE' },
      });
      expect(state()).toEqual(before);
      sqlite().exec('DROP TRIGGER fail_schedule');
      const row = await command.invoke();
      expect(await command.invoke()).toEqual(row);
      expect(state().audit).toHaveLength(2);
    }
  );

  it('completes a current-version cancellation no-op without new business effects, but rejects stale cancellation', async () => {
    const row = await caller().create(input());
    const cancelled = await caller().cancel({ id: row.id, version: row.version });
    const before = state(),
      api = caller(),
      target = { id: row.id, version: cancelled.version };
    expect(await api.cancel(target)).toEqual(cancelled);
    expect(await api.cancel(target)).toEqual(cancelled);
    expect(state()).toEqual(before);
    expect(
      sqlite().prepare("SELECT count(*) AS n FROM idempotency_keys WHERE status='succeeded'").get()
    ).toEqual({ n: 3 });
    await expect(caller().cancel({ id: row.id, version: row.version })).rejects.toMatchObject({
      cause: { errorCode: 'STALE_VERSION' },
    });
  });

  it('recovers the same command after real SQLITE_BUSY without partial state', async () => {
    const competitor = new Database(join(directory!, 'schedule.db'));
    const previous = sqlite().pragma('busy_timeout', { simple: true }) as number;
    const api = caller();
    try {
      sqlite().pragma('busy_timeout=1');
      competitor.exec('BEGIN IMMEDIATE');
      await expect(api.create(input())).rejects.toMatchObject({
        cause: { errorCode: 'COMMAND_DATABASE_BUSY' },
      });
      expect(state()).toEqual({ rows: [], audit: [], outbox: [] });
      competitor.exec('ROLLBACK');
      const row = await api.create(input());
      expect(await api.create(input())).toEqual(row);
      expect(state().rows).toHaveLength(1);
      expect(state().outbox).toHaveLength(1);
    } finally {
      if (competitor.inTransaction) competitor.exec('ROLLBACK');
      competitor.close();
      sqlite().pragma(`busy_timeout=${previous}`);
    }
  });

  it('serializes competing device creates and versioned updates without duplicate effects', async () => {
    const second = await createCriticalCommandFixture({
      db: getDatabase(),
      serverApp: server.app,
      tenantId: 'tenant',
      userId: 'manager',
      email: 'manager@example.test',
      role: 'manager',
      siteId: 'site',
      sessionVersion: 1,
    });
    const peer = appRouter.createCaller(second.context).employeeShifts.schedule;
    const created = await Promise.allSettled([caller().create(input()), peer.create(input())]);
    expect(created.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(state().rows).toHaveLength(1);
    const winner = created.find(result => result.status === 'fulfilled');
    if (!winner || winner.status !== 'fulfilled') throw new Error('Expected a schedule');
    const target = { ...input(), id: winner.value.id, version: winner.value.version };
    const competing = await Promise.allSettled([
      caller().update({ ...target, endTime: '17:00' }),
      appRouter
        .createCaller(
          freshCriticalContext({
            db: getDatabase(),
            serverApp: server.app,
            tenantId: 'tenant',
            userId: 'manager',
            email: 'manager@example.test',
            role: 'manager',
            siteId: 'site',
            deviceId: second.deviceId,
            sessionVersion: 1,
          })
        )
        .employeeShifts.schedule.update({ ...target, endTime: '18:00' }),
    ]);
    expect(competing.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(state().audit).toHaveLength(2);
    expect(state().outbox).toHaveLength(2);
    expect(state().rows[0]).toMatchObject({ version: 2 });
  });

  it('allows viewer workers without granting them schedule administration', async () => {
    expect((await caller().context()).employees.map(row => row.id)).toContain('worker');
    await caller().create(input());
    const ctx = context();
    await expect(
      appRouter
        .createCaller({ ...ctx, user: { ...ctx.user!, id: 'worker', role: 'viewer' } })
        .employeeShifts.schedule.context()
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(sqlite().prepare("SELECT role FROM users WHERE id='worker'").get()).toEqual({
      role: 'viewer',
    });
  });

  it('keeps historical cancellation possible after both site and worker are archived', async () => {
    const row = await caller().create(input());
    sqlite().exec(
      "UPDATE sites SET is_active=0 WHERE id='site'; UPDATE users SET is_active=0 WHERE id='worker'"
    );
    await expect(caller().cancel({ id: row.id, version: row.version })).resolves.toMatchObject({
      status: 'cancelled',
    });
  });

  for (const kind of ['create', 'update', 'cancel'] as const) {
    it.each([
      ['actor role', "UPDATE users SET role='cashier' WHERE id='manager'", 'AUTH_IDENTITY_CHANGED'],
      ['actor active', "UPDATE users SET is_active=0 WHERE id='manager'", 'AUTH_IDENTITY_CHANGED'],
      [
        'tenant active',
        "UPDATE tenants SET is_active=0 WHERE id='tenant'",
        'AUTH_IDENTITY_CHANGED',
      ],
      [
        'worker promoted',
        "UPDATE users SET role='admin' WHERE id='worker'",
        kind === 'create' ? 'SCHEDULE_EMPLOYEE_NOT_FOUND' : 'SCHEDULE_SHIFT_NOT_FOUND',
      ],
      [
        'locale',
        "UPDATE tenant_locale_settings SET timezone_override='America/New_York',version=version+1 WHERE tenant_id='tenant'",
        'STALE_VERSION',
      ],
      ...(kind === 'cancel'
        ? []
        : [
            [
              'worker archived',
              "UPDATE users SET is_active=0 WHERE id='worker'",
              'SCHEDULE_EMPLOYEE_NOT_FOUND',
            ],
            [
              'site archived',
              "UPDATE sites SET is_active=0 WHERE id='site'",
              'SCHEDULE_SITE_NOT_FOUND',
            ],
          ]),
    ])(`rechecks ${kind} %s after preflight and before any write`, async (_name, sql, code) => {
      const command = await prepare(kind),
        before = state(),
        resolve = clock.resolveTenantBusinessClock;
      vi.spyOn(clock, 'resolveTenantBusinessClock').mockImplementationOnce(async (...args) => {
        const value = await resolve(...args);
        sqlite().exec(sql!);
        return value;
      });
      await expect(command.invoke()).rejects.toMatchObject({ cause: { errorCode: code } });
      expect(state()).toEqual(before);
    });
  }
});
