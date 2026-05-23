/**
 * ENG-134d — Shared helpers for the keyboard-only `/sales` smoke spec.
 *
 * Centralises a few small utilities the spec at
 * `e2e/web/sales-keyboard-only.spec.ts` reuses across its ten test
 * cases. Keeping the helpers tight here means each test reads as a
 * sequence of user intents (Tab, Enter, F1, Mod+K) rather than a
 * tangle of Playwright locators.
 *
 * The mount-autofocus + close-restore poll mirrors the contract
 * shipped by ENG-105F. The MOD_KEY constant mirrors the platform
 * branch shipped in `sales-scanner-focus.spec.ts:36` so a local Mac
 * dev run picks `Meta+K` and a Linux CI run picks `Control+K`.
 *
 * @module e2e/web/support/sales-keyboard
 */
import { expect, type Page } from '@playwright/test';

/**
 * `matchesShortcut()` in `apps/web/src/lib/shortcuts.ts` resolves the
 * `Mod` token to `Meta` on darwin and `Control` elsewhere. CI runs on
 * Linux but `npx playwright test` on the operator's macOS box also
 * needs the spec to work, so we branch here before pressing the key.
 */
export const MOD_KEY: 'Meta' | 'Control' =
  process.platform === 'darwin' ? 'Meta' : 'Control';

/** The id of the page-level sales product search input. */
export const SEARCH_INPUT_ID = 'sales-product-search-input';

export const SEARCH_INPUT_SELECTOR = `#${SEARCH_INPUT_ID}`;

/**
 * Polls `document.activeElement.id` and asserts it lands on the page-level
 * search input within 10 seconds. Equal to the helper used by the
 * scanner-focus spec but exported here so future keyboard-flow specs can
 * reuse it. Use after a modal close to validate the ENG-105F restore
 * contract, or after `/sales` mount to validate the ENG-105F autofocus.
 */
export async function expectSearchInputFocused(page: Page): Promise<void> {
  await expect
    .poll(async () => page.evaluate(() => document.activeElement?.id ?? ''), {
      timeout: 10_000,
    })
    .toBe(SEARCH_INPUT_ID);
}

/**
 * Adds a product to the in-progress cart using only the keyboard:
 *  1. Type the SKU into the page-level search input.
 *  2. Press Enter to open ProductSearchDialog (ENG-105F + form submit path).
 *  3. Focus the row whose data-testid matches the SKU (ENG-134e).
 *  4. Press Enter on the row to select (handleProductSelect).
 *  5. Press the dialog's primary action ("Add to cart") via getByRole.
 *
 * After this returns, the dialog is closed and focus has restored to the
 * page-level search input (ENG-105F close→restore). The cart contains
 * one new row referencing the product.
 *
 * The helper does NOT use mouse clicks at any step — callers that need
 * to validate the mouse path should use `business.spec.ts`'s
 * `createCompletedCashSale` instead.
 */
export async function addProductToCartViaKeyboard(
  page: Page,
  sku: string
): Promise<void> {
  const search = page.locator(SEARCH_INPUT_SELECTOR);
  await search.waitFor();
  await search.fill(sku);
  await search.press('Enter');

  const dialog = page.getByRole('dialog', {
    name: /add product|agregar producto/i,
  });
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  const row = dialog.locator(`[data-testid="product-search-row-${sku}"]`);
  await row.waitFor({ timeout: 10_000 });
  await row.focus();
  await page.keyboard.press('Enter');

  // The dialog's primary action button is in the modal footer; using
  // getByRole keeps this resilient to copy / variant changes.
  const addToCart = dialog.getByRole('button', {
    name: /add to cart|agregar al carrito/i,
  });
  await addToCart.focus();
  await page.keyboard.press('Enter');

  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await expectSearchInputFocused(page);
}
