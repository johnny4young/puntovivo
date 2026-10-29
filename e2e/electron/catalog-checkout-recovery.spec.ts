import path from 'node:path';
import Database from 'better-sqlite3';
import { electronTest as test, expect, applyE2eSqlCipherKey } from './fixtures.js';
import { FIRST_SALE_E2E_EMAIL } from '../shared/baseline.js';
import {
  createProduct,
  addProductToCart,
  dismissVisibleToasts,
  goToRoute,
  openCashSession,
  signIn,
} from './support/journey.js';

// Every fixture owns an encrypted database. All identities, products and cash
// entries below are synthetic; this journey never prints or sends a receipt.
test('catalog errors, import cancellation and discounted checkout reconcile once', async ({
  page,
  userDataDir,
}, info) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const dbPath = path.join(userDataDir, 'data', 'local.db');
  function rows(sql: string) {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      applyE2eSqlCipherKey(db);
      return db.prepare(sql).all();
    } finally {
      db.close();
    }
  }
  const baseRow = () => rows("SELECT price FROM products WHERE sku='QA-CATALOG-A'");
  const saleRows = () =>
    rows(
      "SELECT s.total,s.status,s.payment_status FROM sales s WHERE s.tenant_id=(SELECT tenant_id FROM products WHERE sku='QA-CATALOG-A')"
    );
  const stock = () =>
    rows(
      "SELECT total FROM product_stock_totals WHERE product_id=(SELECT id FROM products WHERE sku='QA-CATALOG-A')"
    );
  async function capture(name: string) {
    await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true });
  }
  await signIn(page, FIRST_SALE_E2E_EMAIL);
  await goToRoute(page, '/products');
  await createProduct(page, {
    name: 'QA Catalog Base',
    sku: 'QA-CATALOG-A',
    price: '1000',
    stock: '20',
  });
  await expect.poll(baseRow).toEqual([{ price: 1000 }]);
  await page.getByRole('button', { name: /^add product$/i }).click();
  let dialog = page.getByRole('dialog', { name: 'Create Product', exact: true });
  await dialog.locator('#product-name').fill('QA Corrected Duplicate');
  await dialog.locator('#product-sku').fill('QA-CATALOG-A');
  await dialog.locator('#product-price').fill('2000');
  await dialog.getByRole('button', { name: 'Create Product', exact: true }).click();
  await expect(dialog.locator('form').getByRole('alert')).toContainText(/SKU already exists/i);
  await expect(dialog.locator('#product-name')).toHaveValue('QA Corrected Duplicate');
  await capture('catalog-duplicate-error');
  expect(rows("SELECT COUNT(*) AS n FROM products WHERE sku='QA-CATALOG-A'")).toEqual([{ n: 1 }]);
  await dialog.locator('#product-sku').fill('QA-CATALOG-B');
  await dialog.getByRole('button', { name: 'Create Product', exact: true }).click();
  await expect(dialog).toBeHidden();
  const row = page.getByRole('row').filter({ hasText: 'QA-CATALOG-A' });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Edit Product', exact: true });
  await dialog.getByRole('tab', { name: 'Pricing', exact: true }).click();
  const editPrice = () =>
    dialog
      .getByRole('group', { name: 'Price Tier 1', exact: true })
      .getByRole('spinbutton', { name: 'Sale Price', exact: true });
  await editPrice().fill('9999');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Discard product changes?', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(editPrice()).toHaveValue('9999');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect.poll(baseRow).toEqual([{ price: 1000 }]);
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Edit Product', exact: true });
  await dialog.getByRole('tab', { name: 'Pricing', exact: true }).click();
  await editPrice().fill('1200');
  await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect.poll(baseRow).toEqual([{ price: 1200 }]);
  await goToRoute(page, '/data-import');
  await page.getByRole('radio', { name: /Real business data/i }).click();
  async function preview() {
    await page.locator('#data-import-file').setInputFiles({
      name: 'qa-only.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Name,SKU,Price,Cost,Opening stock,Minimum stock,Tax rate\nQA Imported,QA-IMPORT,500,100,3,1,0'
      ),
    });
    await page.getByRole('button', { name: 'Validate and preview', exact: true }).click();
    await expect(page.getByTestId('data-import-summary-ready')).toContainText('1');
    await expect(page.getByTestId('data-import-summary-invalid')).toContainText('0');
  }
  await preview();
  expect(rows("SELECT COUNT(*) AS n FROM products WHERE sku='QA-IMPORT'")).toEqual([{ n: 0 }]);
  await capture('import-preview-no-persistence');
  await goToRoute(page, '/products');
  await page.reload();
  expect(rows("SELECT COUNT(*) AS n FROM products WHERE sku='QA-IMPORT'")).toEqual([{ n: 0 }]);
  await goToRoute(page, '/data-import');
  await page.getByRole('radio', { name: /Real business data/i }).click();
  await preview();
  await page
    .getByLabel('I confirm that this file contains real business data', { exact: false })
    .check();
  await page.getByRole('button', { name: 'Import 1 ready row', exact: true }).click();
  await expect(page.getByTestId('data-import-report-stockInitialized')).toContainText('1');
  await page.reload();
  expect(rows("SELECT sku,price FROM products WHERE sku='QA-IMPORT'")).toEqual([
    { sku: 'QA-IMPORT', price: 500 },
  ]);
  await goToRoute(page, '/sales');
  await openCashSession(page, 'QA Local Register');
  await dismissVisibleToasts(page);
  await addProductToCart(page, 'QA-CATALOG-A');
  let item = page.getByTestId('sale-cart-item-QA-CATALOG-A');
  await item
    .getByRole('spinbutton', { name: 'Discount for QA Catalog Base', exact: true })
    .fill('10');
  await item
    .getByRole('spinbutton', { name: 'Discount for QA Catalog Base', exact: true })
    .press('Tab');
  const charge = page.getByTestId('checkout-primary-action');
  await charge.click();
  let payment = page.getByRole('dialog', { name: 'Charge Sale', exact: true });
  await expect(payment.getByTestId('sale-payment-summary')).toContainText(/1[,.]080/);
  await payment.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(payment).toBeHidden();
  // Closing payment returns to the scanner input for the next product.
  await expect(page.locator('#sales-product-search-input')).toBeFocused();
  await capture('payment-cancel-scanner-focus');
  expect(saleRows()).toEqual([]);
  expect(stock()).toEqual([{ total: 20 }]);
  await item.getByRole('button', { name: 'Remove QA Catalog Base', exact: true }).click();
  await expect(item).toBeHidden();
  expect(saleRows()).toEqual([]);
  expect(stock()).toEqual([{ total: 20 }]);
  await addProductToCart(page, 'QA-CATALOG-A');
  item = page.getByTestId('sale-cart-item-QA-CATALOG-A');
  await item
    .getByRole('spinbutton', { name: 'Discount for QA Catalog Base', exact: true })
    .fill('10');
  await item
    .getByRole('spinbutton', { name: 'Discount for QA Catalog Base', exact: true })
    .press('Tab');
  await charge.click();
  payment = page.getByRole('dialog', { name: 'Charge Sale', exact: true });
  await expect(payment.getByTestId('sale-payment-summary')).toContainText(/1[,.]080/);
  await payment.locator('#sale-payment-confirm').dblclick();
  await expect(payment).toBeHidden();
  await expect
    .poll(saleRows)
    .toEqual([{ total: 1080, status: 'completed', payment_status: 'paid' }]);
  await expect.poll(stock).toEqual([{ total: 19 }]);
  await page.reload();
  expect(saleRows()).toEqual([{ total: 1080, status: 'completed', payment_status: 'paid' }]);
  expect(stock()).toEqual([{ total: 19 }]);
  await capture('discounted-checkout-once');
  await info.attach('local-database-oracle', {
    body: JSON.stringify({
      products: rows("SELECT sku,price FROM products WHERE sku LIKE 'QA-%' ORDER BY sku"),
      sales: saleRows(),
      stock: stock(),
    }),
    contentType: 'application/json',
  });
  expect(pageErrors).toEqual([]);
});
