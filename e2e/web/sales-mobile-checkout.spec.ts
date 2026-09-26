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
    // Anchor in visible copy so the regression also runs against the old layout.
    const label = page.getByText(spanish ? 'Total borrador' : 'Draft total', { exact: true });
    const total = label.locator('..').locator('p').nth(1);
    const bar = label.locator('xpath=ancestor::div[contains(@class,"fixed")]');
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expectUnclipped(total, page);
      for (const button of await bar.getByRole('button').all()) await expectUnclipped(button, page);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(
      bar.getByRole('button', { name: spanish ? 'Cerrar caja' : 'Close cash session', exact: true })
    ).toBeEnabled();
    await addProductToCartViaKeyboard(page, scenario.product.sku);
    await expect(total).toContainText(/123[.,]456[.,]789/);
    const search = bar.getByRole('button', { name: spanish ? 'Buscar' : 'Search', exact: true });
    const charge = bar.getByRole('button', {
      name: spanish ? 'Cobrar venta' : 'Charge sale',
      exact: true,
    });
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expectUnclipped(total, page);
      for (const button of await bar.getByRole('button').all()) await expectUnclipped(button, page);
      const amountBox = (await total.boundingBox())!;
      const actionBox = (await charge.boundingBox())!;
      expect(amountBox.y + amountBox.height).toBeLessThanOrEqual(actionBox.y);
      await search.focus();
      await page.keyboard.press('Tab');
      await expect(charge).toBeFocused();
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
