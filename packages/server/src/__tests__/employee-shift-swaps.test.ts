/** Three-party consent, actual SQLite rollback and Command Envelope replay, without HTTP mocks. */
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
import * as clock from '../services/pharmacy/business-clock.js';
import * as commands from '../application/workforce/shift-swaps.js';
import { getSwap } from '../services/labor/shift-swap-policy.js';
import { isRemoteSyncApplyBlocked, resolveSyncTransportPolicy } from '../services/sync/contract.js';

let server: PuntovivoServer, directory: string | undefined;
const devices = new Map<string, string>();
const actors = {
  admin: 'admin',
  admin2: 'admin',
  manager: 'manager',
  worker: 'viewer',
  cashier: 'cashier',
  foreign: 'admin',
} as const;
const sqlite = () => (getDatabase() as unknown as { $client: Database.Database }).$client;
const context = (actor: keyof typeof actors = 'manager') =>
  freshCriticalContext({
    db: getDatabase(),
    serverApp: server.app,
    tenantId: actor === 'foreign' ? 'other' : 'tenant',
    userId: actor,
    email: `${actor}@example.test`,
    role: actors[actor],
    siteId: actor === 'foreign' ? 'foreign-site' : 'site',
    deviceId: devices.get(actor)!,
    sessionVersion: 1,
  });
const root = (actor: keyof typeof actors = 'manager') => appRouter.createCaller(context(actor));
const caller = (actor: keyof typeof actors = 'manager') => root(actor).workforce.shiftSwaps;
const reason = 'PRIVATE explicit request reason';
const request = () => ({
  offeredShiftId: 'offered',
  requestedShiftId: 'requested',
  offeredVersion: 1,
  requestedVersion: 1,
  reason,
});
function futureWindow(days: number) {
  const startsAt = new Date(Date.now() + days * 86_400_000).toISOString();
  return { startsAt, endsAt: new Date(Date.parse(startsAt) + 8 * 3_600_000).toISOString() };
}
function moveShift(id: string, days: number) {
  const window = futureWindow(days);
  sqlite()
    .prepare('UPDATE scheduled_shifts SET starts_at=?,ends_at=? WHERE id=?')
    .run(window.startsAt, window.endsAt, id);
  return window;
}
function state() {
  return Object.fromEntries(
    [
      'employee_shift_swaps',
      'employee_shift_swap_claims',
      'employee_shift_swap_events',
      'scheduled_shifts',
      'audit_logs',
      'sync_outbox',
    ].map(table => [table, sqlite().prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])
  );
}
const pair = () => ({
  offered: sqlite().prepare("SELECT * FROM scheduled_shifts WHERE id='offered'").get(),
  requested: sqlite().prepare("SELECT * FROM scheduled_shifts WHERE id='requested'").get(),
});
const accept = async () => {
  const row = await caller('worker').create(request());
  await caller('cashier').respond({ id: row.id, expectedVersion: 1, status: 'accepted' });
  return row.id;
};
beforeEach(async ({ task }) => {
  directory = task.name.includes('SQLITE_BUSY')
    ? mkdtempSync(join(tmpdir(), 'puntovivo-swaps-'))
    : undefined;
  server = await createServer({
    dbPath: directory ? join(directory, 'swaps.db') : ':memory:',
    seedData: false,
    verbose: false,
  });
  sqlite().exec(`
    INSERT INTO tenants(id,name,slug,default_currency_code) VALUES ('tenant','Tenant','tenant','COP'),('other','Other','other','COP');
    INSERT INTO companies(id,tenant_id,name) VALUES ('company','tenant','Company'),('other-company','other','Other');
    INSERT INTO sites(id,tenant_id,company_id,name) VALUES ('site','tenant','company','Central'),('second-site','tenant','company','North'),('foreign-site','other','other-company','Foreign');
    INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES
      ('admin','tenant','Admin','admin@example.test','unused','admin'),('admin2','tenant','Second Admin','admin2@example.test','unused','admin'),('manager','tenant','Manager','manager@example.test','unused','manager'),
      ('worker','tenant','Worker','worker@example.test','unused','viewer'),('cashier','tenant','Cashier','cashier@example.test','unused','cashier'),('foreign','other','Foreign','foreign@example.test','unused','admin');
    INSERT INTO tenant_locale_settings(tenant_id,country_code) VALUES ('tenant','CO'),('other','CO');
    INSERT INTO scheduled_shifts(id,tenant_id,user_id,site_id,starts_at,ends_at,time_zone,created_by_user_id,updated_by_user_id,notes) VALUES
      ('offered','tenant','worker','site','2030-09-09T13:00:00.000Z','2030-09-09T21:00:00.000Z','America/Bogota','manager','manager','PRIVATE opening notes'),
      ('requested','tenant','cashier','second-site','2030-09-09T15:00:00.000Z','2030-09-09T23:00:00.000Z','America/Bogota','manager','manager','PRIVATE closing notes');
  `);
  devices.clear();
  for (const actor of Object.keys(actors) as Array<keyof typeof actors>) {
    const fixture = await createCriticalCommandFixture({
      db: getDatabase(),
      serverApp: server.app,
      tenantId: actor === 'foreign' ? 'other' : 'tenant',
      userId: actor,
      email: `${actor}@example.test`,
      role: actors[actor],
      siteId: actor === 'foreign' ? 'foreign-site' : 'site',
      sessionVersion: 1,
    });
    devices.set(actor, fixture.deviceId);
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('employee shift exchange', () => {
  it('requires consent then independent approval and preserves exact cross-site replacement lineage', async () => {
    const before = pair();
    const id = await accept();
    expect(pair()).toEqual(before);
    const approved = await caller().decide({ id, expectedVersion: 2, status: 'approved' });
    expect(approved).toEqual({ id, version: 3, status: 'approved' });
    const row = getSwap(getDatabase(), 'tenant', id);
    expect(
      sqlite()
        .prepare('SELECT user_id,site_id,starts_at,ends_at,notes FROM scheduled_shifts WHERE id=?')
        .get(row.offeredReplacementId)
    ).toEqual({
      user_id: 'cashier',
      site_id: 'site',
      starts_at: '2030-09-09T13:00:00.000Z',
      ends_at: '2030-09-09T21:00:00.000Z',
      notes: 'PRIVATE opening notes',
    });
    expect(
      sqlite()
        .prepare('SELECT user_id,site_id FROM scheduled_shifts WHERE id=?')
        .get(row.requestedReplacementId)
    ).toEqual({ user_id: 'worker', site_id: 'second-site' });
    expect(
      sqlite().prepare("SELECT count(*) AS n FROM scheduled_shifts WHERE status='cancelled'").get()
    ).toEqual({ n: 2 });
    expect(sqlite().prepare('SELECT * FROM employee_shift_swap_claims').all()).toEqual([]);
    expect(
      sqlite()
        .prepare('SELECT version,status FROM employee_shift_swap_events ORDER BY version')
        .all()
    ).toEqual([
      { version: 1, status: 'requested' },
      { version: 2, status: 'accepted' },
      { version: 3, status: 'approved' },
    ]);
    const minimal = JSON.stringify([
      sqlite().prepare('SELECT "after" FROM audit_logs').all(),
      sqlite().prepare('SELECT payload FROM sync_outbox').all(),
      approved,
    ]);
    expect(minimal).not.toContain('PRIVATE');
    expect(minimal).not.toContain('fingerprint');
    expect(isRemoteSyncApplyBlocked('employee_shift_swaps')).toBe(true);
    expect(resolveSyncTransportPolicy('employee_shift_swaps')).toBe('local_only');
    expect(sqlite().prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('replays every decision exactly once and rejects a new operation after approval', async () => {
    const createCaller = appRouter.createCaller(context('worker')).workforce.shiftSwaps;
    const first = await createCaller.create(request());
    expect(await createCaller.create(request())).toEqual(first);
    const respondCaller = appRouter.createCaller(context('cashier')).workforce.shiftSwaps;
    const input = { id: first.id, expectedVersion: 1, status: 'accepted' as const };
    expect(await respondCaller.respond(input)).toEqual(await respondCaller.respond(input));
    const decideCaller = appRouter.createCaller(context()).workforce.shiftSwaps;
    const decision = { id: first.id, expectedVersion: 2, status: 'approved' as const };
    const result = await decideCaller.decide(decision),
      before = state();
    expect(await decideCaller.decide(decision)).toEqual(result);
    expect(state()).toEqual(before);
    await expect(caller().decide({ ...decision, expectedVersion: 3 })).rejects.toThrow(/decision/);
  });
  it('blocks reverse and overlapping claims and releases both after cancellation', async () => {
    const row = await caller('worker').create(request());
    await expect(
      caller('cashier').create({
        ...request(),
        offeredShiftId: 'requested',
        requestedShiftId: 'offered',
      })
    ).rejects.toThrow(/active exchange/);
    await expect(caller('worker').create(request())).rejects.toThrow(/active exchange/);
    await caller('worker').respond({ id: row.id, expectedVersion: 1, status: 'cancelled', reason });
    expect((await caller('worker').create(request())).id).not.toBe(row.id);
  });
  it('allows only counterpart consent and cannot approve without it', async () => {
    const row = await caller('worker').create(request()),
      before = state();
    for (const actor of ['worker', 'manager', 'admin'] as const)
      await expect(
        caller(actor).respond({ id: row.id, expectedVersion: 1, status: 'accepted' })
      ).rejects.toThrow(/decision/);
    await expect(
      caller().decide({ id: row.id, expectedVersion: 1, status: 'approved' })
    ).rejects.toThrow(/decision/);
    expect(state()).toEqual(before);
  });
  it('does not widen the manager schedule API for employee self-service', async () => {
    await expect(root('worker').employeeShifts.schedule.context()).rejects.toThrow(
      /administrators and managers/
    );
    await expect(
      caller('worker').decide({ id: 'any', expectedVersion: 1, status: 'approved' })
    ).rejects.toThrow(/administrators and managers/);
  });
  it('hides unrelated, foreign and administrator shifts and requests', async () => {
    await expect(caller('manager').create(request())).rejects.toThrow(/not available/);
    await expect(caller('foreign').create(request())).rejects.toThrow(/not available/);
    const row = await caller('worker').create(request());
    await expect(
      caller('foreign').decide({ id: row.id, expectedVersion: 1, status: 'rejected', reason })
    ).rejects.toThrow(/not available/);
    sqlite().exec("UPDATE users SET role='admin' WHERE id='cashier'");
    await expect(
      caller().decide({ id: row.id, expectedVersion: 1, status: 'rejected', reason })
    ).rejects.toThrow(/not available/);
    await caller('admin').decide({ id: row.id, expectedVersion: 1, status: 'rejected', reason });
    await expect(caller('worker').create(request())).rejects.toThrow(/not available/);
  });
  it.each(['offered', 'requested'])(
    'rejects changed %s version, then permits cleanup after archival',
    async shift => {
      const id = await accept();
      sqlite().prepare('UPDATE scheduled_shifts SET version=version+1 WHERE id=?').run(shift);
      const before = state();
      await expect(caller().decide({ id, expectedVersion: 2, status: 'approved' })).rejects.toThrow(
        /changed or started/
      );
      expect(state()).toEqual(before);
      sqlite().exec(
        "UPDATE users SET is_active=0 WHERE id='worker'; UPDATE sites SET is_active=0 WHERE id='second-site'"
      );
      await caller().decide({ id, expectedVersion: 2, status: 'rejected', reason });
      expect(sqlite().prepare('SELECT * FROM employee_shift_swap_claims').all()).toEqual([]);
    }
  );
  it('detects raw content mutation even when a writer forgot the version bump', async () => {
    const id = await accept();
    sqlite().exec("UPDATE scheduled_shifts SET notes='MUTATED' WHERE id='offered'");
    await expect(caller().decide({ id, expectedVersion: 2, status: 'approved' })).rejects.toThrow(
      /changed or started/
    );
  });
  it('rejects self approval by a manager participant', async () => {
    sqlite().exec("UPDATE scheduled_shifts SET user_id='manager' WHERE id='offered'");
    const row = await caller().create(request());
    await caller('cashier').respond({ id: row.id, expectedVersion: 1, status: 'accepted' });
    await expect(
      caller().decide({ id: row.id, expectedVersion: 2, status: 'approved' })
    ).rejects.toThrow(/decision/);
    expect(
      (await caller('admin').decide({ id: row.id, expectedVersion: 2, status: 'approved' })).status
    ).toBe('approved');
  });
  it('rechecks approved time off across sites before committing replacements', async () => {
    sqlite().exec(
      "UPDATE scheduled_shifts SET starts_at='2030-09-10T13:00:00.000Z',ends_at='2030-09-10T21:00:00.000Z' WHERE id='requested'"
    );
    const id = await accept();
    const leave = await root().workforce.timeOff.create({
      userId: 'worker',
      siteId: 'site',
      kind: 'vacation',
      fromDate: '2030-09-10',
      untilDate: '2030-09-11',
      reason,
    });
    await root().workforce.timeOff.advance({
      id: leave.id,
      siteId: 'site',
      expectedVersion: 1,
      status: 'approved',
      reason,
    });
    const before = state();
    await expect(
      caller().decide({ id, expectedVersion: 2, status: 'approved' })
    ).rejects.toMatchObject({ cause: { errorCode: 'SCHEDULE_TIME_OFF_CONFLICT' } });
    expect(state()).toEqual(before);
  });
  it('rechecks availability changed after consent without reassigning original shifts', async () => {
    const id = await accept();
    await root().workforce.availability.create({
      userId: 'worker',
      fromDate: '2030-09-09',
      untilDate: null,
      slots: [{ weekday: 1, startMinute: 480, endMinute: 960 }],
      reason,
    });
    const before = state();
    await expect(
      caller().decide({ id, expectedVersion: 2, status: 'approved' })
    ).rejects.toMatchObject({ cause: { errorCode: 'SCHEDULE_AVAILABILITY_CONFLICT' } });
    expect(state()).toEqual(before);
  });
  it('does not leak unrelated shift IDs on cross-site overlap rejection', async () => {
    const id = await accept();
    sqlite().exec(
      "INSERT INTO scheduled_shifts(id,tenant_id,user_id,site_id,starts_at,ends_at,time_zone,created_by_user_id,updated_by_user_id) VALUES('private-conflict','tenant','worker','site','2030-09-09T21:00:00.000Z','2030-09-09T23:00:00.000Z','America/Bogota','manager','manager')"
    );
    const before = state();
    await expect(
      caller().decide({ id, expectedVersion: 2, status: 'approved' })
    ).rejects.toMatchObject({
      message: 'The exchange conflicts with another scheduled shift',
      cause: { details: undefined },
    });
    expect(state()).toEqual(before);
  });
  it.each([
    ['2030-09-09 13:00:00', '2030-09-09T21:00:00.000Z'],
    ['invalid', '2030-09-09T21:00:00.000Z'],
    ['2020-09-09T13:00:00.000Z', '2020-09-09T21:00:00.000Z'],
  ])('rejects noncanonical or elapsed input instant %s', async (starts, ends) => {
    // Deliberately corrupt a legacy row that bypassed modern constraints.
    sqlite().pragma('ignore_check_constraints=ON');
    sqlite()
      .prepare("UPDATE scheduled_shifts SET starts_at=?,ends_at=? WHERE id='offered'")
      .run(starts, ends);
    sqlite().pragma('ignore_check_constraints=OFF');
    await expect(caller('worker').create(request())).rejects.toThrow(/changed or started/);
  });
  it('freezes approved original history and decision events', async () => {
    const id = await accept();
    await caller().decide({ id, expectedVersion: 2, status: 'approved' });
    for (const statement of [
      "UPDATE scheduled_shifts SET notes='erased' WHERE id='offered'",
      "DELETE FROM scheduled_shifts WHERE id='requested'",
      "UPDATE employee_shift_swap_events SET reason='erased'",
      'DELETE FROM employee_shift_swap_events',
      'DELETE FROM employee_shift_swaps',
    ])
      expect(() => sqlite().exec(statement)).toThrow(/IMMUTABLE/);
  });
  it.each([
    ['first cancellation', "AFTER UPDATE ON scheduled_shifts WHEN NEW.id='offered'"],
    ['second cancellation', "AFTER UPDATE ON scheduled_shifts WHEN NEW.id='requested'"],
    ['first replacement', "AFTER INSERT ON scheduled_shifts WHEN NEW.user_id='cashier'"],
    ['second replacement', "AFTER INSERT ON scheduled_shifts WHEN NEW.user_id='worker'"],
    ['event', "AFTER INSERT ON employee_shift_swap_events WHEN NEW.status='approved'"],
    ['outbox', "AFTER INSERT ON sync_outbox WHEN NEW.entity_type='employee_shift_swaps'"],
    ['completion', "BEFORE UPDATE ON idempotency_keys WHEN NEW.status='succeeded'"],
  ])(
    'rolls back failure at %s and retries the same envelope exactly once',
    async (_label, clause) => {
      const id = await accept(),
        before = state();
      sqlite().exec(
        `CREATE TRIGGER inject_swap_failure ${clause} BEGIN SELECT RAISE(ABORT,'PRIVATE injected disk failure'); END;`
      );
      const sameCaller = appRouter.createCaller(context()).workforce.shiftSwaps,
        input = { id, expectedVersion: 2, status: 'approved' as const };
      await expect(sameCaller.decide(input)).rejects.toThrow(
        'Schedules are temporarily unavailable'
      );
      expect(state()).toEqual(before);
      sqlite().exec('DROP TRIGGER inject_swap_failure');
      expect((await sameCaller.decide(input)).status).toBe('approved');
      const after = state();
      await sameCaller.decide(input);
      expect(state()).toEqual(after);
    }
  );
  it('recovers after real SQLITE_BUSY on another connection without partial business state', async () => {
    const id = await accept(),
      api = caller(),
      input = { id, expectedVersion: 2, status: 'approved' as const },
      before = state();
    const competitor = new Database(join(directory!, 'swaps.db')),
      timeout = sqlite().pragma('busy_timeout', { simple: true }) as number;
    try {
      sqlite().pragma('busy_timeout=1');
      competitor.exec('BEGIN IMMEDIATE');
      await expect(api.decide(input)).rejects.toMatchObject({
        cause: { errorCode: 'COMMAND_DATABASE_BUSY' },
      });
      expect(state()).toEqual(before);
      competitor.exec('ROLLBACK');
      const result = await api.decide(input);
      expect(await api.decide(input)).toEqual(result);
    } finally {
      if (competitor.inTransaction) competitor.exec('ROLLBACK');
      competitor.close();
      sqlite().pragma(`busy_timeout=${timeout}`);
    }
  });
  it('returns durable approval after failure between commit and response', async () => {
    const id = await accept(),
      original = commands.advanceShiftSwap;
    vi.spyOn(commands, 'advanceShiftSwap').mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error('PRIVATE response lost');
    });
    const api = caller(),
      input = { id, expectedVersion: 2, status: 'approved' as const };
    const result = await api.decide(input),
      before = state();
    expect(await api.decide(input)).toEqual(result);
    expect(state()).toEqual(before);
  });
  it.each([
    ['role', "UPDATE users SET role='cashier' WHERE id='manager'", 'AUTH_IDENTITY_CHANGED'],
    [
      'active cashier',
      "UPDATE devices SET active_user_id='cashier' WHERE active_user_id='manager'",
      'AUTH_IDENTITY_CHANGED',
    ],
    ['employee archived', "UPDATE users SET is_active=0 WHERE id='cashier'", 'SHIFT_SWAP_CHANGED'],
    ['site archived', "UPDATE sites SET is_active=0 WHERE id='site'", 'SHIFT_SWAP_CHANGED'],
    [
      'participant promoted',
      "UPDATE users SET role='admin' WHERE id='worker'",
      'SHIFT_SWAP_NOT_FOUND',
    ],
    [
      'session',
      "UPDATE users SET session_version=session_version+1 WHERE id='manager'",
      'AUTH_IDENTITY_CHANGED',
    ],
  ])('rechecks %s after reservation inside the writer', async (_label, sql, errorCode) => {
    const id = await accept(),
      before = state(),
      resolve = clock.resolveTenantBusinessClock;
    vi.spyOn(clock, 'resolveTenantBusinessClock').mockImplementationOnce(async (...args) => {
      const value = await resolve(...args);
      sqlite().exec(sql!);
      return value;
    });
    await expect(
      caller().decide({ id, expectedVersion: 2, status: 'approved' })
    ).rejects.toMatchObject({ cause: { errorCode } });
    expect(state()).toEqual(before);
  });
  it('serializes competing consent and cancellation without combining both decisions', async () => {
    const row = await caller('worker').create(request());
    const outcomes = await Promise.allSettled([
      caller('cashier').respond({ id: row.id, expectedVersion: 1, status: 'accepted' }),
      caller('worker').respond({ id: row.id, expectedVersion: 1, status: 'cancelled', reason }),
    ]);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    expect(getSwap(getDatabase(), 'tenant', row.id).version).toBe(2);
    expect(sqlite().prepare('SELECT * FROM employee_shift_swap_events').all()).toHaveLength(2);
  });
  it('keeps frozen recurring-plan occurrence links after an approved swap', async () => {
    sqlite().exec(
      "UPDATE scheduled_shifts SET starts_at='2030-09-17T13:00:00.000Z',ends_at='2030-09-17T21:00:00.000Z' WHERE id='requested'"
    );
    const plan = await root().workforce.schedulePlans.create({
      title: 'Original publication',
      recurrence: {
        siteId: 'site',
        fromDate: '2030-09-16',
        untilDate: '2030-09-17',
        anchorWeekStart: '2030-09-16',
        rules: [
          {
            id: 'shift',
            userId: 'worker',
            weekdays: [1],
            intervalWeeks: 1,
            startTime: '08:00',
            endTime: '16:00',
            endDayOffset: 0,
            notes: null,
          },
        ],
      },
    });
    await root().workforce.schedulePlans.publish({ id: plan.id, expectedVersion: 1 });
    const occurrence = sqlite()
      .prepare('SELECT * FROM employee_schedule_occurrences WHERE plan_id=?')
      .get(plan.id) as { published_shift_id: string };
    const created = await caller('worker').create({
      ...request(),
      offeredShiftId: occurrence.published_shift_id,
    });
    await caller('cashier').respond({ id: created.id, expectedVersion: 1, status: 'accepted' });
    await caller().decide({ id: created.id, expectedVersion: 2, status: 'approved' });
    expect(
      sqlite().prepare('SELECT * FROM employee_schedule_occurrences WHERE plan_id=?').get(plan.id)
    ).toEqual(occurrence);
    expect(
      sqlite()
        .prepare('SELECT user_id,status FROM scheduled_shifts WHERE id=?')
        .get(occurrence.published_shift_id)
    ).toEqual({ user_id: 'worker', status: 'cancelled' });
  });
  it('enforces consent, immutable intent and live claims even for raw SQLite writers', async () => {
    const row = await caller('worker').create(request());
    const before = state();
    for (const statement of [
      "UPDATE employee_shift_swaps SET status='accepted',version=2,updated_by_user_id='worker'",
      "UPDATE employee_shift_swaps SET intent_json='{}',version=2",
      'DELETE FROM employee_shift_swap_claims',
      "UPDATE employee_shift_swap_claims SET shift_id='unrelated'",
      'DELETE FROM employee_shift_swaps',
      "UPDATE employee_shift_swap_events SET snapshot_json='{}'",
    ])
      expect(() => sqlite().exec(statement)).toThrow(/SHIFT_SWAP_/);
    expect(state()).toEqual(before);
    await caller('cashier').respond({ id: row.id, expectedVersion: 1, status: 'rejected', reason });
    expect(sqlite().prepare('SELECT * FROM employee_shift_swap_claims').all()).toEqual([]);
  });
  it('lists bounded safe employee shifts and candidates without widening manager schedule rows', async () => {
    moveShift('offered', 10);
    moveShift('requested', 11);
    const ownNextWindow = futureWindow(15),
      managerWindow = futureWindow(12),
      adminWindow = futureWindow(13),
      cancelledWindow = futureWindow(14);
    sqlite().exec(`
      INSERT INTO scheduled_shifts(id,tenant_id,user_id,site_id,starts_at,ends_at,time_zone,created_by_user_id,updated_by_user_id,notes)
      VALUES
        ('own-next','tenant','worker','site','${ownNextWindow.startsAt}','${ownNextWindow.endsAt}','America/Bogota','manager','manager','PRIVATE own next'),
        ('manager-peer','tenant','manager','site','${managerWindow.startsAt}','${managerWindow.endsAt}','America/Bogota','admin','admin','PRIVATE manager peer'),
        ('admin-peer','tenant','admin','site','${adminWindow.startsAt}','${adminWindow.endsAt}','America/Bogota','admin','admin','PRIVATE admin peer'),
        ('cancelled-peer','tenant','cashier','site','${cancelledWindow.startsAt}','${cancelledWindow.endsAt}','America/Bogota','manager','manager','PRIVATE cancelled');
      UPDATE scheduled_shifts SET status='cancelled',cancelled_at='${new Date().toISOString()}',cancelled_by_user_id='manager' WHERE id='cancelled-peer';
    `);
    const first = await caller('worker').myShifts({ limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await caller('worker').myShifts({ limit: 1, cursor: first.nextCursor! });
    expect([...first.items, ...second.items].map(row => row.id)).toEqual(['offered', 'own-next']);

    const candidates = await caller('worker').candidates({
      offeredShiftId: 'offered',
      offeredVersion: 1,
      limit: 20,
    });
    expect(candidates.items.map(row => row.id)).toEqual(['requested', 'manager-peer']);
    expect(JSON.stringify({ first, second, candidates })).not.toMatch(
      /PRIVATE|fingerprint|notes|admin-peer|foreign/
    );

    await caller('worker').create(request());
    expect((await caller('worker').myShifts({ limit: 20 })).items.map(row => row.id)).toEqual([
      'own-next',
    ]);
    expect(
      (
        await caller('worker').candidates({
          offeredShiftId: 'own-next',
          offeredVersion: 1,
          limit: 20,
        })
      ).items.map(row => row.id)
    ).toEqual(['manager-peer']);
  });
  it('scopes request projections and private events to participants or authorized management', async () => {
    moveShift('offered', 10);
    moveShift('requested', 11);
    const row = await caller('worker').create(request());
    const workerPage = await caller('worker').mine({ limit: 20 });
    expect(workerPage.items).toHaveLength(1);
    expect(workerPage.items[0]).toMatchObject({
      id: row.id,
      status: 'requested',
      requester: { id: 'worker', name: 'Worker' },
      recipient: { id: 'cashier', name: 'Cashier' },
      offered: { siteName: 'Central' },
      requested: { siteName: 'North' },
    });
    expect((await caller('cashier').mine({ limit: 20 })).items).toHaveLength(1);
    expect((await caller('manager').mine({ limit: 20 })).items).toEqual([]);
    expect(JSON.stringify(workerPage)).not.toMatch(/PRIVATE|fingerprint|notes/);

    const events = await caller('manager').events({ id: row.id, limit: 20 });
    expect(events.items).toEqual([
      expect.objectContaining({
        version: 1,
        status: 'requested',
        actorId: 'worker',
        actorName: 'Worker',
        reason,
      }),
    ]);
    expect(JSON.stringify(events)).not.toMatch(/fingerprint|snapshot|opening notes|closing notes/);
    await expect(caller('foreign').events({ id: row.id, limit: 20 })).rejects.toMatchObject({
      cause: { errorCode: 'SHIFT_SWAP_NOT_FOUND' },
    });

    expect((await caller('manager').managerInbox({ limit: 20 })).items).toHaveLength(1);
    await caller('cashier').respond({ id: row.id, expectedVersion: 1, status: 'accepted' });
    expect((await caller('manager').managerInbox({ status: 'accepted', limit: 20 })).items).toEqual(
      [expect.objectContaining({ id: row.id, status: 'accepted', version: 2 })]
    );

    const adminWindow = futureWindow(20),
      managerWindow = futureWindow(21);
    sqlite().exec(`
      INSERT INTO scheduled_shifts(id,tenant_id,user_id,site_id,starts_at,ends_at,time_zone,created_by_user_id,updated_by_user_id) VALUES
        ('admin-offered','tenant','admin','site','${adminWindow.startsAt}','${adminWindow.endsAt}','America/Bogota','admin','admin'),
        ('manager-requested','tenant','manager','site','${managerWindow.startsAt}','${managerWindow.endsAt}','America/Bogota','admin','admin');
    `);
    const adminRequest = await caller('admin').create({
      ...request(),
      offeredShiftId: 'admin-offered',
      requestedShiftId: 'manager-requested',
    });
    expect(
      (await caller('manager').managerInbox({ limit: 20 })).items.map(item => item.id)
    ).toEqual([row.id]);
    expect(
      (await caller('admin').managerInbox({ limit: 20 })).items.map(item => item.id)
    ).not.toContain(adminRequest.id);
    expect(
      (await caller('admin2').managerInbox({ limit: 20 })).items.map(item => item.id)
    ).toContain(adminRequest.id);
  });
  it('lets the recipient withdraw accepted consent before independent approval', async () => {
    const id = await accept();
    const withdrawn = await caller('cashier').respond({
      id,
      expectedVersion: 2,
      status: 'cancelled',
      reason: 'I can no longer cover this exchange',
    });
    expect(withdrawn).toEqual({ id, version: 3, status: 'cancelled' });
    expect(sqlite().prepare('SELECT * FROM employee_shift_swap_claims').all()).toEqual([]);
    await expect(
      caller().decide({ id, expectedVersion: 3, status: 'approved' })
    ).rejects.toMatchObject({ cause: { errorCode: 'SHIFT_SWAP_STATE_INVALID' } });
  });
  it('rechecks a revoked approver device inside completion and rolls all replacements back', async () => {
    const id = await accept(),
      before = state(),
      resolve = clock.resolveTenantBusinessClock;
    vi.spyOn(clock, 'resolveTenantBusinessClock').mockImplementationOnce(async (...args) => {
      const value = await resolve(...args);
      sqlite().prepare('UPDATE devices SET is_active=0 WHERE id=?').run(devices.get('manager'));
      return value;
    });
    await expect(
      caller().decide({ id, expectedVersion: 2, status: 'approved' })
    ).rejects.toMatchObject({ cause: { errorCode: 'AUTH_IDENTITY_CHANGED' } });
    expect(state()).toEqual(before);
  });
  it('blocks a third employee from claiming either side of an existing exchange', async () => {
    await caller('worker').create(request());
    sqlite().exec(
      "INSERT INTO scheduled_shifts(id,tenant_id,user_id,site_id,starts_at,ends_at,time_zone,created_by_user_id,updated_by_user_id) VALUES('third','tenant','manager','site','2030-09-12T13:00:00.000Z','2030-09-12T21:00:00.000Z','America/Bogota','admin','admin')"
    );
    for (const requestedShiftId of ['offered', 'requested']) {
      await expect(
        caller().create({ ...request(), offeredShiftId: 'third', requestedShiftId })
      ).rejects.toMatchObject({ cause: { errorCode: 'SHIFT_SWAP_CLAIMED' } });
    }
    expect(sqlite().prepare('SELECT * FROM employee_shift_swap_claims').all()).toHaveLength(2);
  });
  it('serializes approval against rejection with one immutable final decision', async () => {
    const id = await accept();
    const outcomes = await Promise.allSettled([
      caller().decide({ id, expectedVersion: 2, status: 'approved' }),
      caller('admin').decide({ id, expectedVersion: 2, status: 'rejected', reason }),
    ]);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    const row = getSwap(getDatabase(), 'tenant', id);
    expect(row.version).toBe(3);
    expect(sqlite().prepare('SELECT * FROM employee_shift_swap_events').all()).toHaveLength(3);
    expect(sqlite().prepare('SELECT * FROM scheduled_shifts').all()).toHaveLength(
      row.status === 'approved' ? 4 : 2
    );
    expect(sqlite().prepare('SELECT * FROM employee_shift_swap_claims').all()).toEqual([]);
  });
  it('can exchange replacements later without rewriting either prior consent or original shifts', async () => {
    const id = await accept();
    await caller().decide({ id, expectedVersion: 2, status: 'approved' });
    const original = getSwap(getDatabase(), 'tenant', id),
      originalPair = pair();
    const next = await caller('worker').create({
      ...request(),
      offeredShiftId: original.requestedReplacementId!,
      requestedShiftId: original.offeredReplacementId!,
    });
    await caller('cashier').respond({ id: next.id, expectedVersion: 1, status: 'accepted' });
    await caller().decide({ id: next.id, expectedVersion: 2, status: 'approved' });
    expect(getSwap(getDatabase(), 'tenant', id)).toEqual(original);
    expect(pair()).toEqual(originalPair);
    expect(sqlite().prepare('SELECT * FROM scheduled_shifts').all()).toHaveLength(6);
    expect(
      sqlite().prepare("SELECT * FROM scheduled_shifts WHERE status='scheduled'").all()
    ).toHaveLength(2);
  });
});
