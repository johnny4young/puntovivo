import path from 'node:path';
import Database from 'better-sqlite3';
import { test, expect } from '@playwright/test';
import { runEmploymentJourney } from '../shared/employment-journey';
import { attachClientIssueTracker, expectNoClientIssues, login, E2E_PASSWORD } from './support/app';
import { seedSurfaceGateScenario } from './support/db';

test('employment lifecycle preserves evidence and manager privacy after reload', async ({
  page,
}, info) => {
  const scenario = seedSurfaceGateScenario(`employment-${info.parallelIndex}-${Date.now()}`, {});
  const tracker = attachClientIssueTracker(page);
  await login(page, { ...scenario.admin, defaultPath: '/company' });
  const result = await runEmploymentJourney(page, {
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
    const original = db
      .prepare(
        'SELECT version,voided_at AS voidedAt,pay_amount AS pay FROM employment_contracts WHERE tenant_id=? AND id=?'
      )
      .get(scenario.tenantId, result.originalId) as {
      version: number;
      voidedAt: string;
      pay: number;
    };
    const revised = db
      .prepare(
        'SELECT version,predecessor_id AS predecessorId,effective_until AS end,pay_amount AS pay FROM employment_contracts WHERE tenant_id=? AND id=?'
      )
      .get(scenario.tenantId, result.revisedId);
    expect(original.version).toBe(3);
    expect(original.voidedAt).toBeTruthy();
    expect(original.pay).toBe(1900000.67);
    expect(revised).toEqual({
      version: 2,
      predecessorId: result.originalId,
      end: '2026-12-01',
      pay: 2100000.99,
    });
    const count = db
      .prepare('SELECT count(*) AS total FROM employment_contract_events WHERE tenant_id=?')
      .get(scenario.tenantId);
    expect(count).toEqual({ total: 5 });
    expect(
      db
        .prepare('SELECT version,status FROM scheduled_shifts WHERE tenant_id=? AND id=?')
        .get(scenario.tenantId, result.scheduleId)
    ).toEqual({ version: 3, status: 'cancelled' });
    const outbox = db
      .prepare(
        "SELECT status,payload FROM sync_outbox WHERE tenant_id=? AND entity_type='scheduled_shifts' AND entity_id=?"
      )
      .all(scenario.tenantId, result.scheduleId) as { status: string; payload: string }[];
    expect(outbox).toHaveLength(3);
    expect(outbox.every(row => row.status === 'local_only')).toBe(true);
    expect(JSON.stringify(outbox)).not.toContain('Viewer coverage');
  } finally {
    db.close();
  }
  await expectNoClientIssues(tracker);
});
