import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  attachClientIssueTracker,
  expectNoClientIssues,
  login,
  seedSalesFavorites,
} from './support/app';
import { seedSaleScenario } from './support/db';
import { addProductToCartViaKeyboard } from './support/sales-keyboard';

const FIRST_VIEWPORT = { width: 1024, height: 768 } as const;

async function expectFullyInsideViewport(locator: Locator, page: Page) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();

  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
}

test.describe('sales first viewport', () => {
  test('keeps the transaction path visible and adds a familiar product in one action', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedSaleScenario(
      `sales-first-viewport-${testInfo.parallelIndex}-${Date.now()}`
    );
    await seedSalesFavorites(page, {
      tenantId: scenario.tenantId,
      siteIds: scenario.sites.map(site => site.id),
      productIds: [scenario.product.id],
    });
    await page.setViewportSize(FIRST_VIEWPORT);
    await login(page, {
      ...scenario.cashier,
      defaultPath: '/sales',
    });

    const operation = page.getByTestId('sales-operation-strip');
    const search = page.getByLabel('Product / barcode');
    const primaryAction = page.getByTestId('checkout-primary-action');
    const total = page.getByTestId('checkout-total');
    const quickAccess = page.getByTestId('sales-quick-access');

    await expect(page.getByTestId('first-sale-guide')).toBeHidden();
    await expect(operation).toBeHidden();
    await expectFullyInsideViewport(search, page);
    await expectFullyInsideViewport(total, page);
    await expectFullyInsideViewport(primaryAction, page);
    await expect(page.getByRole('button', { name: 'Charge sale', exact: true })).toHaveCount(1);
    await expect(search).toBeFocused();
    await expect(quickAccess).toBeInViewport();

    const familiarProduct = page.getByTestId(`sales-quick-product-${scenario.product.sku}`);
    await expectFullyInsideViewport(familiarProduct, page);
    await familiarProduct.click();

    await expect(page.getByTestId(`sale-cart-item-${scenario.product.sku}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('sales-context-actions')).toBeVisible();
    await expect(total.getByText(/Items \(1\)/)).toBeVisible();
    await expectFullyInsideViewport(primaryAction, page);
    await expect(primaryAction).toHaveAccessibleName('Charge sale');
    await expect(primaryAction).toBeEnabled();
    await expect(page.getByTestId('checkout-fast-cash')).toBeVisible();

    await expectNoClientIssues(tracker);
  });

  test('keeps open tickets in one command bar and the cart near the top', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedSaleScenario(`sales-command-bar-${testInfo.parallelIndex}-${Date.now()}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, { ...scenario.cashier, defaultPath: '/sales' });

    await addProductToCartViaKeyboard(page, scenario.product.sku);
    await page.getByTestId('checkout-new-sale').click();

    const bar = page.getByTestId('sales-command-bar');
    const tickets = bar.getByTestId('cart-workspace-switcher-item');
    await expect(tickets).toHaveCount(2);
    await expect(bar.getByTestId('sales-open-suspended')).toBeVisible();
    await expect(bar.getByTestId('sales-open-history')).toHaveAccessibleName('History');
    expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(72);

    await bar.locator('[data-testid="cart-workspace-switcher-item"][aria-pressed="false"]').click();
    const line = page.getByTestId(`sale-cart-item-${scenario.product.sku}`);
    await expect(line).toBeVisible();
    expect((await line.boundingBox())!.y).toBeLessThan(380);

    await page.setViewportSize(FIRST_VIEWPORT);
    await expectFullyInsideViewport(page.getByTestId('checkout-primary-action'), page);

    await expectNoClientIssues(tracker);
  });
});
