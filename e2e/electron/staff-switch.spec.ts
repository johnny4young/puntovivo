/**
 * The `staff-switch` operator journey, run against the desktop app.
 *
 * An administrator enrolls a cashier PIN and hands the same workstation to
 * that cashier without carrying privileged routes or identity-owned state
 * across the handoff. The journey then reloads the renderer to prove the
 * short-lived cashier session survives the intended continuity boundary and
 * verifies the immutable actor/target audit evidence after fresh admin
 * authentication.
 *
 * @module e2e/electron/staff-switch
 */

import type { Page } from '@playwright/test';
import { electronTest as test, expect } from './fixtures.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { E2E_USERS, type E2EUserProfile } from '../shared/baseline.js';
import { goToRoute, requestRoute, signIn, signOut } from './support/journey.js';

const CASHIER_PIN = '246810';

function baselineUser(role: E2EUserProfile['role']): E2EUserProfile {
  const user = E2E_USERS.find(candidate => candidate.role === role);
  if (!user) throw new Error(`baseline did not seed a ${role}`);
  return user;
}

async function configureCashierPin(
  page: Page,
  cashier: E2EUserProfile
): Promise<{ cashierId: string }> {
  await goToRoute(page, '/users');
  await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible({
    timeout: 30_000,
  });

  const row = page.locator('tbody tr').filter({ hasText: cashier.name }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const cashierId = await row.getAttribute('data-row-id');
  expect(cashierId, 'cashier row exposes its stable user id').toBeTruthy();

  await row.getByRole('button', { name: `Manage staff PIN for ${cashier.name}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Manage staff PIN' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#staff-pin').fill(CASHIER_PIN);
  await dialog.getByRole('button', { name: 'Save PIN' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(row).toContainText('Configured');

  return { cashierId: cashierId! };
}

async function removeCashierPin(page: Page, cashier: E2EUserProfile): Promise<void> {
  await goToRoute(page, '/users');
  const row = page.locator('tbody tr').filter({ hasText: cashier.name }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole('button', { name: `Manage staff PIN for ${cashier.name}` }).click();

  const dialog = page.getByRole('dialog', { name: 'Manage staff PIN' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove PIN' }).click();
  await dialog.getByRole('button', { name: 'Remove PIN' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(row).toContainText('Not configured');
}

async function switchToCashier(page: Page, cashier: E2EUserProfile): Promise<void> {
  await page.getByRole('button', { name: /open user menu/i }).click();
  await page.getByRole('button', { name: 'Switch cashier' }).click();

  const dialog = page.getByRole('dialog', { name: 'Switch cashier' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: cashier.name, exact: true }).check();
  await dialog.locator('#staff-switch-pin').fill(CASHIER_PIN);
  await dialog.getByRole('button', { name: 'Switch cashier' }).click();

  await expect(page).toHaveURL(/\/sales$/, { timeout: 30_000 });
  await expect(
    page.getByRole('button', { name: `Open user menu for ${cashier.name}` })
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('header').getByText('cashier', { exact: true })).toBeVisible();
}

async function expectCashierCannotReachUsers(page: Page): Promise<void> {
  // Request the privileged destination without requiring it to settle first:
  // the packaged hash router can redirect synchronously, before Playwright
  // observes the intermediate URL. The final /sales route is the contract.
  await requestRoute(page, '/users');
  await expect(page).toHaveURL(/\/sales$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toHaveCount(0);
}

async function expectPersistentCashierSession(page: Page, cashier: E2EUserProfile): Promise<void> {
  await page.reload();
  await expect(
    page.getByRole('button', { name: `Open user menu for ${cashier.name}` })
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(page).toHaveURL(/\/sales$/, { timeout: 30_000 });
  await expectCashierCannotReachUsers(page);
}

async function expectStaffSwitchAudit(
  page: Page,
  options: {
    admin: E2EUserProfile;
    cashierId: string;
  }
): Promise<void> {
  await goToRoute(page, '/audit-logs');
  await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByLabel('Action').selectOption('auth.staff_switch');

  const row = page
    .locator('tbody tr')
    .filter({ hasText: 'Cashier switched' })
    .filter({ hasText: options.admin.name })
    .filter({ hasText: options.cashierId })
    .first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText('Cashier');
}

test.describe('staff switch on the desktop app', () => {
  test('hands one workstation to a cashier without retaining admin authority', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    const admin = baselineUser('admin');
    const cashier = baselineUser('cashier');
    let pinConfigured = false;

    await signIn(page, admin.email);
    try {
      const { cashierId } = await configureCashierPin(page, cashier);
      pinConfigured = true;
      await switchToCashier(page, cashier);
      await expectCashierCannotReachUsers(page);
      await expectPersistentCashierSession(page, cashier);

      await signOut(page);
      await signIn(page, admin.email);
      await expectStaffSwitchAudit(page, { admin, cashierId });

      await page.reload();
      await expect(
        page.getByRole('button', { name: `Open user menu for ${admin.name}` })
      ).toBeVisible({ timeout: 30_000 });
      await expectStaffSwitchAudit(page, { admin, cashierId });
    } finally {
      if (pinConfigured) {
        await signOut(page);
        await signIn(page, admin.email);
        await removeCashierPin(page, cashier);
      }
    }

    await expectNoClientIssues(tracker);
  });
});
