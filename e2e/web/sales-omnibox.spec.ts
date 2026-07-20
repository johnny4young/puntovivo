/** global product-to-cart command palette journey. */

import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login } from './support/app';
import { seedSaleScenario } from './support/db';

const MOD_KEY = process.platform === 'darwin' ? 'Meta' : 'Control';

async function captureEvidence(page: import('@playwright/test').Page) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  await page.screenshot({
    path: path.join(auditDir, 'sales-omnibox-from-inventory-en.png'),
    fullPage: true,
  });
}

test.describe('sales omnibox', () => {
  test('adds a product from inventory without stealing editable-field shortcuts', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedSaleScenario(`omnibox-${testInfo.parallelIndex}-${Date.now()}`);
    await login(page, {
      email: scenario.manager.email,
      password: scenario.manager.password,
      defaultPath: '/dashboard',
    });
    await page.goto('/inventory');
    await expect(page.getByRole('main').getByRole('heading', { name: 'Inventory' })).toBeVisible();

    const editableSearch = page.getByPlaceholder('Search movements by product...');
    await expect(editableSearch).toBeVisible({ timeout: 15_000 });
    await editableSearch.focus();
    await page.keyboard.press(`${MOD_KEY}+K`);
    await expect(
      page.getByRole('dialog', { name: /command palette|paleta de comandos/i })
    ).toBeHidden();
    await expect(editableSearch).toBeFocused();

    await editableSearch.evaluate(element => (element as HTMLElement).blur());
    await page.keyboard.press(`${MOD_KEY}+K`);
    const palette = page.getByRole('dialog', {
      name: /command palette|paleta de comandos/i,
    });
    await expect(palette).toBeVisible();
    await palette.getByRole('textbox').fill(scenario.product.sku);
    const sellOption = palette.getByRole('option', {
      name: new RegExp(scenario.product.sku, 'i'),
    });
    await expect(sellOption).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/sales$/);
    const productDialog = page.getByRole('dialog', {
      name: /add product|agregar producto/i,
    });
    await expect(productDialog).toBeVisible({ timeout: 15_000 });
    const productRow = productDialog.getByTestId(`product-search-row-${scenario.product.sku}`);
    await expect(productRow).toBeVisible({ timeout: 15_000 });
    await productRow.click();
    await productDialog.getByRole('button', { name: /add to cart|agregar al carrito/i }).click();
    await expect(productDialog).toBeHidden();
    await expect(page.getByTestId(`sale-cart-item-${scenario.product.sku}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('#sales-product-search-input')).toBeFocused();
    await captureEvidence(page);
    await expectNoClientIssues(tracker);
  });
});
