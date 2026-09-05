/** Real SQLite/Command Envelope scheduling decisions; drafts never reserve operational time. */
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
import * as commands from '../application/workforce/schedule-plans.js';
import * as admission from '../services/labor/schedule-plan-admission.js';
import { getSchedulePlan, listSchedulePlans } from '../services/labor/schedule-plan-reads.js';
import { isRemoteSyncApplyBlocked, resolveSyncTransportPolicy } from '../services/sync/contract.js';

let server: PuntovivoServer, directory: string | undefined;
const devices = new Map<string, string>();
const actors = {
  admin: 'admin',
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
const caller = (actor: keyof typeof actors = 'manager') => root(actor).workforce.schedulePlans;
const input = () => ({
  title: 'PRIVATE weekly counter coverage',
  recurrence: {
    siteId: 'site',
    fromDate: '2026-09-07',
    untilDate: '2026-09-10',
    anchorWeekStart: '2026-09-07',
    rules: [
      {
        id: 'rule-worker',
        userId: 'worker',
        weekdays: [1, 3],
        intervalWeeks: 1,
        startTime: '08:00',
        endTime: '16:00',
        endDayOffset: 0 as const,
        notes: 'PRIVATE refrigerated goods coverage',
      },
    ],
  },
});
const shift = (date = '2026-09-09') => ({
  userId: 'worker',
  siteId: 'second-site',
  startDate: date,
  startTime: '08:00',
  endDate: date,
  endTime: '16:00',
});
const reason = 'PRIVATE explicit manager decision';
function state() {
  return {
    plans: sqlite().prepare('SELECT * FROM employee_schedule_plans ORDER BY id').all(),
    occurrences: sqlite().prepare('SELECT * FROM employee_schedule_occurrences ORDER BY id').all(),
    events: sqlite().prepare('SELECT * FROM employee_schedule_plan_events ORDER BY id').all(),
    shifts: sqlite().prepare('SELECT * FROM scheduled_shifts ORDER BY id').all(),
    audit: sqlite()
      .prepare(
        "SELECT * FROM audit_logs WHERE resource_type IN ('schedule_plan','scheduled_shift') ORDER BY id"
      )
      .all(),
    outbox: sqlite()
      .prepare(
        "SELECT * FROM sync_outbox WHERE entity_type IN ('employee_schedule_plans','scheduled_shifts') ORDER BY id"
      )
      .all(),
  };
}
beforeEach(async ({ task }) => {
  directory =
    task.name.includes('SQLITE_BUSY') || task.name.includes('SAME-SNAPSHOT')
      ? mkdtempSync(join(tmpdir(), 'puntovivo-schedule-plans-'))
      : undefined;
  server = await createServer({
    dbPath: directory ? join(directory, 'plans.db') : ':memory:',
    seedData: false,
    verbose: false,
  });
  sqlite().exec(`
    INSERT INTO tenants(id,name,slug,default_currency_code) VALUES ('tenant','Tenant','tenant','COP'),('other','Other','other','COP');
    INSERT INTO companies(id,tenant_id,name) VALUES ('company','tenant','Company'),('other-company','other','Other');
    INSERT INTO sites(id,tenant_id,company_id,name) VALUES ('site','tenant','company','Central'),('second-site','tenant','company','North'),('foreign-site','other','other-company','Foreign');
    INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES
      ('admin','tenant','Admin','admin@example.test','unused','admin'),('manager','tenant','Manager','manager@example.test','unused','manager'),
      ('worker','tenant','Worker','worker@example.test','unused','viewer'),('cashier','tenant','Cashier','cashier@example.test','unused','cashier'),('foreign','other','Foreign','foreign@example.test','unused','admin');
    INSERT INTO tenant_locale_settings(tenant_id,country_code) VALUES ('tenant','CO'),('other','CO');
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

describe('schedule plan lifecycle', () => {
  it('publishes a valid DST-shortened overnight shift despite more than 24 nominal hours', async () => {
    sqlite().exec(
      "UPDATE tenant_locale_settings SET timezone_override='America/New_York' WHERE tenant_id='tenant'"
    );
    const value = input();
    value.recurrence.fromDate = '2026-03-07';
    value.recurrence.untilDate = '2026-03-08';
    value.recurrence.anchorWeekStart = '2026-03-02';
    const rule = value.recurrence.rules[0]!;
    const draft = await caller().create({
      ...value,
      recurrence: {
        ...value.recurrence,
        rules: [{ ...rule, weekdays: [6], startTime: '08:00', endTime: '08:30', endDayOffset: 1 }],
      },
    });
    await caller().publish({ id: draft.id, expectedVersion: 1 });
    const published = await caller().get({ id: draft.id });
    expect(published.occurrences).toHaveLength(1);
    const row = published.occurrences[0]!;
    expect(Date.parse(row.endsAt) - Date.parse(row.startsAt)).toBe(23.5 * 3_600_000);
    expect(row.publishedShiftId).not.toBeNull();
  });
  it('stores a non-operative draft, publishes every linked occurrence and replays once', async () => {
    const draftApi = caller(),
      draft = await draftApi.create(input());
    expect(await draftApi.create(input())).toEqual(draft);
    expect(draft).toMatchObject({ status: 'draft', version: 1, occurrenceCount: 2 });
    expect(state().shifts).toEqual([]);
    expect(state().events).toHaveLength(1);
    const api = caller(),
      decision = { id: draft.id, expectedVersion: 1 };
    const result = await api.publish(decision);
    expect(await api.publish(decision)).toEqual(result);
    expect(result).toMatchObject({ status: 'published', version: 2, occurrenceCount: 2 });
    const snapshot = await caller().get({ id: draft.id });
    expect(snapshot.occurrences.every(row => row.publishedShiftId !== null)).toBe(true);
    expect(new Set(snapshot.occurrences.map(row => row.publishedShiftId)).size).toBe(2);
    expect(state().shifts).toHaveLength(2);
    expect(state().events).toHaveLength(2);
    expect(state().outbox).toHaveLength(4);
    expect(state().audit).toHaveLength(2);
    expect(sqlite().prepare('SELECT status FROM idempotency_keys').all()).toEqual([
      { status: 'succeeded' },
      { status: 'succeeded' },
    ]);
    expect(JSON.stringify(state().outbox)).not.toContain('PRIVATE');
    expect(JSON.stringify(state().audit)).not.toContain('PRIVATE');
    expect(resolveSyncTransportPolicy('employee_schedule_plans')).toBe('local_only');
    expect(isRemoteSyncApplyBlocked('employee_schedule_plans')).toBe(true);
  });

  it('does not reserve employee time until publication and rejects the last conflicting occurrence', async () => {
    const draft = await caller().create(input());
    await root().employeeShifts.schedule.create(shift());
    const before = state();
    await expect(caller().publish({ id: draft.id, expectedVersion: 1 })).rejects.toMatchObject({
      cause: { errorCode: 'SCHEDULE_SHIFT_OVERLAP' },
    });
    expect(state()).toEqual(before);
  });

  it('requires approved absences and availability to be resolved at publication, not generation', async () => {
    const absence = await root().workforce.timeOff.create({
      userId: 'worker',
      siteId: 'second-site',
      fromDate: '2026-09-09',
      untilDate: '2026-09-10',
      kind: 'leave',
      reason,
    });
    await root().workforce.timeOff.advance({
      id: absence.id,
      siteId: 'second-site',
      expectedVersion: 1,
      status: 'approved',
      reason,
    });
    const draft = await caller().create(input()),
      before = state();
    await expect(caller().publish({ id: draft.id, expectedVersion: 1 })).rejects.toMatchObject({
      cause: { errorCode: 'SCHEDULE_TIME_OFF_CONFLICT' },
    });
    expect(state()).toEqual(before);
  });

  it('regenerates only after explicit CAS and preserves prior private intent and the frozen zone', async () => {
    const draft = await caller().create(input());
    sqlite().exec(
      "UPDATE tenant_locale_settings SET timezone_override='America/New_York',version=version+1 WHERE tenant_id='tenant'"
    );
    const updatedInput = input();
    updatedInput.recurrence.rules[0]!.endTime = '12:00';
    const changed = await caller().regenerate({
      ...updatedInput,
      id: draft.id,
      expectedVersion: 1,
      reason,
    });
    expect(changed).toMatchObject({ version: 2, status: 'draft' });
    const snapshot = await caller().get({ id: draft.id });
    expect(snapshot.plan.timeZone).toBe('America/Bogota');
    expect(snapshot.occurrences.every(row => row.endsAt.endsWith('17:00:00.000Z'))).toBe(true);
    const first = sqlite()
      .prepare('SELECT snapshot_json FROM employee_schedule_plan_events WHERE version=1')
      .get() as { snapshot_json: string };
    expect(
      JSON.parse(first.snapshot_json).occurrences.every(
        (row: { endTime: string }) => row.endTime === '16:00'
      )
    ).toBe(true);
    await expect(
      caller().regenerate({ ...input(), id: draft.id, expectedVersion: 1, reason })
    ).rejects.toMatchObject({ cause: { errorCode: 'STALE_VERSION' } });
    expect(state().shifts).toEqual([]);
  });

  it('retains a discarded plan and refuses later activation or changes', async () => {
    const draft = await caller().create(input());
    const result = await caller().discard({ id: draft.id, expectedVersion: 1, reason });
    expect(result).toMatchObject({ status: 'discarded', version: 2 });
    const before = state();
    for (const invoke of [
      () => caller().publish({ id: draft.id, expectedVersion: 2 }),
      () => caller().regenerate({ ...input(), id: draft.id, expectedVersion: 2, reason }),
      () => caller().discard({ id: draft.id, expectedVersion: 2, reason }),
    ]) {
      await expect(invoke()).rejects.toMatchObject({
        cause: { errorCode: 'SCHEDULE_PLAN_STATE_INVALID' },
      });
    }
    expect(state()).toEqual(before);
    expect(state().occurrences).toHaveLength(2);
  });

  it('reads header and regenerated occurrences from the SAME-SNAPSHOT across a concurrent commit', async () => {
    const draft = await caller().create(input());
    const originalSnapshot = getSchedulePlan(getDatabase(), 'tenant', 'manager', draft.id);
    const competitor = new Database(join(directory!, 'plans.db'));
    const prepare = sqlite().prepare.bind(sqlite());
    let committed = false;
    try {
      vi.spyOn(sqlite(), 'prepare').mockImplementation(query => {
        const statement = prepare(query);
        if (query.includes('from "employee_schedule_plans"') && !committed) {
          const get = statement.get.bind(statement);
          vi.spyOn(statement, 'get').mockImplementation((...args) => {
            const result = get(...args);
            if (!committed) {
              committed = true;
              competitor.transaction(() => {
                competitor
                  .prepare('DELETE FROM employee_schedule_occurrences WHERE plan_id=?')
                  .run(draft.id);
                const rules = input().recurrence.rules.map(rule => ({
                  ...rule,
                  notes: 'Concurrent edit',
                }));
                competitor
                  .prepare(
                    'UPDATE employee_schedule_plans SET rules_json=?,version=version+1 WHERE id=?'
                  )
                  .run(JSON.stringify(rules), draft.id);
                const insert = competitor.prepare(
                  'INSERT INTO employee_schedule_occurrences(id,tenant_id,plan_id,rule_id,user_id,start_date,start_time,end_date,end_time,starts_at,ends_at,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
                );
                for (const row of originalSnapshot.occurrences)
                  insert.run(
                    row.id + 'new',
                    'tenant',
                    draft.id,
                    row.ruleId,
                    row.userId,
                    row.startDate,
                    row.startTime,
                    row.endDate,
                    row.endTime,
                    row.startsAt,
                    row.endsAt,
                    'Concurrent edit'
                  );
              })();
            }
            return result;
          });
        }
        return statement;
      });
      expect(getSchedulePlan(getDatabase(), 'tenant', 'manager', draft.id)).toEqual(
        originalSnapshot
      );
      expect(committed).toBe(true);
      const next = getSchedulePlan(getDatabase(), 'tenant', 'manager', draft.id);
      expect(next.plan.version).toBe(2);
      expect(next.occurrences.every(row => row.notes === 'Concurrent edit')).toBe(true);
    } finally {
      vi.restoreAllMocks();
      competitor.close();
    }
  });

  it('keeps publication evidence frozen after an ordinary shift correction', async () => {
    const draft = await caller().create(input());
    await caller().publish({ id: draft.id, expectedVersion: 1 });
    const frozen = await caller().get({ id: draft.id }),
      first = frozen.occurrences.find(row => row.startDate === '2026-09-07')!;
    await root().employeeShifts.schedule.update({
      ...shift('2026-09-07'),
      siteId: 'site',
      id: first.publishedShiftId!,
      version: 1,
      endTime: '12:00',
    });
    expect(await caller().get({ id: draft.id })).toEqual(frozen);
    expect(
      sqlite()
        .prepare('SELECT version FROM scheduled_shifts WHERE id=?')
        .get(first.publishedShiftId)
    ).toEqual({ version: 2 });
    for (const query of [
      'UPDATE employee_schedule_plan_events SET reason=reason',
      'DELETE FROM employee_schedule_plan_events',
      'UPDATE employee_schedule_plans SET version=version+1',
      'DELETE FROM employee_schedule_plans',
      'UPDATE employee_schedule_occurrences SET notes=notes',
      'DELETE FROM employee_schedule_occurrences',
    ])
      expect(() => sqlite().exec(query)).toThrow(/IMMUTABLE/);
  });

  it('allows only one of two managers to publish the same draft', async () => {
    const draft = await caller().create(input());
    const results = await Promise.allSettled([
      caller().publish({ id: draft.id, expectedVersion: 1 }),
      caller('admin').publish({ id: draft.id, expectedVersion: 1 }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(state().shifts).toHaveLength(2);
    expect(state().events).toHaveLength(2);
  });

  it('uses bounded keyset pages without exposing draft rules or reasons', async () => {
    for (let i = 0; i < 3; i++) await caller().create({ ...input(), title: `Plan ${i}` });
    const core = listSchedulePlans(getDatabase(), 'tenant', 'manager', {
      siteId: 'site',
      limit: 2,
    });
    const first = await caller().list({ siteId: 'site', limit: 2 });
    expect(first).toEqual(core);
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await caller().list({ siteId: 'site', limit: 2, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(row => row.id)).size).toBe(3);
    expect(JSON.stringify(first)).not.toContain('PRIVATE');
  });
});

describe('plan authority and isolation', () => {
  it('exposes only bounded manager-safe employee choices and separate current names', async () => {
    const draft = await caller().create(input());
    const frozen = getSchedulePlan(getDatabase(), 'tenant', 'manager', draft.id),
      before = state();
    const choices = await caller().employees({ limit: 2 });
    expect(choices.items).toHaveLength(2);
    expect(choices.nextCursor).not.toBeNull();
    const next = await caller().employees({ limit: 2, cursor: choices.nextCursor! });
    expect([...choices.items, ...next.items].map(row => row.id).sort()).toEqual([
      'cashier',
      'manager',
      'worker',
    ]);
    expect(choices.items.every(row => Object.keys(row).sort().join(',') === 'id,name,role')).toBe(
      true
    );
    expect(await caller().employees({ search: '%_' })).toEqual({ items: [], nextCursor: null });
    sqlite().exec(
      "UPDATE users SET name='Current worker name',is_active=0 WHERE id='worker'; UPDATE sites SET name='Current site name' WHERE id='site'"
    );
    const shown = await caller().get({ id: draft.id });
    expect(shown.display).toEqual({
      employees: [{ id: 'worker', name: 'Current worker name', isActive: false }],
      site: { id: 'site', name: 'Current site name', isActive: true },
    });
    expect({ plan: shown.plan, occurrences: shown.occurrences }).toEqual(frozen);
    expect(state()).toEqual(before);
    await expect(caller('worker').employees({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it.each(['cashier', 'worker'] as const)('denies %s reads and writes', async actor => {
    await expect(caller(actor).create(input())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller(actor).list({ siteId: 'site' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(state().plans).toEqual([]);
  });
  it('rejects foreign sites and employees and does not reveal another tenant plan', async () => {
    const draft = await caller().create(input());
    await expect(caller('foreign').get({ id: draft.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      caller('foreign').publish({ id: draft.id, expectedVersion: 1 })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const otherSite = input();
    otherSite.recurrence.siteId = 'foreign-site';
    await expect(caller().create(otherSite)).rejects.toThrow();
    const otherUser = input();
    otherUser.recurrence.rules[0]!.userId = 'foreign';
    await expect(caller().create(otherUser)).rejects.toMatchObject({
      cause: { errorCode: 'SCHEDULE_EMPLOYEE_NOT_FOUND' },
    });
    expect((await caller('foreign').list({ siteId: 'foreign-site' })).items).toEqual([]);
  });
  it('hides an admin rule from managers even if that rule generates no occurrences', async () => {
    const mixed = input();
    mixed.recurrence.rules.push({
      ...mixed.recurrence.rules[0]!,
      id: 'admin-rule',
      userId: 'admin',
      weekdays: [7],
    });
    await expect(caller().create(mixed)).rejects.toMatchObject({
      cause: { errorCode: 'SCHEDULE_EMPLOYEE_NOT_FOUND' },
    });
    const draft = await caller('admin').create(mixed);
    await expect(caller().get({ id: draft.id })).rejects.toMatchObject({
      cause: { errorCode: 'SCHEDULE_EMPLOYEE_NOT_FOUND' },
    });
    expect((await caller().list({ siteId: 'site' })).items).toEqual([]);
    expect((await caller('admin').list({ siteId: 'site' })).items).toHaveLength(1);
  });
  it('permits discard after target archival, never publication', async () => {
    const draft = await caller().create(input());
    sqlite().exec(
      "UPDATE users SET is_active=0 WHERE id='worker'; UPDATE sites SET is_active=0 WHERE id='site'"
    );
    await expect(caller().publish({ id: draft.id, expectedVersion: 1 })).rejects.toThrow();
    expect(await caller().discard({ id: draft.id, expectedVersion: 1, reason })).toMatchObject({
      status: 'discarded',
    });
  });
  it.each([
    "UPDATE users SET is_active=0 WHERE id='worker'",
    "UPDATE users SET role='admin' WHERE id='worker'",
    "UPDATE users SET role='viewer' WHERE id='manager'",
    "UPDATE sites SET is_active=0 WHERE id='site'",
    "UPDATE tenants SET is_active=0 WHERE id='tenant'",
    "UPDATE tenant_locale_settings SET timezone_override='America/New_York' WHERE tenant_id='tenant'",
  ])('rejects current authority changes after preflight: %s', async mutation => {
    const draft = await caller().create(input()),
      original = admission.preflightSchedulePlan;
    vi.spyOn(admission, 'preflightSchedulePlan').mockImplementationOnce(async (...args) => {
      const digest = await original(...args);
      sqlite().exec(mutation);
      return digest;
    });
    const before = state();
    await expect(caller().publish({ id: draft.id, expectedVersion: 1 })).rejects.toThrow();
    expect(state()).toEqual(before);
  });
  it('detects unversioned availability mutation between preflight and the writer', async () => {
    await root().workforce.availability.create({
      userId: 'worker',
      fromDate: '2026-09-07',
      untilDate: null,
      slots: [
        { weekday: 1, startMinute: 0, endMinute: 1440 },
        { weekday: 3, startMinute: 0, endMinute: 1440 },
      ],
      reason,
    });
    const draft = await caller().create(input()),
      original = admission.preflightSchedulePlan;
    vi.spyOn(admission, 'preflightSchedulePlan').mockImplementationOnce(async (...args) => {
      const digest = await original(...args);
      sqlite()
        .prepare("UPDATE employee_availability SET slots_json=? WHERE user_id='worker'")
        .run(
          JSON.stringify([
            { weekday: 1, startMinute: 540, endMinute: 1440 },
            { weekday: 3, startMinute: 0, endMinute: 1440 },
          ])
        );
      return digest;
    });
    const before = state();
    await expect(caller().publish({ id: draft.id, expectedVersion: 1 })).rejects.toMatchObject({
      cause: { errorCode: 'SCHEDULE_PLAN_CHANGED' },
    });
    expect(state()).toEqual(before);
  });
});

describe('plan transaction recovery', () => {
  for (const operation of ['create', 'regenerate', 'discard'] as const)
    it.each([
      ['audit', "BEFORE INSERT ON audit_logs WHEN NEW.resource_type='schedule_plan'"],
      ['outbox', "BEFORE INSERT ON sync_outbox WHEN NEW.entity_type='employee_schedule_plans'"],
      ['event', 'BEFORE INSERT ON employee_schedule_plan_events'],
      ['completion', "BEFORE UPDATE ON idempotency_keys WHEN NEW.status='succeeded'"],
    ])(
      `rolls back ${operation} on %s failure and recovers the original envelope`,
      async (_name, trigger) => {
        const draft = operation === 'create' ? null : await caller().create(input()),
          before = state(),
          api = caller(),
          changed = input();
        changed.recurrence.rules[0]!.endTime = '12:00';
        const run = () =>
          operation === 'create'
            ? api.create(input())
            : operation === 'regenerate'
              ? api.regenerate({ ...changed, id: draft!.id, expectedVersion: 1, reason })
              : api.discard({ id: draft!.id, expectedVersion: 1, reason });
        sqlite().exec(
          `CREATE TRIGGER fail_decision ${trigger} BEGIN SELECT RAISE(ABORT,'PRIVATE_DATABASE_DETAIL'); END`
        );
        await expect(run()).rejects.toMatchObject({
          cause: { errorCode: 'SCHEDULE_TEMPORARILY_UNAVAILABLE' },
        });
        expect(state()).toEqual(before);
        sqlite().exec('DROP TRIGGER fail_decision');
        const result = await run(),
          committed = state();
        expect(await run()).toEqual(result);
        expect(state()).toEqual(committed);
        expect(committed.shifts).toEqual([]);
        expect(committed.events).toHaveLength(operation === 'create' ? 1 : 2);
        expect(committed.plans).toHaveLength(1);
      }
    );

  it.each([
    [
      'last shift',
      'BEFORE INSERT ON scheduled_shifts WHEN (SELECT count(*) FROM scheduled_shifts WHERE tenant_id=NEW.tenant_id)=1',
    ],
    ['audit', "BEFORE INSERT ON audit_logs WHEN NEW.resource_type='schedule_plan'"],
    ['plan outbox', "BEFORE INSERT ON sync_outbox WHEN NEW.entity_type='employee_schedule_plans'"],
    ['shift outbox', "BEFORE INSERT ON sync_outbox WHEN NEW.entity_type='scheduled_shifts'"],
    ['event', 'BEFORE INSERT ON employee_schedule_plan_events'],
    ['completion', "BEFORE UPDATE ON idempotency_keys WHEN NEW.status='succeeded'"],
  ])(
    'rolls back every occurrence on %s failure and retries the same envelope',
    async (_name, trigger) => {
      const draft = await caller().create(input()),
        before = state(),
        api = caller(),
        decision = { id: draft.id, expectedVersion: 1 };
      sqlite().exec(
        `CREATE TRIGGER fail_plan ${trigger} BEGIN SELECT RAISE(ABORT,'PRIVATE_DATABASE_DETAIL'); END`
      );
      await expect(api.publish(decision)).rejects.toMatchObject({
        cause: { errorCode: 'SCHEDULE_TEMPORARILY_UNAVAILABLE' },
        message: 'Schedules are temporarily unavailable; retry the same operation',
      });
      expect(state()).toEqual(before);
      sqlite().exec('DROP TRIGGER fail_plan');
      const result = await api.publish(decision);
      expect(await api.publish(decision)).toEqual(result);
      expect(state().shifts).toHaveLength(2);
      expect(state().events).toHaveLength(2);
    }
  );
  it('recovers publication after commit but before resolver response, without creating another shift', async () => {
    const draft = await caller().create(input()),
      original = commands.publishSchedulePlan;
    const fault = vi
      .spyOn(commands, 'publishSchedulePlan')
      .mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new Error('PRIVATE_POST_COMMIT');
      });
    const api = caller(),
      decision = { id: draft.id, expectedVersion: 1 };
    const result = await api.publish(decision);
    expect(await api.publish(decision)).toEqual(result);
    expect(fault).toHaveBeenCalledOnce();
    expect(state().shifts).toHaveLength(2);
    expect(state().events).toHaveLength(2);
  });
  it('recovers publication after real SQLITE_BUSY without partial state', async () => {
    const draft = await caller().create(input()),
      api = caller(),
      decision = { id: draft.id, expectedVersion: 1 },
      before = state();
    const competitor = new Database(join(directory!, 'plans.db')),
      timeout = sqlite().pragma('busy_timeout', { simple: true }) as number;
    try {
      sqlite().pragma('busy_timeout=1');
      competitor.exec('BEGIN IMMEDIATE');
      await expect(api.publish(decision)).rejects.toMatchObject({
        // The envelope preserves the existing typed retryable BUSY contract.
        cause: { errorCode: 'COMMAND_DATABASE_BUSY' },
      });
      expect(state()).toEqual(before);
      competitor.exec('ROLLBACK');
      const result = await api.publish(decision);
      expect(await api.publish(decision)).toEqual(result);
      expect(state().shifts).toHaveLength(2);
    } finally {
      if (competitor.inTransaction) competitor.exec('ROLLBACK');
      competitor.close();
      sqlite().pragma(`busy_timeout=${timeout}`);
    }
  });
});

describe('plan publication read-set races', () => {
  it.each([
    ['new availability', 'SCHEDULE_PLAN_CHANGED'],
    ['absence approval', 'SCHEDULE_TIME_OFF_CONFLICT'],
    ['manual shift', 'SCHEDULE_SHIFT_OVERLAP'],
    ['draft regeneration', 'STALE_VERSION'],
  ] as const)(
    'rejects %s committed after preflight without losing the concurrent decision',
    async (change, errorCode) => {
      const draft = await caller().create(input()),
        original = admission.preflightSchedulePlan;
      let afterConcurrent: ReturnType<typeof state> | undefined;
      vi.spyOn(admission, 'preflightSchedulePlan').mockImplementationOnce(async (...args) => {
        const digest = await original(...args);
        if (change === 'new availability') {
          await root().workforce.availability.create({
            userId: 'worker',
            fromDate: '2026-09-07',
            untilDate: null,
            slots: [],
            reason,
          });
        } else if (change === 'absence approval') {
          const absence = await root().workforce.timeOff.create({
            userId: 'worker',
            siteId: 'second-site',
            fromDate: '2026-09-09',
            untilDate: '2026-09-10',
            kind: 'leave',
            reason,
          });
          await root().workforce.timeOff.advance({
            id: absence.id,
            siteId: 'second-site',
            expectedVersion: 1,
            status: 'approved',
            reason,
          });
        } else if (change === 'manual shift') {
          await root().employeeShifts.schedule.create(shift());
        } else {
          const changed = input();
          changed.recurrence.rules[0]!.endTime = '12:00';
          await caller().regenerate({ ...changed, id: draft.id, expectedVersion: 1, reason });
        }
        afterConcurrent = state();
        return digest;
      });
      await expect(caller().publish({ id: draft.id, expectedVersion: 1 })).rejects.toMatchObject({
        cause: { errorCode },
      });
      expect(afterConcurrent).toBeDefined();
      expect(state()).toEqual(afterConcurrent);
      expect((await caller().get({ id: draft.id })).plan.status).toBe('draft');
    }
  );

  it('does not publish a draft whose rows no longer match frozen intent, even at the same count', async () => {
    const draft = await caller().create(input()),
      frozen = await caller().get({ id: draft.id });
    // Simulate an external writer replacing validly-shaped draft rows, not an API regeneration.
    const row = frozen.occurrences[0]!;
    sqlite().transaction(() => {
      sqlite().prepare('DELETE FROM employee_schedule_occurrences WHERE id=?').run(row.id);
      sqlite()
        .prepare(
          'INSERT INTO employee_schedule_occurrences(id,tenant_id,plan_id,rule_id,user_id,start_date,start_time,end_date,end_time,starts_at,ends_at,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
        )
        .run(
          row.id,
          row.tenantId,
          row.planId,
          row.ruleId,
          row.userId,
          row.startDate,
          row.startTime,
          row.endDate,
          row.endTime,
          row.startsAt,
          row.endsAt,
          'Changed outside the frozen rule'
        );
    })();
    const before = state();
    await expect(caller().publish({ id: draft.id, expectedVersion: 1 })).rejects.toMatchObject({
      cause: { errorCode: 'SCHEDULE_PLAN_CHANGED' },
    });
    expect(state()).toEqual(before);
  });

  it('refuses incomplete publication at the storage boundary', async () => {
    const draft = await caller().create(input()),
      before = state();
    expect(() =>
      sqlite()
        .prepare(
          "UPDATE employee_schedule_plans SET status='published',version=version+1,decided_at=? WHERE id=?"
        )
        .run(new Date().toISOString(), draft.id)
    ).toThrow(/SCHEDULE_PLAN_INCOMPLETE/);
    expect(state()).toEqual(before);
    const occurrence = (await caller().get({ id: draft.id })).occurrences[0]!;
    // A real shift for the same employee at another site is not a valid publication link.
    const wrongSite = await root().employeeShifts.schedule.create({
      ...shift(occurrence.startDate),
      notes: occurrence.notes ?? undefined,
    });
    expect(() =>
      sqlite()
        .prepare('UPDATE employee_schedule_occurrences SET published_shift_id=? WHERE id=?')
        .run(wrongSite.id, occurrence.id)
    ).toThrow(/SCHEDULE_PLAN_LINK_INVALID/);
    expect(
      (await caller().get({ id: draft.id })).occurrences.every(row => row.publishedShiftId === null)
    ).toBe(true);
  });

  it.each(['foreign', 'admin'])('rejects forged private-event attribution to %s', async actor => {
    const draft = await caller().create(input()),
      before = state();
    expect(() =>
      sqlite().transaction(() => {
        sqlite()
          .prepare('UPDATE employee_schedule_plans SET version=version+1 WHERE id=?')
          .run(draft.id);
        const snapshot = getSchedulePlan(getDatabase(), 'tenant', 'manager', draft.id);
        sqlite()
          .prepare(
            'INSERT INTO employee_schedule_plan_events(id,tenant_id,plan_id,version,kind,actor_id,operation_id,reason,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
          )
          .run(
            'forged-event',
            'tenant',
            draft.id,
            2,
            'regenerated',
            actor,
            'forged-operation',
            reason,
            JSON.stringify(snapshot),
            snapshot.plan.updatedAt
          );
      })()
    ).toThrow(/SCHEDULE_PLAN_EVENT_INVALID/);
    expect(state()).toEqual(before);
  });
});
