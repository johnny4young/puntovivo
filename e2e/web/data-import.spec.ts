/** ENG-123 — live launch-import journeys, persistence proof, and visual evidence. */
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
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

async function chooseRealData(page: Page, spanish = false) {
  await page
    .getByRole('radio', {
      name: spanish ? /Datos reales del negocio/ : /Real business data/,
    })
    .click();
  await expect(page.getByTestId('data-import-rollback-guidance')).toContainText(
    spanish ? 'Crea un punto de restauración' : 'Create a restore point'
  );
}

async function confirmRealData(page: Page, spanish = false) {
  await page
    .getByLabel(
      spanish
        ? /Confirmo que este archivo contiene datos reales del negocio/
        : /I confirm that this file contains real business data/
    )
    .check();
}

test.describe('launch data import (ENG-123)', () => {
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
    await chooseRealData(page);

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

    await confirmRealData(page);
    await page.getByRole('button', { name: 'Import 1 ready row' }).click();
    const report = page.getByTestId('data-import-report');
    await expect(report).toContainText('Import complete');
    await expect(report).toContainText('Products created: 1. Opening stock records: 1.');
    await expect(page.getByRole('button', { name: 'Import completed' })).toBeDisabled();
    await expect(page.getByTestId('data-import-report-stockInitialized')).toContainText('1');
    await expect(page.getByTestId('data-import-report-rollback')).toContainText(
      'restore the encrypted backup'
    );
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
    await expect(
      page.getByRole('heading', { name: 'Elige cómo se usará este archivo' })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^Productos e inventario/ })).toBeDisabled();
    await chooseRealData(page, true);
    await captureEvidence(page, 'eng-123c-real-mode-rollback-es');
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

    await confirmRealData(page, true);
    await page.getByRole('button', { name: 'Importar 1 fila lista' }).click();
    const report = page.getByTestId('data-import-report');
    await expect(report).toContainText('Importación completada');
    await expect(report).toContainText('Productos creados: 1. Registros de stock de apertura: 1.');
    await expect(page.getByTestId('data-import-report-rollback')).toContainText(
      'restaura el respaldo cifrado'
    );
    await expect(page.getByRole('button', { name: 'Importación completada' })).toBeDisabled();
    await captureEvidence(page, 'eng-123a-import-report-es');
    await expectNoClientIssues(tracker);
  });

  test('admin imports customers with row-level validation and verifies persistence', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const suffix = `${testInfo.parallelIndex}-${Date.now()}`;
    const customerName = `E2E Launch Customer ${suffix}`;
    const customerTaxId = `E2E-CUSTOMER-${suffix}`;

    await loginAs(page, 'admin');
    await page.goto('/data-import');
    await chooseRealData(page);
    await page.getByRole('button', { name: /^Customers/ }).click();
    await expect(page.getByTestId('data-import-customers-workflow')).toBeVisible();

    await page.locator('#data-import-file').setInputFiles({
      name: 'launch-customers.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [
          'Customer name,Tax ID,Email,Phone,City',
          `${customerName},${customerTaxId},customer-${suffix}@example.com,+57 300 000 0000,Bogotá`,
          `Repeated customer,${customerTaxId},duplicate-${suffix}@example.com,,`,
          ',,broken-email,,',
        ].join('\n')
      ),
    });

    await expect(page.getByLabel(/^Name/)).toHaveValue('Customer name');
    await page.getByRole('button', { name: 'Validate and preview' }).click();
    await expect(page.getByTestId('data-import-summary-ready')).toContainText('1');
    await expect(page.getByTestId('data-import-summary-duplicates')).toContainText('1');
    await expect(page.getByTestId('data-import-summary-invalid')).toContainText('1');
    await expect(page.getByTestId('data-import-preview-row-3')).toContainText(
      'Tax ID is repeated in this file'
    );
    await captureEvidence(page, 'eng-123b-customers-preview-en');

    await confirmRealData(page);
    await page.getByRole('button', { name: 'Import 1 ready row' }).click();
    const report = page.getByTestId('data-import-report');
    await expect(report).toContainText('Customers created: 1.');
    await captureEvidence(page, 'eng-123b-customers-report-en');

    await page.goto('/customers');
    await page.getByPlaceholder('Search customers...').fill(customerName);
    await expect(page.getByText(customerName, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expectNoClientIssues(tracker);
  });

  test('Spanish admin validates a city code and imports a supplier', async ({ page }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const suffix = `${testInfo.parallelIndex}-${Date.now()}`;
    const providerName = `Proveedor E2E ${suffix}`;

    await loginAs(page, 'admin', { spanish: true });
    await page.goto('/data-import');
    await chooseRealData(page, true);
    await page.getByRole('button', { name: /^Proveedores/ }).click();
    await expect(page.getByTestId('data-import-providers-workflow')).toBeVisible();

    await page.locator('#data-import-file').setInputFiles({
      name: 'proveedores-lanzamiento.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [
          'Nombre del proveedor;NIT;Correo electrónico;Nombre de contacto;Código de ciudad',
          `${providerName};E2E-PROVIDER-${suffix};proveedor-${suffix}@ejemplo.com;Contacto E2E;`,
          `Proveedor con ciudad desconocida ${suffix};E2E-PROVIDER-CITY-${suffix};ciudad-${suffix}@ejemplo.com;Contacto E2E;UNKNOWN-E2E`,
        ].join('\n')
      ),
    });

    await expect(page.locator('#data-import-map-name')).toHaveValue('Nombre del proveedor');
    await expect(page.getByLabel(/Código de ciudad/)).toHaveValue('Código de ciudad');
    await page.getByRole('button', { name: 'Validar y previsualizar' }).click();
    await expect(page.getByTestId('data-import-summary-ready')).toContainText('1');
    await expect(page.getByTestId('data-import-summary-invalid')).toContainText('1');
    await expect(page.getByTestId('data-import-preview-row-2')).toContainText('E2E-PROVIDER');
    await expect(page.getByTestId('data-import-preview-row-3')).toContainText(
      'El código de ciudad no existe en este negocio'
    );
    await captureEvidence(page, 'eng-123b-providers-preview-es');

    await confirmRealData(page, true);
    await page.getByRole('button', { name: 'Importar 1 fila lista' }).click();
    await expect(page.getByTestId('data-import-report')).toContainText('Proveedores creados: 1.');
    await captureEvidence(page, 'eng-123b-providers-report-es');

    await page.goto('/providers');
    await page.getByPlaceholder('Buscar proveedores...').fill(providerName);
    await expect(page.getByText(providerName, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expectNoClientIssues(tracker);
  });

  test('admin imports a customer opening receivable and verifies the ledger round trip', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const suffix = `${testInfo.parallelIndex}-${Date.now()}`;
    const customerName = `E2E Receivable Customer ${suffix}`;
    const customerTaxId = `E2E-RECEIVABLE-${suffix}`;
    const customerEmail = `receivable-${suffix}@example.com`;
    const receivableCsv = [
      'Tax ID,Email,Opening balance,Note',
      `${customerTaxId},${customerEmail},5432.10,Legacy receivable`,
      `UNKNOWN-${suffix},,100,Must stay invalid`,
    ].join('\n');

    await loginAs(page, 'admin');
    await page.goto('/data-import');
    await chooseRealData(page);
    await page.getByRole('button', { name: /^Customers/ }).click();
    await page.locator('#data-import-file').setInputFiles({
      name: 'receivable-customer.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        `Customer name,Tax ID,Email\n${customerName},${customerTaxId},${customerEmail}`
      ),
    });
    await page.getByRole('button', { name: 'Validate and preview' }).click();
    await expect(page.getByTestId('data-import-summary-ready')).toContainText('1');
    await confirmRealData(page);
    await page.getByRole('button', { name: 'Import 1 ready row' }).click();
    await expect(page.getByTestId('data-import-report')).toContainText('Customers created: 1.');
    await page.getByRole('button', { name: /Dismiss 1 customer imported/ }).click();

    await page.getByRole('button', { name: /^Customer receivables/ }).click();
    await expect(page.getByTestId('data-import-customerBalances-workflow')).toBeVisible();
    await page.locator('#data-import-file').setInputFiles({
      name: 'opening-receivables.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(receivableCsv),
    });

    await expect(page.getByLabel(/Opening receivable/)).toHaveValue('Opening balance');
    await expect(page.getByLabel(/Tax ID/)).toHaveValue('Tax ID');
    await page.getByRole('button', { name: 'Validate and preview' }).click();
    await expect(page.getByTestId('data-import-summary-ready')).toContainText('1');
    await expect(page.getByTestId('data-import-summary-invalid')).toContainText('1');
    await expect(page.getByTestId('data-import-preview-row-2')).toContainText(customerName);
    await expect(page.getByTestId('data-import-preview-row-3')).toContainText(
      'No active customer matches this identity'
    );
    await captureEvidence(page, 'eng-123d-customer-receivables-preview-en');

    await confirmRealData(page);
    await page.getByRole('button', { name: 'Import 1 ready row' }).click();
    await expect(page.getByTestId('data-import-report')).toContainText(
      '1 opening receivable recorded.'
    );
    await expect(page.getByTestId('data-import-report-imported')).toContainText('1');
    await captureEvidence(page, 'eng-123d-customer-receivables-report-en');

    await page.goto('/customers');
    await page.getByPlaceholder('Search customers...').fill(customerName);
    const customerRow = page.locator('tr', { hasText: customerName }).first();
    await expect(customerRow).toBeVisible({ timeout: 15_000 });
    await customerRow.getByRole('button', { name: 'View account' }).click();
    await expect(page.getByRole('heading', { name: 'Account statement' })).toBeVisible();
    await expect(page.getByTestId('ledger-metric-balance')).toContainText(/5[,.]432/);
    const ledgerTable = page.getByTestId('ledger-rows-table');
    await expect(ledgerTable).toContainText('Adjustment');
    await expect(ledgerTable).toContainText('Legacy receivable');
    await captureEvidence(page, 'eng-123d-customer-ledger-roundtrip-en');

    await ensureLanguage(page, 'es');
    await page.goto('/data-import');
    await expect(
      page
        .getByTestId('data-import-page')
        .getByRole('heading', { name: 'Importar datos', level: 1 })
    ).toBeVisible();
    await chooseRealData(page, true);
    await page.getByRole('button', { name: /^Cartera inicial de clientes/ }).click();
    await page.locator('#data-import-file').setInputFiles({
      name: 'saldos-iniciales.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(receivableCsv),
    });
    await page.getByRole('button', { name: 'Validar y previsualizar' }).click();
    await expect(page.getByTestId('data-import-summary-duplicates')).toContainText('1');
    await expect(page.getByTestId('data-import-preview-row-2')).toContainText(
      'Este cliente ya tiene movimientos en su estado de cuenta'
    );
    await expect(page.getByTestId('data-import-preview-row-3')).toContainText(
      'Ningún cliente activo coincide con esta identidad'
    );
    await captureEvidence(page, 'eng-123d-customer-receivables-duplicate-es');
    await expectNoClientIssues(tracker);
  });

  test('demo mode validates fixture rows without exposing a commit path', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const suffix = `${testInfo.parallelIndex}-${Date.now()}`;
    const fixtureSku = `E2E-DEMO-${suffix}`;

    await loginAs(page, 'admin');
    await page.goto('/data-import');
    await expect(page.locator('#data-import-file')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Products and stock/ })).toBeDisabled();

    const demoMode = page.getByRole('radio', { name: /Demo data/ });
    const realMode = page.getByRole('radio', { name: /Real business data/ });
    await demoMode.focus();
    await page.keyboard.press('ArrowRight');
    await expect(realMode).toBeChecked();
    await page.keyboard.press('ArrowLeft');
    await expect(demoMode).toBeChecked();
    await expect(page.getByTestId('data-import-demo-boundary')).toContainText(
      'Preview-only boundary'
    );
    await page.locator('#data-import-file').setInputFiles({
      name: 'fixture-products.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`Name,SKU,Price\nFixture coffee,${fixtureSku},1000`),
    });
    await page.getByRole('button', { name: 'Validate and preview' }).click();

    await expect(page.getByTestId('data-import-summary-ready')).toContainText('1');
    await expect(page.getByTestId('data-import-demo-preview-only')).toContainText(
      'no row can be saved'
    );
    await expect(page.getByRole('button', { name: /Import 1 ready row/ })).toHaveCount(0);
    await captureEvidence(page, 'eng-123c-demo-preview-en');

    await page.goto('/products');
    await page.getByPlaceholder('Search products...').fill(fixtureSku);
    await expect(page.getByText(fixtureSku, { exact: true })).toHaveCount(0);
    await expectNoClientIssues(tracker);
  });
});
