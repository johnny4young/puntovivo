import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { E2E_PASSWORD, ensureLanguage, type ClientIssueTracker } from '../web/support/app.js';
import { runAxeOnPage } from '../web/support/a11y.js';

/** Identical policy and schedule decisions through the UI on standalone and embedded targets. */
interface AvailabilityJourneyTarget {
  singleFrameAxe?: boolean;
  navigate: (route: string) => Promise<void>;
  signInManager: (email: string) => Promise<void>;
  screenshot: (name: string) => Promise<void>;
}
/** Exactly one intentional schedule conflict is allowed; other diagnostics still fail the journey. */
export function assertAvailabilityJourneyDiagnostics(
  tracker: ClientIssueTracker,
  conflictUrl: string
) {
  const response = `response:409 ${conflictUrl}`;
  const console =
    'console:Failed to load resource: the server responded with a status of 409 (Conflict)';
  const issues = tracker.getIssues();
  expect(issues.filter(issue => issue === response)).toHaveLength(1);
  expect(issues.filter(issue => issue === console).length).toBeLessThanOrEqual(1);
  expect(issues.filter(issue => issue !== response && issue !== console)).toEqual([]);
}
export async function runAvailabilityJourney(page: Page, target: AvailabilityJourneyTarget) {
  const suffix = randomUUID().slice(0, 8),
    worker = `Availability Worker ${suffix}`;
  const managerEmail = `availability.manager.${suffix}@example.test`;
  await ensureLanguage(page, 'en');
  await target.navigate('/users');
  for (const person of [
    { name: worker, email: `availability.worker.${suffix}@example.test`, role: 'Viewer' },
    { name: `Availability Manager ${suffix}`, email: managerEmail, role: 'Manager' },
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
  // Read the actual business-week boundary from the form. Electron's US fixture
  // starts Sunday in New York; the Colombian web tenant starts Monday in Bogota.
  await page.getByRole('button', { name: 'Add shift', exact: true }).first().click();
  const weekDialog = page.getByRole('dialog');
  const fromDate = await weekDialog.getByLabel('Start date').inputValue();
  await weekDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(weekDialog).toBeHidden();
  const weekStart = new Date(`${fromDate}T12:00:00Z`);
  const day = (offset: number) =>
    new Date(weekStart.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const sundayOffset = (7 - weekStart.getUTCDay()) % 7;
  const untilDate = day(21),
    replacementDate = day(14);
  await page.getByRole('button', { name: 'Availability', exact: true }).click();
  const panel = page.getByTestId('availability-panel');
  await expect(
    panel.getByRole('heading', { name: 'Recurring employee availability' })
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Set availability' }).click();
  let dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Employee', exact: true })
    .selectOption({ label: `${worker} · Viewer` });
  await dialog.getByLabel('Effective from').fill(fromDate);
  await dialog.getByLabel('Exclusive end date (optional)').fill(untilDate);
  await dialog.getByRole('button', { name: 'Add weekly window' }).click();
  await dialog.getByRole('combobox', { name: 'Day', exact: true }).selectOption('7');
  await dialog.getByLabel('Start time').fill('22:00');
  await dialog.getByLabel('End time').fill('02:00');
  await dialog.getByLabel('Ends on the following day (up to 24 hours)').check();
  await dialog.getByLabel('Private operational reason').fill(`Private availability ${suffix}`);
  await runAxeOnPage(page, { include: '[role="dialog"]', singleFrame: target.singleFrameAxe });
  await target.screenshot('availability-overnight-editor');
  await dialog.getByRole('button', { name: 'Confirm availability decision' }).click();
  await expect(dialog).toBeHidden();
  const original = panel.locator('li[data-testid]').filter({ hasText: worker });
  await expect(original).toContainText('Sunday · 22:00–24:00');
  await expect(original).toContainText('Monday · 00:00–02:00');
  const id = (await original.getAttribute('data-testid'))!.slice('availability-'.length);

  await page.getByRole('button', { name: 'Schedule and attendance', exact: true }).click();
  await page.getByRole('button', { name: 'Add shift', exact: true }).first().click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Employee', exact: true })
    .selectOption({ label: `${worker} · Viewer` });
  await dialog.getByLabel('Start date').fill(day(sundayOffset));
  await dialog.getByLabel('End date').fill(day(sundayOffset + 1));
  await dialog.getByLabel('Start time').fill('21:00');
  await dialog.getByLabel('End time').fill('02:00');
  await dialog.getByLabel('Notes', { exact: true }).fill(`Available overnight ${suffix}`);
  const conflict = page.waitForResponse(
    response =>
      response.url().includes('/api/trpc/employeeShifts.schedule.create') &&
      response.status() === 409
  );
  await dialog.getByRole('button', { name: 'Save shift', exact: true }).click();
  const rejected = await conflict;
  expect(await rejected.text()).toContain('SCHEDULE_AVAILABILITY_CONFLICT');
  await expect(
    dialog
      .getByRole('alert')
      .getByText(
        'This shift falls outside the employee’s configured availability, possibly at another site. Review the schedule and availability.',
        { exact: true }
      )
  ).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Start time').fill('22:00');
  await dialog.getByRole('button', { name: 'Save shift', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page
      .locator('[data-testid^="scheduled-shift-"]')
      .filter({ hasText: `Available overnight ${suffix}` })
  ).toBeVisible();

  await page.getByRole('button', { name: 'Availability', exact: true }).click();
  const originalRow = page.getByTestId(`availability-${id}`);
  await originalRow.getByRole('button', { name: 'Change from a date' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Exclusive end date (optional)')).toHaveCount(0);
  await expect(dialog.getByLabel('End time').nth(1)).toHaveValue('00:00');
  await dialog.getByLabel('Effective from').fill(replacementDate);
  await dialog.getByRole('button', { name: 'Add weekly window' }).click();
  const newWindow = dialog.getByRole('group', { name: 'Window 3', exact: true });
  await newWindow.getByRole('combobox', { name: 'Day', exact: true }).selectOption('2');
  await dialog.getByLabel('Private operational reason').fill(`Private replacement ${suffix}`);
  await dialog.getByRole('button', { name: 'Confirm availability decision' }).click();
  await expect(dialog).toBeHidden();
  await expect(originalRow).toContainText(`${fromDate} → ${replacementDate}`);
  await expect(originalRow).toContainText('Version 2');
  const successor = panel
    .locator('li[data-testid]')
    .filter({ hasText: 'Effective successor to a previous policy.' });
  await expect(successor).toContainText(`${replacementDate} → ${untilDate}`);
  await expect(successor).toContainText('Tuesday · 09:00–17:00');
  const successorId = (await successor.getAttribute('data-testid'))!.slice('availability-'.length);
  await successor.getByRole('button', { name: 'Void availability' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Private operational reason').fill(`Private void ${suffix}`);
  await dialog.getByRole('button', { name: 'Confirm availability decision' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId(`availability-${successorId}`)).toHaveCount(0);
  await panel.getByLabel('Include voided policies').check();
  const voided = page.getByTestId(`availability-${successorId}`);
  await expect(voided).toContainText('Voided');
  await expect(voided).toContainText('Version 2');
  await voided.getByRole('button', { name: 'Private history' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`Private replacement ${suffix}`);
  await expect(dialog).toContainText(`Private void ${suffix}`);
  await expect(dialog).toContainText('Before this decision');
  await target.screenshot('availability-private-history');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await ensureLanguage(page, 'es');
  await page.reload();
  await page.getByRole('button', { name: 'Disponibilidad', exact: true }).click();
  await panel.getByLabel('Incluir políticas anuladas').check();
  await expect(
    panel.getByRole('heading', { name: 'Disponibilidad recurrente del equipo' })
  ).toBeVisible();
  await expect(voided).toContainText('Anulada');
  await expect(voided).toContainText('Versión 2');
  await expect(voided.getByRole('button', { name: 'Anular disponibilidad' })).toHaveCount(0);
  await runAxeOnPage(page, {
    include: '[data-testid="availability-panel"]',
    singleFrame: target.singleFrameAxe,
  });
  await target.screenshot('availability-manager-es');
  await voided.getByRole('button', { name: 'Historial privado' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`Private replacement ${suffix}`);
  await expect(dialog).toContainText(`Private void ${suffix}`);
  await expect(dialog).toContainText('Antes de esta decisión');
  await expect(dialog).toContainText('Después de esta decisión');
  await expect(dialog.getByText('Domingo · 22:00–24:00', { exact: true })).toHaveCount(3);
  await expect(dialog.getByText('Lunes · 00:00–02:00', { exact: true })).toHaveCount(3);
  await expect(dialog.getByText('Martes · 09:00–17:00', { exact: true })).toHaveCount(3);
  await expect(dialog).toContainText(`${replacementDate} → ${untilDate}`);
  await target.screenshot('availability-private-history-reloaded-es');
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  expect(managerRequests.some(url => url.includes('workforce.availability.employees'))).toBe(true);
  expect(managerRequests.some(url => url.includes('users.list'))).toBe(false);
  return {
    id,
    successorId,
    suffix,
    fromDate,
    untilDate,
    replacementDate,
    conflictUrl: rejected.url(),
  };
}
