import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';

import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { E2E_USERS } from '../shared/baseline.js';
import { electronTest as test, expect, IS_PACKAGED_RUN } from './fixtures.js';
import {
  createProduct,
  dismissVisibleToasts,
  goToRoute,
  openCashSession,
  pinPrimarySite,
  signIn,
} from './support/journey.js';

const PRODUCT_NAME = 'E2E Restaurant Plate';
const PRODUCT_SKU = 'E2E-RESTAURANT-PLATE';
const TABLE_NAME = 'E2E Electron Table';
const CHECK_LABEL = 'E2E Electron Patio';

async function captureEvidence(page: Page, name: string): Promise<void> {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  const target = IS_PACKAGED_RUN ? `${name}-packaged` : `${name}-dev`;
  await page.screenshot({
    path: path.join(auditDir, `${target}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}

async function addRestaurantProduct(page: Page): Promise<void> {
  await page.getByTestId('voice-ordering-manual-add').click();
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('Search by SKU, name, or barcode').fill(PRODUCT_SKU);
  const row = dialog.getByTestId(`product-search-row-${PRODUCT_SKU}`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await dialog.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test.describe('restaurant service on the desktop app', () => {
  test('persists and settles a structured table check through the embedded server', async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    const admin = E2E_USERS.find(user => user.role === 'admin');
    if (!admin) throw new Error('E2E admin fixture is missing');

    await signIn(page, admin.email);
    await pinPrimarySite(page);

    await goToRoute(page, '/products');
    await createProduct(page, {
      name: PRODUCT_NAME,
      sku: PRODUCT_SKU,
      stock: '10',
      price: '12500',
    });

    await goToRoute(page, '/sales');
    await openCashSession(page, 'E2E Restaurant Register');
    await dismissVisibleToasts(page);

    await goToRoute(page, '/restaurants/tables');
    await expect(page.getByRole('heading', { name: 'Restaurant tables' })).toBeVisible();
    await page.getByTestId('restaurant-tables-create-cta').click();
    const tableDialog = page.getByRole('dialog', { name: 'Create table' });
    await tableDialog.getByTestId('restaurant-table-name').fill(TABLE_NAME);
    await tableDialog.getByTestId('restaurant-table-seat-count').fill('4');
    await tableDialog.getByTestId('restaurant-table-area').fill('E2E Patio');
    await tableDialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(tableDialog).toBeHidden({ timeout: 15_000 });
    await dismissVisibleToasts(page);

    await goToRoute(page, '/m');
    await expect(page.getByTestId('voice-ordering-screen')).toHaveAttribute(
      'data-variant',
      'mobile'
    );
    await page.getByTestId('voice-ordering-table-select').selectOption({ label: TABLE_NAME });
    await page.getByTestId('voice-ordering-guest-count').fill('2');
    await page.getByTestId('voice-ordering-check-label').fill(CHECK_LABEL);
    await addRestaurantProduct(page);

    const cartRow = page.getByTestId('voice-ordering-cart-row');
    await cartRow.getByTestId('voice-ordering-note-input').fill('No onions');
    await cartRow.getByTestId('voice-ordering-course-select').selectOption('starter');
    await cartRow.getByTestId('voice-ordering-seat-select').selectOption('2');
    await cartRow.getByTestId('voice-ordering-modifier-name').fill('Extra cheese');
    await cartRow.getByTestId('voice-ordering-modifier-price').fill('1500');
    await page.getByTestId('voice-ordering-save').click();
    await expect(page.getByTestId('voice-ordering-cart-empty')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('voice-ordering-table-select').selectOption({ label: TABLE_NAME });
    await expect(page.getByTestId('voice-ordering-open-checks')).toContainText(CHECK_LABEL);
    await captureEvidence(page, 'restaurant-service-open-electron');

    // A renderer reload keeps the encrypted SQLite projection authoritative.
    await page.reload();
    await expect(page.getByTestId('voice-ordering-screen')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('voice-ordering-table-select').selectOption({ label: TABLE_NAME });
    await expect(page.getByTestId('voice-ordering-open-checks')).toContainText(CHECK_LABEL);

    await goToRoute(page, '/sales');
    await page.getByTestId('sales-open-suspended').click();
    const draftCard = page.getByTestId('suspended-draft-card').filter({ hasText: CHECK_LABEL });
    await expect(draftCard).toContainText(TABLE_NAME);
    await draftCard.getByTestId('suspended-draft-resume').click();
    await expect(page.getByTestId(`sale-cart-item-${PRODUCT_SKU}`)).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press('F2');
    const paymentDialog = page.getByRole('dialog', { name: 'Charge Sale' });
    await expect(paymentDialog).toBeVisible();
    await paymentDialog.locator('#sale-payment-confirm').click();
    await expect(paymentDialog).toBeHidden({ timeout: 15_000 });

    await goToRoute(page, '/m');
    await page.getByTestId('voice-ordering-table-select').selectOption({ label: TABLE_NAME });
    await expect(page.getByTestId('voice-ordering-table-state-loading')).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('voice-ordering-open-checks')).toHaveCount(0);
    await captureEvidence(page, 'restaurant-service-settled-electron');
    await expectNoClientIssues(tracker);
  });
});
