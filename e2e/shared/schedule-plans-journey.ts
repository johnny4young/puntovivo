import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { E2E_PASSWORD, ensureLanguage, type ClientIssueTracker } from '../web/support/app.js';
import { runAxeOnPage } from '../web/support/a11y.js';

/** The same manager decisions against standalone HTTP and the embedded Electron backend. */
interface SchedulePlansJourneyTarget {
  singleFrameAxe?: boolean;
  navigate: (route: string) => Promise<void>;
  signInManager: (email: string) => Promise<void>;
  /** Optional follow-on actor journey; Electron qualifies admin audit separately at the default HTTP cap. */
  signInAdmin?: () => Promise<void>;
  screenshot: (name: string) => Promise<void>;
}

/** Permit only the single intentionally rejected publication, not arbitrary console errors. */
export function assertSchedulePlansDiagnostics(tracker: ClientIssueTracker, conflictUrl: string) {
  const response = `response:409 ${conflictUrl}`;
  const console =
    'console:Failed to load resource: the server responded with a status of 409 (Conflict)';
  const issues = tracker.getIssues();
  expect(issues.filter(issue => issue === response)).toHaveLength(1);
  expect(issues.filter(issue => issue === console).length).toBeLessThanOrEqual(1);
  expect(issues.filter(issue => issue !== response && issue !== console)).toEqual([]);
}

export async function runSchedulePlansJourney(page: Page, target: SchedulePlansJourneyTarget) {
  const suffix = randomUUID().slice(0, 8);
  const worker = `Plan Worker ${suffix}`,
    title = `Weekly plan ${suffix}`;
  const managerEmail = `plan.manager.${suffix}@example.test`;
  await ensureLanguage(page, 'en');
  await target.navigate('/users');
  for (const person of [
    { name: worker, email: `plan.worker.${suffix}@example.test`, role: 'Viewer' },
    { name: `Plan Manager ${suffix}`, email: managerEmail, role: 'Manager' },
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
    r => r.url().includes('/api/trpc/auth.logout') && r.status() === 200
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
  // Derive dates from the actual business calendar, not the host's time zone.
  await page.getByRole('button', { name: 'Add shift', exact: true }).first().click();
  let dialog = page.getByRole('dialog');
  const boundary = new Date(`${await dialog.getByLabel('Start date').inputValue()}T12:00:00Z`);
  const monday = new Date(boundary.getTime() + ((8 - boundary.getUTCDay()) % 7) * 86_400_000);
  const fromDate = monday.toISOString().slice(0, 10);
  const untilDate = new Date(monday.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Recurring plans', exact: true }).click();
  const panel = page.getByTestId('schedule-plans-panel');
  await expect(panel.getByRole('heading', { name: 'Recurring schedule plans' })).toBeVisible();

  async function createDraft(name: string) {
    await panel.getByRole('button', { name: 'Create recurring draft' }).click();
    const editor = page.getByRole('dialog', { name: 'Create recurring draft', exact: true });
    await editor.getByLabel('Plan name').fill(name);
    await editor.getByLabel('First starting date').fill(fromDate);
    await editor.getByLabel('Exclusive last starting date').fill(untilDate);
    await editor.getByLabel('Reference Monday').fill(fromDate);
    await editor.getByRole('button', { name: 'Add recurrence rule' }).click();
    await editor
      .getByRole('combobox', { name: 'Employee', exact: true })
      .selectOption({ label: `${worker} · Viewer` });
    await editor.getByLabel('Monday', { exact: true }).check();
    await editor.getByLabel('Tuesday', { exact: true }).check();
    await editor.getByLabel('Operational notes (optional)').fill(`Private plan notes ${suffix}`);
    await runAxeOnPage(page, { include: '[role="dialog"]', singleFrame: target.singleFrameAxe });
    await editor.getByRole('button', { name: 'Save and preview draft' }).click();
    const preview = page.getByRole('dialog', { name: 'Review plan', exact: true });
    await expect(preview).toContainText(name);
    await expect(preview).toContainText('Version 1');
    await expect(preview.getByTestId('plan-occurrence')).toHaveCount(2);
    await expect(preview.getByText('Not an operational shift', { exact: true })).toHaveCount(2);
    return preview;
  }

  dialog = await createDraft(title);
  await target.screenshot('schedule-plan-draft-preview');
  await dialog.getByRole('button', { name: 'Regenerate draft' }).click();
  dialog = page.getByRole('dialog', { name: 'Regenerate draft', exact: true });
  await expect(dialog.getByLabel('Plan name')).toHaveValue(title);
  await dialog.getByLabel('End time', { exact: true }).fill('16:00');
  await dialog.getByLabel('Private operational reason').fill(`Private regeneration ${suffix}`);
  await dialog.getByRole('button', { name: 'Save and preview draft' }).click();
  dialog = page.getByRole('dialog', { name: 'Review plan', exact: true });
  await expect(dialog).toContainText('Version 2');
  await expect(dialog.getByTestId('plan-occurrence').first()).toContainText('16:00');
  await dialog.getByRole('button', { name: 'Publish shifts', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Publish shifts', exact: true });
  await expect(dialog.getByRole('button', { name: 'Confirm publication' })).toBeDisabled();
  await dialog.getByLabel('I reviewed this plan and want to publish all its shifts.').check();
  await dialog.getByRole('button', { name: 'Confirm publication' }).click();
  await expect(dialog).toBeHidden();
  dialog = page.getByRole('dialog', { name: 'Review plan', exact: true });
  await expect(dialog).toContainText('Version 3');
  await expect(
    dialog.getByText('Linked to a published operational shift', { exact: true })
  ).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const published = panel.locator('li[data-testid]').filter({ hasText: title });
  await expect(published).toContainText('Published');
  await expect(published).toContainText('Version 3');
  const id = (await published.getAttribute('data-testid'))!.slice('schedule-plan-'.length);
  await page.getByRole('button', { name: 'Schedule and attendance', exact: true }).click();
  const shifts = page
    .locator('[data-testid^="scheduled-shift-"]')
    .filter({ hasText: `Private plan notes ${suffix}` });
  await expect(shifts).toHaveCount(2);
  await page.reload();
  await expect(shifts).toHaveCount(2);
  await page.getByRole('button', { name: 'Recurring plans', exact: true }).click();
  await page
    .getByTestId(`schedule-plan-${id}`)
    .getByRole('button', { name: 'Review plan' })
    .click();
  dialog = page.getByRole('dialog');
  await expect(
    dialog.getByText('Linked to a published operational shift', { exact: true })
  ).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: 'Publish shifts', exact: true })).toHaveCount(0);
  await target.screenshot('schedule-plan-published-reloaded');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  const duplicateTitle = `Conflicting plan ${suffix}`;
  dialog = await createDraft(duplicateTitle);
  await dialog.getByRole('button', { name: 'Publish shifts', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Publish shifts', exact: true });
  await dialog.getByLabel('I reviewed this plan and want to publish all its shifts.').check();
  const conflict = page.waitForResponse(
    r => r.url().includes('/api/trpc/workforce.schedulePlans.publish') && r.status() === 409
  );
  await dialog.getByRole('button', { name: 'Confirm publication' }).click();
  const rejected = await conflict;
  expect(await rejected.text()).toContain('SCHEDULE_SHIFT_OVERLAP');
  await expect(dialog.getByRole('alert')).toHaveText(
    'This employee already has a shift in that time window.'
  );
  await expect(dialog).toContainText('Version 1');
  await target.screenshot('schedule-plan-overlap-rejected');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const conflicting = panel.locator('li[data-testid]').filter({ hasText: duplicateTitle });
  await expect(conflicting).toContainText('Draft');
  const discardedId = (await conflicting.getAttribute('data-testid'))!.slice(
    'schedule-plan-'.length
  );
  await conflicting.getByRole('button', { name: 'Review plan' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Not an operational shift', { exact: true })).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Discard draft', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Discard draft', exact: true });
  await expect(dialog.getByRole('button', { name: 'Confirm discard' })).toBeDisabled();
  await dialog.getByLabel('Private operational reason').fill(`Private discard ${suffix}`);
  await dialog.getByRole('button', { name: 'Confirm discard' }).click();
  await expect(dialog).toBeHidden();
  dialog = page.getByRole('dialog', { name: 'Review plan', exact: true });
  await expect(dialog).toContainText('Discarded');
  await expect(dialog.getByRole('button', { name: 'Publish shifts', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(conflicting).toContainText('Discarded');
  await expect(conflicting).toContainText('Version 2');
  await ensureLanguage(page, 'es');
  await page.reload();
  await page.getByRole('button', { name: 'Planes recurrentes', exact: true }).click();
  await expect(
    panel.getByRole('heading', { name: 'Planes de horarios recurrentes' })
  ).toBeVisible();
  await expect(page.getByTestId(`schedule-plan-${discardedId}`)).toContainText('Descartado');
  await page
    .getByTestId(`schedule-plan-${id}`)
    .getByRole('button', { name: 'Revisar plan' })
    .click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Versión 3');
  await expect(
    dialog.getByText('Vinculado a un turno operativo publicado', { exact: true })
  ).toHaveCount(2);
  await runAxeOnPage(page, { include: '[role="dialog"]', singleFrame: target.singleFrameAxe });
  await target.screenshot('schedule-plan-published-es');
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  expect(managerRequests.some(url => url.includes('workforce.schedulePlans.employees'))).toBe(true);
  expect(managerRequests.some(url => url.includes('users.list'))).toBe(false);
  if (target.signInAdmin) await runSchedulePlansAdminAudit(page, target, suffix);
  return { id, discardedId, suffix, fromDate, untilDate, conflictUrl: rejected.url() };
}

/** Private notes stay out of the generic administrator audit, including after locale reload. */
export async function runSchedulePlansAdminAudit(
  page: Page,
  target: Pick<SchedulePlansJourneyTarget, 'navigate' | 'screenshot' | 'signInAdmin'>,
  suffix: string
) {
  // Generic audit remains administrator-only and never reveals private schedule notes/reasons.
  await ensureLanguage(page, 'en');
  if (target.signInAdmin) {
    await page.getByRole('button', { name: /open user menu/i }).click();
    const adminLogout = page.waitForResponse(
      r => r.url().includes('/api/trpc/auth.logout') && r.status() === 200
    );
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await adminLogout;
    await expect(page).toHaveURL(/\/login$/);
    await target.signInAdmin();
  }
  await target.navigate('/audit-logs');
  await page
    .getByRole('combobox', { name: 'Action', exact: true })
    .selectOption({ label: 'Schedule plan decision recorded' });
  await page
    .getByRole('combobox', { name: 'Resource type', exact: true })
    .selectOption({ label: 'Schedule plan' });
  await expect(page.getByText('Published · 2 shifts · version 3', { exact: true })).toBeVisible();
  await expect(page.getByText('Discarded · 2 shifts · version 2', { exact: true })).toBeVisible();
  await expect(page.locator('main')).not.toContainText(`Private plan notes ${suffix}`);
  await expect(page.locator('main')).not.toContainText(`Private regeneration ${suffix}`);
  await expect(page.locator('main')).not.toContainText(`Private discard ${suffix}`);
  await target.screenshot('schedule-plan-audit-en');
  await ensureLanguage(page, 'es');
  await page.reload();
  await page
    .getByRole('combobox', { name: 'Acción', exact: true })
    .selectOption('schedule_plan.changed');
  await page
    .getByRole('combobox', { name: 'Tipo de recurso', exact: true })
    .selectOption('schedule_plan');
  await expect(page.getByText('Publicado · 2 turnos · versión 3', { exact: true })).toBeVisible();
  await expect(page.getByText('Descartado · 2 turnos · versión 2', { exact: true })).toBeVisible();
  await target.screenshot('schedule-plan-audit-es');
}
