import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login } from './support/app';
import { seedLargeTotalSaleScenario } from './support/db';
import { addProductToCartViaKeyboard, expectSearchInputFocused } from './support/sales-keyboard';

for (const spanish of [false, true]) {
  const language = spanish ? 'es' : 'en';
  test(`honest checkout guidance and real keyboard shortcuts in ${language}`, async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedLargeTotalSaleScenario(
      `guidance-${language}-${testInfo.parallelIndex}-${Date.now()}`
    );
    await login(page, { ...scenario.cashier, defaultPath: '/sales' }, { spanish });
    const summary = page.getByText(spanish ? 'Resumen del carrito' : 'Cart summary', {
      exact: true,
    });
    await expect(summary).toHaveCount(0);
    await expect(
      page.getByText(
        spanish
          ? 'Escanea un código de barras o busca por nombre o SKU para agregar un producto.'
          : 'Scan a barcode or search by name or SKU to add a product.',
        { exact: true }
      )
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText(
      spanish ? 'Sugerencia rápida' : 'Quick suggestion'
    );
    const hint = page.locator('.sales-scan-hint');
    // The UI formats actual browser-platform keys, not the Node host name.
    const searchKey = await page.evaluate(() => (/Mac/i.test(navigator.platform) ? '⌥P' : 'Alt+P'));
    await expect(hint.locator('kbd')).toHaveText([searchKey, 'F5', 'F1']);
    await expect(hint).not.toContainText('`');

    for (const width of [320, 375, 768]) {
      await page.setViewportSize({ width, height: 1024 });
      // Responsive sidebar motion must finish before measuring visible hints.
      // Keep the viewport assertion: a persistent overflow still fails.
      await expect
        .poll(() =>
          hint.locator('span.inline-flex').evaluateAll(entries =>
            entries.every(entry => {
              const box = entry.getBoundingClientRect();
              return box.left >= 0 && box.right <= window.innerWidth;
            })
          )
        )
        .toBe(true);
      for (const entry of await hint.locator('span.inline-flex').all()) {
        await expect(entry).toBeVisible();
        const geometry = await entry.evaluate(element => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, width: window.innerWidth };
        });
        expect(geometry.left).toBeGreaterThanOrEqual(0);
        expect(geometry.right).toBeLessThanOrEqual(geometry.width);
      }
      await page.keyboard.press('Alt+p');
      await expectSearchInputFocused(page);
      await page.keyboard.press('F5');
      const catalog = page.getByRole('dialog', { name: /add product|agregar producto/i });
      await expect(catalog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(catalog).toBeHidden();
      await expectSearchInputFocused(page);
      if (process.env.PUNTOVIVO_AUDIT_DIR) {
        await mkdir(process.env.PUNTOVIVO_AUDIT_DIR, { recursive: true });
        await page.screenshot({
          path: path.join(process.env.PUNTOVIVO_AUDIT_DIR, `guidance-${language}-${width}.png`),
          fullPage: true,
        });
      }
    }

    await addProductToCartViaKeyboard(page, scenario.product.sku);
    await expect(summary).toBeVisible();
    await expect(
      page.getByText(
        spanish ? '1 ítem en carrito · revisa el total' : '1 item in cart · review total',
        { exact: true }
      )
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText(
      spanish ? 'Último escaneado' : 'Last scanned'
    );
    await page.keyboard.press('F1');
    const payment = page.getByRole('dialog', {
      name: spanish ? 'Cobrar venta' : 'Charge Sale',
      exact: true,
    });
    await expect(payment).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(payment).toBeHidden();
    await expectSearchInputFocused(page);
    await expectNoClientIssues(tracker);
  });
}
