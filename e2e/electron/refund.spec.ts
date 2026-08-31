/**
 * The `refund` operator journey, run against the desktop app.
 *
 * A manager creates and charges one product, then performs the direct refund
 * the role is authorized to execute. The journey proves that the ticket stays
 * in history as refunded, aggregate stock returns visibly, and an admin can
 * reload the immutable audit event with the manager and return intent intact.
 *
 * @module e2e/electron/refund
 */

import { electronTest as test, expect } from './fixtures.js';
import type { Page } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { E2E_USERS } from '../shared/baseline.js';
import {
  addProductToCart,
  chargeExactCash,
  createProduct,
  dismissVisibleToasts,
  goToRoute,
  openCashSession,
  pinPrimarySite,
  signIn,
  signOut,
} from './support/journey.js';

const PRODUCT_NAME = 'E2E Refund Product';
const PRODUCT_SKU = 'E2E-REFUND';
const OPENING_STOCK = '3';

async function openLatestSale(page: Page): Promise<string> {
  await page.getByTestId('sales-open-history').click();
  const history = page.getByTestId('sales-history-drawer');
  await expect(history).toBeVisible({ timeout: 15_000 });
  const latestRow = history.locator('tbody tr').first();
  await expect(latestRow).toBeVisible({ timeout: 15_000 });
  const saleNumber = (await latestRow.locator('td').first().innerText()).trim();
  await latestRow.getByRole('button', { name: new RegExp(`View ${saleNumber}`) }).click();
  await expect(page.getByRole('heading', { name: `Sale ${saleNumber}` })).toBeVisible({
    timeout: 15_000,
  });
  return saleNumber;
}

async function expectRefundAudit(
  page: Page,
  managerName: string,
  saleNumber: string
): Promise<void> {
  await goToRoute(page, '/audit-logs');
  await page.getByLabel(/action/i).selectOption('sale.return');
  const row = page.locator('tbody tr').filter({ hasText: saleNumber }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(managerName);
  await expect(row).toContainText(/sale refunded/i);
}

test.describe('refund on the desktop app', () => {
  test('manager refunds a sale and preserves restored stock plus immutable audit evidence', async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    const manager = E2E_USERS.find(user => user.role === 'manager');
    const admin = E2E_USERS.find(user => user.role === 'admin');
    expect(Boolean(manager && admin), 'baseline seeds a manager and an admin').toBe(true);

    await signIn(page, manager!.email);
    await pinPrimarySite(page);
    await goToRoute(page, '/products');
    await createProduct(page, {
      name: PRODUCT_NAME,
      sku: PRODUCT_SKU,
      stock: OPENING_STOCK,
      price: '4321',
    });

    await goToRoute(page, '/sales');
    await openCashSession(page, 'E2E Refund Register');
    await dismissVisibleToasts(page);
    await addProductToCart(page, PRODUCT_SKU);
    await chargeExactCash(page);
    await dismissVisibleToasts(page);

    const saleNumber = await openLatestSale(page);
    const details = page.getByRole('dialog', { name: `Sale ${saleNumber}` });
    await details.getByRole('button', { name: /refund sale|devolver venta/i }).click();

    const refund = page.getByRole('dialog', {
      name: /refund full sale|devolver venta completa/i,
    });
    await expect(refund).toBeVisible({ timeout: 15_000 });
    await expect(refund.getByText(PRODUCT_NAME)).toBeVisible();
    await expect(
      refund.getByText(/refunds the entire ticket|devuelve el ticket completo/i)
    ).toBeVisible();
    await expect(refund.getByRole('checkbox')).toHaveCount(0);
    await expect(
      refund.getByRole('button', { name: /request approval|solicitar aprobación/i })
    ).toHaveCount(0);
    await refund.getByRole('button', { name: /wrong item|artículo incorrecto/i }).click();
    const confirm = refund.getByRole('button', {
      name: /confirm return|confirmar devolución/i,
    });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(refund).toBeHidden({ timeout: 15_000 });

    // The sale details modal closes back into the already-open history drawer.
    // Its invalidated payment badge is the deterministic completion signal;
    // the success toast is intentionally transient.
    const history = page.getByTestId('sales-history-drawer');
    await expect(history).toBeVisible();
    await history.getByPlaceholder(/search by invoice|buscar por factura/i).fill(saleNumber);
    const refundedRow = history.locator('tbody tr').filter({ hasText: saleNumber }).first();
    await expect(refundedRow).toContainText(/refunded|reembolsada/i, { timeout: 15_000 });

    await goToRoute(page, '/products');
    const productRow = page.locator('tbody tr').filter({ hasText: PRODUCT_SKU }).first();
    await expect(productRow).toBeVisible({ timeout: 15_000 });
    await expect(productRow.getByText(OPENING_STOCK, { exact: true })).toBeVisible();

    await signOut(page);
    await signIn(page, admin!.email);
    await expectRefundAudit(page, manager!.name, saleNumber);

    await page.reload();
    await expect(
      page.getByRole('button', { name: `Open user menu for ${admin!.name}` })
    ).toBeVisible({ timeout: 30_000 });
    await expectRefundAudit(page, manager!.name, saleNumber);

    await expectNoClientIssues(tracker);
  });
});
