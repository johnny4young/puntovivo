import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import { attachClientIssueTracker, ensureLanguage, login } from './support/app';
import { seedHourlyPayrollScenario } from './support/db';

test('submits authoritative hourly attendance without decimal precision loss', async ({
  page,
}, info) => {
  const scenario = seedHourlyPayrollScenario(`payroll-hourly-${info.parallelIndex}-${Date.now()}`);
  const tracker = attachClientIssueTracker(page);
  await login(page, { ...scenario.admin, defaultPath: '/company' });
  await ensureLanguage(page, 'en');
  await page.goto('/schedule');

  await page.getByRole('button', { name: 'Pre-payroll', exact: true }).click();
  const payroll = page.getByTestId('payroll-panel');
  await payroll.getByRole('button', { name: 'Create period', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Create period', exact: true });
  await dialog.getByLabel('First covered date', { exact: true }).fill('2026-08-01');
  await dialog.getByLabel('Exclusive end date', { exact: true }).fill('2026-09-01');
  await dialog.getByLabel('Pay date', { exact: true }).fill('2026-09-05');
  await dialog
    .getByLabel('Private review reason', { exact: true })
    .fill('Reviewed exact hourly payroll period');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  await payroll.getByRole('button', { name: 'Open runs', exact: true }).click();
  await payroll.getByRole('button', { name: 'Create run', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Create run', exact: true });
  await dialog
    .getByLabel('Private review reason', { exact: true })
    .fill('Created exact hourly payroll run');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  await payroll.getByRole('button', { name: 'Calculate new revision', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Calculate immutable revision', exact: true });
  await expect(dialog).toContainText(scenario.workerName);
  await expect(dialog).toContainText('This authoritative value is locked');
  const hours = dialog.getByLabel('Reviewed worked hours', { exact: true });
  await expect(hours).toBeDisabled();
  await expect(hours).toHaveValue(String(scenario.expectedWorkedSeconds / 3600));
  await dialog
    .getByRole('combobox', { name: 'Employee classification', exact: true })
    .selectOption('private_cst');
  await dialog
    .getByRole('combobox', { name: 'Employer contribution exemption', exact: true })
    .selectOption('does_not_apply');
  await dialog.getByLabel('Reviewed contribution base (COP)', { exact: true }).fill('10');
  await dialog
    .getByRole('combobox', { name: 'Transport assistance', exact: true })
    .selectOption('does_not_apply');
  await dialog
    .getByRole('combobox', { name: 'Withholding review', exact: true })
    .selectOption('complete');
  await dialog.getByLabel('Withholding amount (COP)', { exact: true }).fill('0');
  await dialog.getByLabel('Holiday calendar reviewed', { exact: true }).check();
  await dialog.getByLabel('Employee rest day reviewed', { exact: true }).check();
  await dialog.getByLabel('Benefits and provisions reviewed', { exact: true }).check();
  await dialog
    .getByLabel('Employee review reason', { exact: true })
    .fill('Reviewed exact one-second attendance evidence');
  await dialog
    .getByLabel(
      'I reviewed the effective policy, its sources and documented limitations for this whole period.',
      { exact: true }
    )
    .check();
  await dialog
    .getByLabel('Private review reason', { exact: true })
    .fill('Calculated exact one-second payroll revision');
  await page.screenshot({
    path: info.outputPath('hourly-authoritative-input.png'),
    fullPage: true,
  });
  await dialog.getByRole('button', { name: 'Calculate new revision', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(payroll).toContainText('Current revision 1');
  await page.screenshot({
    path: info.outputPath('hourly-authoritative-seconds.png'),
    fullPage: true,
  });

  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'), {
    readonly: true,
  });
  try {
    const row = db
      .prepare(
        `select result.source_snapshot_json as sourceSnapshot,
                result.gross_amount as grossAmount,
                result.net_amount as netAmount
           from payroll_employee_results result
           join users employee
             on employee.id = result.user_id and employee.tenant_id = result.tenant_id
          where result.tenant_id = ? and employee.id = ?
          order by result.created_at desc, result.id desc
          limit 1`
      )
      .get(scenario.tenantId, scenario.worker.id) as
      { sourceSnapshot: string; grossAmount: number; netAmount: number } | undefined;
    expect(row).toBeDefined();
    const snapshot = JSON.parse(row!.sourceSnapshot) as {
      settlementReview: { ordinaryWorkedSeconds: number };
    };
    expect(snapshot.settlementReview.ordinaryWorkedSeconds).toBe(1);
    expect(row).toMatchObject({ grossAmount: 10, netAmount: 9.2 });
  } finally {
    db.close();
  }
  expect(tracker.getIssues()).toEqual([]);
});
