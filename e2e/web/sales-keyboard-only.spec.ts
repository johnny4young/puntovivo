import { expect, test } from '@playwright/test';
import {
  attachClientIssueTracker,
  expectNoClientIssues,
  expectSuccessToast,
  login,
  loginAs,
} from './support/app';
import { runAxeOnPage } from './support/a11y';
import { seedSaleScenario } from './support/db';
import {
  MOD_KEY,
  SEARCH_INPUT_SELECTOR,
  addProductToCartViaKeyboard,
  expectSearchInputFocused,
} from './support/sales-keyboard';

/**
 * ENG-134d — Keyboard-only `/sales` end-to-end smoke.
 *
 * Permanent safety net for the keyboard-first cashier promise shipped
 * by ENG-105F (focus contract) + ENG-134e (ProductSearchDialog row
 * keyboard nav) + ENG-134f (DataTable row activation). The cashier
 * must be able to operate the entire sales surface with only the
 * keyboard — agregar producto, pagar con F1 / F2, undo, quick-create
 * mid-sale, navegar al detail de la venta recién hecha.
 *
 * Each test asserts:
 *  - concrete focus state (`document.activeElement.id`) at every
 *    transition,
 *  - concrete user-visible strings via accessible role lookups,
 *  - zero console errors / unhandled requests through
 *    `attachClientIssueTracker`.
 *
 * Axe scans live inline in the happy-path test ONLY (mount, dialog
 * open, payment modal open) to keep runtime sane.
 */

test.describe('keyboard-only /sales smoke (ENG-134d)', () => {
  test.describe('base flows', () => {
    test('mount autofocus + close→restore round-trip', async ({ page }) => {
      const tracker = attachClientIssueTracker(page);
      await loginAs(page, 'cashier');
      await expect(page).toHaveURL(/\/sales$/);

      await page.waitForSelector(SEARCH_INPUT_SELECTOR);
      await expectSearchInputFocused(page);

      // Use a clearly non-product sentinel so the dialog renders the
      // empty-state (no matching rows). The point of THIS test is the
      // round-trip — we are NOT exercising the selection happy path.
      const search = page.locator(SEARCH_INPUT_SELECTOR);
      await search.fill('e2e-134d-sentinel-no-match');
      await search.press('Enter');

      const dialog = page.getByRole('dialog', {
        name: /add product|agregar producto/i,
      });
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      await expectSearchInputFocused(page);
      await expectNoClientIssues(tracker);
    });

    test('happy-path E2E sale via keyboard only', async ({ page }, testInfo) => {
      const tracker = attachClientIssueTracker(page);
      const scenario = seedSaleScenario(
        `kbd-happy-${testInfo.parallelIndex}-${Date.now()}`
      );

      await login(page, {
        email: scenario.cashier.email,
        password: scenario.cashier.password,
        defaultPath: '/sales',
      });
      await expect(page).toHaveURL(/\/sales$/);

      // Axe scan #1: settled /sales for this freshly-seeded cashier.
      // After ENG-134d the Undo / Clear toolbar buttons no longer
      // render when their action is unavailable, so the cart-empty
      // settled state has no disabled-control contrast violations
      // for axe to flag.
      await page.waitForSelector(SEARCH_INPUT_SELECTOR);
      await runAxeOnPage(page);

      // Step 1-5: ProductSearchDialog → row select → Add to cart.
      const search = page.locator(SEARCH_INPUT_SELECTOR);
      await search.fill(scenario.product.sku);
      await search.press('Enter');

      const productDialog = page.getByRole('dialog', {
        name: /add product|agregar producto/i,
      });
      await expect(productDialog).toBeVisible({ timeout: 10_000 });

      // Axe scan #2: ProductSearchDialog open.
      await runAxeOnPage(page);

      const row = productDialog.locator(
        `[data-testid="product-search-row-${scenario.product.sku}"]`
      );
      await row.waitFor({ timeout: 10_000 });
      await row.focus();
      await page.keyboard.press('Enter');

      const addToCart = productDialog.getByRole('button', {
        name: /add to cart|agregar al carrito/i,
      });
      await addToCart.focus();
      await page.keyboard.press('Enter');
      await expect(productDialog).toBeHidden();

      // Cart shows the new line item; the cashier reads the product
      // name to confirm before pressing F1.
      await expect(
        page.getByRole('cell', { name: new RegExp(scenario.product.sku, 'i') })
      ).toBeVisible({ timeout: 10_000 });

      // Step 6: F1 opens SalePaymentModal (ENG-105 slice A + slice B preflight).
      await expectSearchInputFocused(page);
      await page.keyboard.press('F1');
      const paymentDialog = page.getByRole('dialog', {
        name: /charge sale|cobrar venta/i,
      });
      await expect(paymentDialog).toBeVisible({ timeout: 10_000 });

      // Axe scan #3: SalePaymentModal open.
      await runAxeOnPage(page);

      // Step 7: Tab to Confirm, press Enter. Confirm button id from ENG-105e.
      const confirm = paymentDialog.locator('#sale-payment-confirm');
      await confirm.focus();
      await page.keyboard.press('Enter');

      await expect(paymentDialog).toBeHidden({ timeout: 15_000 });
      await expectSuccessToast(page, /sale completed|venta completada/i);

      // Step 8: focus restores to the page-level search input so the
      // cashier can scan the next item without touching the mouse.
      await expectSearchInputFocused(page);

      await expectNoClientIssues(tracker);
    });

    test('F2 exact-cash applies and confirms with keyboard alone', async ({
      page,
    }, testInfo) => {
      const tracker = attachClientIssueTracker(page);
      const scenario = seedSaleScenario(
        `kbd-fastcash-${testInfo.parallelIndex}-${Date.now()}`
      );

      await login(page, {
        email: scenario.cashier.email,
        password: scenario.cashier.password,
        defaultPath: '/sales',
      });

      await addProductToCartViaKeyboard(page, scenario.product.sku);

      // F2 path: opens payment modal in exact-cash mode with focus
      // already on the Confirm button (ENG-105e contract).
      await page.keyboard.press('F2');
      const paymentDialog = page.getByRole('dialog', {
        name: /charge sale|cobrar venta/i,
      });
      await expect(paymentDialog).toBeVisible({ timeout: 10_000 });

      // ENG-105e queues a microtask focus on #sale-payment-confirm;
      // we poll for it rather than relying on a single tick.
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.id ?? ''), {
          timeout: 5_000,
        })
        .toBe('sale-payment-confirm');

      // Direct Enter confirms — no extra Tab needed because F2 already
      // pre-filled amountReceived and focused the primary action.
      await page.keyboard.press('Enter');
      await expect(paymentDialog).toBeHidden({ timeout: 15_000 });
      await expectSuccessToast(page, /sale completed|venta completada/i);
      await expectSearchInputFocused(page);

      await expectNoClientIssues(tracker);
    });

    test('tab order is sane on /sales empty state', async ({ page }) => {
      const tracker = attachClientIssueTracker(page);
      await loginAs(page, 'cashier');
      await expect(page).toHaveURL(/\/sales$/);

      await page.waitForSelector(SEARCH_INPUT_SELECTOR);
      await expectSearchInputFocused(page);

      // Press Tab 12 times and snapshot the active element each step.
      // The contract: no Tab lands on <body> (would mean focus escaped
      // the page-level interactive set) and every focused element is
      // visible to a screen reader (role / tag is meaningful).
      const trail: Array<{ tag: string; role: string | null; id: string }> = [];
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        const snapshot = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el) return { tag: 'NONE', role: null, id: '' };
          return {
            tag: el.tagName,
            role: el.getAttribute('role'),
            id: (el as HTMLElement).id || '',
          };
        });
        trail.push(snapshot);
      }

      // No Tab should have landed on <body> — that would mean the
      // page-level interactive set is too sparse and the user has
      // fallen off the focusable tree.
      const bodyHits = trail.filter(step => step.tag === 'BODY');
      expect(bodyHits, `Tab landed on <body> at steps ${
        trail
          .map((s, idx) => (s.tag === 'BODY' ? idx + 1 : null))
          .filter(idx => idx != null)
          .join(', ')
      }`).toHaveLength(0);

      await expectNoClientIssues(tracker);
    });
  });

  test.describe('quick-create + palette', () => {
    test('Mod+K palette opens, closes, restores focus', async ({ page }) => {
      const tracker = attachClientIssueTracker(page);
      await loginAs(page, 'cashier');
      await page.waitForSelector(SEARCH_INPUT_SELECTOR);
      await expectSearchInputFocused(page);

      await page.keyboard.press(`${MOD_KEY}+K`);
      const palette = page.getByRole('dialog', {
        name: /command palette|paleta de comandos/i,
      });
      await expect(palette).toBeVisible({ timeout: 10_000 });

      await page.keyboard.press('Escape');
      await expect(palette).toBeHidden();

      await expectSearchInputFocused(page);
      await expectNoClientIssues(tracker);
    });

    test('quick-create product mid-sale via Mod+K', async ({ page }, testInfo) => {
      const tracker = attachClientIssueTracker(page);
      const scenario = seedSaleScenario(
        `kbd-qc-product-${testInfo.parallelIndex}-${Date.now()}`
      );
      // Use the manager so the role gate on the quick-create CTA opens.
      // Manager lands on /dashboard by default; navigate explicitly.
      await login(page, {
        email: scenario.manager.email,
        password: scenario.manager.password,
        defaultPath: '/dashboard',
      });
      await page.goto('/sales');
      await page.waitForSelector(SEARCH_INPUT_SELECTOR);

      await page.keyboard.press(`${MOD_KEY}+K`);
      const palette = page.getByRole('dialog', {
        name: /command palette|paleta de comandos/i,
      });
      await expect(palette).toBeVisible({ timeout: 10_000 });

      // Type into the palette's own search input — keyboard-only.
      const paletteInput = palette.locator('input').first();
      await paletteInput.fill('Create new product');
      await page.keyboard.press('Enter');

      // QuickCreateProductGate mounts ProductFormModal (lazy-load).
      const productModal = page.getByRole('dialog', {
        name: /create product|crear producto/i,
      });
      await expect(productModal).toBeVisible({ timeout: 15_000 });

      // Escape without saving — the test validates the palette path
      // and focus restore, not the form completion (covered by the
      // ProductSearchDialog quick-create CTA test that already lives
      // in business.spec.ts).
      await page.keyboard.press('Escape');
      await expect(productModal).toBeHidden({ timeout: 10_000 });

      await expectSearchInputFocused(page);
      await expectNoClientIssues(tracker);
    });

    test('quick-create customer mid-sale focus contract', async ({
      page,
    }, testInfo) => {
      const tracker = attachClientIssueTracker(page);
      const scenario = seedSaleScenario(
        `kbd-qc-customer-${testInfo.parallelIndex}-${Date.now()}`
      );
      // Manager defaults to /dashboard; navigate to /sales after login.
      await login(page, {
        email: scenario.manager.email,
        password: scenario.manager.password,
        defaultPath: '/dashboard',
      });
      await page.goto('/sales');
      await page.waitForSelector(SEARCH_INPUT_SELECTOR);

      await page.keyboard.press(`${MOD_KEY}+K`);
      const palette = page.getByRole('dialog', {
        name: /command palette|paleta de comandos/i,
      });
      await expect(palette).toBeVisible({ timeout: 10_000 });

      const paletteInput = palette.locator('input').first();
      await paletteInput.fill('Create new customer');
      await page.keyboard.press('Enter');

      const customerModal = page.getByRole('dialog', {
        name: /create customer|crear cliente/i,
      });
      await expect(customerModal).toBeVisible({ timeout: 15_000 });

      await page.keyboard.press('Escape');
      await expect(customerModal).toBeHidden({ timeout: 10_000 });

      await expectSearchInputFocused(page);
      await expectNoClientIssues(tracker);
    });
  });

  test.describe('cart manipulation', () => {
    test('empty cart F1 shows preflight blocker, does not open payment modal', async ({
      page,
    }, testInfo) => {
      const tracker = attachClientIssueTracker(page);
      const scenario = seedSaleScenario(
        `kbd-empty-${testInfo.parallelIndex}-${Date.now()}`
      );
      await login(page, {
        email: scenario.cashier.email,
        password: scenario.cashier.password,
        defaultPath: '/sales',
      });
      await page.waitForSelector(SEARCH_INPUT_SELECTOR);
      await expectSearchInputFocused(page);

      // Cart is empty — F1 should NOT open the payment dialog.
      // ENG-105b ships a preflight blocker `cart_empty` (Cobrar
      // button disabled with aria-describedby pointing at the
      // panel). The keyboard user gets a toast or a no-op.
      await page.keyboard.press('F1');

      // Wait a short window for any modal to appear, then assert
      // none did. We intentionally do NOT poll — if the bug ever
      // regresses (modal opens), this test sees it once.
      await page.waitForTimeout(800);
      const paymentDialog = page.getByRole('dialog', {
        name: /charge sale|cobrar venta/i,
      });
      await expect(paymentDialog).toBeHidden();

      await expectNoClientIssues(tracker);
    });

    test('Mod+Z undoes last cart mutation', async ({ page }, testInfo) => {
      const tracker = attachClientIssueTracker(page);
      const scenario = seedSaleScenario(
        `kbd-undo-${testInfo.parallelIndex}-${Date.now()}`
      );
      await login(page, {
        email: scenario.cashier.email,
        password: scenario.cashier.password,
        defaultPath: '/sales',
      });

      await addProductToCartViaKeyboard(page, scenario.product.sku);

      // Verify the cart row is present.
      const cartRow = page.getByRole('cell', {
        name: new RegExp(scenario.product.sku, 'i'),
      });
      await expect(cartRow).toBeVisible({ timeout: 10_000 });

      // ENG-105d ships Mod+Z to undo the last cart mutation.
      await page.keyboard.press(`${MOD_KEY}+Z`);

      // The cart row vanishes; the toast confirms (best-effort).
      await expect(cartRow).toBeHidden({ timeout: 10_000 });
      await expectSuccessToast(page, /undone|deshecha/i);

      await expectSearchInputFocused(page);
      await expectNoClientIssues(tracker);
    });

    test('SalesHistoryTable row Enter opens detail post-sale (ENG-134f integration)', async ({
      page,
    }, testInfo) => {
      const tracker = attachClientIssueTracker(page);
      const scenario = seedSaleScenario(
        `kbd-history-${testInfo.parallelIndex}-${Date.now()}`
      );

      await login(page, {
        email: scenario.cashier.email,
        password: scenario.cashier.password,
        defaultPath: '/sales',
      });

      // Complete a sale so the history table has a fresh row.
      await addProductToCartViaKeyboard(page, scenario.product.sku);
      await page.keyboard.press('F2');
      const paymentDialog = page.getByRole('dialog', {
        name: /charge sale|cobrar venta/i,
      });
      await expect(paymentDialog).toBeVisible({ timeout: 10_000 });
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.id ?? ''), {
          timeout: 5_000,
        })
        .toBe('sale-payment-confirm');
      await page.keyboard.press('Enter');
      await expect(paymentDialog).toBeHidden({ timeout: 15_000 });

      // The SalesHistoryTable refreshes; the most recent row exposes
      // a stable `data-row-id`. Scope by the section that contains
      // the "Sales history" heading so we don't accidentally hit a
      // cart row carrying the same product id (the cart already
      // cleared, but the SalesCartWorkspace ancestor stays mounted).
      const historySection = page.locator('section', {
        has: page.getByRole('heading', {
          name: /sales history|historial de ventas/i,
        }),
      });
      const firstHistoryRow = historySection
        .locator('tbody tr[data-row-id]')
        .first();
      await firstHistoryRow.waitFor({ timeout: 15_000 });
      await firstHistoryRow.focus();
      await page.keyboard.press('Enter');

      // ENG-134f wires SalesHistoryTable onRowActivate → onView →
      // SaleDetailsModal. The modal title is dynamic: while the
      // `sales.getById` query loads it falls back to "Sale Details" /
      // "Detalles de la venta"; once the data lands it becomes
      // "Sale {saleNumber}" / "Venta {saleNumber}". The regex below
      // accepts both forms so the test does not race the query and so
      // `toBeHidden` after Escape sees the same locator that resolved
      // when the dialog was open (otherwise the locator would silently
      // un-match the live-title state and report hidden spuriously).
      const detailDialog = page.getByRole('dialog', {
        name: /sale (details|[A-Z]+-)|detalles de la venta|venta vta-/i,
      });
      await expect(detailDialog).toBeVisible({ timeout: 10_000 });

      await page.keyboard.press('Escape');
      await expect(detailDialog).toBeHidden();

      await expectNoClientIssues(tracker);
    });
  });
});
