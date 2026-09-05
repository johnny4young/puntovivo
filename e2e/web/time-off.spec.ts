import path from 'node:path';
import Database from 'better-sqlite3';
import { test, expect } from '@playwright/test';
import { runTimeOffJourney } from '../shared/time-off-journey';
import { attachClientIssueTracker, expectNoClientIssues, login, E2E_PASSWORD } from './support/app';
import { seedSurfaceGateScenario } from './support/db';

test('absence decisions preserve approval and private history after manager reload', async ({
  page,
}, info) => {
  const scenario = seedSurfaceGateScenario(`time-off-${info.parallelIndex}-${Date.now()}`, {});
  const tracker = attachClientIssueTracker(page);
  await login(page, { ...scenario.admin, defaultPath: '/company' });
  const { id, suffix } = await runTimeOffJourney(page, {
    navigate: async route => {
      await page.goto(route);
    },
    signInManager: email =>
      login(page, { email, password: E2E_PASSWORD, defaultPath: '/dashboard' }),
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
          'SELECT status,version,approved_by_user_id AS approver,approved_at AS approved FROM employee_time_off WHERE tenant_id=? AND id=?'
        )
        .get(scenario.tenantId, id)
    ).toEqual({
      status: 'cancelled',
      version: 3,
      approver: expect.any(String),
      approved: expect.any(String),
    });
    expect(
      db
        .prepare(
          'SELECT kind,version FROM employee_time_off_events WHERE tenant_id=? AND request_id=? ORDER BY version'
        )
        .all(scenario.tenantId, id)
    ).toEqual([
      { kind: 'requested', version: 1 },
      { kind: 'approved', version: 2 },
      { kind: 'cancelled', version: 3 },
    ]);
    const generic = db
      .prepare(
        "SELECT payload,status FROM sync_outbox WHERE tenant_id=? AND entity_type='employee_time_off'"
      )
      .all(scenario.tenantId) as { payload: string; status: string }[];
    expect(generic).toHaveLength(3);
    expect(generic.every(row => row.status === 'local_only')).toBe(true);
    expect(JSON.stringify(generic)).not.toContain(suffix);
    expect(JSON.stringify(generic)).not.toContain('2026-09-07');
  } finally {
    db.close();
  }
  await expectNoClientIssues(tracker);
});
