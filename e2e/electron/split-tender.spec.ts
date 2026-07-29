/**
 * The `split-tender` operator journey, run against the desktop app.
 *
 * One sale settled across two payment methods. The server has to accept a
 * tender set that sums to the total and record both rows, so this exercises a
 * different completion path from the exact-cash shortcut every other selling
 * journey uses.
 *
 * The split is derived from the amount the dialog itself proposes rather than a
 * hardcoded total: tender inputs carry plain numbers, so reading tender 1's
 * default avoids parsing formatted currency and keeps the journey correct if
 * tax or service configuration ever changes the total.
 *
 * @module e2e/electron/split-tender
 */

import { electronTest as test, expect } from './fixtures.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { FIRST_SALE_E2E_EMAIL } from '../shared/baseline.js';
import {
  addProductToCart,
  createProduct,
  dismissVisibleToasts,
  goToRoute,
  openCashSession,
  signIn,
} from './support/journey.js';

const PRODUCT_NAME = 'E2E Split Product';
const PRODUCT_SKU = 'E2E-SPLIT';

test.describe('split tender on the desktop app', () => {
  test('settles one sale across cash and card', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);

    await signIn(page, FIRST_SALE_E2E_EMAIL);

    await page
      .getByTestId('first-sale-guide')
      .getByRole('link', { name: /create product/i })
      .click();
    await expect(page).toHaveURL(/\/products$/, { timeout: 30_000 });
    await createProduct(page, { name: PRODUCT_NAME, sku: PRODUCT_SKU, stock: '5' });

    await goToRoute(page, '/sales');
    await openCashSession(page, 'E2E Split Register');
    await dismissVisibleToasts(page);
    await addProductToCart(page, PRODUCT_SKU);

    // Open the charge dialog with the button rather than the exact-cash
    // shortcut: F2 settles the whole total in one tender, which is the case
    // this journey exists to avoid.
    await page
      .getByRole('button', { name: /charge sale|cobrar venta/i })
      .first()
      .click();
    const chargeDialog = page.getByRole('dialog', { name: /charge sale|cobrar venta/i });
    await expect(chargeDialog).toBeVisible({ timeout: 15_000 });

    await chargeDialog
      .getByRole('button', { name: /split payment across tenders|dividir el pago/i })
      .click();

    // Tender 1 opens holding the full amount owed; split it in two.
    const firstAmount = chargeDialog.getByLabel(/amount for tender 1|monto del pago 1/i);
    await expect(firstAmount).toBeVisible();
    const total = Number(await firstAmount.inputValue());
    expect(total, 'tender 1 should open with the amount owed').toBeGreaterThan(0);
    const cashPortion = Math.floor(total / 2);
    const cardPortion = total - cashPortion;

    await firstAmount.fill(String(cashPortion));
    await chargeDialog
      .getByRole('button', { name: /add payment method|agregar método de pago/i })
      .click();
    await chargeDialog.getByLabel(/method for tender 2|método del pago 2/i).selectOption('card');
    await chargeDialog
      .getByLabel(/amount for tender 2|monto del pago 2/i)
      .fill(String(cardPortion));

    // Confirm only enables once the tenders account for the whole total, so
    // this assertion is the real check that the split was accepted.
    const confirm = chargeDialog.locator('#sale-payment-confirm');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(chargeDialog).toBeHidden({ timeout: 15_000 });

    // The cart empties only when the server accepted the sale.
    await expect(page.getByTestId(`sale-cart-item-${PRODUCT_SKU}`)).toBeHidden({
      timeout: 15_000,
    });

    await expectNoClientIssues(tracker);
  });
});
