/** Additive schedule storage preserves manual history and frozen decisions on encrypted restarts. */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import {
  createSchedulePlan,
  discardSchedulePlan,
  publishSchedulePlan,
  regenerateSchedulePlan,
} from '../application/workforce/schedule-plans.js';
import type { WorkforceCommandContext } from '../application/workforce/writer.js';
import type { CreateSchedulePlanInput } from '../trpc/schemas/schedulePlans.js';
import { getSchedulePlan } from '../services/labor/schedule-plan-reads.js';

const raw = () => (getDatabase() as unknown as { $client: Database.Database }).$client;
const snapshot = () => ({
  plans: raw().prepare('SELECT * FROM employee_schedule_plans ORDER BY id').all(),
  occurrences: raw().prepare('SELECT * FROM employee_schedule_occurrences ORDER BY id').all(),
  events: raw().prepare('SELECT * FROM employee_schedule_plan_events ORDER BY id').all(),
  shifts: raw().prepare('SELECT * FROM scheduled_shifts ORDER BY id').all(),
});
const input = (): CreateSchedulePlanInput => ({
  title: 'Explicit September staffing',
  recurrence: {
    siteId: 'site',
    fromDate: '2026-09-07',
    untilDate: '2026-09-09',
    anchorWeekStart: '2026-09-07',
    rules: [
      {
        id: 'counter',
        userId: 'worker',
        weekdays: [1, 2],
        intervalWeeks: 1,
        startTime: '22:00',
        endTime: '06:00',
        endDayOffset: 1,
        notes: 'Frozen overnight coverage',
      },
    ],
  },
});
const seed = () =>
  raw().exec(`
  INSERT INTO tenants(id,name,slug,default_currency_code) VALUES ('tenant','Tenant','tenant','COP');
  INSERT INTO companies(id,tenant_id,name) VALUES ('company','tenant','Company');
  INSERT INTO sites(id,tenant_id,company_id,name) VALUES ('site','tenant','company','Central');
  INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES ('admin','tenant','Admin','admin@example.test','unused','admin'),('worker','tenant','Worker','worker@example.test','unused','viewer');
  INSERT INTO tenant_locale_settings(tenant_id,country_code) VALUES ('tenant','CO');
  INSERT INTO scheduled_shifts(id,tenant_id,user_id,site_id,starts_at,ends_at,time_zone,created_by_user_id,updated_by_user_id,notes) VALUES ('historic','tenant','worker','site','2026-01-05T13:00:00.000Z','2026-01-05T21:00:00.000Z','America/Bogota','admin','admin','Manual historical shift');
  INSERT INTO employee_shifts(id,tenant_id,site_id,user_id,clocked_in_at,clocked_out_at) VALUES ('attendance','tenant','site','worker','2026-01-05T13:00:00.000Z','2026-01-05T21:00:00.000Z');
`);
function context(): WorkforceCommandContext {
  return {
    db: getDatabase(),
    tenantId: 'tenant',
    user: { id: 'admin', email: 'admin@example.test', role: 'admin', tenantId: 'tenant' },
    envelope: {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    },
    // This is storage/restart proof. Real command completion and recovery have separate router tests.
    completeInTransaction: () => {},
  };
}

for (const encrypted of [false, true])
  describe(`schedule plan storage encrypted=${encrypted}`, () => {
    it.each(['fresh', 'historical'] as const)(
      'preserves explicit decisions and manual history after %s boot',
      async origin => {
        const directory = mkdtempSync(join(tmpdir(), 'puntovivo-schedule-plan-upgrade-')),
          dbPath = join(directory, 'history.db'),
          prefix = join(directory, 'migrations'),
          encryption = encrypted ? { encryptionKey: 'ad'.repeat(32) } : {};
        try {
          if (origin === 'historical') {
            cpSync(resolve(process.cwd(), 'src/db/migrations'), prefix, { recursive: true });
            const journalPath = join(prefix, 'meta/_journal.json'),
              journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
                entries: Array<{ idx: number }>;
              };
            journal.entries = journal.entries.filter(entry => entry.idx < 73);
            expect(journal.entries).toHaveLength(73);
            writeFileSync(journalPath, JSON.stringify(journal));
            await initDatabase({
              dbPath,
              seedData: false,
              migrationsFolder: prefix,
              ...encryption,
            });
            expect(
              raw()
                .prepare("SELECT name FROM sqlite_master WHERE name='employee_schedule_plans'")
                .get()
            ).toBeUndefined();
          } else {
            await initDatabase({ dbPath, seedData: false, ...encryption });
          }
          seed();
          const manual = raw().prepare("SELECT * FROM scheduled_shifts WHERE id='historic'").get(),
            attendance = raw().prepare('SELECT * FROM employee_shifts').all();
          closeDatabase();
          await initDatabase({ dbPath, seedData: false, ...encryption });
          expect(snapshot()).toEqual({ plans: [], occurrences: [], events: [], shifts: [manual] });
          expect(raw().prepare('SELECT * FROM employee_shifts').all()).toEqual(attendance);

          const published = await createSchedulePlan(context(), input());
          await publishSchedulePlan(context(), { id: published.id, expectedVersion: 1 });
          const frozen = getSchedulePlan(getDatabase(), 'tenant', 'admin', published.id);
          expect(frozen.occurrences.every(row => row.publishedShiftId !== null)).toBe(true);
          expect(frozen.occurrences.map(row => row.endsAt).sort()).toEqual([
            '2026-09-08T11:00:00.000Z',
            '2026-09-09T11:00:00.000Z',
          ]);
          // Existing shift corrections remain allowed, without rewriting the published snapshot.
          raw()
            .prepare('UPDATE scheduled_shifts SET notes=?,version=version+1 WHERE id=?')
            .run('Later operational correction', frozen.occurrences[0]!.publishedShiftId);
          const pending = await createSchedulePlan(context(), input()),
            changed = input();
          changed.recurrence.rules[0]!.endTime = '05:00';
          await regenerateSchedulePlan(context(), {
            ...changed,
            id: pending.id,
            expectedVersion: 1,
            reason: 'Explicit draft coverage adjustment',
          });
          const discarded = await createSchedulePlan(context(), input());
          await discardSchedulePlan(context(), {
            id: discarded.id,
            expectedVersion: 1,
            reason: 'Explicit unused draft decision',
          });
          const expected = snapshot();
          expect(expected.plans).toHaveLength(3);
          expect(expected.occurrences).toHaveLength(6);
          expect(expected.events).toHaveLength(6);
          expect(expected.shifts).toHaveLength(3);
          const ledger = raw().prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all();
          closeDatabase();
          if (encrypted) {
            expect(readFileSync(dbPath).subarray(0, 16).toString()).not.toBe('SQLite format 3\0');
            const unopened = new Database(dbPath, { readonly: true });
            try {
              expect(() =>
                unopened.prepare('SELECT * FROM employee_schedule_plans').all()
              ).toThrow();
            } finally {
              unopened.close();
            }
          }
          for (let boot = 0; boot < 2; boot++) {
            await initDatabase({ dbPath, seedData: false, ...encryption });
            expect(snapshot()).toEqual(expected);
            expect(getSchedulePlan(getDatabase(), 'tenant', 'admin', published.id)).toEqual(frozen);
            expect(raw().prepare('SELECT * FROM employee_shifts').all()).toEqual(attendance);
            expect(
              raw().prepare("SELECT * FROM scheduled_shifts WHERE id='historic'").get()
            ).toEqual(manual);
            expect(raw().prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all()).toEqual(
              ledger
            );
            expect(raw().prepare('PRAGMA foreign_key_check').all()).toEqual([]);
            expect(raw().prepare('PRAGMA integrity_check').get()).toEqual({
              integrity_check: 'ok',
            });
            expect(() => raw().prepare('DELETE FROM employee_schedule_plan_events').run()).toThrow(
              /IMMUTABLE/
            );
            expect(() =>
              raw()
                .prepare('DELETE FROM employee_schedule_occurrences WHERE plan_id=?')
                .run(published.id)
            ).toThrow(/IMMUTABLE/);
            closeDatabase();
          }
        } finally {
          closeDatabase();
          rmSync(directory, { recursive: true, force: true });
        }
      }
    );
  });
