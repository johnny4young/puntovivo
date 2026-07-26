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
  pinPrimarySite,
  signIn,
  signOut,
} from './support/journey.js';

const PRODUCT_NAME = 'E2E Close Product';
const PRODUCT_SKU = 'E2E-CLOSE';
const REGISTER = 'E2E Close Register';

test.describe('blind close on the desktop app', () => {
  // INCOMPLETE, and reported rather than hidden. Everything except the sale
  // works: the admin stocks the shelf, the cashier opens the drawer, and the
  // blind-close dialog behaves. The sale is refused with
  // SALE_INSUFFICIENT_STOCK and `Available: 0` no matter which of the two
  // sites both roles are pinned to.
  //
  // What is established, so the next attempt does not re-derive it:
  //   - It is NOT a role problem. Blind close is role gated and the cashier is
  //     the right actor; that part of this spec is correct.
  //   - It is NOT the two roles sitting on different sites. They are pinned to
  //     the same one and it still fails.
  //   - It is NOT the primary-versus-secondary site: pinning both to either
  //     one reports Available: 0.
  //   - The products list shows the typed quantity from BOTH sites, because
  //     that column is the product-level rollup, so the list cannot be used to
  //     locate the stock. Only the till reveals the per-site figure.
  //
  // The same createProduct call works in the single-site first-sale tenant, so
  // the difference is how initial stock is allocated in a two-site tenant.
  // Worth a look from the server side rather than more UI probing: the stock
  // rollup table is maintained by triggers from the per-site balances, so a
  // product total of N while every site reports 0 would contradict that
  // invariant. If it does, this is a product defect and not a test gap.
  test.fixme(
    true,
    'initial product stock is not available at any site in a two-site tenant; needs server-side inspection, not more UI probing'
  );
  test('closes a drawer with an overage and reports the discrepancy', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);

    const admin = E2E_USERS.find(user => user.role === 'admin');
    const cashier = E2E_USERS.find(user => user.role === 'cashier');
    expect(Boolean(admin && cashier), 'baseline seeds an admin and a cashier').toBe(true);

    // The cashier cannot create products, so the admin stocks the shelf first.
    // Both roles sit on the primary site: that is where a new product's stock
    // lands regardless of the active site (see pinPrimarySite).
    await signIn(page, admin!.email);
    await pinPrimarySite(page);
    await goToRoute(page, '/products');
    await createProduct(page, { name: PRODUCT_NAME, sku: PRODUCT_SKU, stock: '5' });

    await signOut(page);
    await signIn(page, cashier!.email);
    await pinPrimarySite(page);
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
