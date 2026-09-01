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

    // Count more than the drawer should hold. The closing total is an
    // independent operator declaration, while the denomination grid is the
    // auditable count that must reconcile to it before the product enables
    // the close action.
    await closeDialog.locator('#cash-session-closing-count').fill('9000');
    // The tenant's canonical transaction currency is COP. Match the accessible
    // denomination label without assuming a particular currency-symbol form so
    // the journey remains valid across the supported Intl implementations.
    await closeDialog.getByLabel(/count for denomination .*5,000/i).fill('1');
    await closeDialog.getByLabel(/count for denomination .*2,000/i).fill('2');
    const confirmClose = closeDialog.getByRole('button', {
      name: /close session|cerrar caja/i,
    });
    await expect(confirmClose).toBeEnabled();
    await confirmClose.click();
    await expect(closeDialog).toBeHidden({ timeout: 15_000 });

    // The discrepancy surfaces only once the count is committed, inside the
    // post-close day summary. Finish that ritual before asserting the sales
    // workspace returned to its no-open-drawer state.
    const dayCloseDialog = page.getByRole('dialog', { name: /day closed|día cerrado/i });
    await expect(dayCloseDialog).toBeVisible({ timeout: 15_000 });
    await expect(dayCloseDialog.getByText(/overage|sobrante|over by/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await dayCloseDialog.getByRole('button', { name: /done|terminar/i }).click();
    await expect(dayCloseDialog).toBeHidden({ timeout: 15_000 });

    // With the drawer closed, selling has to be gated again.
    await expect(
      page.getByRole('button', { name: /open cash session|abrir caja/i }).first()
    ).toBeVisible({ timeout: 15_000 });

    await expectNoClientIssues(tracker);
  });
});
