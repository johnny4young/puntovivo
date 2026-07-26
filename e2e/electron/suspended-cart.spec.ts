/**
 * The `suspended-cart` operator journey, run against the desktop app.
 *
 * Park a cart, charge a different one, resume the parked cart, and charge that
 * through completeDraft. This is the flow a counter actually uses when a
 * customer walks off to fetch one more thing, and it crosses a server draft —
 * the cart survives outside the renderer, so it is exactly the kind of journey
 * a browser-only proof does not cover for the shipped app.
 *
 * Stock arithmetic is asserted by the web journey against the development
 * database. Here the assertions are the ones a cashier can see, because the
 * packaged app's database is encrypted inside its userData directory and
 * reaching into it would test the fixture rather than the product.
 *
 * @module e2e/electron/suspended-cart
 */

import { electronTest as test, expect } from './fixtures.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { FIRST_SALE_E2E_EMAIL } from '../shared/baseline.js';
import {
  addProductToCart,
  chargeExactCash,
  createProduct,
  dismissVisibleToasts,
  openCashSession,
  signIn,
} from './support/journey.js';

const PRODUCT_NAME = 'E2E Park Product';
const PRODUCT_SKU = 'E2E-PARK';

test.describe('suspended cart on the desktop app', () => {
  test('parks a cart, charges a second one, then resumes and charges the first', async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);

    await signIn(page, FIRST_SALE_E2E_EMAIL);

    // Build the preconditions through the UI — see support/journey.ts for why
    // this journey seeds nothing.
    await page
      .getByTestId('first-sale-guide')
      .getByRole('link', { name: /create product/i })
      .click();
    await expect(page).toHaveURL(/\/products$/, { timeout: 30_000 });
    await createProduct(page, { name: PRODUCT_NAME, sku: PRODUCT_SKU, stock: '10' });

    await page
      .getByTestId('first-sale-guide')
      .getByRole('link', { name: /go to sales/i })
      .click();
    await expect(page).toHaveURL(/\/sales$/, { timeout: 30_000 });
    await openCashSession(page, 'E2E Park Register');
    await dismissVisibleToasts(page);

    // Cart A — add a unit and park it under a label the counter would use.
    await addProductToCart(page, PRODUCT_SKU);
    await page.getByTestId('checkout-suspend').click();
    const labelInput = page.getByTestId('suspend-label-input');
    await expect(labelInput).toBeVisible();
    await labelInput.fill('Mesa 5');
    await page.getByRole('button', { name: /^(Suspend|Suspender)$/ }).click();
    await expect(page.getByTestId('checkout-open-suspended-panel')).toBeVisible({
      timeout: 15_000,
    });
    await dismissVisibleToasts(page);

    // Cart B — a normal sale while cart A waits on the server.
    await addProductToCart(page, PRODUCT_SKU);
    await chargeExactCash(page);
    await dismissVisibleToasts(page);

    // Resume cart A. The label is what proves the right draft came back.
    await page.getByTestId('checkout-open-suspended-panel').click();
    const draftCard = page.getByTestId('suspended-draft-card').first();
    await expect(draftCard).toBeVisible({ timeout: 15_000 });
    await expect(draftCard).toContainText('Mesa 5');
    await draftCard.getByTestId('suspended-draft-resume').click();
    await expect(page.getByTestId('resumed-cart-banner')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`sale-cart-item-${PRODUCT_SKU}`)).toBeVisible();
    await dismissVisibleToasts(page);

    // Charging a resumed cart goes through completeDraft, a different server
    // path from the plain sale above.
    await chargeExactCash(page);
    await expect(page.getByTestId('resumed-cart-banner')).toBeHidden({ timeout: 15_000 });

    await expectNoClientIssues(tracker);
  });
});
