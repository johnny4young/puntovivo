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
  test(`schedule storage failure is safe and recoverable from the UI (${language})`, async ({
    page,
  }, info) => {
    const scenario = seedSurfaceGateScenario(`schedule-recovery-${language}-${randomUUID()}`, {});
    const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
    db.pragma('busy_timeout = 15000');
    const trigger = `schedule_fault_${randomUUID().replaceAll('-', '')}`;
    const marker = 'private_schedule_storage_detail';
    const tenantLiteral = `'${scenario.tenantId.replaceAll("'", "''")}'`;
    const envelopes: string[] = [];
    const requestStarted = Promise.withResolvers<void>();
    const releaseRequest = Promise.withResolvers<void>();
    page.on('request', request => {
      if (
        request.method() === 'POST' &&
        request.url().includes('/api/trpc/employeeShifts.schedule.create')
      ) {
        envelopes.push(request.headers()['x-puntovivo-envelope'] ?? '');
      }
    });
    const copy =
      language === 'es'
        ? 'Los horarios no están disponibles temporalmente. Reintenta la misma operación.'
        : 'Schedules are temporarily unavailable. Retry the same operation.';
    try {
      const bootstrapTracker = attachClientIssueTracker(page);
      await login(
        page,
        { ...scenario.admin, defaultPath: '/company' },
        { spanish: language === 'es' }
      );
      await ensureLanguage(page, language);
      await page.goto('/schedule');
      await page
        .getByRole('button', { name: /^(Add shift|Agregar turno)$/ })
        .first()
        .click();
      const dialog = page.getByRole('dialog');
      const notes = `Recovery ${language} ${randomUUID()}`;
      await dialog.getByLabel(/^(Notes|Notas)$/).fill(notes);
      await expectNoClientIssues(bootstrapTracker);
      db.exec(`CREATE TRIGGER ${trigger} BEFORE INSERT ON scheduled_shifts
        WHEN NEW.tenant_id = ${tenantLiteral}
        BEGIN SELECT RAISE(ABORT, '${marker}'); END`);
      // Delay the real request, not its result, so Escape/backdrop cannot replace
      // decision A while the server is still allowed to reject that same decision.
      await page.route('**/api/trpc/employeeShifts.schedule.create*', async route => {
        requestStarted.resolve();
        await releaseRequest.promise;
        await route.continue();
      });
      const failure = page.waitForResponse(
        response =>
          response.url().includes('/api/trpc/employeeShifts.schedule.create') &&
          response.status() === 500
      );
      await dialog.getByRole('button', { name: /^(Save shift|Guardar turno)$/ }).click();
      await requestStarted.promise;
      await expect(
        dialog.getByRole('button', { name: /^(Close modal|Cerrar modal)$/ })
      ).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: /^(Close|Cerrar)$/ })).toBeDisabled();
      await page.keyboard.press('Escape');
      await dialog
        .locator(':scope > div')
        .first()
        .click({ position: { x: 1, y: 1 } });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel(/^(Notes|Notas)$/)).toHaveValue(notes);
      releaseRequest.resolve();
      const failureResponse = await failure;
      const body = await failureResponse.text();
      expect(body).toContain('SCHEDULE_TEMPORARILY_UNAVAILABLE');
      expect(body).not.toContain(marker);
      await expect(dialog.getByRole('alert').getByText(copy, { exact: true })).toBeVisible();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel(/^(Notes|Notas)$/)).toHaveValue(notes);
      expect(
        db
          .prepare('SELECT count(*) AS total FROM scheduled_shifts WHERE tenant_id=?')
          .get(scenario.tenantId)
      ).toEqual({ total: 0 });
      expect(
        db
          .prepare(
            "SELECT count(*) AS total FROM sync_outbox WHERE tenant_id=? AND entity_type='scheduled_shifts'"
          )
          .get(scenario.tenantId)
      ).toEqual({ total: 0 });
      await page.screenshot({
        path: info.outputPath(`schedule-safe-error-${language}.png`),
        fullPage: true,
      });
      // Correlate the exception to exactly one deliberately failed request;
      // another endpoint failure, duplicate 500 or requestfailed must still fail.
      const assertExpectedFailureOnly = () => {
        const responseIssue = `response:500 ${failureResponse.url()}`;
        const consoleIssue =
          'console:Failed to load resource: the server responded with a status of 500 (Internal Server Error)';
        const issues = bootstrapTracker.getIssues();
        expect(issues.filter(issue => issue === responseIssue)).toHaveLength(1);
        expect(issues.filter(issue => issue === consoleIssue).length).toBeLessThanOrEqual(1);
        expect(issues.filter(issue => issue !== responseIssue && issue !== consoleIssue)).toEqual(
          []
        );
      };
      assertExpectedFailureOnly();
      db.exec(`DROP TRIGGER ${trigger}`);
      const recoveryTracker = attachClientIssueTracker(page);
      await dialog.getByRole('button', { name: /^(Save shift|Guardar turno)$/ }).click();
      await expect(dialog).toBeHidden();
      const shift = page.locator('[data-testid^="scheduled-shift-"]').filter({ hasText: notes });
      await expect(shift).toHaveCount(1);
      await page.reload();
      await expect(shift).toHaveCount(1);
      expect(
        db
          .prepare('SELECT version,status FROM scheduled_shifts WHERE tenant_id=?')
          .all(scenario.tenantId)
      ).toEqual([{ version: 1, status: 'scheduled' }]);
      expect(
        db
          .prepare(
            "SELECT count(*) AS total FROM audit_logs WHERE tenant_id=? AND action='scheduled_shift.create'"
          )
          .get(scenario.tenantId)
      ).toEqual({ total: 1 });
      expect(
        db
          .prepare(
            "SELECT status FROM sync_outbox WHERE tenant_id=? AND entity_type='scheduled_shifts'"
          )
          .all(scenario.tenantId)
      ).toEqual([{ status: 'local_only' }]);
      await expectNoClientIssues(recoveryTracker);
      expect(envelopes).toHaveLength(2);
      expect(envelopes[0]).not.toBe('');
      expect(envelopes[1]).toBe(envelopes[0]);
      assertExpectedFailureOnly();
    } finally {
      releaseRequest.resolve();
      db.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
      db.close();
    }
  });
}
