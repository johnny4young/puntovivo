import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { E2E_PASSWORD, ensureLanguage, type ClientIssueTracker } from '../web/support/app.js';
import { runAxeOnPage } from '../web/support/a11y.js';

/** Runtime-specific navigation while the payroll flow remains target-agnostic. */
interface PayrollJourneyTarget {
  singleFrameAxe?: boolean;
  navigate: (route: string) => Promise<void>;
  screenshot: (name: string) => Promise<void>;
}

export function assertPayrollJourneyDiagnostics(tracker: ClientIssueTracker) {
  expect(tracker.getIssues()).toEqual([]);
}

async function dismissVisibleToasts(page: Page) {
  const dismiss = page.locator('[role="status"] button[aria-label]');
  while ((await dismiss.count()) > 0) await dismiss.first().click();
}

/**
 * UI-only Colombia pre-payroll journey shared by Web and Electron.
 *
 * It deliberately creates every prerequisite through the product surface so the
 * evidence covers React -> tRPC -> Command Envelope -> SQLite -> reload.
 */
export async function runPayrollJourney(page: Page, target: PayrollJourneyTarget) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const worker = {
    name: `Payroll Worker ${suffix}`,
    email: `payroll.worker.${suffix}@example.test`,
    role: 'Cashier',
  };
  const employmentReason = `Reviewed monthly employment evidence ${suffix}`;
  const profileReason = `Reviewed Colombia contribution evidence ${suffix}`;
  const periodReason = `Reviewed October pre-payroll period ${suffix}`;
  const runReason = `Created regular pre-payroll run ${suffix}`;
  const employeeReason = `Reviewed employee settlement evidence ${suffix}`;
  const calculationReason = `Calculated authoritative pre-payroll revision ${suffix}`;

  await ensureLanguage(page, 'en');
  await target.navigate('/company');
  const advancedSettings = page.getByRole('button', { name: /^Advanced settings/ });
  if ((await advancedSettings.getAttribute('aria-expanded')) !== 'true') {
    await advancedSettings.click();
  }
  await page.getByRole('button', { name: 'Locale', exact: true }).click();
  await expect(page).toHaveURL(/\/company\?tab=locale$/);
  await page.getByTestId('locale-country-select').selectOption('CO');
  await page.getByRole('button', { name: 'Save locale', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Locale updated');
  await dismissVisibleToasts(page);

  await target.navigate('/users');
  await page.getByRole('button', { name: 'Add User', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Create User', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill(worker.name);
  await dialog.getByLabel('Email', { exact: true }).fill(worker.email);
  await dialog.getByLabel('Role', { exact: true }).selectOption({ label: worker.role });
  await dialog.getByLabel('Initial Password').fill(E2E_PASSWORD);
  await dialog.getByRole('button', { name: 'Create User', exact: true }).click();
  await expect(dialog).toBeHidden();

  await target.navigate('/schedule');
  await page.getByRole('button', { name: 'Employment and assignments', exact: true }).click();
  const employment = page.getByTestId('employment-panel');
  await employment.getByRole('button', { name: 'Add employment terms', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Add employment terms', exact: true });
  await dialog
    .getByRole('combobox', { name: 'Employee', exact: true })
    .selectOption({ label: `${worker.name} · ${worker.role}` });
  await dialog.getByLabel('Position', { exact: true }).fill('Payroll smoke cashier');
  await dialog.getByLabel('Effective from', { exact: true }).fill('2026-01-01');
  await dialog.getByRole('combobox', { name: 'Pay basis', exact: true }).selectOption('monthly');
  await dialog.getByRole('spinbutton', { name: /^Agreed amount/ }).fill('3500000');
  await dialog.getByLabel('Private reason and supporting context').fill(employmentReason);
  await dialog.getByRole('button', { name: 'Save terms', exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Pre-payroll', exact: true }).click();
  const payroll = page.getByTestId('payroll-panel');
  await expect(payroll.getByRole('heading', { name: 'Colombia pre-payroll' })).toBeVisible();
  await payroll.getByRole('button', { name: 'Employee profiles', exact: true }).click();
  await payroll.getByRole('button', { name: 'Create payroll profile', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Create payroll profile', exact: true });
  await dialog
    .getByRole('combobox', { name: 'Employee', exact: true })
    .selectOption({ label: `${worker.name} · ${worker.role}` });
  await dialog.getByLabel('Effective from', { exact: true }).fill('2026-01-01');
  await dialog.getByLabel('Identification number', { exact: true }).fill(`9${suffix}`);
  await dialog.getByLabel('Private review reason', { exact: true }).fill(profileReason);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(payroll).toContainText(worker.name);

  await payroll.getByRole('button', { name: 'Periods and runs', exact: true }).click();
  await payroll.getByRole('button', { name: 'Create period', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Create period', exact: true });
  await dialog.getByLabel('First covered date', { exact: true }).fill('2026-10-01');
  await dialog.getByLabel('Exclusive end date', { exact: true }).fill('2026-11-01');
  await dialog.getByLabel('Pay date', { exact: true }).fill('2026-11-05');
  await dialog.getByLabel('Private review reason', { exact: true }).fill(periodReason);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  await payroll.getByRole('button', { name: 'Open runs', exact: true }).click();
  await payroll.getByRole('button', { name: 'Create run', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Create run', exact: true });
  await dialog.getByLabel('Private review reason', { exact: true }).fill(runReason);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  await payroll.getByRole('button', { name: 'Calculate new revision', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Calculate immutable revision', exact: true });
  const authoritativeWorker = dialog.getByRole('checkbox', { name: new RegExp(worker.name) });
  await expect(authoritativeWorker).toBeChecked();
  await expect(authoritativeWorker).toBeDisabled();
  await dialog
    .getByRole('combobox', { name: 'Employee classification', exact: true })
    .selectOption('private_cst');
  await dialog
    .getByRole('combobox', { name: 'Employer contribution exemption', exact: true })
    .selectOption('does_not_apply');
  await dialog.getByLabel('Reviewed contribution base (COP)', { exact: true }).fill('3500000');
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
  await dialog.getByLabel('Employee review reason', { exact: true }).fill(employeeReason);
  await dialog
    .getByLabel(
      'I reviewed the effective policy, its sources and documented limitations for this whole period.',
      { exact: true }
    )
    .check();
  await dialog.getByLabel('Private review reason', { exact: true }).fill(calculationReason);
  await runAxeOnPage(page, { include: '[role="dialog"]', singleFrame: target.singleFrameAxe });
  await dialog.getByRole('button', { name: 'Calculate new revision', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(payroll).toContainText('Current revision 1');

  await payroll.getByRole('button', { name: 'View evidence', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Immutable pre-payroll evidence', exact: true });
  await expect(dialog).toContainText(worker.name);
  await expect(dialog).toContainText('COP 3,500,000.00');
  await expect(dialog).toContainText('COP 3,220,000.00');
  await runAxeOnPage(page, { include: '[role="dialog"]', singleFrame: target.singleFrameAxe });
  await target.screenshot('pre-payroll-evidence-en');
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();

  await page.reload();
  await page.getByRole('button', { name: 'Pre-payroll', exact: true }).click();
  await page.getByTestId('payroll-panel').getByRole('button', { name: 'Open runs' }).click();
  await expect(page.getByTestId('payroll-panel')).toContainText('Current revision 1');

  await ensureLanguage(page, 'es');
  await expect(page.getByRole('heading', { name: 'Pre-nómina Colombia' })).toBeVisible();
  await expect(page.getByTestId('payroll-panel')).toContainText('Versión de cálculo actual 1');
  await page.getByRole('button', { name: 'Ver evidencia', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Evidencia inmutable de pre-nómina', exact: true });
  await expect(dialog).toContainText('3.500.000,00 COP');
  await expect(dialog).toContainText('3.220.000,00 COP');
  await target.screenshot('pre-payroll-evidence-es');
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).last().click();

  return {
    worker,
    employmentReason,
    profileReason,
    periodReason,
    runReason,
    employeeReason,
    calculationReason,
  };
}
