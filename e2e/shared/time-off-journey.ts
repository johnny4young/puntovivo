import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { E2E_PASSWORD, ensureLanguage } from '../web/support/app.js';
import { runAxeOnPage } from '../web/support/a11y.js';

/** One operational UI workflow, shared by standalone web and embedded Electron. */
interface TimeOffJourneyTarget {
  singleFrameAxe?: boolean;
  navigate: (route: string) => Promise<void>;
  signInManager: (email: string) => Promise<void>;
  screenshot: (name: string) => Promise<void>;
}
export async function runTimeOffJourney(page: Page, target: TimeOffJourneyTarget) {
  const suffix = randomUUID().slice(0, 8),
    worker = `Absence Worker ${suffix}`;
  const managerEmail = `absence.manager.${suffix}@example.test`;
  await ensureLanguage(page, 'en');
  await target.navigate('/users');
  for (const person of [
    { name: worker, email: `absence.worker.${suffix}@example.test`, role: 'Viewer' },
    { name: `Absence Manager ${suffix}`, email: managerEmail, role: 'Manager' },
  ]) {
    await page.getByRole('button', { name: 'Add User', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create User', exact: true });
    await dialog.getByLabel('Name', { exact: true }).fill(person.name);
    await dialog.getByLabel('Email', { exact: true }).fill(person.email);
    await dialog.getByLabel('Role', { exact: true }).selectOption({ label: person.role });
    await dialog.getByLabel('Initial Password').fill(E2E_PASSWORD);
    await dialog.getByRole('button', { name: 'Create User', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('tr').filter({ hasText: person.email })).toBeVisible();
  }
  // A manager, not a fixture or admin-only endpoint, approves the viewer worker's request.
  await page.getByRole('button', { name: /open user menu/i }).click();
  const logout = page.waitForResponse(
    response => response.url().includes('/api/trpc/auth.logout') && response.status() === 200
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await logout;
  await expect(page).toHaveURL(/\/login$/);
  await target.signInManager(managerEmail);
  const managerRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/trpc/')) managerRequests.push(request.url());
  });
  await target.navigate('/schedule');
  await page.getByRole('button', { name: 'Absences', exact: true }).click();
  const panel = page.getByTestId('time-off-panel');
  await expect(panel.getByRole('heading', { name: 'Vacations, leave and absences' })).toBeVisible();
  await panel.getByRole('button', { name: 'Request absence' }).click();
  let dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Employee', exact: true })
    .selectOption({ label: `${worker} · Viewer` });
  await dialog.getByLabel('First day absent').fill('2026-09-07');
  await dialog.getByLabel('Return date (not included)').fill('2026-09-09');
  await dialog.getByLabel('Private operational reason').fill(`Private request ${suffix}`);
  await runAxeOnPage(page, { include: '[role="dialog"]', singleFrame: target.singleFrameAxe });
  await dialog.getByRole('button', { name: 'Confirm decision' }).click();
  await expect(dialog).toBeHidden();
  const row = panel.locator('li[data-testid]').filter({ hasText: worker });
  await expect(row).toContainText('Pending approval');
  const id = (await row.getAttribute('data-testid'))!.slice('time-off-'.length);
  await expect(row).toContainText('2026-09-07 → 2026-09-09');
  await row.getByRole('button', { name: 'Approve absence' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('none will be cancelled automatically');
  await dialog.getByLabel('Private operational reason').fill(`Private approval ${suffix}`);
  await dialog.getByRole('button', { name: 'Confirm decision' }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toContainText('Approved');
  await expect(row).toContainText('Version 2');
  await expect(row.getByRole('button', { name: 'Approve absence' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Cancel absence' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Private operational reason').fill(`Private cancellation ${suffix}`);
  await dialog.getByRole('button', { name: 'Confirm decision' }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toContainText('Cancelled');
  await expect(row).toContainText('Version 3');
  await row.getByRole('button', { name: 'Private history' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`Private request ${suffix}`);
  await expect(dialog).toContainText(`Private approval ${suffix}`);
  await expect(dialog).toContainText(`Private cancellation ${suffix}`);
  await expect(dialog.getByText(/^Approved by /)).toHaveCount(2);
  await target.screenshot('time-off-private-history');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await ensureLanguage(page, 'es');
  await page.reload();
  await page.getByRole('button', { name: 'Ausencias', exact: true }).click();
  await expect(
    panel.getByRole('heading', { name: 'Vacaciones, licencias y ausencias' })
  ).toBeVisible();
  await expect(row).toContainText('Cancelada');
  await expect(row).toContainText('Versión 3');
  await expect(row.getByRole('button', { name: 'Cancelar ausencia' })).toHaveCount(0);
  await runAxeOnPage(page, {
    include: '[data-testid="time-off-panel"]',
    singleFrame: target.singleFrameAxe,
  });
  await target.screenshot('time-off-manager-es');
  expect(managerRequests.some(url => url.includes('workforce.timeOff.employees'))).toBe(true);
  expect(managerRequests.some(url => url.includes('users.list'))).toBe(false);
  return { id, suffix };
}
