import { expect, test, type Page } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login } from './support/app';
import { seedSaleScenario } from './support/db';

async function expectSalesWorkbenchContained(page: Page, width: number) {
  await page.setViewportSize({ width, height: 812 });
  const geometry = await page.locator('.sales-workbench-grid').evaluate(grid => {
    const bounds = grid.getBoundingClientRect();
    const cards = [...grid.children].map(card => {
      const rect = card.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
    const cartItem = grid.querySelector('[data-testid^="sale-cart-item-"]');
    const primaryRow = cartItem?.firstElementChild;
    const productDetails = primaryRow?.querySelector('button');
    const quantityControls = primaryRow?.querySelector('div');
    const offenders = [...grid.querySelectorAll('*')]
      .map(element => ({
        tag: element.tagName,
        className: typeof element.className === 'string' ? element.className.slice(0, 100) : '',
        right: element.getBoundingClientRect().right,
      }))
      .filter(element => element.right > bounds.right + 0.5)
      .sort((a, b) => b.right - a.right)
      .slice(0, 8);
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      gridWidth: grid.clientWidth,
      contentWidth: grid.scrollWidth,
      gridRight: bounds.right,
      cards,
      offenders,
      cartItemPresent: cartItem !== null,
      cartPrimaryRow:
        productDetails && quantityControls
          ? {
              productBottom: productDetails.getBoundingClientRect().bottom,
              controlsTop: quantityControls.getBoundingClientRect().top,
            }
          : null,
    };
  });

  expect(
    geometry.contentWidth,
    `workbench content at ${width}px: ${JSON.stringify(geometry.offenders)}`
  ).toBeLessThanOrEqual(geometry.gridWidth + 1);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.gridRight).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.cards).toHaveLength(2);
  for (const card of geometry.cards) {
    expect(card.left).toBeGreaterThanOrEqual(0);
    expect(card.right).toBeLessThanOrEqual(geometry.gridRight + 1);
  }
  if (geometry.cartItemPresent) {
    expect(geometry.cartPrimaryRow).not.toBeNull();
  }
  if (width < 640 && geometry.cartPrimaryRow) {
    expect(geometry.cartPrimaryRow.productBottom).toBeLessThanOrEqual(
      geometry.cartPrimaryRow.controlsTop + 1
    );
  }
}

for (const language of ['en', 'es'] as const) {
  test(`Sales keeps the ${language} cart and checkout in the mobile viewport`, async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedSaleScenario(
      `sales-mobile-${language}-${testInfo.parallelIndex}-${Date.now()}`
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
    await page.setViewportSize({ width: 375, height: 812 });
    await login(
      page,
      { ...scenario.cashier, defaultPath: '/sales' },
      { spanish: language === 'es' }
    );

    for (const width of [320, 375, 768]) {
      await expectSalesWorkbenchContained(page, width);
    }

    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByTestId(`sales-quick-product-${scenario.product.sku}`).click();
    await expect(page.getByTestId(`sale-cart-item-${scenario.product.sku}`)).toBeVisible();
    for (const width of [320, 375, 768]) {
      await expectSalesWorkbenchContained(page, width);
    }
    await expectNoClientIssues(tracker);
  });
}
