import { expect, test } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, loginAs } from './support/app';

/**
 * Scanner focus contract for the /sales cashier flow.
 *
 * Covers the four observable promises the slice ships:
 *
 * 1. On /sales mount the page-level product search input is the
 * focus target so a USB HID barcode scan lands in the right
 * place without a click.
 * 2. After the ProductSearchDialog closes (Escape or selection)
 * focus restores to the same search input.
 * 3. After the QuickCreateCustomerGate closes focus restores to
 * the search input.
 * 4. The wedge-listener whitelist keeps manual typing safe: a
 * cashier who types slowly into the search input still gets
 * the form submit (ProductSearchDialog opens with the query)
 * and the wedge does NOT swallow the Enter.
 *
 * The fast-scan path (wedge fires, cart updates, input clears) is
 * exercised by `useBarcodeWedgeListener.test.ts`. The focus
 * restoration logic is exercised by `useScannerFocusRestoration.test.ts`.
 * This spec proves the wiring holds end-to-end in a real browser.
 */

const SEARCH_INPUT_ID = 'sales-product-search-input';
const SEARCH_INPUT_SELECTOR = `#${SEARCH_INPUT_ID}`;
// matchesShortcut() resolves Mod=Meta on darwin and Mod=Control elsewhere.
// CI runs on linux but local Playwright runs on the operator's macOS box,
// so we branch here to keep the spec runnable on both.
const MOD_KEY = process.platform === 'darwin' ? 'Meta' : 'Control';

async function expectSearchInputFocused(page: import('@playwright/test').Page) {
  await expect
    .poll(async () => page.evaluate(() => document.activeElement?.id ?? ''), {
      timeout: 10_000,
    })
    .toBe(SEARCH_INPUT_ID);
}

test.describe('sales scanner focus', () => {
  test('mount: page-level search input is auto-focused on /sales load', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    await loginAs(page, 'cashier');
    await expect(page).toHaveURL(/\/sales$/);

    await page.waitForSelector(SEARCH_INPUT_SELECTOR);
    await expectSearchInputFocused(page);

    await expectNoClientIssues(tracker);
  });

  test('product search dialog: focus returns to search input after Escape', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    await loginAs(page, 'cashier');
    await expect(page).toHaveURL(/\/sales$/);

    const search = page.locator(SEARCH_INPUT_SELECTOR);
    await search.waitFor();
    await search.fill('e2e-no-match-expected');
    await search.press('Enter');

    // ProductSearchDialog title is rendered as a visible <h2> AND
    // wired via aria-labelledby, so getByRole resolves it both
    // ways. Cheaper than a text filter that could match overlapping
    // dialogs while quick-create gates are mounted.
    const dialog = page.getByRole('dialog', {
      name: /add product|agregar producto/i,
    });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await expectSearchInputFocused(page);
    await expectNoClientIssues(tracker);
  });

  test('quick-create customer: focus returns to search input after Escape', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    await loginAs(page, 'manager');
    await page.goto('/sales');
    await expect(page).toHaveURL(/\/sales$/);

    await page.waitForSelector(SEARCH_INPUT_SELECTOR);

    // Open the command palette via the canonical Mod+K shortcut.
    await page.keyboard.press(`${MOD_KEY}+K`);

    // CommandPalette exposes its title via aria-label only — match
    // by accessible name instead of visible text.
    const palette = page.getByRole('dialog', {
      name: /command palette|paleta de comandos/i,
    });
    await expect(palette).toBeVisible({ timeout: 10_000 });

    const paletteInput = palette.locator('input').first();
    await paletteInput.fill('Create new customer');
    await page.keyboard.press('Enter');

    // CustomerFormModal renders title customers:form.createTitle —
    // "Create Customer" / "Crear cliente". Matching by accessible
    // name keeps this stable while the palette tears down.
    const customerModal = page.getByRole('dialog', {
      name: /create customer|crear cliente/i,
    });
    await expect(customerModal).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');
    await expect(customerModal).toBeHidden();

    await expectSearchInputFocused(page);
    await expectNoClientIssues(tracker);
  });

  test('whitelist: manual slow typing reaches the form submit, wedge does not swallow Enter', async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    await loginAs(page, 'cashier');
    await expect(page).toHaveURL(/\/sales$/);

    const search = page.locator(SEARCH_INPUT_SELECTOR);
    await search.waitFor();
    await expectSearchInputFocused(page);

    // Type at human cadence (100ms per key, well above the 30ms
    // wedge inter-char threshold). Every keystroke resets the wedge
    // buffer so it never reaches minLength → the trailing Enter
    // falls through to the form submit and opens the
    // ProductSearchDialog with the typed query. Using a clearly
    // non-product sentinel here (rather than a valid EAN-13 like
    // 7702049000031) keeps the assertion stable against any seed
    // that happens to ship a real barcode.
    await search.pressSequentially('e2e-105f-slow-typing', { delay: 100 });
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', {
      name: /add product|agregar producto/i,
    });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await expectSearchInputFocused(page);
    await expectNoClientIssues(tracker);
  });
});
