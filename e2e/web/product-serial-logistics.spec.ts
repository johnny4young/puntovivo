/** serialized procurement, supplier return and exact inter-site transfer. */
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  expectSuccessToast,
  login,
} from './support/app.js';
import {
  findLatestPurchaseForProduct,
  findLatestTransferByNotes,
  findProductBySku,
  getProductSerials,
  getPurchaseById,
  getTransferById,
  getTransferSerials,
  seedPurchaseScenario,
} from './support/db.js';

async function captureEvidence(page: Page, name: string, locator?: Locator) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  if (locator) {
    await locator.screenshot({
      animations: 'disabled',
      path: path.join(auditDir, `${name}.png`),
    });
    return;
  }
  await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: path.join(auditDir, `${name}.png`),
  });
}

async function pollForRecord<T>(reader: () => T | null): Promise<T> {
  await expect.poll(reader, { timeout: 15_000 }).not.toBeNull();
  const record = reader();
  if (record === null) {
    throw new Error('Expected record to be available after polling');
  }
  return record;
}

function transferHistory(page: Page) {
  return page
    .locator('.card')
    .filter({
      has: page.getByRole('heading', { name: /Transfer history|Historial de transferencias/ }),
    })
    .first();
}

test('admin preserves exact serial identities from purchase through return and transfer', async ({
  page,
}, testInfo) => {
  const tracker = attachClientIssueTracker(page);
  const suffix = `${testInfo.parallelIndex}-${Date.now()}`;
  const scenario = seedPurchaseScenario(`serial-logistics-${suffix}`);
  const productName = `E2E Serialized Scanner ${suffix}`;
  const productSku = `E2E-SER-LOG-${suffix}`;
  const serials = [`LOG-${suffix}-001`, `LOG-${suffix}-002`, `LOG-${suffix}-003`];
  const returnReason = `E2E exact supplier return ${suffix}`;
  const transferNotes = `E2E exact serial transfer ${suffix}`;

  await login(page, {
    email: scenario.admin.email,
    password: scenario.admin.password,
    defaultPath: '/dashboard',
  });

  await page.goto('/products');
  await page.getByRole('button', { name: 'Add Product' }).click();
  const productDialog = page.getByRole('dialog', { name: 'Create Product' });
  await productDialog.locator('#product-name').fill(productName);
  await productDialog.locator('#product-sku').fill(productSku);
  await productDialog.getByRole('checkbox', { name: 'Track serial numbers' }).check();
  await productDialog.getByRole('tab', { name: 'Units' }).click();
  await productDialog
    .getByRole('tabpanel', { name: 'Units' })
    .locator('select')
    .selectOption({ index: 1 });
  await productDialog.getByRole('button', { name: 'Create Product' }).click();
  await expect(productDialog).toBeHidden({ timeout: 15_000 });

  const product = await pollForRecord(() => findProductBySku(productSku));
  expect(product.tracksSerials).toBe(1);

  await page.goto('/purchases');
  await page.getByRole('button', { name: 'Add Product' }).first().click();
  const addProductDialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByRole('heading', { name: 'Add Product to Purchase' }) })
    .last();
  await addProductDialog.getByPlaceholder('Search by SKU, name, or barcode').fill(productSku);
  const productRow = addProductDialog.locator('tr', { hasText: productSku }).first();
  await expect(productRow).toBeVisible({ timeout: 15_000 });
  await productRow.click();
  await addProductDialog.getByRole('button', { name: 'Add to purchase' }).click();
  await expect(addProductDialog).toBeHidden();

  const purchaseRow = page.locator('tr', { hasText: productSku }).first();
  await purchaseRow
    .getByLabel('Serial numbers')
    .fill(`${serials[0]}\n${serials[0].toLocaleLowerCase('en-US')}`);
  await expect(
    purchaseRow.getByText('Remove duplicate serial numbers before continuing')
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Register Purchase' }).first()).toBeDisabled();
  await captureEvidence(page, 'eng-110d-purchase-duplicate-serial-validation-en');
  await purchaseRow.getByLabel('Serial numbers').fill(serials.join('\n'));
  await expect(
    purchaseRow.getByText('Remove duplicate serial numbers before continuing')
  ).toHaveCount(0);
  const purchaseQuantity = purchaseRow.locator('input[type="number"]').first();
  await expect(purchaseQuantity).toHaveValue('3');
  await expect(purchaseQuantity).toHaveAttribute('readonly');
  await purchaseRow.locator('input[type="number"]').nth(1).fill('1200');
  await captureEvidence(page, 'eng-110d-purchase-serial-capture-en');

  await page.getByRole('button', { name: 'Register Purchase' }).first().click();
  const finalizeDialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByRole('heading', { name: 'Register Purchase' }) })
    .last();
  await expect(finalizeDialog).toBeVisible({ timeout: 15_000 });
  await finalizeDialog.locator('#purchase-provider').selectOption(scenario.provider.id);
  await finalizeDialog.locator('#purchase-notes').fill('E2E serialized purchase receipt');
  await finalizeDialog.getByRole('button', { name: 'Register Purchase' }).click();
  await expect(finalizeDialog).toBeHidden({ timeout: 15_000 });
  await expectSuccessToast(page, 'Purchase registered');

  const purchase = await pollForRecord(() =>
    findLatestPurchaseForProduct(product.id, scenario.admin.id)
  );
  expect(purchase.status).toBe('completed');
  await expect.poll(() => getProductSerials(product.id)).toHaveLength(3);
  const receivedSerials = getProductSerials(product.id);
  expect(receivedSerials.map(serial => serial.serialNumber)).toEqual(serials);
  expect(receivedSerials.every(serial => serial.status === 'in_stock')).toBe(true);
  expect(receivedSerials.every(serial => serial.currentSiteId === purchase.siteId)).toBe(true);
  expect(receivedSerials.every(serial => serial.sourcePurchaseItemId !== null)).toBe(true);

  await page.getByPlaceholder('Search by purchase number...').fill(purchase.purchaseNumber);
  await page.getByRole('button', { name: `View ${purchase.purchaseNumber}` }).click();
  const purchaseDetails = page.getByRole('dialog', {
    name: new RegExp(`Purchase ${purchase.purchaseNumber}`),
  });
  await expect(purchaseDetails).toBeVisible();
  await purchaseDetails.getByRole('button', { name: 'Return Items', exact: true }).click();
  const returnDialog = page
    .locator('[role="dialog"]')
    .filter({
      has: page.getByRole('heading', { name: `Return Items for ${purchase.purchaseNumber}` }),
    })
    .last();
  await expect(returnDialog).toBeVisible();
  await returnDialog.getByRole('checkbox', { name: serials[2] }).check();
  await expect(returnDialog.getByRole('spinbutton', { name: 'Return Quantity' })).toHaveValue('1');
  await expect(returnDialog.getByRole('spinbutton', { name: 'Return Quantity' })).toHaveAttribute(
    'readonly'
  );
  await returnDialog.locator('#purchase-return-reason').fill(returnReason);
  await captureEvidence(page, 'eng-110d-purchase-exact-return-en');
  await returnDialog.getByRole('button', { name: 'Record Return' }).click();
  await expect(returnDialog).toBeHidden({ timeout: 15_000 });
  await expectSuccessToast(page, 'Purchase return recorded and stock reduced');

  await expect
    .poll(() => getPurchaseById(purchase.id), { timeout: 15_000 })
    .toMatchObject({ status: 'partial_returned' });
  await expect
    .poll(() => getProductSerials(product.id).map(serial => serial.status))
    .toEqual(['in_stock', 'in_stock', 'returned_to_supplier']);

  await page.goto('/inventory');
  await page.getByRole('button', { name: 'By Site' }).click();
  await page.locator('#inventory-balances-site').selectOption(purchase.siteId);
  const destinationSite = scenario.sites.find(site => site.id !== purchase.siteId);
  expect(destinationSite).toBeTruthy();
  await page.getByRole('button', { name: 'Transfer stock' }).click();
  const transferDialog = page.getByRole('dialog', { name: 'Transfer stock between sites' });
  await expect(transferDialog).toBeVisible({ timeout: 15_000 });
  await transferDialog.getByRole('combobox', { name: 'To site' }).selectOption(destinationSite!.id);
  await transferDialog.getByRole('combobox', { name: 'Product' }).selectOption(product.id);
  await transferDialog.getByRole('checkbox', { name: serials[0] }).check();
  await transferDialog.getByRole('checkbox', { name: serials[1] }).check();
  await expect(transferDialog.getByRole('checkbox', { name: serials[2] })).toHaveCount(0);
  await expect(transferDialog.getByRole('spinbutton', { name: 'Quantity' })).toHaveValue('2');
  await expect(transferDialog.getByRole('spinbutton', { name: 'Quantity' })).toHaveAttribute(
    'readonly'
  );
  await transferDialog.getByLabel('Notes').fill(transferNotes);
  await transferDialog.getByLabel('Ship now, receive later').check();
  await captureEvidence(page, 'eng-110d-transfer-exact-serials-en');
  await transferDialog.getByRole('button', { name: 'Transfer' }).click();
  await expect(transferDialog).toBeHidden({ timeout: 15_000 });
  await expectSuccessToast(page, 'Transfer recorded');

  const transfer = await pollForRecord(() => findLatestTransferByNotes(transferNotes));
  expect(transfer.status).toBe('in_transit');
  expect(getTransferSerials(transfer.id).map(serial => serial.serialNumber)).toEqual(
    serials.slice(0, 2)
  );
  await expect
    .poll(() => getProductSerials(product.id).map(serial => serial.status))
    .toEqual(['in_transit', 'in_transit', 'returned_to_supplier']);

  await ensureLanguage(page, 'es');
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'Por sede' }).click();
  const transferRow = transferHistory(page).locator(`tr[data-row-id="${transfer.id}"]`);
  await expect(transferRow).toContainText('En tránsito');
  await transferRow.getByRole('button', { name: 'Recibir' }).click();
  const receiveDialog = page.getByRole('dialog', { name: 'Recibir transferencia' });
  await expect(receiveDialog).toBeVisible();
  await expect(receiveDialog.getByText(serials[0])).toBeVisible();
  await expect(receiveDialog.getByText(serials[1])).toBeVisible();
  const receivedQuantity = receiveDialog.getByRole('spinbutton', {
    name: `Cantidad recibida de ${productName}`,
  });
  await expect(receivedQuantity).toHaveValue('2');
  await expect(receivedQuantity).toHaveAttribute('readonly');
  await captureEvidence(page, 'eng-110d-transfer-receive-es');
  await receiveDialog.getByRole('button', { name: 'Confirmar recepción' }).click();
  await expect(receiveDialog).toBeHidden({ timeout: 15_000 });
  await expectSuccessToast(page, 'Transferencia recibida');

  await expect
    .poll(() => getTransferById(transfer.id), { timeout: 15_000 })
    .toMatchObject({ status: 'completed', toSiteId: destinationSite!.id });
  await expect
    .poll(() => getProductSerials(product.id))
    .toEqual([
      expect.objectContaining({
        serialNumber: serials[0],
        status: 'in_stock',
        currentSiteId: destinationSite!.id,
      }),
      expect.objectContaining({
        serialNumber: serials[1],
        status: 'in_stock',
        currentSiteId: destinationSite!.id,
      }),
      expect.objectContaining({
        serialNumber: serials[2],
        status: 'returned_to_supplier',
        currentSiteId: purchase.siteId,
      }),
    ]);
  await expect(transferRow).toContainText('Completada');
  await transferRow.getByRole('button', { name: 'Detalles' }).click();
  const detailsDialog = page.getByRole('dialog', { name: 'Detalle de la transferencia' });
  await expect(detailsDialog.getByText(serials[0])).toBeVisible();
  await expect(detailsDialog.getByText(serials[1])).toBeVisible();
  await captureEvidence(page, 'eng-110d-transfer-provenance-es', detailsDialog);

  await expectNoClientIssues(tracker);
});
