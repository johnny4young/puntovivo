import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { E2E_PASSWORD, ensureLanguage } from '../web/support/app.js';
import { runAxeOnPage } from '../web/support/a11y.js';

/** Target navigation differs for web/history and packaged Electron/hash; all mutations remain UI-driven. */
interface EmploymentJourneyTarget {
  singleFrameAxe?: boolean;
  navigate: (route: string) => Promise<void>;
  signInManager: (email: string) => Promise<void>;
  screenshot: (name: string) => Promise<void>;
}

/** Same employment lifecycle on both runtimes; never inserts employment evidence through fixtures. */
export async function runEmploymentJourney(page: Page, target: EmploymentJourneyTarget) {
  const suffix = randomUUID().slice(0, 8);
  const workerName = `Employment Worker ${suffix}`;
  const managerEmail = `workforce.manager.${suffix}@example.test`;
  const workerEmail = `workforce.worker.${suffix}@example.test`;
  await ensureLanguage(page, 'en');
  await target.navigate('/users');
  for (const person of [
    { name: workerName, email: workerEmail, role: 'Viewer' },
    { name: `Employment Manager ${suffix}`, email: managerEmail, role: 'Manager' },
  ]) {
    await page.getByRole('button', { name: 'Add User', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create User', exact: true });
    // Consecutive creation must not retain the previous user's initial password or identity.
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('');
    await expect(dialog.getByLabel('Email', { exact: true })).toHaveValue('');
    await expect(dialog.getByLabel('Initial Password')).toHaveValue('');
    await expect(dialog.getByLabel('Role', { exact: true })).toHaveValue('cashier');
    await dialog.getByLabel('Name', { exact: true }).fill(person.name);
    await dialog.getByLabel('Email', { exact: true }).fill(person.email);
    await dialog.getByLabel('Role', { exact: true }).selectOption({ label: person.role });
    await dialog.getByLabel('Initial Password').fill(E2E_PASSWORD);
    await dialog.getByRole('button', { name: 'Create User', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('tr').filter({ hasText: person.email })).toBeVisible();
  }

  await target.navigate('/schedule');
  await page.getByRole('button', { name: 'Employment and assignments', exact: true }).click();
  const panel = page.getByTestId('employment-panel');
  await panel.getByRole('button', { name: 'Add employment terms' }).click();
  let dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Employee', exact: true })
    .selectOption({ label: `${workerName} · Viewer` });
  await dialog.getByLabel('Position', { exact: true }).fill(`Original position ${suffix}`);
  await dialog.getByLabel('Effective from', { exact: true }).fill('2026-09-04');
  await dialog.getByLabel(/^First day no longer effective/).fill('2027-01-01');
  await dialog.getByLabel('Pay basis').selectOption('monthly');
  await dialog.getByRole('spinbutton', { name: /^Agreed amount/ }).fill('1900000.67');
  await dialog
    .getByLabel('Private reason and supporting context')
    .fill(`Private original evidence ${suffix}`);
  await runAxeOnPage(page, { include: '[role="dialog"]', singleFrame: target.singleFrameAxe });
  await dialog.getByRole('button', { name: 'Save terms', exact: true }).click();
  await expect(dialog).toBeHidden();
  const original = panel
    .locator('li[data-testid]')
    .filter({ hasText: `Original position ${suffix}` });
  await expect(original).toContainText('1,900,000.67');
  await expect(original).toContainText('Operational hourly cost unknown — not treated as zero');
  const originalId = (await original.getAttribute('data-testid'))!.slice('employment-'.length);

  await original.getByRole('button', { name: 'Change terms from a date' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: 'Employee', exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel(/^First day no longer effective/)).toBeDisabled();
  await expect(dialog.getByLabel(/^First day no longer effective/)).toHaveValue('2027-01-01');
  await dialog.getByLabel('Position', { exact: true }).fill(`Revised position ${suffix}`);
  await dialog.getByLabel('Effective from', { exact: true }).fill('2026-10-01');
  await dialog.getByRole('spinbutton', { name: /^Agreed amount/ }).fill('2100000.99');
  await dialog.getByRole('spinbutton', { name: /^Operational hourly cost/ }).fill('12500.25');
  await dialog
    .getByLabel('Private reason and supporting context')
    .fill(`Private replacement evidence ${suffix}`);
  await dialog.getByRole('button', { name: 'Save terms', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(original).toContainText('2026-09-04 → 2026-10-01');
  await expect(original).toContainText('1,900,000.67');
  const revised = panel
    .locator('li[data-testid]')
    .filter({ hasText: `Revised position ${suffix}` });
  await expect(revised).toContainText('2,100,000.99');
  const revisedId = (await revised.getAttribute('data-testid'))!.slice('employment-'.length);
  await revised.getByRole('button', { name: 'End terms', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^First day no longer effective/).fill('2026-12-01');
  await dialog
    .getByLabel('Private reason and supporting context')
    .fill(`Private ending evidence ${suffix}`);
  await dialog.getByRole('button', { name: 'Save terms', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(revised).toContainText('2026-10-01 → 2026-12-01');
  await revised.getByRole('button', { name: 'Private history' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`Private ending evidence ${suffix}`);
  await dialog.getByText('Before change', { exact: true }).click();
  const before = dialog.locator('details').filter({ hasText: 'Before change' });
  await expect(before).toContainText('2027-01-01');
  await expect(before).toContainText('2,100,000.99');
  await expect(before).toContainText('12,500.25');
  await target.screenshot('employment-private-history');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  await original.getByRole('button', { name: 'Void incorrect terms' }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Private reason and supporting context')
    .fill(`Private void evidence ${suffix}`);
  await dialog.getByRole('button', { name: 'Save terms', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(original).toHaveCount(0);
  await panel.getByRole('checkbox', { name: 'Include voided records' }).check();
  await expect(original).toContainText('Voided record');
  await expect(original.getByRole('button', { name: 'End terms', exact: true })).toHaveCount(0);

  await ensureLanguage(page, 'es');
  await expect(panel).toContainText('Condiciones laborales y asignaciones');
  await expect(revised).toContainText('2.100.000,99');
  await target.screenshot('employment-admin-es');
  await page.reload();
  await page
    .getByRole('button', { name: 'Condiciones laborales y asignaciones', exact: true })
    .click();
  await expect(revised).toContainText('2.100.000,99');
  await expect(revised).toContainText('2026-12-01');
  await expect(original).toHaveCount(0);
  await ensureLanguage(page, 'en');
  await page.getByRole('button', { name: /open user menu/i }).click();
  const loggedOut = page.waitForResponse(
    response => response.url().includes('/api/trpc/auth.logout') && response.status() === 200
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await loggedOut;
  await expect(page).toHaveURL(/\/login$/);
  await target.signInManager(managerEmail);
  const managerRequests: string[] = [];
  const recordRequest = (request: import('@playwright/test').Request) => {
    if (request.url().includes('/api/trpc/')) managerRequests.push(request.url());
  };
  page.on('request', recordRequest);
  try {
    await target.navigate('/schedule');
    await page.getByRole('button', { name: 'Employment and assignments', exact: true }).click();
    await expect(revised).toContainText(workerName);
    await expect(revised).not.toContainText('2,100,000');
    await expect(panel).not.toContainText(`Private ending evidence ${suffix}`);
    await expect(panel.getByRole('button', { name: 'Private history' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Add employment terms' })).toHaveCount(0);
    await panel.getByLabel('Effective on date (optional)').fill('2026-12-01');
    await expect(revised).toHaveCount(0);
    await panel.getByLabel('Effective on date (optional)').fill('2026-10-01');
    await expect(revised).toBeVisible();
    await expect(original).toHaveCount(0);
    await target.screenshot('employment-manager');
    await runAxeOnPage(page, {
      include: '[data-testid="employment-panel"]',
      singleFrame: target.singleFrameAxe,
    });
    expect(managerRequests.some(url => url.includes('workforce.assignments'))).toBe(true);
    expect(managerRequests.some(url => url.includes('workforce.contracts'))).toBe(false);
  } finally {
    page.off('request', recordRequest);
  }
  // Employment eligibility does not grant application access. A manager can
  // schedule the viewer worker using the ordinary, now-transactional workflow.
  const scheduleView = page.getByRole('button', { name: 'Schedule and attendance', exact: true });
  await scheduleView.click();
  await expect(scheduleView).toHaveAttribute('aria-pressed', 'true');
  await expect(scheduleView).toHaveClass(/btn-primary/);
  await page.getByRole('button', { name: 'Add shift', exact: true }).first().click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Employee', exact: true })
    .selectOption({ label: `${workerName} · Viewer` });
  await dialog.getByLabel('Start time', { exact: true }).fill('08:00');
  await dialog.getByLabel('End time', { exact: true }).fill('16:00');
  await dialog.getByLabel('Notes', { exact: true }).fill(`Viewer coverage ${suffix}`);
  await dialog.getByRole('button', { name: 'Save shift', exact: true }).click();
  await expect(dialog).toBeHidden();
  const shift = page.locator('[data-testid^="scheduled-shift-"]').filter({ hasText: workerName });
  await expect(shift).toContainText(`Viewer coverage ${suffix}`);
  const scheduleId = (await shift.getAttribute('data-testid'))!.slice('scheduled-shift-'.length);
  await shift.getByRole('button', { name: `Edit ${workerName} shift on ` }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('End time', { exact: true }).fill('17:00');
  await dialog.getByLabel('Notes', { exact: true }).fill(`Updated viewer coverage ${suffix}`);
  await dialog.getByRole('button', { name: 'Save shift', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(shift).toContainText(`Updated viewer coverage ${suffix}`);
  await shift.getByRole('button', { name: `Cancel ${workerName} shift on ` }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Cancel shift', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(shift).toHaveCount(0);
  await ensureLanguage(page, 'es');
  await page.reload();
  await page.getByLabel('Mostrar turnos cancelados', { exact: true }).check();
  await expect(shift).toContainText('Cancelado');
  await expect(shift).toContainText(`Updated viewer coverage ${suffix}`);
  await target.screenshot('viewer-schedule-cancelled-es');
  await runAxeOnPage(page, {
    include: '[data-testid="team-schedule-page"]',
    singleFrame: target.singleFrameAxe,
  });
  return { originalId, revisedId, workerEmail, scheduleId };
}
