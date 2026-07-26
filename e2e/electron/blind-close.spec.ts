/**
 * The `blind-close` operator journey, run against the desktop app.
 *
 * A cashier counts the drawer without being shown what the system expects, and
 * the difference is surfaced only after the count is committed. That blindness
 * is the control: a cashier who can see the expected total can make the count
 * match it.
 *
 * The journey deliberately uses two roles. `canSeeLiveDelta` in
 * CashSessionCloseModal lets admins and managers watch the counted-versus-
 * expected delta as they type, and only a cashier gets the blind count — so an
 * admin closing the drawer would silently exercise the opposite behaviour. The
 * admin appears only to stock the shelf, which a cashier is not allowed to do.
 *
 * @module e2e/electron/blind-close
 */

import { electronTest as test, expect } from './fixtures.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { E2E_USERS } from '../shared/baseline.js';
import {
  addProductToCart,
  chargeExactCash,
  createProduct,
  dismissVisibleToasts,
  goToRoute,
  openCashSession,
  signIn,
  signOut,
} from './support/journey.js';

const PRODUCT_NAME = 'E2E Close Product';
const PRODUCT_SKU = 'E2E-CLOSE';
const REGISTER = 'E2E Close Register';

test.describe('blind close on the desktop app', () => {
  // INCOMPLETE, and marked so it is reported rather than quietly absent.
  // The journey below is correct in shape — the role split is the finding that
  // matters — but the admin of the baseline tenant does not surface the
  // "Add Product" control the first-sale tenant does, so stocking the shelf
  // needs UI discovery this spec has not done yet. Do not delete: the role
  // gating documented above is the expensive part and is already right.
  test.fixme(
    true,
    'baseline-tenant admin does not expose the Add Product control; stocking step needs UI discovery'
  );
  test('closes a drawer with an overage and reports the discrepancy', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);

    const admin = E2E_USERS.find(user => user.role === 'admin');
    const cashier = E2E_USERS.find(user => user.role === 'cashier');
    expect(Boolean(admin && cashier), 'baseline seeds an admin and a cashier').toBe(true);

    // The cashier cannot create products, so the admin stocks the shelf first.
    await signIn(page, admin!.email);
    await goToRoute(page, '/products');
    await createProduct(page, { name: PRODUCT_NAME, sku: PRODUCT_SKU, stock: '5' });

    await signOut(page);
    await signIn(page, cashier!.email);
    await goToRoute(page, '/sales');

    // Float of zero and one cash sale, so the expected drawer content is
    // exactly the sale total and the overage below is unambiguous.
    await openCashSession(page, REGISTER);
    await dismissVisibleToasts(page);
    await addProductToCart(page, PRODUCT_SKU);
    await chargeExactCash(page);
    await dismissVisibleToasts(page);

    await page
      .getByRole('button', { name: /close cash session|cerrar caja/i })
      .first()
      .click();
    const closeDialog = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: /close cash session|cerrar caja/i }) })
      .last();
    await expect(closeDialog).toBeVisible({ timeout: 15_000 });

    // The dialog must state the guarantee. Asserting the absence of the word
    // "expected" would flag the hint itself, which is the copy that promises
    // the balance stays hidden.
    await expect(
      closeDialog.getByText(/hidden|oculto/i).first(),
      'a cashier close must say the expected balance stays hidden'
    ).toBeVisible();

    // Count more than the drawer should hold.
    await closeDialog.locator('#cash-session-closing-count').fill('9000');
    await closeDialog.getByRole('button', { name: /close session|cerrar caja/i }).click();
    await expect(closeDialog).toBeHidden({ timeout: 15_000 });

    // The discrepancy surfaces only once the count is committed.
    await expect(page.getByText(/overage|sobrante/i).first()).toBeVisible({ timeout: 15_000 });

    // With the drawer closed, selling has to be gated again.
    await expect(
      page.getByRole('button', { name: /open cash session|abrir caja/i }).first()
    ).toBeVisible({ timeout: 15_000 });

    await expectNoClientIssues(tracker);
  });
});
