import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  expectSuccessToast,
  login,
} from './support/app';
import {
  getRestaurantServiceEvidence,
  seedRestaurantServiceScenario,
  seedRestaurantTableCatalog,
  seedSurfaceGateScenario,
} from './support/db';

async function captureRestaurantEvidence(page: Page, name: string): Promise<void> {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  await page.screenshot({
    path: path.join(auditDir, `${name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}

async function addRestaurantProduct(page: Page, sku: string): Promise<void> {
  await page.getByTestId('voice-ordering-manual-add').click();
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('Search by SKU, name, or barcode').fill(sku);
  const row = dialog.getByTestId(`product-search-row-${sku}`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await dialog.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test.describe('restaurant service lifecycle', () => {
  test('direct voice ordering stays closed when dine-in is disabled', async ({
    page,
  }, testInfo) => {
    const scenario = seedSurfaceGateScenario(`restaurant-gate-${testInfo.parallelIndex}`, {
      'pos-touch': true,
      'mobile-waiter': true,
      'dine-in': false,
    });
    const tracker = attachClientIssueTracker(page);

    await login(page, {
      email: scenario.admin.email,
      password: scenario.admin.password,
      // A deliberately minimal isolated tenant is routed through setup on
      // first login; the direct URL assertion starts after auth is stable.
      defaultPath: '/company',
    });
    await page.goto('/touch/voice');

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(/Today's Sales|Ventas de hoy/i).first()).toBeVisible();
    await expect(page.getByTestId('voice-ordering-screen')).toHaveCount(0);

    await page.goto('/m');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('voice-ordering-screen')).toHaveCount(0);
    await expectNoClientIssues(tracker);
  });

  test('admin searches beyond the first table page with literal characters', async ({
    page,
  }, testInfo) => {
    const scenario = seedSurfaceGateScenario(
      `restaurant-catalog-${testInfo.parallelIndex}-${Date.now()}`,
      { 'dine-in': true }
    );
    const catalog = seedRestaurantTableCatalog(scenario);
    const tracker = attachClientIssueTracker(page);

    await login(page, {
      email: scenario.admin.email,
      password: scenario.admin.password,
      defaultPath: '/company',
    });
    await ensureLanguage(page, 'en');
    await page.goto('/restaurants/tables');

    await expect(page.getByRole('heading', { name: 'Restaurant tables' })).toBeVisible();
    await expect(page.getByTestId('restaurant-tables-pagination')).toContainText(
      `Showing 1–100 of ${catalog.totalTables} tables`
    );
    await expect(page.locator('tbody').getByText(catalog.targetName, { exact: true })).toHaveCount(
      0
    );
    await expect(
      page
        .getByTestId('restaurant-floor-map-preview')
        .getByText(catalog.targetName, { exact: true })
    ).toBeVisible();

    await page.getByTestId('data-table-search').fill('%_!');
    await expect(page.locator('tbody').getByText(catalog.targetName, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('restaurant-tables-pagination')).toHaveCount(0);

    await ensureLanguage(page, 'es');
    await expect(page.getByRole('heading', { name: 'Mesas del restaurante' })).toBeVisible();
    await expect(
      page.locator('tbody').getByText(catalog.targetName, { exact: true })
    ).toBeVisible();
    await captureRestaurantEvidence(page, 'restaurant-table-server-search-es');
    await expectNoClientIssues(tracker);
  });

  test('admin creates a table, waiter opens a structured check, and cashier settles it', async ({
    page,
  }, testInfo) => {
    const scenario = seedRestaurantServiceScenario(
      `restaurant-${testInfo.parallelIndex}-${Date.now()}`
    );
    const tableName = `E2E Table ${scenario.product.sku.slice(-6)}`;
    const checkLabel = `E2E Patio ${scenario.product.sku.slice(-6)}`;
    const tracker = attachClientIssueTracker(page);

    await login(page, {
      email: scenario.admin.email,
      password: scenario.admin.password,
      defaultPath: '/dashboard',
    });

    // The catalog is operator-managed: create the physical table through the
    // admin surface instead of planting a row in the fixture.
    await page.goto('/restaurants/tables');
    await expect(page.getByRole('heading', { name: 'Restaurant tables' })).toBeVisible();
    await page.getByTestId('restaurant-tables-create-cta').click();
    const tableDialog = page.getByRole('dialog', { name: 'Create table' });
    await tableDialog.getByTestId('restaurant-table-name').fill(tableName);
    await tableDialog.getByTestId('restaurant-table-seat-count').fill('4');
    await tableDialog.getByTestId('restaurant-table-area').fill('E2E Patio');
    await tableDialog.getByTestId('restaurant-table-notes').fill('E2E waiter service');
    await tableDialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(tableDialog).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(tableName, { exact: true }).first()).toBeVisible();

    // Mobile Waiter and POS Touch share this component and the same atomic
    // restaurantServices.openCheck command. Exercise party, seat, course,
    // kitchen note and priced modifier in one real renderer-to-SQLite round trip.
    await page.goto('/m');
    await expect(page.getByTestId('voice-ordering-screen')).toHaveAttribute(
      'data-variant',
      'mobile'
    );
    await page.getByTestId('voice-ordering-table-select').selectOption({ label: tableName });
    await page.getByTestId('voice-ordering-guest-count').fill('2');
    await page.getByTestId('voice-ordering-check-label').fill(checkLabel);
    await addRestaurantProduct(page, scenario.product.sku);

    const cartRow = page.getByTestId('voice-ordering-cart-row');
    await expect(cartRow).toHaveCount(1);
    await cartRow.getByTestId('voice-ordering-note-input').fill('No onions');
    await cartRow.getByTestId('voice-ordering-course-select').selectOption('starter');
    await cartRow.getByTestId('voice-ordering-seat-select').selectOption('2');
    await cartRow.getByTestId('voice-ordering-modifier-name').fill('Extra cheese');
    await cartRow.getByTestId('voice-ordering-modifier-price').fill('1500');
    await expect(page.getByTestId('voice-ordering-save')).toBeEnabled();
    await page.getByTestId('voice-ordering-save').click();
    await expect(page.getByTestId('voice-ordering-cart-empty')).toBeVisible({ timeout: 15_000 });
    await expectSuccessToast(page, `Saved order for ${tableName} with 1 item.`);

    await page.getByTestId('voice-ordering-table-select').selectOption({ label: tableName });
    const openChecks = page.getByTestId('voice-ordering-open-checks');
    await expect(openChecks).toContainText('1 open check');
    await expect(openChecks).toContainText(checkLabel);
    await captureRestaurantEvidence(page, 'restaurant-service-open-mobile');

    await expect
      .poll(() => getRestaurantServiceEvidence(scenario.tenantId, tableName, scenario.admin.id))
      .toMatchObject({
        serviceStatus: 'open',
        guestCount: 2,
        checkStatus: 'open',
        checkLabel,
        saleStatus: 'draft',
        saleTotal: 14_000,
        dinerCount: 2,
        lineCount: 1,
        roundCount: 1,
        courseKeys: ['starter'],
        lines: [
          {
            note: 'No onions',
            seatNumber: 2,
            modifierName: 'Extra cheese',
            modifierPriceDelta: 1500,
          },
        ],
      });

    // A reload must reconstruct the check from SQLite, not from the local cart.
    await page.reload();
    await expect(page.getByTestId('voice-ordering-screen')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('voice-ordering-table-select').selectOption({ label: tableName });
    await expect(page.getByTestId('voice-ordering-open-checks')).toContainText(checkLabel);

    // Resume through the ordinary till and settle with the existing payment
    // drawer. This must close both the check and its last open table service.
    await page.goto('/sales');
    await page.getByTestId('sales-open-suspended').click();
    const draftCard = page.getByTestId('suspended-draft-card').filter({ hasText: checkLabel });
    await expect(draftCard).toContainText(tableName);
    await draftCard.getByTestId('suspended-draft-resume').click();
    await expect(page.getByTestId(`sale-cart-item-${scenario.product.sku}`)).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press('F2');
    const paymentDialog = page.getByRole('dialog', { name: 'Charge Sale' });
    await expect(paymentDialog).toBeVisible();
    await paymentDialog.getByRole('button', { name: 'Confirm Sale' }).click();
    await expect(paymentDialog).toBeHidden({ timeout: 15_000 });

    await expect
      .poll(() => getRestaurantServiceEvidence(scenario.tenantId, tableName, scenario.admin.id))
      .toMatchObject({
        serviceStatus: 'closed',
        checkStatus: 'settled',
        saleStatus: 'completed',
        saleTotal: 14_000,
        lineCount: 1,
      });

    await page.goto('/m');
    await page.getByTestId('voice-ordering-table-select').selectOption({ label: tableName });
    await expect(page.getByTestId('voice-ordering-table-state-loading')).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('voice-ordering-open-checks')).toHaveCount(0);
    await captureRestaurantEvidence(page, 'restaurant-service-settled-mobile');
    await expectNoClientIssues(tracker);
  });
});
