/** Exact lot procurement and transformation round-trip through the live web UI. */

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
  findProductBySku,
  getInventoryBalance,
  getInventoryLots,
  getInventoryValuation,
  getLatestInventoryTransformation,
  seedPurchaseScenario,
} from './support/db.js';

async function captureEvidence(page: Page, name: string, locator?: Locator) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  const options = {
    animations: 'disabled' as const,
    path: path.join(auditDir, `${name}.png`),
  };
  if (locator) {
    await locator.screenshot(options);
    return;
  }
  await page.screenshot({ ...options, fullPage: true });
}

async function pollForRecord<T>(reader: () => T | null): Promise<T> {
  await expect.poll(reader, { timeout: 15_000 }).not.toBeNull();
  const record = reader();
  if (record === null) throw new Error('Expected persisted evidence after polling');
  return record;
}

async function switchToSite(page: Page, target: { id: string; name: string }, tenantId: string) {
  const trigger = page.locator('header button[name="site"]');
  if ((await trigger.innerText()).trim() !== target.name) {
    await trigger.click();
    await page.getByRole('option', { name: target.name, exact: true }).click();
  }
  await expect(trigger).toHaveText(target.name);
  await expect
    .poll(() =>
      page.evaluate(key => window.localStorage.getItem(key), `active_site_id:${tenantId}`)
    )
    .toBe(target.id);
}

async function createLotProduct(page: Page, input: { name: string; sku: string; price: string }) {
  await page.getByRole('button', { name: 'Add Product' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Product' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#product-name').fill(input.name);
  await dialog.locator('#product-sku').fill(input.sku);
  await dialog.locator('#product-price').fill(input.price);
  await dialog.getByRole('button', { name: 'Advanced settings' }).click();
  await dialog.getByRole('checkbox', { name: 'Track lots and expiry' }).check();
  await dialog.getByRole('tab', { name: 'Units' }).click();
  await dialog.getByRole('button', { name: 'Add unit' }).click();
  await dialog
    .getByRole('tabpanel', { name: 'Units' })
    .locator('select')
    .selectOption({ index: 1 });
  await dialog.getByRole('checkbox', { name: 'Base unit' }).check();
  await dialog.getByRole('button', { name: 'Create Product' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function receiveExactLot(
  page: Page,
  input: {
    productSku: string;
    productName: string;
    providerId: string;
    lotNumber: string;
  }
) {
  await page.goto('/purchases');
  await page.getByRole('button', { name: 'Add Product' }).first().click();
  const addDialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByRole('heading', { name: 'Add Product to Purchase' }) })
    .last();
  await addDialog.getByPlaceholder('Search by SKU, name, or barcode').fill(input.productSku);
  const searchRow = addDialog.locator('tr', { hasText: input.productSku }).first();
  await expect(searchRow).toBeVisible({ timeout: 15_000 });
  await searchRow.click();
  await addDialog.getByRole('button', { name: 'Add to purchase' }).click();
  await expect(addDialog).toBeHidden();

  const purchaseRow = page.locator('tr', { hasText: input.productSku }).first();
  await purchaseRow.locator('input[type="number"]').first().fill('4');
  await purchaseRow.locator('input[type="number"]').nth(1).fill('2500');
  await page.getByRole('button', { name: 'Register Purchase' }).first().click();

  const finalizeDialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByRole('heading', { name: 'Register Purchase' }) })
    .last();
  await expect(finalizeDialog).toContainText(input.productName);
  await finalizeDialog.locator('#purchase-provider').selectOption(input.providerId);
  await finalizeDialog.getByLabel('Lot number').fill(input.lotNumber);
  await finalizeDialog.getByLabel('Expiry date').fill('2030-12-31');
  await expect(finalizeDialog.getByLabel('Base quantity')).toHaveValue('4');
  await finalizeDialog.locator('#purchase-notes').fill('E2E exact lot receipt');
  await finalizeDialog.getByRole('button', { name: 'Register Purchase' }).click();
  await expect(finalizeDialog).toBeHidden({ timeout: 15_000 });
  await expectSuccessToast(page, 'Purchase registered');
}

test('manager procures an exact lot and freezes it through a transformation', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const tracker = attachClientIssueTracker(page);
  const suffix = `${testInfo.parallelIndex}-${Date.now()}`;
  const scenario = seedPurchaseScenario(`lot-transformation-${suffix}`);
  const inputName = `E2E Tracked Raw ${suffix}`;
  const inputSku = `E2E-TRAW-${suffix}`;
  const outputName = `E2E Tracked Output ${suffix}`;
  const outputSku = `E2E-TOUT-${suffix}`;
  const inputLot = `RAW-${suffix}`;
  const outputLot = `OUT-${suffix}`;
  const recipeName = `E2E exact preparation ${suffix}`;
  const activeSite = scenario.sites[0]!;

  await login(page, {
    email: scenario.manager.email,
    password: scenario.manager.password,
    defaultPath: '/dashboard',
  });
  await switchToSite(page, activeSite, scenario.tenantId);

  await page.goto('/products');
  await createLotProduct(page, { name: inputName, sku: inputSku, price: '5000' });
  await createLotProduct(page, { name: outputName, sku: outputSku, price: '9000' });
  const inputProduct = await pollForRecord(() => findProductBySku(inputSku));
  const outputProduct = await pollForRecord(() => findProductBySku(outputSku));
  expect(inputProduct.tracksLots).toBe(1);
  expect(outputProduct.tracksLots).toBe(1);

  await receiveExactLot(page, {
    productSku: inputSku,
    productName: inputName,
    providerId: scenario.provider.id,
    lotNumber: inputLot,
  });
  await expect.poll(() => getInventoryLots(inputProduct.id)).toHaveLength(1);
  const [receivedLot] = getInventoryLots(inputProduct.id);
  expect(receivedLot).toMatchObject({
    siteId: activeSite.id,
    lotNumber: inputLot,
    onHand: 4,
    unitCost: 2500,
    status: 'active',
  });
  expect(receivedLot?.sourcePurchaseItemId).not.toBeNull();
  const purchase = await pollForRecord(() =>
    findLatestPurchaseForProduct(inputProduct.id, scenario.manager.id)
  );

  // Prime the real purchase-detail query with all four received units still
  // returnable. The later reopen happens in the same SPA/QueryClient, inside
  // the app-wide five-minute cache window, after the transformation consumes
  // the lot. This catches stale debit controls rather than merely exercising a
  // first read of the post-transformation state.
  await page.getByPlaceholder('Search by purchase number...').fill(purchase.purchaseNumber);
  await page.getByRole('button', { name: `View ${purchase.purchaseNumber}` }).click();
  const initialPurchaseDetails = page.getByRole('dialog', {
    name: `Purchase ${purchase.purchaseNumber}`,
  });
  await expect(initialPurchaseDetails).toContainText(
    `${inputLot} · received 4 · available to return 4`
  );
  await expect(
    initialPurchaseDetails.getByRole('columnheader', { name: 'Available to return' })
  ).toBeVisible();
  const initialPurchasedProductRow = initialPurchaseDetails
    .locator('tbody tr', { hasText: inputSku })
    .first();
  await expect(initialPurchasedProductRow.getByRole('cell').nth(3)).toHaveText('4');
  await expect(initialPurchaseDetails.getByRole('button', { name: 'Return Items' })).toBeVisible();
  await initialPurchaseDetails.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(initialPurchaseDetails).toBeHidden();

  await page.keyboard.press('Alt+3');
  await expect(page).toHaveURL(/\/inventory$/);
  await page.getByRole('button', { name: 'Transformations' }).click();
  await expect(page.getByTestId('inventory-transformations-panel')).toBeVisible();
  await page.getByRole('button', { name: 'New recipe' }).click();
  const recipeDialog = page.getByRole('dialog', { name: 'Create transformation recipe' });
  await recipeDialog.getByLabel('Recipe name').fill(recipeName);
  const productSearch = recipeDialog.getByLabel('Find more catalog products');
  const productSelects = recipeDialog.getByLabel('Stock product');
  await productSearch.fill(inputSku);
  await expect(
    productSelects.first().getByRole('option', { name: `${inputName} · ${inputSku}` })
  ).toBeAttached();
  await productSelects.first().selectOption(inputProduct.id);
  await productSearch.fill(outputSku);
  await expect(
    productSelects.nth(1).getByRole('option', { name: `${outputName} · ${outputSku}` })
  ).toBeAttached();
  await productSelects.nth(1).selectOption(outputProduct.id);
  const recipeQuantities = recipeDialog.getByLabel('Base quantity');
  await recipeQuantities.first().fill('4');
  await recipeQuantities.nth(1).fill('3');
  await recipeDialog.getByRole('button', { name: 'Save recipe' }).click();
  await expect(recipeDialog).toBeHidden({ timeout: 15_000 });
  await expectSuccessToast(page, 'Transformation recipe saved');

  const recipeCard = page.locator('article').filter({ hasText: recipeName }).first();
  await recipeCard.getByRole('button', { name: 'Execute' }).click();
  const executeDialog = page.getByRole('dialog', { name: `Execute ${recipeName}` });
  await executeDialog.getByLabel(`Quantity from lot ${inputLot}`).first().fill('4');
  await executeDialog.getByLabel('New output lot').fill(outputLot);
  await executeDialog.getByLabel('Expiry date').fill('2031-12-31');
  await executeDialog.getByLabel('Execution notes').fill('E2E exact lot transformation');
  await executeDialog.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(executeDialog).toBeHidden({ timeout: 15_000 });
  await expectSuccessToast(page, 'Inventory transformation completed');

  const transformation = await pollForRecord(() => getLatestInventoryTransformation(recipeName));
  expect(transformation).toMatchObject({
    status: 'completed',
    inputProductId: inputProduct.id,
    inputLotNumber: inputLot,
    inputQuantity: 4,
    outputProductId: outputProduct.id,
    outputLotNumber: outputLot,
    outputQuantity: 3,
    totalInputCost: 10_000,
    totalOutputCost: 10_000,
  });
  expect(getInventoryBalance(activeSite.id, inputProduct.id)?.onHand).toBe(0);
  expect(getInventoryBalance(activeSite.id, outputProduct.id)?.onHand).toBe(3);
  expect(getInventoryLots(inputProduct.id)[0]?.onHand).toBe(0);
  expect(getInventoryLots(outputProduct.id)[0]).toMatchObject({
    lotNumber: outputLot,
    onHand: 3,
    unitCost: 3333.33,
    status: 'active',
  });
  const valuedOutput = findProductBySku(outputSku);
  expect(valuedOutput).toMatchObject({
    cost: 3333.33,
    initialCost: 3333.33,
  });
  expect((valuedOutput?.initialCost ?? 0) * 3).toBeCloseTo(9999.99, 2);
  const expectedInventoryValue = getInventoryValuation(scenario.tenantId);
  const inventoryValueKpi = page.locator('.pv-kpi').filter({ hasText: 'Inventory value' });
  await expect
    .poll(async () => {
      const text = await inventoryValueKpi.innerText();
      return Number(text.replace(/[^\d.-]/g, ''));
    })
    .toBe(Math.round(expectedInventoryValue));

  const historyCard = page.locator('article').filter({ hasText: recipeName }).last();
  await historyCard.getByRole('button', { name: 'Details' }).click();
  const details = page.getByTestId('inventory-transformation-details');
  await expect(details).toContainText(inputLot);
  await expect(details).toContainText(outputLot);
  await expect(details).toContainText(inputSku);
  await expect(details).toContainText(outputSku);
  await captureEvidence(page, 'pr8-lot-transformation-details', details);
  await page.getByRole('button', { name: 'Close modal' }).click();

  await ensureLanguage(page, 'es');
  await page.keyboard.press('Alt+4');
  await expect(page).toHaveURL(/\/purchases$/);
  await page.getByPlaceholder('Buscar por número de recibo...').fill(purchase.purchaseNumber);
  await page.getByRole('button', { name: `Ver ${purchase.purchaseNumber}` }).click();
  const purchaseDetails = page.getByRole('dialog', {
    name: `Compra ${purchase.purchaseNumber}`,
  });
  await expect(purchaseDetails).toContainText(
    `${inputLot} · recibidas 4 · disponibles para devolución 0`
  );
  await expect(
    purchaseDetails.getByRole('columnheader', { name: 'Disponible para devolución' })
  ).toBeVisible();
  const purchasedProductRow = purchaseDetails.locator('tbody tr', { hasText: inputSku }).first();
  await expect(purchasedProductRow.getByRole('cell').nth(3)).toHaveText('0');
  await expect(purchaseDetails.getByRole('button', { name: 'Devolver artículos' })).toHaveCount(0);
  await expect(purchaseDetails).toContainText(/vence .*2030/i);
  await expect(purchaseDetails).toContainText('estado actual: agotado');
  await captureEvidence(page, 'pr8-purchase-lot-details-es', purchaseDetails);
  await purchaseDetails.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(purchaseDetails).toBeHidden();

  await ensureLanguage(page, 'en');
  await page.keyboard.press('Alt+3');
  await expect(page).toHaveURL(/\/inventory$/);
  await page.reload();
  await page.getByRole('button', { name: 'Transformations' }).click();
  const persistedHistory = page.locator('article').filter({ hasText: recipeName }).last();
  await expect(persistedHistory).toContainText('Completed');
  await captureEvidence(page, 'pr8-lot-transformation-reload');
  await expectNoClientIssues(tracker);
});
