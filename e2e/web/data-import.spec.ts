/** ENG-123a — live launch-import journey, persistence proof, and visual evidence. */
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

import { attachClientIssueTracker, expectNoClientIssues, loginAs } from './support/app.js';

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

test.describe('launch data import (ENG-123a)', () => {
  test('admin previews, imports, downloads a report, and sees catalog stock', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const suffix = `${testInfo.parallelIndex}-${Date.now()}`;
    const productName = `E2E Launch Coffee ${suffix}`;
    const productSku = `E2E-LAUNCH-${suffix}`;

    await loginAs(page, 'admin');
    await page.goto('/data-import');
    await expect(
      page.getByTestId('data-import-page').getByRole('heading', { name: 'Import data', level: 1 })
    ).toBeVisible();

    await page.locator('#data-import-file').setInputFiles({
      name: 'launch-products.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [
          'Name,SKU,Price,Cost,Opening stock,Minimum stock,Tax rate',
          `${productName},${productSku},12500,8000,7,2,19`,
          `Repeated product,${productSku.toLocaleLowerCase()},10000,6000,0,0,0`,
          'Missing SKU,,1000,500,0,0,0',
        ].join('\n')
      ),
    });

    await expect(page.getByText('launch-products.csv')).toBeVisible();
    await expect(page.getByLabel(/Product name/)).toHaveValue('Name');
    await expect(page.getByLabel(/Opening stock/)).toHaveValue('Opening stock');
    await page.getByRole('button', { name: 'Validate and preview' }).click();

    await expect(page.getByTestId('data-import-summary-ready')).toContainText('1');
    await expect(page.getByTestId('data-import-summary-duplicates')).toContainText('1');
    await expect(page.getByTestId('data-import-summary-invalid')).toContainText('1');
    await expect(page.getByTestId('data-import-preview-row-3')).toContainText(
      'SKU is repeated in this file'
    );
    await captureEvidence(page, 'eng-123a-import-preview-en');

    await page.getByRole('button', { name: 'Import 1 ready row' }).click();
    const report = page.getByTestId('data-import-report');
    await expect(report).toContainText('Import complete');
    await expect(report).toContainText('Products created: 1. Opening stock records: 1.');
    await expect(page.getByRole('button', { name: 'Import completed' })).toBeDisabled();
    await expect(page.getByTestId('data-import-report-stockInitialized')).toContainText('1');
    await captureEvidence(page, 'eng-123a-import-report-en');

    const downloadPromise = page.waitForEvent('download');
    await report.getByRole('button', { name: 'Download report' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^puntovivo-launch-import-.+\.csv$/);
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const reportCsv = await readFile(downloadPath!, 'utf8');
    expect(reportCsv).toContain(productSku);
    expect(reportCsv).toContain('Imported');
    expect(reportCsv).toContain('Skipped');
    expect(reportCsv).toContain('Invalid');

    await page.goto('/products');
    await page.getByPlaceholder('Search products...').fill(productName);
    await expect(page.getByText(productName, { exact: true })).toBeVisible({ timeout: 15_000 });

    await page.goto('/inventory');
    await page.getByRole('button', { name: 'Stock Query' }).click();
    await page.getByPlaceholder('Search stock by product...').fill(productName);
    const stockRow = page.locator('tr', { hasText: productSku }).first();
    await expect(stockRow).toBeVisible({ timeout: 15_000 });
    await expect(stockRow.getByText('7', { exact: true }).first()).toBeVisible();
    await expectNoClientIssues(tracker);
  });

  test('Spanish admin previews and imports a localized launch template', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const suffix = `${testInfo.parallelIndex}-${Date.now()}`;
    const productSku = `E2E-LANZAMIENTO-${suffix}`;
    await loginAs(page, 'admin', { spanish: true });
    await page.goto('/data-import');

    await expect(
      page
        .getByTestId('data-import-page')
        .getByRole('heading', { name: 'Importar datos', level: 1 })
    ).toBeVisible();
    await expect(page.getByText('Elige un archivo de origen')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Descargar plantilla' })).toBeVisible();

    await page.locator('#data-import-file').setInputFiles({
      name: 'productos-lanzamiento.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [
          'Nombre del producto;SKU;Precio de venta;Costo;Stock de apertura;Stock mínimo;Tasa de impuesto',
          `Café importado ${suffix};${productSku};1.234,50;800,25;2;1;19`,
        ].join('\n')
      ),
    });
    await expect(page.getByLabel(/Nombre del producto/)).toHaveValue('Nombre del producto');
    await expect(page.getByLabel(/Stock de apertura/)).toHaveValue('Stock de apertura');
    await page.getByRole('button', { name: 'Validar y previsualizar' }).click();

    await expect(page.getByTestId('data-import-summary-ready')).toContainText('1');
    await expect(page.getByTestId('data-import-preview-row-2')).toContainText('1234.5');
    await captureEvidence(page, 'eng-123a-import-preview-es');

    await page.getByRole('button', { name: 'Importar 1 fila lista' }).click();
    const report = page.getByTestId('data-import-report');
    await expect(report).toContainText('Importación completada');
    await expect(report).toContainText('Productos creados: 1. Registros de stock de apertura: 1.');
    await expect(page.getByRole('button', { name: 'Importación completada' })).toBeDisabled();
    await captureEvidence(page, 'eng-123a-import-report-es');
    await expectNoClientIssues(tracker);
  });
});
