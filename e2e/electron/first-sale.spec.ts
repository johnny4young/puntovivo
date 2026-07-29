/**
 * The `first-sale` operator journey, run against the desktop app.
 *
 * `operator-journeys.json` declares this journey with web evidence only, which
 * proves the flow in a browser against a dev server — not in the application
 * that ships. This spec walks the same journey through the desktop renderer so
 * the evidence covers the artefact an operator actually installs.
 *
 * Target selection is the fixture's job: without PUNTOVIVO_PACKAGED_APP it
 * drives the dev bundle, with it the packaged build over CDP. The steps below
 * are identical either way, which is the point — a journey that only passes on
 * one of the two targets is a finding, not a flake.
 *
 * @module e2e/electron/first-sale
 */

import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { electronTest as test, expect, IS_PACKAGED_RUN } from './fixtures.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { E2E_PASSWORD, FIRST_SALE_E2E_EMAIL } from '../shared/baseline.js';
import { goToRoute } from './support/journey.js';

const PRODUCT_NAME = 'E2E First Sale Product';
const PRODUCT_SKU = 'E2E-FIRST-SALE';

async function captureEvidence(page: Page, name: string) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  const target = IS_PACKAGED_RUN ? `${name}-packaged` : `${name}-dev`;
  await page.screenshot({ path: path.join(auditDir, `${target}.png`), fullPage: true });
}

/**
 * Toasts stack over the guide and the cart, and a stale one can swallow the
 * click that the next step depends on. The web journey does the same.
 */
async function dismissVisibleToasts(page: Page) {
  const dismissButtons = page.locator('[role="status"] button[aria-label]');
  while ((await dismissButtons.count()) > 0) {
    await dismissButtons.first().click();
  }
}

test.describe('first sale on the desktop app', () => {
  test('walks a fresh admin through product, drawer, sale, and celebration', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);

    // The renderer boots on the login route; the packaged build serves it from
    // puntovivo-app://app behind a hash route, the dev bundle from localhost.
    // Both land on the same form.
    const emailInput = page.getByLabel(/email/i);
    await expect(emailInput).toBeVisible({ timeout: 30_000 });

    // Pin the locale before signing in. The journey asserts copy, and the
    // desktop app inherits the OS language, so an unpinned run asserts
    // whatever language the machine happens to use.
    await page.evaluate(() => {
      window.localStorage.setItem('puntovivo-language-preference', 'en');
    });
    await page.reload();
    await expect(emailInput).toBeVisible({ timeout: 30_000 });
    await emailInput.fill(FIRST_SALE_E2E_EMAIL);
    await page.getByRole('textbox', { name: /password/i }).fill(E2E_PASSWORD);
    await page
      .getByRole('button', { name: /enter workspace|entrar al espacio de trabajo/i })
      .click();

    const guide = page.getByTestId('first-sale-guide');
    await expect(guide).toBeVisible({ timeout: 30_000 });
    await expect(guide.getByText(/0 of 3 steps completed|0 de 3 pasos completados/)).toBeVisible();
    await captureEvidence(page, 'first-sale-0-fresh');

    // Step 1 — create the only product this tenant will own.
    await guide.getByRole('link', { name: /create product|crear producto/i }).click();
    await expect(page).toHaveURL(/\/products$/, { timeout: 30_000 });
    await page.getByRole('button', { name: /add product|agregar producto/i }).click();
    const productDialog = page.getByRole('dialog', { name: /create product|crear producto/i });
    await expect(productDialog).toBeVisible();
    await productDialog.locator('#product-name').fill(PRODUCT_NAME);
    await productDialog.locator('#product-sku').fill(PRODUCT_SKU);
    await productDialog.locator('#product-price').fill('1000');
    await productDialog
      .getByRole('button', { name: /add opening stock|agregar inventario inicial/i })
      .click();
    await productDialog.locator('#product-stock').fill('10');
    await productDialog.getByRole('button', { name: /create product|crear producto/i }).click();
    await expect(productDialog).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(PRODUCT_NAME).first()).toBeVisible({ timeout: 15_000 });
    await expect(guide).toBeHidden();

    // Step 2 — open the drawer. Selling without a cash session is refused by
    // the server, so this is a real precondition and not UI decoration.
    await goToRoute(page, '/sales');
    await expect(guide).toBeHidden();
    await page
      .getByRole('button', { name: /open cash session|abrir caja/i })
      .first()
      .click();
    const cashDialog = page
      .locator('[role="dialog"]')
      .filter({
        has: page.getByRole('heading', { name: /open cash session|abrir caja/i }),
      })
      .last();
    await expect(cashDialog).toBeVisible({ timeout: 15_000 });
    await cashDialog.locator('#cash-session-register').fill('E2E Desktop Register');
    await cashDialog.locator('#cash-session-opening-float').fill('0');
    const openSession = cashDialog.getByRole('button', { name: /open session|abrir caja/i });
    await expect(openSession).toBeEnabled();
    await openSession.click();
    await expect(cashDialog).toBeHidden({ timeout: 15_000 });
    await expect(guide).toBeHidden();
    await dismissVisibleToasts(page);
    await captureEvidence(page, 'first-sale-2-register-open');

    // Step 3 — sell the product and charge it.
    await page
      .getByRole('button', { name: /search products|buscar productos/i })
      .first()
      .click();
    const searchDialog = page.getByRole('dialog', { name: /add product|agregar producto/i });
    await expect(searchDialog).toBeVisible();
    await searchDialog.getByRole('textbox', { name: /search|buscar/i }).fill(PRODUCT_SKU);
    const productRow = searchDialog.getByTestId(`product-search-row-${PRODUCT_SKU}`);
    await expect(productRow).toBeVisible({ timeout: 15_000 });
    await productRow.click();
    await searchDialog.getByRole('button', { name: /add to cart|agregar al carrito/i }).click();
    await expect(searchDialog).toBeHidden();
    await expect(page.getByTestId(`sale-cart-item-${PRODUCT_SKU}`)).toBeVisible();

    // F2 is the exact-cash shortcut. Driving it from the keyboard also proves
    // the packaged renderer receives accelerators, which a click would not.
    await page.keyboard.press('F2');
    const paymentDialog = page.getByRole('dialog', { name: /charge sale|cobrar venta/i });
    await expect(paymentDialog).toBeVisible({ timeout: 15_000 });
    const confirmSale = paymentDialog.locator('#sale-payment-confirm');
    await expect(confirmSale).toBeEnabled();
    await confirmSale.click();
    await expect(paymentDialog).toBeHidden({ timeout: 15_000 });

    const celebration = page.getByTestId('first-sale-celebration');
    await expect(
      celebration.getByText(/your first sale is complete|tu primera venta está completa/i)
    ).toBeVisible({ timeout: 15_000 });
    await captureEvidence(page, 'first-sale-3-celebration');

    await expectNoClientIssues(tracker);
  });
});
