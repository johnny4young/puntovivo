import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { E2E_PASSWORD, ensureLanguage, type ClientIssueTracker } from '../web/support/app.js';
import { runAxeOnPage } from '../web/support/a11y.js';

/** Runtime-specific navigation and actor login while the business flow stays target-agnostic. */
interface AttendanceReconciliationJourneyTarget {
  singleFrameAxe?: boolean;
  navigate: (route: string) => Promise<void>;
  signIn: (email: string) => Promise<void>;
  signInAdmin: () => Promise<void>;
  signInManager: (email: string) => Promise<void>;
  screenshot: (name: string) => Promise<void>;
}

export function assertAttendanceReconciliationJourneyDiagnostics(tracker: ClientIssueTracker) {
  expect(tracker.getIssues()).toEqual([]);
}

function bogotaDate(offsetDays = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const date = new Date(`${today}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function dismissToasts(page: Page) {
  const buttons = page.locator('[role="status"] button[aria-label]');
  while ((await buttons.count()) > 0) await buttons.first().click();
}

async function signOut(page: Page) {
  await dismissToasts(page);
  const menu = page.locator('#header-user-menu');
  if (!(await menu.isVisible())) {
    await page
      .getByRole('button', { name: /^(?:open user menu for|abre el menú de usuario de) /i })
      .click();
  }
  const response = page.waitForResponse(
    candidate => candidate.url().includes('/api/trpc/auth.logout') && candidate.status() === 200
  );
  await menu.getByRole('button', { name: /^(?:sign out|cerrar sesión)$/i }).click();
  await response;
  await expect(page).toHaveURL(/\/login$/);
}

/** UI-only employee, contract, plan, clock and decision lifecycle shared by web and Electron. */
export async function runAttendanceReconciliationJourney(
  page: Page,
  target: AttendanceReconciliationJourneyTarget
) {
  const suffix = randomUUID().slice(0, 8);
  const attended = {
    name: `Attendance Worker ${suffix}`,
    email: `attendance.worker.${suffix}@example.test`,
    role: 'Cashier',
  };
  const absent = {
    name: `No Show Worker ${suffix}`,
    email: `attendance.absent.${suffix}@example.test`,
    role: 'Cashier',
  };
  const manager = {
    name: `Attendance Manager ${suffix}`,
    email: `attendance.manager.${suffix}@example.test`,
    role: 'Manager',
  };
  const today = bogotaDate();
  const previousWeekDate = bogotaDate(-7);
  const attendedReason = `Reviewed signed attendance evidence ${suffix}`;
  const noShowReason = `No clock evidence after supervisor review ${suffix}`;

  await ensureLanguage(page, 'en');
  await target.navigate('/users');
  for (const person of [attended, absent, manager]) {
    await page.getByRole('button', { name: 'Add User', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create User', exact: true });
    await dialog.getByLabel('Name', { exact: true }).fill(person.name);
    await dialog.getByLabel('Email', { exact: true }).fill(person.email);
    await dialog.getByLabel('Role', { exact: true }).selectOption({ label: person.role });
    await dialog.getByLabel('Initial Password').fill(E2E_PASSWORD);
    await dialog.getByRole('button', { name: 'Create User', exact: true }).click();
    await expect(dialog).toBeHidden();
  }

  await target.navigate('/schedule');
  await page.getByRole('button', { name: 'Employment and assignments', exact: true }).click();
  const employment = page.getByTestId('employment-panel');
  await employment.getByRole('button', { name: 'Add employment terms' }).click();
  let dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Employee', exact: true })
    .selectOption({ label: `${attended.name} · Cashier` });
  await dialog.getByLabel('Position', { exact: true }).fill('Reconciliation cashier');
  await dialog.getByLabel('Effective from', { exact: true }).fill(today);
  await dialog.getByRole('spinbutton', { name: /^Agreed amount/ }).fill('360000');
  await dialog
    .getByLabel('Private reason and supporting context')
    .fill(`Operational cost terms ${suffix}`);
  await dialog.getByRole('button', { name: 'Save terms', exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Schedule and attendance', exact: true }).click();
  const createShift = async (
    person: typeof attended,
    date: string,
    startTime: string,
    endTime: string,
    notes: string
  ) => {
    await page.getByRole('button', { name: 'Add shift', exact: true }).first().click();
    const editor = page.getByRole('dialog');
    await editor
      .getByRole('combobox', { name: 'Employee', exact: true })
      .selectOption({ label: `${person.name} · Cashier` });
    await editor.getByLabel('Start date', { exact: true }).fill(date);
    await editor.getByLabel('End date', { exact: true }).fill(date);
    await editor.getByLabel('Start time', { exact: true }).fill(startTime);
    await editor.getByLabel('End time', { exact: true }).fill(endTime);
    await editor.getByLabel('Notes', { exact: true }).fill(notes);
    await editor.getByRole('button', { name: 'Save shift', exact: true }).click();
    await expect(editor).toBeHidden();
  };
  const noShowNotes = `No-show plan ${suffix}`;
  const attendedNotes = `Attendance plan ${suffix}`;
  await createShift(absent, previousWeekDate, '00:01', '00:02', noShowNotes);
  await createShift(attended, today, '00:01', '23:59', attendedNotes);
  const attendedSchedule = page
    .locator('[data-testid^="scheduled-shift-"]')
    .filter({ hasText: attendedNotes });
  await expect(attendedSchedule).toBeVisible();
  const attendedScheduleId = (await attendedSchedule.getAttribute('data-testid'))!.slice(
    'scheduled-shift-'.length
  );

  await signOut(page);
  await target.signIn(attended.email);
  await page.getByRole('button', { name: /open user menu/i }).click();
  const timeClock = page.getByRole('region', { name: 'Time clock' });
  await timeClock.getByRole('button', { name: 'Clock in', exact: true }).click();
  await expect(timeClock).toContainText('Clocked in');
  await page.waitForTimeout(2_200);
  await timeClock.getByRole('button', { name: 'Clock out', exact: true }).click();
  await expect(timeClock.getByRole('button', { name: 'Clock in', exact: true })).toBeVisible();

  await signOut(page);
  await target.signInAdmin();
  await target.navigate('/schedule');
  await page.getByRole('button', { name: 'Planned vs actual', exact: true }).click();
  let panel = page.getByTestId('plan-actual-panel');
  await panel
    .getByRole('combobox', { name: 'Employee', exact: true })
    .selectOption({ label: attended.name });
  let row = panel.locator('[data-testid^="plan-actual-"]').filter({ hasText: attended.name });
  await expect(row).toContainText('Scheduled');
  const cost = panel.getByRole('region', { name: 'Regular operational labor cost' });
  await expect(cost).toContainText('priced');
  await row.getByRole('button', { name: 'Review outcome', exact: true }).click();
  dialog = page.getByRole('dialog', { name: `Reconcile attendance · ${attended.name}` });
  const evidence = dialog.getByRole('combobox', { name: 'Attendance evidence', exact: true });
  const candidate = evidence.locator('option:not([value=""])').first();
  await expect(candidate).toBeAttached();
  const candidateId = await candidate.getAttribute('value');
  if (!candidateId) throw new Error('attendance evidence option did not expose a stable identity');
  await evidence.selectOption(candidateId);
  await dialog.getByLabel('Review reason', { exact: true }).fill(attendedReason);
  await runAxeOnPage(page, { include: '[role="dialog"]', singleFrame: target.singleFrameAxe });
  await dialog.getByRole('button', { name: 'Save decision', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toContainText('Attended');
  await target.screenshot('attendance-reconciliation-attended-cost');

  await page.getByRole('button', { name: 'Schedule and attendance', exact: true }).click();
  const frozen = page.getByTestId(`scheduled-shift-${attendedScheduleId}`);
  await expect(frozen).toContainText('Reconciled · historical evidence');
  await expect(
    frozen.getByRole('button', { name: new RegExp(`Edit ${attended.name}`) })
  ).toHaveCount(0);

  await page.getByRole('button', { name: 'Planned vs actual', exact: true }).click();
  panel = page.getByTestId('plan-actual-panel');
  await panel.getByRole('button', { name: 'Previous reconciliation week' }).click();
  await panel
    .getByRole('combobox', { name: 'Employee', exact: true })
    .selectOption({ label: absent.name });
  row = panel.locator('[data-testid^="plan-actual-"]').filter({ hasText: absent.name });
  await expect(row).toContainText('Needs review');
  const noShowScheduleId = (await row.getAttribute('data-testid'))!.slice('plan-actual-'.length);
  await row.getByRole('button', { name: 'Review outcome', exact: true }).click();
  dialog = page.getByRole('dialog', { name: `Reconcile attendance · ${absent.name}` });
  await dialog.getByRole('radio', { name: 'Confirm no-show', exact: true }).click();
  await dialog.getByLabel('Review reason', { exact: true }).fill(noShowReason);
  await dialog.getByRole('button', { name: 'Save decision', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toContainText('Confirmed no-show');

  await ensureLanguage(page, 'es');
  await page.reload();
  await page.getByRole('button', { name: 'Planificado frente a real', exact: true }).click();
  panel = page.getByTestId('plan-actual-panel');
  await panel.getByRole('button', { name: 'Semana de conciliación anterior' }).click();
  await panel
    .getByRole('combobox', { name: 'Empleado', exact: true })
    .selectOption({ label: absent.name });
  row = panel.locator('[data-testid^="plan-actual-"]').filter({ hasText: absent.name });
  await expect(row).toContainText('Inasistencia confirmada');
  await target.screenshot('attendance-reconciliation-no-show-es');

  await ensureLanguage(page, 'en');
  await target.navigate('/audit-logs');
  await page
    .getByRole('combobox', { name: 'Action', exact: true })
    .selectOption('attendance_reconciliation.changed');
  await page
    .getByRole('combobox', { name: 'Resource type', exact: true })
    .selectOption('attendance_reconciliation');
  await expect(page.getByRole('main').first()).toContainText('Attendance reconciliation recorded');
  await expect(page.getByRole('main').first()).not.toContainText(attendedReason);
  await expect(page.getByRole('main').first()).not.toContainText(noShowReason);

  await signOut(page);
  await target.signInManager(manager.email);
  await target.navigate('/schedule');
  await page.getByRole('button', { name: 'Planned vs actual', exact: true }).click();
  panel = page.getByTestId('plan-actual-panel');
  await panel
    .getByRole('combobox', { name: 'Employee', exact: true })
    .selectOption({ label: attended.name });
  await expect(
    panel.locator('[data-testid^="plan-actual-"]').filter({ hasText: attended.name })
  ).toContainText('Attended');
  await expect(panel.getByRole('heading', { name: 'Regular operational labor cost' })).toHaveCount(
    0
  );
  await runAxeOnPage(page, {
    include: '[data-testid="plan-actual-panel"]',
    singleFrame: target.singleFrameAxe,
  });
  await target.screenshot('attendance-reconciliation-manager-private');

  return {
    attended,
    absent,
    attendedReason,
    noShowReason,
    attendedScheduleId,
    noShowScheduleId,
  };
}
