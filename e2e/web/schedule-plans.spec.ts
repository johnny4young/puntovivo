import path from 'node:path';
import Database from 'better-sqlite3';
import { test, expect } from '@playwright/test';
import {
  runSchedulePlansJourney,
  assertSchedulePlansDiagnostics,
} from '../shared/schedule-plans-journey';
import { attachClientIssueTracker, login, E2E_PASSWORD } from './support/app';
import { seedSurfaceGateScenario } from './support/db';

test('manager drafts, regenerates and publishes recurring shifts atomically through UI and reload', async ({
  page,
}, info) => {
  const scenario = seedSurfaceGateScenario(`plans-${info.parallelIndex}-${Date.now()}`, {});
  const tracker = attachClientIssueTracker(page);
  await login(page, { ...scenario.admin, defaultPath: '/company' });
  const result = await runSchedulePlansJourney(page, {
    navigate: async route => {
      await page.goto(route);
    },
    signInManager: email =>
      login(page, { email, password: E2E_PASSWORD, defaultPath: '/dashboard' }),
    signInAdmin: () => login(page, { ...scenario.admin, defaultPath: '/company' }),
    screenshot: async name => {
      await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
    },
  });
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'), {
    readonly: true,
  });
  try {
    expect(
      db
        .prepare(
          'SELECT id,status,version,occurrence_count AS count FROM employee_schedule_plans WHERE tenant_id=? ORDER BY status'
        )
        .all(scenario.tenantId)
    ).toEqual([
      { id: result.discardedId, status: 'discarded', version: 2, count: 2 },
      { id: result.id, status: 'published', version: 3, count: 2 },
    ]);
    expect(
      db
        .prepare(
          'SELECT kind,version FROM employee_schedule_plan_events WHERE tenant_id=? AND plan_id=? ORDER BY version'
        )
        .all(scenario.tenantId, result.id)
    ).toEqual([
      { kind: 'created', version: 1 },
      { kind: 'regenerated', version: 2 },
      { kind: 'published', version: 3 },
    ]);
    expect(
      db
        .prepare(
          'SELECT kind,version FROM employee_schedule_plan_events WHERE tenant_id=? AND plan_id=? ORDER BY version'
        )
        .all(scenario.tenantId, result.discardedId)
    ).toEqual([
      { kind: 'created', version: 1 },
      { kind: 'discarded', version: 2 },
    ]);
    expect(
      db
        .prepare(
          'SELECT status,version,CAST(ROUND((julianday(ends_at)-julianday(starts_at))*24) AS INTEGER) AS hours FROM scheduled_shifts WHERE tenant_id=?'
        )
        .all(scenario.tenantId)
    ).toEqual([
      { status: 'scheduled', version: 1, hours: 7 },
      { status: 'scheduled', version: 1, hours: 7 },
    ]);
    expect(
      db
        .prepare(
          'SELECT count(*) AS count FROM employee_schedule_occurrences o JOIN scheduled_shifts s ON s.id=o.published_shift_id AND s.tenant_id=o.tenant_id AND s.starts_at=o.starts_at AND s.ends_at=o.ends_at AND s.notes IS o.notes WHERE o.tenant_id=? AND o.plan_id=?'
        )
        .get(scenario.tenantId, result.id)
    ).toEqual({ count: 2 });
    expect(
      db
        .prepare(
          'SELECT count(published_shift_id) AS count FROM employee_schedule_occurrences WHERE tenant_id=? AND plan_id=?'
        )
        .get(scenario.tenantId, result.discardedId)
    ).toEqual({ count: 0 });
    const generic = db
      .prepare(
        "SELECT payload,status FROM sync_outbox WHERE tenant_id=? AND entity_type='employee_schedule_plans'"
      )
      .all(scenario.tenantId) as { payload: string; status: string }[];
    expect(generic).toHaveLength(5);
    expect(generic.every(row => row.status === 'local_only')).toBe(true);
    expect(JSON.stringify(generic)).not.toContain(result.suffix);
    expect(JSON.stringify(generic)).not.toContain(result.fromDate);
    expect(JSON.stringify(generic)).not.toContain('rules');
    expect(
      db
        .prepare(
          "SELECT count(*) AS count FROM audit_logs WHERE tenant_id=? AND resource_type='schedule_plan'"
        )
        .get(scenario.tenantId)
    ).toEqual({ count: 5 });
  } finally {
    db.close();
  }
  assertSchedulePlansDiagnostics(tracker, result.conflictUrl);
});
