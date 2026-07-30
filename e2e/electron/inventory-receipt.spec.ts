/**
 * The `inventory-receipt` operator journey, run against the desktop app.
 *
 * An admin provisions the supplier, then a manager creates a stocked catalog
 * item and records an exact two-unit receipt. The journey proves the purchase
 * read side, aggregate and site stock effects, and immutable actor-attributed
 * receipt evidence after a fresh authentication.
 *
 * @module e2e/electron/inventory-receipt
 */

import type { Locator, Page } from '@playwright/test';
import { electronTest as test, expect } from './fixtures.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { E2E_USERS, type E2EUserProfile } from '../shared/baseline.js';
import { createProduct, goToRoute, pinPrimarySite, signIn, signOut } from './support/journey.js';

const PRODUCT_NAME = 'E2E Receipt Product';
const PRODUCT_SKU = 'E2E-RECEIPT';
const PROVIDER_NAME = 'E2E Receipt Provider';
const OPENING_STOCK = 4;
const RECEIVED_QUANTITY = 2;
const EXPECTED_STOCK = OPENING_STOCK + RECEIVED_QUANTITY;
const RECEIPT_NOTE = 'Desktop receiving evidence';

function baselineUser(role: E2EUserProfile['role']): E2EUserProfile {
  const user = E2E_USERS.find(candidate => candidate.role === role);
  if (!user) throw new Error(`baseline did not seed a ${role}`);
  return user;
}

async function createProvider(page: Page): Promise<void> {
  await goToRoute(page, '/providers');
  await page.getByRole('button', { name: /add provider|agregar proveedor/i }).click();
  const dialog = page.getByRole('dialog', {
    name: /create provider|crear proveedor/i,
  });
  await expect(dialog).toBeVisible();
  await dialog.locator('#provider-name').fill(PROVIDER_NAME);
  await dialog.getByRole('button', { name: /create provider|crear proveedor/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText(PROVIDER_NAME, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

async function addReceiptLine(page: Page): Promise<Locator> {
  await page
    .getByRole('button', { name: /add product|agregar producto/i })
    .first()
    .click();
  const dialog = page.getByRole('dialog', {
    name: /add product to purchase|agregar producto a la compra/i,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: /search|buscar/i }).fill(PRODUCT_SKU);
  const productRow = dialog.getByTestId(`product-search-row-${PRODUCT_SKU}`);
  await expect(productRow).toBeVisible({ timeout: 15_000 });
  await productRow.click();
  await dialog.getByRole('button', { name: /add to purchase|agregar a la compra/i }).click();
  await expect(dialog).toBeHidden();

  const receiptLine = page.locator('tbody tr').filter({ hasText: PRODUCT_SKU }).first();
  await expect(receiptLine).toBeVisible();
  await receiptLine.locator('input[type="number"]').first().fill(String(RECEIVED_QUANTITY));
  await receiptLine.locator('input[type="number"]').nth(1).fill('1600');
  return receiptLine;
}

async function registerPurchase(page: Page): Promise<string> {
  await goToRoute(page, '/purchases');
  // Products and Purchases both expose an "Add Product" button. Wait for the
  // destination heading before resolving the button so a fast client-side
  // route change cannot click the stale Products-page control.
  await expect(page.getByRole('heading', { name: /purchases|compras/i, level: 1 })).toBeVisible();
  await addReceiptLine(page);
  await page
    .getByRole('button', { name: /register purchase|registrar compra/i })
    .first()
    .click();

  const dialog = page.getByRole('dialog', {
    name: /register purchase|registrar compra/i,
  });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.locator('#purchase-provider').selectOption({ label: PROVIDER_NAME });
  await dialog.locator('#purchase-notes').fill(RECEIPT_NOTE);
  await dialog.getByRole('button', { name: /register purchase|registrar compra/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  const historyRow = page.locator('tbody tr').filter({ hasText: PROVIDER_NAME }).first();
  await expect(historyRow).toBeVisible({ timeout: 15_000 });
  await expect(historyRow).toContainText(/completed|completado/i);
  const purchaseNumber = (await historyRow.locator('td').first().innerText()).trim();
  expect(purchaseNumber, 'purchase history exposes the completed receipt number').not.toBe('');
  return purchaseNumber;
}

async function expectPurchaseDetails(
  page: Page,
  purchaseNumber: string,
  siteName: string
): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`View ${purchaseNumber}`) }).click();
  const dialog = page.getByRole('dialog', {
    name: new RegExp(`Purchase ${purchaseNumber}`),
  });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText(PROVIDER_NAME, { exact: true })).toBeVisible();
  await expect(dialog.getByText(siteName, { exact: true })).toBeVisible();
  await expect(dialog.getByText('Completed', { exact: true })).toBeVisible();
  await expect(dialog.getByText(RECEIPT_NOTE, { exact: true })).toBeVisible();

  const line = dialog.locator('tbody tr').filter({ hasText: PRODUCT_SKU }).first();
  await expect(line).toBeVisible();
  await expect(line.locator('td').nth(1)).toHaveText(String(RECEIVED_QUANTITY));
  await expect(line.locator('td').nth(2)).toHaveText('0');
  await expect(line.locator('td').nth(3)).toHaveText(String(RECEIVED_QUANTITY));

  // Close the portal before changing routes. A history.pushState navigation
  // can update the URL while the modal still owns the interactive tree.
  await dialog.getByRole('button', { name: /close modal|cerrar modal/i }).click();
  await expect(dialog).toBeHidden();
}

async function expectInventoryEffects(page: Page, siteName: string): Promise<void> {
  await goToRoute(page, '/inventory');
  await expect(
    page.getByRole('heading', { name: /inventory|inventario/i, level: 1 })
  ).toBeVisible();
  await page.getByRole('button', { name: /stock query|consulta de stock/i }).click();
  await page
    .getByPlaceholder(/search stock by product|buscar stock por producto/i)
    .fill(PRODUCT_NAME);
  const aggregateRow = page.locator('tbody tr').filter({ hasText: PRODUCT_SKU }).first();
  await expect(aggregateRow).toBeVisible({ timeout: 15_000 });
  await expect(aggregateRow.locator('td').nth(1)).toContainText(String(EXPECTED_STOCK));

  await page.getByRole('button', { name: /by site|por sede/i }).click();
  await page.locator('#inventory-balances-site').selectOption({ label: siteName });
  await page
    .getByPlaceholder(/search balances by product|buscar balances por producto/i)
    .fill(PRODUCT_NAME);
  const siteRow = page.locator('tbody tr').filter({ hasText: PRODUCT_SKU }).first();
  await expect(siteRow).toBeVisible({ timeout: 15_000 });
  await expect(siteRow.locator('td').nth(1)).toHaveText(String(EXPECTED_STOCK));
}

async function expectReceiptAudit(
  page: Page,
  options: {
    purchaseNumber: string;
    manager: E2EUserProfile;
    siteName: string;
  }
): Promise<string> {
  await goToRoute(page, '/audit-logs');
  await expect(
    page.getByRole('heading', { name: /audit log|registro de auditoría/i, level: 1 })
  ).toBeVisible();
  await page.getByLabel(/action/i).selectOption('purchase.receive');
  const row = page
    .locator('tbody tr')
    .filter({ hasText: options.purchaseNumber })
    .filter({ hasText: options.manager.name })
    .first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText('Purchase received');
  await expect(row).toContainText(
    `${options.purchaseNumber} · ${RECEIVED_QUANTITY} base units received at ${options.siteName}`
  );
  const resourceId = (await row.locator('td').nth(3).locator('.font-mono').innerText()).trim();
  expect(resourceId, 'receipt audit exposes its immutable purchase resource id').not.toBe('');
  return resourceId;
}

test.describe('inventory receipt on the desktop app', () => {
  test('manager receives exact stock and preserves immutable receipt evidence', async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    const admin = baselineUser('admin');
    const manager = baselineUser('manager');

    await signIn(page, admin.email);
    await createProvider(page);

    await signOut(page);
    await signIn(page, manager.email);
    await pinPrimarySite(page);
    const siteName = (await page.locator('header button[name="site"]').innerText()).trim();
    await goToRoute(page, '/products');
    await createProduct(page, {
      name: PRODUCT_NAME,
      sku: PRODUCT_SKU,
      stock: String(OPENING_STOCK),
      price: '3200',
    });

    const purchaseNumber = await registerPurchase(page);
    await expectPurchaseDetails(page, purchaseNumber, siteName);
    await expectInventoryEffects(page, siteName);

    await signOut(page);
    await signIn(page, admin.email);
    const resourceId = await expectReceiptAudit(page, {
      purchaseNumber,
      manager,
      siteName,
    });

    await signOut(page);
    await signIn(page, admin.email);
    const persistedResourceId = await expectReceiptAudit(page, {
      purchaseNumber,
      manager,
      siteName,
    });
    expect(persistedResourceId).toBe(resourceId);

    await expectNoClientIssues(tracker);
  });
});
