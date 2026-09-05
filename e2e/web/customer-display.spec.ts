import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

import { attachClientIssueTracker, expectNoClientIssues, login, openUserMenu } from './support/app';
import { seedCustomerDisplayScenario } from './support/db';
import { addProductToCartViaKeyboard } from './support/sales-keyboard';

async function captureEvidence(page: import('@playwright/test').Page): Promise<void> {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  await page.screenshot({
    path: path.join(auditDir, 'customer-display-live-en.png'),
    fullPage: true,
  });
}

test.describe('Customer Display', () => {
  test('mirrors only the paired register, hides data offline and clears it on logout', async ({
    context,
    page,
  }, testInfo) => {
    const scenario = seedCustomerDisplayScenario(
      `customer-display-${testInfo.parallelIndex}-${Date.now()}`
    );
    const cashierTracker = attachClientIssueTracker(page);
    await login(page, {
      email: scenario.cashier.email,
      password: scenario.cashier.password,
      defaultPath: '/sales',
    });
    const openDisplay = page.getByTestId('sales-open-customer-display');
    await expect(openDisplay).toBeVisible();

    const displayPage = context.waitForEvent('page');
    await openDisplay.click();
    const display = await displayPage;
    const displayTracker = attachClientIssueTracker(display);
    await expect(display).toHaveURL(/\/customer-display\?access=[0-9a-f-]+$/);
    expect(display.url()).not.toContain(scenario.tenantId);
    expect(display.url()).not.toContain(scenario.activeSite.id);
    expect(display.url()).not.toContain(scenario.cashSessionId);
    await expect(page.getByText('Customer display did not open', { exact: true })).toHaveCount(0);
    const register = display.getByTestId('customer-display-register');
    await expect(register).toBeVisible({ timeout: 15_000 });
    await expect(register.locator('option')).toHaveCount(1);
    await expect(display.getByTestId('customer-display-idle')).toBeVisible({ timeout: 15_000 });

    await addProductToCartViaKeyboard(page, scenario.product.sku);
    await expect(display.getByText(scenario.product.name, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(display.getByTestId('customer-display-total')).toContainText('12,500');
    await expect(display.getByText(scenario.product.sku, { exact: true })).toHaveCount(0);
    await expect(display.getByText(scenario.cashier.email, { exact: true })).toHaveCount(0);

    expect(
      await display.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .map(entry => entry.name)
          .filter(name => name.includes('/api/'))
      )
    ).toEqual([]);

    await display.evaluate(() => {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    await expect(display.getByTestId('customer-display-offline')).toBeVisible();
    await expect(display.getByText(scenario.product.name, { exact: true })).toHaveCount(0);

    await display.evaluate(() => {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
      window.dispatchEvent(new Event('online'));
    });
    await display.getByTestId('customer-display-reconnect').click();
    await expect(display.getByText(scenario.product.name, { exact: true })).toBeVisible();
    await captureEvidence(display);

    const windowsBeforeReuse = context.pages().length;
    await page.bringToFront();
    const duplicatePage = context
      .waitForEvent('page', { timeout: 1_000 })
      .then(candidate => candidate)
      .catch(() => null);
    await openDisplay.click();
    expect(await duplicatePage).toBeNull();
    expect(context.pages()).toHaveLength(windowsBeforeReuse);

    await expectNoClientIssues(cashierTracker);
    await expectNoClientIssues(displayTracker);

    await openUserMenu(page);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(display.getByTestId('customer-display-no-register')).toBeVisible({
      timeout: 10_000,
    });
    await expect(display.getByText(scenario.product.name, { exact: true })).toHaveCount(0);
  });
});
