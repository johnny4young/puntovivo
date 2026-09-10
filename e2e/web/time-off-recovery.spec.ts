import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { test, expect } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  login,
} from './support/app';
import { seedSurfaceGateScenario } from './support/db';

for (const language of ['en', 'es'] as const) {
  test(`absence event failure rolls back and retries safely from the UI (${language})`, async ({
    page,
  }, info) => {
    const scenario = seedSurfaceGateScenario(`absence-recovery-${language}-${randomUUID()}`, {});
    const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
    db.pragma('busy_timeout=15000');
    const trigger = `absence_fault_${randomUUID().replaceAll('-', '')}`;
    const marker = 'private_absence_storage_detail';
    const tenantLiteral = `'${scenario.tenantId.replaceAll("'", "''")}'`;
    const envelopes: string[] = [];
    page.on('request', request => {
      if (
        request.method() === 'POST' &&
        request.url().includes('/api/trpc/workforce.timeOff.create')
      )
        envelopes.push(request.headers()['x-puntovivo-envelope'] ?? '');
    });
    const copy =
      language === 'es'
        ? 'Los registros de ausencias no están disponibles temporalmente. Reintenta la misma operación.'
        : 'Time-off records are temporarily unavailable. Retry the same operation.';
    try {
      const tracker = attachClientIssueTracker(page);
      await login(
        page,
        { ...scenario.admin, defaultPath: '/company' },
        { spanish: language === 'es' }
      );
      await ensureLanguage(page, language);
      await page.goto('/schedule');
      await page.getByRole('button', { name: /^(Absences|Ausencias)$/, exact: true }).click();
      await page
        .getByRole('button', { name: /^(Request absence|Solicitar ausencia)$/, exact: true })
        .click();
      const dialog = page.getByRole('dialog');
      await dialog
        .getByRole('combobox', { name: /^(Employee|Empleado)$/, exact: true })
        .selectOption(scenario.admin.id);
      await dialog.getByLabel(/^(First day absent|Primer día de ausencia)$/).fill('2026-09-07');
      await dialog
        .getByLabel(/^(Return date \(not included\)|Fecha de regreso \(no incluida\))$/)
        .fill('2026-09-09');
      const reason = `Private absence recovery ${randomUUID()}`;
      await dialog
        .getByLabel(/^(Private operational reason|Motivo operativo privado)$/)
        .fill(reason);
      await expectNoClientIssues(tracker);
      db.exec(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON employee_time_off_events WHEN NEW.tenant_id=${tenantLiteral} BEGIN SELECT RAISE(ABORT,'${marker}'); END`
      );
      const failure = page.waitForResponse(
        response =>
          response.url().includes('/api/trpc/workforce.timeOff.create') && response.status() === 500
      );
      await dialog.getByRole('button', { name: /^(Confirm decision|Confirmar decisión)$/ }).click();
      const response = await failure,
        body = await response.text();
      expect(body).toContain('TIME_OFF_TEMPORARILY_UNAVAILABLE');
      expect(body).not.toContain(marker);
      await expect(dialog.getByText(copy, { exact: true })).toBeVisible();
      await expect(
        dialog.getByLabel(/^(Private operational reason|Motivo operativo privado)$/)
      ).toHaveValue(reason);
      for (const table of ['employee_time_off', 'employee_time_off_events'])
        expect(
          db.prepare(`SELECT count(*) AS n FROM ${table} WHERE tenant_id=?`).get(scenario.tenantId)
        ).toEqual({ n: 0 });
      expect(
        db
          .prepare(
            "SELECT count(*) AS n FROM sync_outbox WHERE tenant_id=? AND entity_type='employee_time_off'"
          )
          .get(scenario.tenantId)
      ).toEqual({ n: 0 });
      await page.screenshot({
        path: info.outputPath(`absence-safe-error-${language}.png`),
        fullPage: true,
      });
      const expectedFailureOnly = () => {
        const expectedResponse = `response:500 ${response.url()}`;
        const expectedConsole =
          'console:Failed to load resource: the server responded with a status of 500 (Internal Server Error)';
        const issues = tracker.getIssues();
        expect(issues.filter(issue => issue === expectedResponse)).toHaveLength(1);
        expect(issues.filter(issue => issue === expectedConsole).length).toBeLessThanOrEqual(1);
        expect(
          issues.filter(issue => issue !== expectedResponse && issue !== expectedConsole)
        ).toEqual([]);
      };
      expectedFailureOnly();
      db.exec(`DROP TRIGGER ${trigger}`);
      const recovery = attachClientIssueTracker(page);
      await dialog.getByRole('button', { name: /^(Confirm decision|Confirmar decisión)$/ }).click();
      await expect(dialog).toBeHidden();
      const panel = page.getByTestId('time-off-panel');
      await expect(panel.locator('li[data-testid]')).toHaveCount(1);
      await page.reload();
      await page.getByRole('button', { name: /^(Absences|Ausencias)$/, exact: true }).click();
      await expect(panel.locator('li[data-testid]')).toHaveCount(1);
      expect(
        db
          .prepare('SELECT status,version FROM employee_time_off WHERE tenant_id=?')
          .all(scenario.tenantId)
      ).toEqual([{ status: 'pending', version: 1 }]);
      expect(
        db
          .prepare('SELECT count(*) AS n FROM employee_time_off_events WHERE tenant_id=?')
          .get(scenario.tenantId)
      ).toEqual({ n: 1 });
      expect(
        db
          .prepare(
            "SELECT count(*) AS n FROM audit_logs WHERE tenant_id=? AND action='time_off.changed'"
          )
          .get(scenario.tenantId)
      ).toEqual({ n: 1 });
      expect(envelopes).toHaveLength(2);
      expect(envelopes[0]).not.toBe('');
      expect(envelopes[1]).toBe(envelopes[0]);
      await expectNoClientIssues(recovery);
      expectedFailureOnly();
    } finally {
      db.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
      db.close();
    }
  });
}
