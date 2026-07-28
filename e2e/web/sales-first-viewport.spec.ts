import { expect, test, type Locator, type Page } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login } from './support/app';
import { seedSaleScenario } from './support/db';

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
    await page.addInitScript(
      ({ tenantId, siteIds, productId }) => {
        for (const siteId of siteIds) {
          window.localStorage.setItem(
            `puntovivo:sales-favorites:v1:${tenantId}:${siteId}`,
            JSON.stringify({ productIds: [productId] })
          );
        }
      },
      {
        tenantId: scenario.tenantId,
        siteIds: scenario.sites.map(site => site.id),
        productId: scenario.product.id,
      }
    );
    await page.setViewportSize(FIRST_VIEWPORT);
    await login(page, {
      ...scenario.cashier,
      defaultPath: '/sales',
    });

    const operation = page.getByTestId('sales-operation-strip');
    const search = page.getByLabel('Product / barcode');
    const primaryAction = page.getByTestId('checkout-primary-action');
    const quickAccess = page.getByTestId('sales-quick-access');

    await expect(page.getByTestId('first-sale-guide')).toBeHidden();
    await expectFullyInsideViewport(operation, page);
    await expectFullyInsideViewport(search, page);
    await expectFullyInsideViewport(primaryAction, page);
    await expect(search).toBeFocused();
    await expect(quickAccess).toBeInViewport();

    const familiarProduct = page.getByTestId(`sales-quick-product-${scenario.product.sku}`);
    await expectFullyInsideViewport(familiarProduct, page);
    await familiarProduct.click();

    await expect(page.getByTestId(`sale-cart-item-${scenario.product.sku}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('sales-context-actions')).toBeVisible();
    await expect(operation.getByText(/1 item/)).toBeVisible();
    await expect(operation.getByRole('button', { name: 'Charge sale' })).toBeEnabled();

    await expectNoClientIssues(tracker);
  });
});
