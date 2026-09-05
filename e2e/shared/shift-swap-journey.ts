import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { E2E_PASSWORD, ensureLanguage, type ClientIssueTracker } from '../web/support/app.js';
import { runAxeOnPage } from '../web/support/a11y.js';

interface ShiftSwapJourneyTarget {
  singleFrameAxe?: boolean;
  navigate: (route: string) => Promise<void>;
  signIn: (email: string) => Promise<void>;
  signInAdmin: () => Promise<void>;
  screenshot: (name: string) => Promise<void>;
}

export function assertShiftSwapJourneyDiagnostics(tracker: ClientIssueTracker) {
  expect(tracker.getIssues()).toEqual([]);
}

async function signOut(page: Page) {
  await page
    .getByRole('button', { name: /^(?:open user menu for|abre el menú de usuario de) /i })
    .click();
  const response = page.waitForResponse(
    candidate => candidate.url().includes('/api/trpc/auth.logout') && candidate.status() === 200
  );
  await page.getByRole('button', { name: /^(?:sign out|cerrar sesión)$/i }).click();
  await response;
  await expect(page).toHaveURL(/\/login$/);
}

/** One real three-actor exchange through identical web and embedded-Electron UI contracts. */
export async function runShiftSwapJourney(page: Page, target: ShiftSwapJourneyTarget) {
  const suffix = randomUUID().slice(0, 8);
  const requester = {
    name: `Swap Cashier ${suffix}`,
    email: `swap.cashier.${suffix}@example.test`,
    role: 'Cashier',
  };
  const recipient = {
    name: `Swap Viewer ${suffix}`,
    email: `swap.viewer.${suffix}@example.test`,
    role: 'Viewer',
  };
  const reason = `Private shift exchange ${suffix}`;
  await ensureLanguage(page, 'en');
  await target.navigate('/users');
  for (const person of [requester, recipient]) {
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

  await target.navigate('/schedule');
  await page.getByRole('button', { name: 'Add shift', exact: true }).first().click();
  let dialog = page.getByRole('dialog');
  const base = new Date(`${await dialog.getByLabel('Start date').inputValue()}T12:00:00.000Z`);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const dateAt = (offset: number) =>
    new Date(base.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const offeredDate = dateAt(14);
  const requestedDate = dateAt(15);

  async function createShift(person: typeof requester, date: string, notes: string) {
    await page.getByRole('button', { name: 'Add shift', exact: true }).first().click();
    const editor = page.getByRole('dialog');
    await editor
      .getByRole('combobox', { name: 'Employee', exact: true })
      .selectOption({ label: `${person.name} · ${person.role}` });
    await editor.getByLabel('Start date').fill(date);
    await editor.getByLabel('End date').fill(date);
    await editor.getByLabel('Start time').fill('09:00');
    await editor.getByLabel('End time').fill('17:00');
    await editor.getByLabel('Notes', { exact: true }).fill(notes);
    await editor.getByRole('button', { name: 'Save shift', exact: true }).click();
    await expect(editor).toBeHidden();
  }
  const offeredNotes = `Offered assignment ${suffix}`;
  const requestedNotes = `Requested assignment ${suffix}`;
  await createShift(requester, offeredDate, offeredNotes);
  await createShift(recipient, requestedDate, requestedNotes);

  await signOut(page);
  await target.signIn(requester.email);
  // Exercise the user-menu entry, not just the direct route.
  await page.getByRole('button', { name: /open user menu/i }).click();
  await page.getByRole('button', { name: 'My schedule and exchanges', exact: true }).click();
  await expect(page).toHaveURL(/\/my-schedule$/);
  await page.getByRole('button', { name: 'Request an exchange', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Request a shift exchange', exact: true });
  await dialog.locator('input[name="offered-shift"]').check();
  await dialog.getByRole('radio', { name: new RegExp(recipient.name) }).check();
  await dialog.getByLabel('Private operational reason').fill(reason);
  await expect(dialog.getByRole('button', { name: 'Send exact request' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /reviewed these exact two shifts/i }).check();
  await expect(dialog).toContainText('version 1');
  await runAxeOnPage(page, { include: '[role="dialog"]', singleFrame: target.singleFrameAxe });
  await target.screenshot('shift-swap-exact-request');
  await dialog.getByRole('button', { name: 'Send exact request' }).click();
  await expect(dialog).toBeHidden();
  const requesterRow = page
    .locator('[data-testid^="shift-swap-"]')
    .filter({ hasText: recipient.name });
  await expect(requesterRow).toContainText('Requested');
  await expect(requesterRow).not.toContainText(reason);

  await signOut(page);
  await target.signIn(recipient.email);
  await target.navigate('/my-schedule');
  await ensureLanguage(page, 'es');
  const recipientRow = page
    .locator('[data-testid^="shift-swap-"]')
    .filter({ hasText: requester.name });
  await expect(recipientRow).toContainText('Solicitado');
  await recipientRow.getByRole('button', { name: 'Aceptar intercambio exacto' }).click();
  dialog = page.getByRole('dialog', { name: 'Aceptar este intercambio exacto' });
  await expect(dialog.getByRole('button', { name: 'Confirmar aceptación' })).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await target.screenshot('shift-swap-recipient-consent-es');
  await dialog.getByRole('button', { name: 'Confirmar aceptación' }).click();
  await expect(dialog).toBeHidden();
  await expect(recipientRow).toContainText('Aceptado por el empleado');

  // Login boot honors the persisted preference; return to English before the admin login helper.
  await ensureLanguage(page, 'en');
  await signOut(page);
  await target.signInAdmin();
  await target.navigate('/schedule');
  await page.getByRole('button', { name: 'Shift exchanges', exact: true }).click();
  const managerRow = page
    .locator('[data-testid^="manager-shift-swap-"]')
    .filter({ hasText: requester.name });
  await expect(managerRow).toContainText('Accepted by employee');
  await managerRow.getByRole('button', { name: 'Approve exact exchange' }).click();
  dialog = page.getByRole('dialog', { name: 'Approve this exact exchange' });
  await expect(dialog).toContainText(requester.name);
  await expect(dialog).toContainText(recipient.name);
  await expect(dialog.getByRole('button', { name: 'Confirm approval' })).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await runAxeOnPage(page, { include: '[role="dialog"]', singleFrame: target.singleFrameAxe });
  await target.screenshot('shift-swap-manager-approval');
  await dialog.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(dialog).toBeHidden();
  await expect(managerRow).toHaveCount(0);

  await target.navigate('/audit-logs');
  await page
    .getByRole('combobox', { name: 'Action', exact: true })
    .selectOption('shift_swap.changed');
  await page
    .getByRole('combobox', { name: 'Resource type', exact: true })
    .selectOption('shift_swap');
  await expect(page.getByText('Approved · version 3', { exact: true })).toBeVisible();
  await expect(page.getByRole('main').first()).not.toContainText(reason);
  await target.screenshot('shift-swap-audit-safe');

  await signOut(page);
  await target.signIn(requester.email);
  await target.navigate('/my-schedule');
  await page.reload();
  await expect(page.getByText('Approved · version 3', { exact: true })).toBeVisible();
  await expect(page.getByTestId('my-schedule-page')).not.toContainText(reason);
  await runAxeOnPage(page, {
    include: '[data-testid="my-schedule-page"]',
    singleFrame: target.singleFrameAxe,
  });
  await target.screenshot('shift-swap-approved-after-reload');
  return {
    suffix,
    requester,
    recipient,
    reason,
    offeredDate,
    requestedDate,
    offeredNotes,
    requestedNotes,
  };
}
