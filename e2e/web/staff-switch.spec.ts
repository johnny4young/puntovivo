import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  attachClientIssueTracker,
  expectNoClientIssues,
  loginAs,
  resetSession,
} from './support/app';

const E2E_STAFF_PIN = '246810';

async function captureEvidence(page: Page, name: string) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: path.join(auditDir, `${name}.png`),
  });
}

function cashierRow(page: Page) {
  return page.locator('tr').filter({ hasText: 'E2E Cashier' }).first();
}

async function openCashierPinModal(page: Page) {
  await page.goto('/users');
  await expect(page).toHaveURL(/\/users$/);
  const row = cashierRow(page);
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Manage staff PIN for E2E Cashier' }).click();
  const dialog = page.getByRole('dialog', { name: 'Manage staff PIN' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('shared-terminal staff PIN switching', () => {
  test('admin enrolls a cashier PIN and the cashier safely takes over', async ({
    page,
    context,
  }) => {
    const tracker = attachClientIssueTracker(page);
    let privilegedPage: Page | null = null;
    let privilegedTracker: ReturnType<typeof attachClientIssueTracker> | null = null;

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, 'admin');

    try {
      const pinDialog = await openCashierPinModal(page);
      await pinDialog.locator('#staff-pin').fill(E2E_STAFF_PIN);
      await captureEvidence(page, 'eng-106a-pin-enrollment');
      await pinDialog.getByRole('button', { name: 'Save PIN' }).click();
      await expect(pinDialog).toHaveCount(0);
      await expect(cashierRow(page).getByText('Configured', { exact: true })).toBeVisible();

      // A second same-origin tab must lose the source admin identity when the
      // shared workstation changes operator. This proves the storage handoff
      // in a real Chromium context rather than only through a synthetic event.
      privilegedPage = await context.newPage();
      privilegedTracker = attachClientIssueTracker(privilegedPage);
      await privilegedPage.goto('/users');
      await expect(
        privilegedPage.getByRole('main').getByRole('heading', { name: 'Users', exact: true })
      ).toBeVisible();

      await page.getByRole('button', { name: 'Open user menu for E2E Admin' }).click();
      await page.getByRole('button', { name: 'Switch cashier' }).click();

      const switchDialog = page.getByRole('dialog', { name: 'Switch cashier' });
      await expect(switchDialog).toBeVisible();
      await switchDialog.getByRole('radio', { name: 'E2E Cashier', exact: true }).check();
      await switchDialog.locator('#staff-switch-pin').fill(E2E_STAFF_PIN);
      await captureEvidence(page, 'eng-106a-switch-ready');
      await switchDialog.getByRole('button', { name: 'Switch cashier' }).click();

      await expect(page).toHaveURL(/\/sales$/);
      await expect(
        page.getByRole('button', { name: 'Open user menu for E2E Cashier' })
      ).toBeVisible();
      await expect(page.locator('header').getByText('cashier', { exact: true })).toBeVisible();
      await expect(privilegedPage).toHaveURL(/\/login$/);
      await expect(
        privilegedPage.getByRole('main').getByRole('heading', { name: 'Users', exact: true })
      ).toHaveCount(0);
      await expectNoClientIssues(privilegedTracker);
      await privilegedPage.close();
      privilegedPage = null;
      privilegedTracker = null;

      // The adopted cashier must not retain admin-only route access from the
      // prior identity or from a stale React Query/route cache.
      await page.goto('/users');
      await expect(page).toHaveURL(/\/sales$/);
      await expect(page.getByRole('heading', { name: 'Users', exact: true })).toHaveCount(0);

      await page.reload();
      await expect(
        page.getByRole('button', { name: 'Open user menu for E2E Cashier' })
      ).toBeVisible();
      await page.goto('/users');
      await expect(page).toHaveURL(/\/sales$/);
      await captureEvidence(page, 'eng-106a-cashier-session');
    } finally {
      if (privilegedPage) {
        await privilegedPage.close();
      }
      // Keep the shared E2E baseline deterministic even if another local run
      // reuses its database after this directed smoke.
      await resetSession(page);
      await loginAs(page, 'admin');
      const pinDialog = await openCashierPinModal(page);
      await pinDialog.getByRole('button', { name: 'Remove PIN' }).click();
      const confirmDialog = page.getByRole('dialog', { name: 'Manage staff PIN' });
      await confirmDialog.getByRole('button', { name: 'Remove PIN' }).click();
      await expect(confirmDialog).toHaveCount(0);
      await expect(cashierRow(page).getByText('Not configured', { exact: true })).toBeVisible();
    }

    await expectNoClientIssues(tracker);
  });
});
