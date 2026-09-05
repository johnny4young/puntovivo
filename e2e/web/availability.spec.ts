import path from 'node:path';
import Database from 'better-sqlite3';
import { test, expect } from '@playwright/test';
import {
  runAvailabilityJourney,
  assertAvailabilityJourneyDiagnostics,
} from '../shared/availability-journey';
import { attachClientIssueTracker, login, E2E_PASSWORD } from './support/app';
import { seedSurfaceGateScenario } from './support/db';

test('manager availability constrains shifts and preserves effective history after reload', async ({
  page,
}, info) => {
  const scenario = seedSurfaceGateScenario(`availability-${info.parallelIndex}-${Date.now()}`, {});
  const tracker = attachClientIssueTracker(page);
  await login(page, { ...scenario.admin, defaultPath: '/company' });
  const result = await runAvailabilityJourney(page, {
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
          'SELECT id,status,version,from_date AS start,until_date AS end,replaces_id AS predecessor FROM employee_availability WHERE tenant_id=? ORDER BY from_date'
        )
        .all(scenario.tenantId)
    ).toEqual([
      {
        id: result.id,
        status: 'active',
        version: 2,
        start: result.fromDate,
        end: result.replacementDate,
        predecessor: null,
      },
      {
        id: result.successorId,
        status: 'voided',
        version: 2,
        start: result.replacementDate,
        end: result.untilDate,
        predecessor: result.id,
      },
    ]);
    expect(
      db
        .prepare(
          'SELECT kind,version FROM employee_availability_events WHERE tenant_id=? AND availability_id=? ORDER BY version'
        )
        .all(scenario.tenantId, result.id)
    ).toEqual([
      { kind: 'created', version: 1 },
      { kind: 'ended', version: 2 },
    ]);
    expect(
      db
        .prepare(
          'SELECT kind,version FROM employee_availability_events WHERE tenant_id=? AND availability_id=? ORDER BY version'
        )
        .all(scenario.tenantId, result.successorId)
    ).toEqual([
      { kind: 'created', version: 1 },
      { kind: 'voided', version: 2 },
    ]);
    expect(
      db
        .prepare(
          'SELECT status,version,CAST(ROUND((julianday(ends_at)-julianday(starts_at))*24) AS INTEGER) AS hours FROM scheduled_shifts WHERE tenant_id=?'
        )
        .all(scenario.tenantId)
    ).toEqual([{ status: 'scheduled', version: 1, hours: 4 }]);
    const generic = db
      .prepare(
        "SELECT payload,status FROM sync_outbox WHERE tenant_id=? AND entity_type='employee_availability'"
      )
      .all(scenario.tenantId) as { payload: string; status: string }[];
    expect(generic).toHaveLength(4);
    expect(generic.every(row => row.status === 'local_only')).toBe(true);
    expect(JSON.stringify(generic)).not.toContain(result.suffix);
    expect(JSON.stringify(generic)).not.toContain(result.fromDate);
    expect(JSON.stringify(generic)).not.toContain('startMinute');
  } finally {
    db.close();
  }
  assertAvailabilityJourneyDiagnostics(tracker, result.conflictUrl);
});
