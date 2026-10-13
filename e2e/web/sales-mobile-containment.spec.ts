import { expect, test, type Page } from '@playwright/test';
import {
  attachClientIssueTracker,
  expectNoClientIssues,
  login,
  seedSalesFavorites,
} from './support/app';
import { seedLargeTotalSaleScenario } from './support/db';

async function expectSalesWorkbenchContained(page: Page, width: number) {
  await page.setViewportSize({ width, height: 812 });
  const geometry = await page.locator('.sales-workbench-grid').evaluate(grid => {
    // Element boxes can stay inside their parent while their text spills out
    // (a fixed-width money cell), so measure rendered text runs as well.
    // Intentionally ellipsized and screen-reader-only text is excluded.
    const overflowingText = (container: Element) => {
      const limit = container.getBoundingClientRect().right;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      const spills: { text: string; owner: string; right: number; limit: number }[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!node.textContent?.trim() || !parent || parent.closest('.truncate, .sr-only')) {
          continue;
        }
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.right > limit + 1) {
          spills.push({
            text: node.textContent.trim().slice(0, 60),
            owner: parent.className.toString().slice(0, 100),
            right: rect.right,
            limit,
          });
        }
      }
      return spills;
    };
    const bounds = grid.getBoundingClientRect();
    const shell = grid.closest('.app-shell') ?? document.documentElement;
    const cards = [...grid.children].map(card => {
      const rect = card.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
    const cartItem = grid.querySelector('[data-testid^="sale-cart-item-"]');
    const primaryRow = cartItem?.firstElementChild;
    const productDetails = primaryRow?.querySelector(':scope > button');
    const quantityControls = primaryRow?.querySelector(':scope > div');
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
      // `.app-shell` clips horizontal overflow, so the document never grows
      // wider than the viewport; the shell's own scroll width is the signal.
      shellWidth: shell.clientWidth,
      shellContentWidth: shell.scrollWidth,
      gridWidth: grid.clientWidth,
      contentWidth: grid.scrollWidth,
      gridRight: bounds.right,
      cards,
      offenders,
      textSpills: [
        ...[...grid.children].flatMap(overflowingText),
        ...(cartItem ? overflowingText(cartItem) : []),
      ],
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

  expect(geometry.textSpills, `text spilling out at ${width}px`).toEqual([]);
  expect(
    geometry.contentWidth,
    `workbench content at ${width}px: ${JSON.stringify(geometry.offenders)}`
  ).toBeLessThanOrEqual(geometry.gridWidth + 1);
  expect(geometry.shellContentWidth).toBeLessThanOrEqual(geometry.shellWidth + 1);
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
    // A large catalog price keeps the money cells at a realistic worst case.
    const scenario = seedLargeTotalSaleScenario(
      `sales-mobile-${language}-${testInfo.parallelIndex}-${Date.now()}`
    );
    await seedSalesFavorites(page, {
      tenantId: scenario.tenantId,
      siteIds: scenario.sites.map(site => site.id),
      productIds: [scenario.product.id],
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await login(
      page,
      { ...scenario.cashier, defaultPath: '/sales' },
      { spanish: language === 'es' }
    );

    // Measure the settled idle workbench, not the lazy quick-access skeleton.
    const quickProduct = page.getByTestId(`sales-quick-product-${scenario.product.sku}`);
    await expect(quickProduct).toBeVisible();
    for (const width of [320, 375, 768]) {
      await expectSalesWorkbenchContained(page, width);
    }

    await page.setViewportSize({ width: 375, height: 812 });
    await quickProduct.click();
    await expect(page.getByTestId(`sale-cart-item-${scenario.product.sku}`)).toBeVisible();
    for (const width of [320, 375, 768]) {
      await expectSalesWorkbenchContained(page, width);
    }
    await expectNoClientIssues(tracker);
  });
}
