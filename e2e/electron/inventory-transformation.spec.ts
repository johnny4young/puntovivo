/** Exact lot purchase and transformation journey on the embedded Electron stack. */

import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { type Locator, type Page } from '@playwright/test';

import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { E2E_USERS, type E2EUserProfile } from '../shared/baseline.js';
import { electronTest as test, expect } from './fixtures.js';
import { goToRoute, pinPrimarySite, signIn, signOut } from './support/journey.js';

const INPUT_NAME = 'E2E Electron Tracked Raw';
const INPUT_SKU = 'E2E-ELECTRON-TRAW';
const OUTPUT_NAME = 'E2E Electron Tracked Output';
const OUTPUT_SKU = 'E2E-ELECTRON-TOUT';
const INPUT_LOT = 'ELECTRON-RAW-001';
const OUTPUT_LOT = 'ELECTRON-OUT-001';
const PROVIDER_NAME = 'E2E Electron Lot Provider';
const RECIPE_NAME = 'E2E Electron exact preparation';

function baselineUser(role: E2EUserProfile['role']): E2EUserProfile {
  const user = E2E_USERS.find(candidate => candidate.role === role);
  if (!user) throw new Error(`baseline did not seed a ${role}`);
  return user;
}

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

async function createProvider(page: Page) {
  await goToRoute(page, '/providers');
  await page.getByRole('button', { name: /add provider|agregar proveedor/i }).click();
  const dialog = page.getByRole('dialog', { name: /create provider|crear proveedor/i });
  await dialog.locator('#provider-name').fill(PROVIDER_NAME);
  await dialog.getByRole('button', { name: /create provider|crear proveedor/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function createLotProduct(page: Page, input: { name: string; sku: string; price: string }) {
  await page.getByRole('button', { name: /add product|agregar producto/i }).click();
  const dialog = page.getByRole('dialog', { name: /create product|crear producto/i });
  await dialog.locator('#product-name').fill(input.name);
  await dialog.locator('#product-sku').fill(input.sku);
  await dialog.locator('#product-price').fill(input.price);
  await dialog.getByRole('button', { name: /advanced settings|configuración avanzada/i }).click();
  await dialog
    .getByRole('checkbox', { name: /track lots and expiry|controlar lotes y vencimientos/i })
    .check();
  await dialog.getByRole('tab', { name: /units|unidades/i }).click();
  await dialog.getByRole('button', { name: /add unit|agregar unidad/i }).click();
  await dialog
    .getByRole('tabpanel', { name: /units|unidades/i })
    .locator('select')
    .selectOption({ index: 1 });
  await dialog.getByRole('checkbox', { name: /base unit|unidad base/i }).check();
  await dialog.getByRole('button', { name: /create product|crear producto/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function receiveExactLot(page: Page) {
  await goToRoute(page, '/purchases');
  await page
    .getByRole('button', { name: /add product|agregar producto/i })
    .first()
    .click();
  const addDialog = page
    .locator('[role="dialog"]')
    .filter({
      has: page.getByRole('heading', {
        name: /add product to purchase|agregar producto a la compra/i,
      }),
    })
    .last();
  await addDialog
    .getByPlaceholder(/search by sku, name, or barcode|buscar por sku, nombre o código/i)
    .fill(INPUT_SKU);
  const productRow = addDialog.locator('tr', { hasText: INPUT_SKU }).first();
  await expect(productRow).toBeVisible({ timeout: 15_000 });
  await productRow.click();
  await addDialog.getByRole('button', { name: /add to purchase|agregar a la compra/i }).click();
  await expect(addDialog).toBeHidden();

  const purchaseRow = page.locator('tr', { hasText: INPUT_SKU }).first();
  await purchaseRow.locator('input[type="number"]').first().fill('4');
  await purchaseRow.locator('input[type="number"]').nth(1).fill('2500');
  await page
    .getByRole('button', { name: /register purchase|registrar compra/i })
    .first()
    .click();
  const finalizeDialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByRole('heading', { name: /register purchase|registrar compra/i }) })
    .last();
  await finalizeDialog.locator('#purchase-provider').selectOption({ label: PROVIDER_NAME });
  await finalizeDialog.getByLabel(/lot number|número de lote/i).fill(INPUT_LOT);
  await finalizeDialog.getByLabel(/expiry date|fecha de vencimiento/i).fill('2030-12-31');
  await expect(finalizeDialog.getByLabel(/base quantity|cantidad base/i)).toHaveValue('4');
  await finalizeDialog.locator('#purchase-notes').fill('Electron exact lot receipt');
  await finalizeDialog.getByRole('button', { name: /register purchase|registrar compra/i }).click();
  await expect(finalizeDialog).toBeHidden({ timeout: 15_000 });
}

async function createAndExecuteRecipe(page: Page) {
  await goToRoute(page, '/inventory');
  await page.getByRole('button', { name: /transformations|transformaciones/i }).click();
  await expect(page.getByTestId('inventory-transformations-panel')).toBeVisible();
  await page.getByRole('button', { name: /new recipe|nueva receta/i }).click();
  const recipeDialog = page.getByRole('dialog', {
    name: /create transformation recipe|crear receta de transformación/i,
  });
  await recipeDialog.getByLabel(/recipe name|nombre de la receta/i).fill(RECIPE_NAME);
  const search = recipeDialog.getByLabel(/find more catalog products|buscar más productos/i);
  const products = recipeDialog.getByLabel(/stock product|producto de inventario/i);
  await search.fill(INPUT_SKU);
  await expect(
    products.first().getByRole('option', { name: `${INPUT_NAME} · ${INPUT_SKU}` })
  ).toBeAttached();
  await products.first().selectOption({ label: `${INPUT_NAME} · ${INPUT_SKU}` });
  await search.fill(OUTPUT_SKU);
  await expect(
    products.nth(1).getByRole('option', { name: `${OUTPUT_NAME} · ${OUTPUT_SKU}` })
  ).toBeAttached();
  await products.nth(1).selectOption({ label: `${OUTPUT_NAME} · ${OUTPUT_SKU}` });
  const quantities = recipeDialog.getByLabel(/base quantity|cantidad base/i);
  await quantities.first().fill('4');
  await quantities.nth(1).fill('3');
  await recipeDialog.getByRole('button', { name: /save recipe|guardar receta/i }).click();
  await expect(recipeDialog).toBeHidden({ timeout: 15_000 });

  const recipeCard = page.locator('article').filter({ hasText: RECIPE_NAME }).first();
  await recipeCard.getByRole('button', { name: /execute|ejecutar/i }).click();
  const executeDialog = page.getByRole('dialog', {
    name: new RegExp(`(?:Execute|Ejecutar) ${RECIPE_NAME}`),
  });
  await executeDialog
    .getByLabel(new RegExp(`(?:Quantity from lot|Cantidad del lote) ${INPUT_LOT}`))
    .first()
    .fill('4');
  await executeDialog.getByLabel(/new output lot|nuevo lote de salida/i).fill(OUTPUT_LOT);
  await executeDialog.getByLabel(/expiry date|fecha de vencimiento/i).fill('2031-12-31');
  await executeDialog
    .getByLabel(/execution notes|notas de ejecución/i)
    .fill('Electron exact lot transformation');
  await executeDialog.getByRole('button', { name: /execute|ejecutar/i, exact: true }).click();
  await expect(executeDialog).toBeHidden({ timeout: 15_000 });
  await expect(
    page.locator('.pv-kpi').filter({ hasText: /inventory value|valor del inventario/i })
  ).toContainText(/COP\s*10[.,]000/);
}

test('manager preserves lot provenance through the embedded Electron server', async ({ page }) => {
  test.setTimeout(120_000);
  const tracker = attachClientIssueTracker(page);
  const admin = baselineUser('admin');
  const manager = baselineUser('manager');

  await signIn(page, admin.email);
  await createProvider(page);
  await signOut(page);
  await signIn(page, manager.email);
  await pinPrimarySite(page);
  await goToRoute(page, '/products');
  await createLotProduct(page, { name: INPUT_NAME, sku: INPUT_SKU, price: '5000' });
  await createLotProduct(page, { name: OUTPUT_NAME, sku: OUTPUT_SKU, price: '9000' });
  await receiveExactLot(page);
  await createAndExecuteRecipe(page);

  const historyCard = page.locator('article').filter({ hasText: RECIPE_NAME }).last();
  await expect(historyCard).toContainText(/completed|completado/i);
  await historyCard.getByRole('button', { name: /details|detalles/i }).click();
  const details = page.getByTestId('inventory-transformation-details');
  await expect(details).toContainText(INPUT_LOT);
  await expect(details).toContainText(OUTPUT_LOT);
  await expect(details).toContainText(INPUT_SKU);
  await expect(details).toContainText(OUTPUT_SKU);
  await captureEvidence(page, 'pr8-electron-lot-transformation-details', details);
  await page.getByRole('button', { name: /close modal|cerrar modal/i }).click();

  await signOut(page);
  await signIn(page, manager.email);
  await pinPrimarySite(page);
  await goToRoute(page, '/inventory');
  await expect(
    page.locator('.pv-kpi').filter({ hasText: /inventory value|valor del inventario/i })
  ).toContainText(/COP\s*10[.,]000/);
  await page.getByRole('button', { name: /transformations|transformaciones/i }).click();
  const persistedHistory = page.locator('article').filter({ hasText: RECIPE_NAME }).last();
  await expect(persistedHistory).toContainText(/completed|completado/i);
  await captureEvidence(page, 'pr8-electron-lot-transformation-reload');
  await expectNoClientIssues(tracker);
});
