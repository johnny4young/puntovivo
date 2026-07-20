/** live product-matrix creation, catalog round-trip and POS reachability. */
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  loginAs,
} from './support/app.js';

async function captureEvidence(page: Page, name: string) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: path.join(auditDir, `${name}.png`),
  });
}

test('admin creates a Size x Color matrix and sells only child products', async ({
  page,
}, testInfo) => {
  const tracker = attachClientIssueTracker(page);
  const suffix = `${testInfo.parallelIndex}-${Date.now()}`;
  const productName = `E2E Matrix Shirt ${suffix}`;
  const productSku = `E2E-MATRIX-${suffix}`;

  await loginAs(page, 'admin');
  await page.goto('/products');
  await page.getByRole('button', { name: 'Add Product' }).click();
  const productDialog = page.getByRole('dialog', { name: 'Create Product' });
  await productDialog.locator('#product-name').fill(productName);
  await productDialog.locator('#product-sku').fill(productSku);
  await productDialog.getByRole('tab', { name: 'Units' }).click();
  await productDialog
    .getByRole('tabpanel', { name: 'Units' })
    .locator('select')
    .selectOption({ index: 1 });
  await productDialog.getByRole('button', { name: 'Create Product' }).click();
  await expect(productDialog).toBeHidden({ timeout: 15_000 });

  await page.getByPlaceholder('Search products...').fill(productName);
  const standardRow = page.locator('tbody tr').filter({ hasText: productName }).first();
  await expect(standardRow).toBeVisible({ timeout: 15_000 });
  await standardRow.getByRole('button', { name: 'View details' }).click();
  const details = page.getByTestId('product-details-drawer');
  await expect(details).toContainText('Standard product');
  await details.getByRole('button', { name: 'Create variants' }).click();

  const matrixDialog = page.getByRole('dialog', { name: `Create variants · ${productName}` });
  await expect(matrixDialog).toBeVisible();
  await matrixDialog.getByRole('textbox', { name: 'Axis 1 name' }).fill('Size');
  await matrixDialog.getByRole('textbox', { name: 'Options' }).fill('S, M');
  await matrixDialog.getByRole('button', { name: 'Add another axis' }).click();
  await matrixDialog.getByRole('textbox', { name: 'Axis 2 name' }).fill('Color');
  await matrixDialog.getByRole('textbox', { name: 'Options' }).nth(1).fill('Blue, Red');
  await expect(matrixDialog.getByText('4 combinations')).toBeVisible();
  await expect(matrixDialog.getByText(`${productName} · M / Red`)).toBeVisible();
  await expect(matrixDialog.getByText(`${productSku}-M-RED`)).toBeVisible();
  await matrixDialog.getByText(`${productName} · M / Red`).scrollIntoViewIfNeeded();
  await captureEvidence(page, 'eng-110b-variant-preview-en');
  await matrixDialog.getByRole('button', { name: 'Create 4 variants' }).click();
  await expect(matrixDialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText('4 variants created')).toBeVisible();

  await ensureLanguage(page, 'es');
  await page.getByPlaceholder('Buscar productos...').fill(productName);
  const parentRow = page
    .locator('tbody tr')
    .filter({ hasText: productName })
    .filter({ hasText: 'Matriz de variantes' });
  await expect(parentRow).toHaveCount(1);
  await parentRow.getByRole('button', { name: 'Ver detalle' }).click();
  const spanishDetails = page.getByTestId('product-details-drawer');
  await expect(spanishDetails).toContainText('Padre de matriz');
  await expect(spanishDetails).toContainText('Matriz de variantes');
  await spanishDetails.getByRole('button', { name: 'Ver variantes' }).click();

  const matrixView = page.getByRole('dialog', { name: `Matriz de variantes · ${productName}` });
  await expect(matrixView).toBeVisible();
  await expect(matrixView.getByText('Size')).toBeVisible();
  await expect(matrixView.getByText('Color')).toBeVisible();
  await expect(matrixView.locator('tbody tr')).toHaveCount(4);
  await expect(matrixView.getByText(`${productName} · S / Blue`)).toBeVisible();
  await captureEvidence(page, 'eng-110b-variant-matrix-es');
  await matrixView.getByRole('button', { name: 'Cerrar', exact: true }).click();

  await page.goto('/sales');
  await page.locator('#sales-product-search-input').fill(productSku);
  await page.locator('#sales-product-search-input').press('Enter');
  const productSearch = page.getByRole('dialog');
  await expect(productSearch.locator('tbody tr')).toHaveCount(4);
  await expect(productSearch.getByText(productSku, { exact: true })).toHaveCount(0);
  await expect(productSearch.getByText(`${productSku}-S-BLUE`, { exact: true })).toBeVisible();
  await productSearch.locator('tbody tr', { hasText: `${productSku}-S-BLUE` }).click();
  await productSearch.getByRole('button', { name: 'Agregar al carrito' }).click();
  await expect(page.getByTestId(`sale-cart-item-${productSku}-S-BLUE`)).toBeVisible();

  await expectNoClientIssues(tracker);
});
