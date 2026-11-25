import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login } from './support/app';
import { findLatestSaleForProduct, seedLargeTotalSaleScenario } from './support/db';
import { addProductToCartViaKeyboard } from './support/sales-keyboard';

async function expectUnclipped(locator: Locator, page: Page) {
  await expect(locator).toBeVisible();
  const geometry = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: element.clientWidth,
      contentWidth: element.scrollWidth,
    };
  });
  expect(geometry.width).toBeGreaterThan(0);
  expect(geometry.contentWidth).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
}

// The last CSS viewport is the reflow equivalent of 750x812 at 200% browser zoom.
const VIEWPORTS = [
  { width: 320, height: 812 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 375, height: 406 },
];

for (const spanish of [false, true]) {
  const language = spanish ? 'es' : 'en';
  test(`mobile checkout keeps the full total and actions visible in ${language}`, async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedLargeTotalSaleScenario(
      `mobile-total-${language}-${testInfo.parallelIndex}-${Date.now()}`
    );
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, { ...scenario.cashier, defaultPath: '/sales' }, { spanish });
    const bar = page.getByTestId('mobile-checkout-bar');
    const total = bar.getByTestId('mobile-checkout-total');
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expectUnclipped(total, page);
      for (const button of await bar.getByRole('button').all()) await expectUnclipped(button, page);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    const closeName = spanish ? 'Cerrar caja' : 'Close cash session';
    const charge = bar.getByRole('button', {
      name: spanish ? 'Cobrar venta' : 'Charge sale',
      exact: true,
    });
    await expect(charge).toBeDisabled();
    await expect(bar.getByRole('button', { name: closeName, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: closeName, exact: true })).toBeEnabled();
    await addProductToCartViaKeyboard(page, scenario.product.sku);
    await expect(total).toContainText(/123[.,]456[.,]789/);
    await expect(bar.getByTestId('mobile-checkout-caption')).toHaveText(
      spanish ? 'Total · 1 artículo' : 'Total · 1 item'
    );
    const suspend = bar.getByRole('button', {
      name: spanish ? 'Suspender' : 'Suspend',
      exact: true,
    });
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expectUnclipped(total, page);
      for (const button of await bar.getByRole('button').all()) await expectUnclipped(button, page);
      const amountBox = (await total.boundingBox())!;
      const actionBox = (await charge.boundingBox())!;
      expect(amountBox.y + amountBox.height).toBeLessThanOrEqual(actionBox.y);
      await charge.focus();
      await page.keyboard.press('Tab');
      await expect(suspend).toBeFocused();
      if (process.env.PUNTOVIVO_AUDIT_DIR) {
        await mkdir(process.env.PUNTOVIVO_AUDIT_DIR, { recursive: true });
        await page.screenshot({
          path: path.join(
            process.env.PUNTOVIVO_AUDIT_DIR,
            `${language}-${viewport.width}x${viewport.height}.png`
          ),
        });
      }
    }
    await page.setViewportSize({ width: 375, height: 812 });
    // The final checkout panel content must remain reachable above the fixed bar.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const shellBottom = await page
      .locator('.sales-pos-shell')
      .evaluate(el => el.getBoundingClientRect().bottom);
    expect(shellBottom).toBeLessThanOrEqual((await bar.boundingBox())!.y + 1);
    await charge.click();
    const dialog = page.getByRole('dialog', { name: spanish ? 'Cobrar venta' : 'Charge Sale' });
    await dialog
      .getByRole('button', { name: spanish ? 'Confirmar venta' : 'Confirm Sale' })
      .click();
    await expect(dialog).toBeHidden({ timeout: 15000 });
    await expect
      .poll(() => findLatestSaleForProduct(scenario.product.id, scenario.cashier.id)?.total)
      .toBe(123456789);
    const sale = findLatestSaleForProduct(scenario.product.id, scenario.cashier.id)!;
    await page
      .getByRole('button', { name: spanish ? 'Historial' : 'History', exact: true })
      .click();
    await expect(page.getByText(sale.saleNumber, { exact: true })).toBeVisible();
    await expectNoClientIssues(tracker);
  });
}

test('a phone sells from the search, the key chips and a compact ticket', async ({
  page,
}, testInfo) => {
  const tracker = attachClientIssueTracker(page);
  const scenario = seedLargeTotalSaleScenario(
    `phone-layout-${testInfo.parallelIndex}-${Date.now()}`
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, { ...scenario.cashier, defaultPath: '/sales' });

  // Status lives in the register pill and the fixed bar, not in banners above the sale.
  await expect(page.getByTestId('sales-register-state')).toHaveText('Register open');
  await expect(page.getByTestId('sales-operation-strip')).toBeHidden();
  await expect(page.locator('.sales-shortcut-strip')).toBeHidden();
  await expect(page.getByPlaceholder('Search for a product')).toBeVisible();

  await addProductToCartViaKeyboard(page, scenario.product.sku);
  const line = page.getByTestId(`sale-cart-item-${scenario.product.sku}`);
  await expect(page.getByTestId('sales-last-read')).toHaveCount(0);
  const keys = page.getByTestId('sales-quick-access');
  expect((await keys.boundingBox())!.y).toBeLessThan((await line.boundingBox())!.y);

  // A scanned line reads as name, quantity and total; a tap opens its keys.
  const compact = line.locator('.sales-ticket-qty-compact');
  await expect(compact.locator('[aria-hidden="true"]')).toHaveText('× 1');
  await expect(compact).toContainText('Quantity 1');
  await expect(line.getByRole('button', { name: /^Add one / })).toBeHidden();
  await line.locator('.sales-ticket-name').click();
  await expect(line.getByRole('button', { name: /^Add one / })).toBeVisible();
  await expect(line.locator('.sales-ticket-qty-compact')).toBeHidden();

  // Credit needs a customer, so the drawer opens on the customer picker.
  await page.getByTestId('mobile-checkout-credit').click();
  const dialog = page.getByRole('dialog', { name: 'Charge Sale' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#sale-payment-customer')).toBeFocused();
  await expectNoClientIssues(tracker);
});
