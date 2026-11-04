import { expect, test, type Page } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login } from './support/app';
import { seedSaleScenario } from './support/db';
import { addProductToCartViaKeyboard } from './support/sales-keyboard';

async function openCloseWithSuspendedSale(page: Page, sku: string) {
  await addProductToCartViaKeyboard(page, sku);
  await page.getByTestId('checkout-suspend').click();
  await page.getByTestId('suspend-label-input').fill('Mesa 5');
  await page.getByRole('button', { name: 'Suspend', exact: true }).click();
  await expect(page.getByTestId('sales-suspended-count')).toHaveText('1');

  await page.getByRole('button', { name: 'Close cash session' }).first().click();
  const closeDialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByRole('heading', { name: 'Close cash session' }) })
    .last();
  await expect(closeDialog).toBeVisible();
  await closeDialog.locator('#cash-session-closing-count').fill('700');
  return closeDialog;
}

test.describe('closing the register with suspended sales', () => {
  test('returns to the count however the review ends, and resuming ends the close', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedSaleScenario(
      `cash-close-suspended-${testInfo.parallelIndex}-${Date.now()}`
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, { ...scenario.cashier, defaultPath: '/sales' });

    const closeDialog = await openCloseWithSuspendedSale(page, scenario.product.sku);
    const review = closeDialog.getByTestId('close-session-review-suspended');
    const draft = page.getByTestId('suspended-draft-card').filter({ hasText: 'Mesa 5' });

    await review.click();
    await expect(draft).toBeVisible();
    await expect(closeDialog).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(closeDialog).toBeVisible();
    await expect(closeDialog.locator('#cash-session-closing-count')).toHaveValue('700');

    // The shortcut closes the panel on a different path than its close button.
    await review.click();
    await expect(draft).toBeVisible();
    await page.keyboard.press('ControlOrMeta+r');
    await expect(draft).toBeHidden();
    await expect(closeDialog).toBeVisible();
    await expect(closeDialog.locator('#cash-session-closing-count')).toHaveValue('700');

    await review.click();
    await draft.getByTestId('suspended-draft-resume').click();
    await expect(draft).toBeHidden();
    await expect(closeDialog).toBeHidden();
    await expect(page.getByTestId(`sale-cart-item-${scenario.product.sku}`)).toBeVisible();

    await expectNoClientIssues(tracker);
  });
});
