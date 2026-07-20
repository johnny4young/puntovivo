import path from 'node:path';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  attachClientIssueTracker,
  E2E_PASSWORD,
  ensureLanguage,
  expectNoClientIssues,
  login,
  loginAs,
  openUserMenu,
} from './support/app';

function seedOvertimeScenario() {
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const id = (kind: string) => `e2e_overtime_${kind}_${suffix}`;
  const now = new Date().toISOString();
  const password = db
    .prepare('select password_hash as passwordHash from users where email = ?')
    .get('e2e.admin@local.test') as { passwordHash: string } | undefined;
  if (!password) throw new Error('Expected the E2E admin password hash');
  const tenantId = id('tenant');
  const companyId = id('company');
  const overtimeSiteId = id('site_a');
  const otherSiteId = id('site_b');
  const adminId = id('admin');
  const cashierId = id('cashier');
  const fridayShiftId = id('friday');
  const email = `e2e.overtime.${suffix}@local.test`;

  try {
    db.transaction(() => {
      db.prepare(
        `insert into tenants (
          id, name, slug, settings, default_currency_code, is_active, created_at, updated_at
        ) values (?, ?, ?, ?, 'COP', 1, ?, ?)`
      ).run(
        tenantId,
        `E2E Overtime ${suffix}`,
        `e2e-overtime-${suffix}`,
        JSON.stringify({ modules: {} }),
        now,
        now
      );
      db.prepare(
        'insert into companies (id, tenant_id, name, created_at, updated_at) values (?, ?, ?, ?, ?)'
      ).run(companyId, tenantId, `E2E Overtime Company ${suffix}`, now, now);
      const insertSite = db.prepare(
        `insert into sites (
          id, tenant_id, company_id, name, is_active, created_at, updated_at
        ) values (?, ?, ?, ?, 1, ?, ?)`
      );
      insertSite.run(overtimeSiteId, tenantId, companyId, 'A Overtime Site', now, now);
      insertSite.run(otherSiteId, tenantId, companyId, 'B Other Site', now, now);
      db.prepare(
        `insert into tenant_locale_settings (
          tenant_id, country_code, version, updated_at
        ) values (?, 'CO', 1, ?)`
      ).run(tenantId, now);
      const insertUser = db.prepare(
        `insert into users (
          id, tenant_id, email, name, password_hash, session_version,
          role, is_active, created_at, updated_at
        ) values (?, ?, ?, ?, ?, 1, ?, 1, ?, ?)`
      );
      insertUser.run(
        adminId,
        tenantId,
        email,
        'E2E Overtime Admin',
        password.passwordHash,
        'admin',
        now,
        now
      );
      insertUser.run(
        cashierId,
        tenantId,
        `e2e.overtime.cashier.${suffix}@local.test`,
        'Camila Horas',
        password.passwordHash,
        'cashier',
        now,
        now
      );
      const insertShift = db.prepare(
        `insert into employee_shifts (
          id, tenant_id, user_id, site_id, clocked_in_at, clocked_out_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (let day = 13; day <= 16; day += 1) {
        const startedAt = `2026-07-${day}T13:00:00.000Z`;
        const endedAt = `2026-07-${day}T21:30:00.000Z`;
        insertShift.run(
          id(`shift_${day}`),
          tenantId,
          cashierId,
          otherSiteId,
          startedAt,
          endedAt,
          startedAt,
          endedAt
        );
      }
      insertShift.run(
        fridayShiftId,
        tenantId,
        cashierId,
        overtimeSiteId,
        '2026-07-17T13:00:00.000Z',
        '2026-07-17T22:00:00.000Z',
        '2026-07-17T13:00:00.000Z',
        '2026-07-17T22:00:00.000Z'
      );
    })();
  } finally {
    db.close();
  }

  return {
    fridayShiftId,
    admin: { email, password: E2E_PASSWORD, defaultPath: '/company' },
  };
}

async function captureEvidence(page: Page, name: string) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(100);
  await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: path.join(auditDir, `${name}.png`),
  });
}

async function captureLocatorEvidence(page: Page, locator: Locator, name: string) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await locator.screenshot({
    animations: 'disabled',
    path: path.join(auditDir, `${name}.png`),
  });
}

function readCorrectionEvidence(shiftId: string) {
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
  try {
    const raw = db
      .prepare(
        `select clocked_in_at as clockedInAt, clocked_out_at as clockedOutAt
         from employee_shifts where id = ?`
      )
      .get(shiftId) as { clockedInAt: string; clockedOutAt: string } | undefined;
    const correction = db
      .prepare(
        `select version, clocked_in_at as clockedInAt, clocked_out_at as clockedOutAt, reason
         from employee_shift_corrections
         where employee_shift_id = ? order by version desc limit 1`
      )
      .get(shiftId) as
      { version: number; clockedInAt: string; clockedOutAt: string; reason: string } | undefined;
    return { raw, correction };
  } finally {
    db.close();
  }
}

test.describe('employee attendance evidence across shift states', () => {
  test('persists shifts and explicit breaks across the user menu in both locales', async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, 'admin');

    try {
      await openUserMenu(page);
      let timeClock = page.getByRole('region', { name: 'Time clock' });
      await expect(
        timeClock.getByRole('button', { name: /^(?:Clock in|Clock out)$/ })
      ).toBeVisible();
      const staleClockOut = timeClock.getByRole('button', { name: 'Clock out' });
      if (await staleClockOut.isVisible()) {
        const staleEndBreak = timeClock.getByRole('button', { name: 'End break' });
        if (await staleEndBreak.isVisible()) await staleEndBreak.click();
        await staleClockOut.click();
      }
      await expect(timeClock.getByRole('button', { name: 'Clock in' })).toBeVisible();
      await expect(timeClock.getByText(/Site:/)).toBeVisible();
      await timeClock.getByRole('button', { name: 'Clock in' }).click();
      await expect(timeClock.getByText(/Clocked in/)).toBeVisible();
      await expect(timeClock.getByRole('button', { name: 'Clock out' })).toBeVisible();
      await timeClock.getByRole('button', { name: 'Start break' }).click();
      await expect(timeClock.getByText(/On break since/)).toBeVisible();
      await expect(timeClock.getByRole('button', { name: 'Clock out' })).toBeDisabled();
      await captureEvidence(page, 'eng-140b-active-break-en');

      // Close/reopen the popover so the assertion reads server state rather
      // than only the mutation's optimistic UI lifecycle.
      await openUserMenu(page);
      await openUserMenu(page);
      timeClock = page.getByRole('region', { name: 'Time clock' });
      await expect(timeClock.getByRole('button', { name: 'End break' })).toBeVisible();
      await timeClock.getByRole('button', { name: 'End break' }).click();
      await expect(timeClock.getByRole('button', { name: 'Start break' })).toBeVisible();
      await timeClock.getByRole('button', { name: 'Clock out' }).click();
      await expect(timeClock.getByRole('button', { name: 'Clock in' })).toBeVisible();

      await ensureLanguage(page, 'es');
      await openUserMenu(page);
      const reloj = page.getByRole('region', { name: 'Control de turno' });
      await reloj.getByRole('button', { name: 'Marcar entrada' }).click();
      await expect(reloj.getByText(/Entrada registrada/)).toBeVisible();
      await expect(reloj.getByText(/Sede:/)).toBeVisible();
      await reloj.getByRole('button', { name: 'Iniciar pausa' }).click();
      await expect(reloj.getByText(/En pausa desde/)).toBeVisible();
      await expect(reloj.getByRole('button', { name: 'Marcar salida' })).toBeDisabled();
      await captureEvidence(page, 'eng-140b-active-break-es');
      await reloj.getByRole('button', { name: 'Finalizar pausa' }).click();
      await reloj.getByRole('button', { name: 'Marcar salida' }).click();
      await expect(reloj.getByRole('button', { name: 'Marcar entrada' })).toBeVisible();

      await page.goto('/schedule');
      const attendance = page.getByTestId('team-attendance-panel');
      await expect(attendance.getByRole('heading', { name: 'Asistencia real' })).toBeVisible();
      await expect(attendance.getByText('Tiempo en pausa').first()).toBeVisible();
      await expect(attendance.getByText(/Detalle de pausa \(1\)/).first()).toBeVisible();
      await captureEvidence(page, 'eng-140b-attendance-es');

      await ensureLanguage(page, 'en');
      await expect(attendance.getByRole('heading', { name: 'Actual attendance' })).toBeVisible();
      await expect(attendance.getByText('Break time').first()).toBeVisible();
      await captureEvidence(page, 'eng-140b-attendance-en');

      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      await captureEvidence(page, 'eng-140b-attendance-mobile-en');

      await ensureLanguage(page, 'es');
      await expect(attendance.getByRole('heading', { name: 'Asistencia real' })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      await captureEvidence(page, 'eng-140b-attendance-mobile-es');

      await openUserMenu(page);
      const mobileClock = page.getByRole('region', { name: 'Control de turno' });
      await mobileClock.getByRole('button', { name: 'Marcar entrada' }).click();
      await mobileClock.getByRole('button', { name: 'Iniciar pausa' }).click();
      await expect(mobileClock.getByRole('button', { name: 'Marcar salida' })).toBeDisabled();
      await captureEvidence(page, 'eng-140b-active-break-mobile-es');
      await mobileClock.getByRole('button', { name: 'Finalizar pausa' }).click();
      await mobileClock.getByRole('button', { name: 'Marcar salida' }).click();
      await expect(mobileClock.getByRole('button', { name: 'Marcar entrada' })).toBeVisible();

      await expectNoClientIssues(tracker);
    } finally {
      // Retries run without repeating global setup. Never strand the shared
      // template admin in an open shift after an assertion failure.
      const menu = page.locator('#header-user-menu');
      if (!(await menu.isVisible())) {
        await openUserMenu(page);
      }
      const clockOut = page.getByRole('button', { name: /^(?:Clock out|Marcar salida)$/ });
      if (await clockOut.isVisible()) {
        const endBreak = page.getByRole('button', { name: /^(?:End break|Finalizar pausa)$/ });
        if (await endBreak.isVisible()) {
          await endBreak.click();
          await expect(endBreak).toBeHidden();
        }
        const refreshedClockOut = page.getByRole('button', {
          name: /^(?:Clock out|Marcar salida)$/,
        });
        if (await refreshedClockOut.isVisible()) await refreshedClockOut.click();
      }
    }
  });

  test('shows overtime and appends a bilingual immutable correction', async ({ page }) => {
    const scenario = seedOvertimeScenario();
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, scenario.admin);
    await ensureLanguage(page, 'en');
    await page.goto('/schedule');

    const attendance = page.getByTestId('team-attendance-panel');
    await expect(attendance.getByRole('heading', { name: 'Actual attendance' })).toBeVisible();
    await expect(attendance.getByTestId('overtime-policy')).toContainText(
      '42 regular hours per week'
    );
    const friday = attendance.getByTestId(`attendance-shift-${scenario.fridayShiftId}`);
    await expect(friday).toContainText('Camila Horas');
    await expect(friday).toContainText('Regular8h');
    await expect(friday).toContainText('Overtime1h');
    await expect(friday).toContainText('Day overtime · 1h · 1.25×');
    await captureEvidence(page, 'eng-140c-overtime-en');

    await ensureLanguage(page, 'es');
    await expect(attendance.getByRole('heading', { name: 'Asistencia real' })).toBeVisible();
    await expect(attendance.getByTestId('overtime-policy')).toContainText(
      '42 horas ordinarias por semana'
    );
    await expect(friday).toContainText('Ordinario8h');
    await expect(friday).toContainText('Horas extra1h');
    await expect(friday).toContainText('Extra diurna · 1h · 1.25×');

    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await captureEvidence(page, 'eng-140c-overtime-mobile-es');

    await page.setViewportSize({ width: 1440, height: 900 });
    await ensureLanguage(page, 'en');
    await expect(friday).toContainText('Day overtime · 1h · 1.25×');
    await friday.getByRole('button', { name: 'Correct attendance' }).click();
    const correctionDialog = page.getByRole('dialog');
    await expect(correctionDialog).toContainText(
      'Original clock and break evidence is never overwritten.'
    );
    await correctionDialog.getByLabel('End time').fill('17:30');
    await correctionDialog
      .getByLabel('Correction reason')
      .fill('Verified against the signed register close and supervisor note.');
    await captureLocatorEvidence(page, correctionDialog, 'eng-140e-correction-form-en');
    await correctionDialog.getByRole('button', { name: 'Save correction' }).click();
    await expect(page.getByText('Attendance corrected')).toBeVisible();
    await expect(friday).toContainText('Corrected · v1');
    await expect(friday).toContainText('Day overtime · 1h 30m · 1.25×');
    await friday.getByRole('button', { name: 'View correction history' }).click();
    await expect(friday).toContainText('Version 1 · E2E Overtime Admin');
    await captureEvidence(page, 'eng-140e-correction-en');

    await expect(attendance.getByTestId('attendance-export-notice')).toContainText(
      'not only the visible page'
    );
    const csvDownloadPromise = page.waitForEvent('download');
    await attendance.getByRole('button', { name: 'Payroll CSV' }).click();
    const csvDownload = await csvDownloadPromise;
    expect(csvDownload.suggestedFilename()).toBe('payroll-attendance-2026-07-13-2026-07-20.csv');
    const csvPath = await csvDownload.path();
    expect(csvPath).not.toBeNull();
    const csv = await readFile(csvPath!, 'utf8');
    expect(csv).toContain('"employee_name"');
    expect(csv).toContain('"Camila Horas"');
    expect(csv).toContain('"correction_version"');
    expect(csv).toContain('"Verified against the signed register close and supervisor note."');
    expect(csv).toContain('co_day_overtime');

    const xlsxDownloadPromise = page.waitForEvent('download');
    await attendance.getByRole('button', { name: 'Accounting XLSX' }).click();
    const xlsxDownload = await xlsxDownloadPromise;
    expect(xlsxDownload.suggestedFilename()).toBe(
      'accounting-attendance-handoff-2026-07-13-2026-07-20.xlsx'
    );
    const xlsxPath = await xlsxDownload.path();
    expect(xlsxPath).not.toBeNull();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(xlsxPath!);
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([
      'Summary',
      'Evidence',
      'Premiums',
      'Read me',
    ]);
    const evidenceValues = workbook
      .getWorksheet('Evidence')!
      .getColumn(6)
      .values.map(value => String(value));
    expect(evidenceValues).toContain(scenario.fridayShiftId);
    expect(workbook.getWorksheet('Premiums')!.getCell('E2').value).toBe('co_day_overtime');

    const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
    if (auditDir) {
      await mkdir(auditDir, { recursive: true });
      await Promise.all([
        copyFile(csvPath!, path.join(auditDir, csvDownload.suggestedFilename())),
        copyFile(xlsxPath!, path.join(auditDir, xlsxDownload.suggestedFilename())),
      ]);
    }
    await captureEvidence(page, 'eng-140f-exports-en');

    const persisted = readCorrectionEvidence(scenario.fridayShiftId);
    expect(persisted.raw).toEqual({
      clockedInAt: '2026-07-17T13:00:00.000Z',
      clockedOutAt: '2026-07-17T22:00:00.000Z',
    });
    expect(persisted.correction).toMatchObject({
      version: 1,
      reason: 'Verified against the signed register close and supervisor note.',
    });
    expect(persisted.correction?.clockedOutAt).not.toBe(persisted.raw?.clockedOutAt);

    await ensureLanguage(page, 'es');
    await expect(friday).toContainText('Corregida · v1');
    await expect(friday).toContainText('Extra diurna · 1h 30m · 1.25×');
    await expect(attendance.getByRole('button', { name: 'CSV de nómina' })).toBeVisible();
    await expect(attendance.getByRole('button', { name: 'XLSX contable' })).toBeVisible();
    await expect(attendance.getByTestId('attendance-export-notice')).toContainText(
      'no solo la página visible'
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await captureEvidence(page, 'eng-140e-correction-mobile-es');
    await captureEvidence(page, 'eng-140f-exports-mobile-es');
    await expectNoClientIssues(tracker);
  });
});
