/**
 * Shared steps for the desktop operator journeys.
 *
 * Every journey builds its own preconditions through the UI rather than seeding
 * the database. That is not a stylistic choice: `e2e/web/support/db.ts` binds to
 * `packages/server/data/local.db`, the web suite's unencrypted development
 * database, so it cannot reach the SQLCipher database inside an Electron
 * userData directory. Driving the UI also means a precondition that silently
 * stops working shows up as a failing journey instead of a seed that quietly
 * diverges from what the product does.
 *
 * The helpers accept both languages because the desktop app inherits the OS
 * locale; journeys pin English before signing in, and the fallbacks keep a
 * mis-pinned run readable instead of failing on a regex.
 *
 * @module e2e/electron/support/journey
 */

import { expect, type Page } from '@playwright/test';
import { E2E_PASSWORD, SECONDARY_SITE_NAME } from '../../shared/baseline.js';
import { IS_PACKAGED_RUN } from '../fixtures.js';

/**
 * Navigate to an app route on either target.
 *
 * The sidebar groups routes under collapsible workspaces, so there is no flat
 * link to click, and a constructed URL only works on one target: the dev bundle
 * serves history routes from localhost while the packaged build serves hash
 * routes from `puntovivo-app://app`. Branching here keeps every journey free of
 * that detail.
 */
export async function requestRoute(page: Page, route: string): Promise<void> {
  if (IS_PACKAGED_RUN) {
    await page.evaluate(target => {
      window.location.hash = `#${target}`;
    }, route);
  } else {
    // Keep this a client-side navigation. A full page.goto() tears down the
    // authenticated React tree between pinning a site and using it; the
    // rehydration request can then resolve the tenant fallback before the
    // selected-site header is restored, silently moving a multi-site journey
    // back to the alphabetically first site. Dispatching popstate exercises
    // the same BrowserRouter path transition as an in-app link and preserves
    // the operator's selected site.
    await page.evaluate(target => {
      window.history.pushState({}, '', target);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, route);
  }
}

export async function goToRoute(page: Page, route: string): Promise<void> {
  await requestRoute(page, route);
  await expect(page).toHaveURL(new RegExp(`${route}$`), { timeout: 30_000 });
}

/**
 * Return to a signed-out login form.
 *
 * The web suite's `resetSession` navigates to `/login`, which the packaged app
 * cannot do: it serves the renderer from `puntovivo-app://app` behind a hash
 * route, so a path navigation has nowhere to land. Clear both the renderer
 * stores and Electron's memory-only session before reloading; clearing only
 * cookies is no longer a logout now that renderer reloads preserve the active
 * workstation operator.
 */
export async function signOut(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.evaluate(async () => {
    const desktopSession = window.api?.session ?? window.session;
    await desktopSession?.clear?.();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.reload();
  await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 30_000 });
}

/** Sign in, pinning the locale first so copy assertions are deterministic. */
export async function signIn(page: Page, email: string, password = E2E_PASSWORD): Promise<void> {
  const emailInput = page.getByLabel(/email/i);
  await expect(emailInput).toBeVisible({ timeout: 30_000 });

  await page.evaluate(() => {
    window.localStorage.setItem('puntovivo-language-preference', 'en');
  });
  await page.reload();
  await expect(emailInput).toBeVisible({ timeout: 30_000 });

  await emailInput.fill(email);
  await page.getByRole('textbox', { name: /password/i }).fill(password);
  await page.getByRole('button', { name: /enter workspace|entrar al espacio de trabajo/i }).click();

  // Wait for the post-login redirect to settle before returning. Without this
  // the caller's own navigation races it: the app finishes authenticating,
  // redirects to its landing route, and silently discards wherever the journey
  // had just navigated to.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /open user menu/i })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Pin the site that receives a product's initial stock.
 *
 * The stock typed into the create-product dialog does NOT land at whatever
 * site is active — it goes to the tenant's primary site. The products list
 * hides this, because the quantity it shows is the product-level rollup and
 * reads the same from either site; the discrepancy only surfaces at the till,
 * as `Available: 0`. So any journey that stocks a shelf and then sells has to
 * put both roles on the primary site.
 *
 * Identified as "the site the baseline did not add" rather than by name, so a
 * renamed primary site does not silently break every selling journey.
 */
export async function pinPrimarySite(page: Page): Promise<void> {
  const trigger = page.locator('header button[name="site"]');
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  const options = page.getByRole('option');
  await expect(options.first()).toBeVisible({ timeout: 15_000 });
  const names = await options.allInnerTexts();
  const primary = names.map(name => name.trim()).find(name => name !== SECONDARY_SITE_NAME);
  if (!primary) {
    throw new Error(`no primary site among: ${names.join(', ')}`);
  }
  const primaryOption = page.getByRole('option', { name: primary });
  const primarySiteId = await primaryOption.getAttribute('data-value');
  if (!primarySiteId) {
    throw new Error(`primary site option ${primary} did not expose its stable value`);
  }
  await primaryOption.click();
  await expect(trigger).toHaveText(primary, { timeout: 15_000 });

  // `switchSite` updates React state first and persists the x-site-id source
  // in an effect. The label can therefore change one render before the tRPC
  // transport sees the new site. Waiting for storage prevents the next
  // mutation from racing under the old site in multi-site journeys.
  await expect
    .poll(async () => Object.values(await readStoredSiteSelections(page)).includes(primarySiteId), {
      timeout: 15_000,
    })
    .toBe(true);
}

async function readStoredSiteSelections(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() =>
    Object.fromEntries(
      Object.entries(window.localStorage).filter(([key]) => key.startsWith('active_site_id:'))
    )
  );
}

/** Create a sellable product through the operator-first quick form. */
export async function createProduct(
  page: Page,
  options: { name: string; sku: string; stock?: string; price?: string }
): Promise<void> {
  await page.getByRole('button', { name: /add product|agregar producto/i }).click();
  const dialog = page.getByRole('dialog', { name: /create product|crear producto/i });
  await expect(dialog).toBeVisible();
  await dialog.locator('#product-name').fill(options.name);
  await dialog.locator('#product-sku').fill(options.sku);
  await dialog.locator('#product-price').fill(options.price ?? '1000');
  await dialog
    .getByRole('button', { name: /add opening stock|agregar inventario inicial/i })
    .click();
  await dialog.locator('#product-stock').fill(options.stock ?? '10');
  await dialog.getByRole('button', { name: /create product|crear producto/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/**
 * Open the drawer. Completing a sale without an active cash session is refused
 * by the server, so this is a real precondition for every selling journey.
 */
export async function openCashSession(page: Page, register: string): Promise<void> {
  await page
    .getByRole('button', { name: /open cash session|abrir caja/i })
    .first()
    .click();
  const dialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByRole('heading', { name: /open cash session|abrir caja/i }) })
    .last();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.locator('#cash-session-register').fill(register);
  await dialog.locator('#cash-session-opening-float').fill('0');
  // The confirm button reads "Open session" in English and "Abrir caja" in
  // Spanish — not "Abrir sesión".
  const confirm = dialog.getByRole('button', { name: /open session|abrir caja/i });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/** Add one unit of `sku` to the cart through the product search dialog. */
export async function addProductToCart(page: Page, sku: string): Promise<void> {
  await page
    .getByRole('button', { name: /search products|buscar productos/i })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: /add product|agregar producto/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: /search|buscar/i }).fill(sku);
  const row = dialog.getByTestId(`product-search-row-${sku}`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await dialog.getByRole('button', { name: /add to cart|agregar al carrito/i }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId(`sale-cart-item-${sku}`)).toBeVisible();
}

/** Charge the current cart with the exact-cash shortcut and confirm. */
export async function chargeExactCash(page: Page): Promise<void> {
  await page.keyboard.press('F2');
  const dialog = page.getByRole('dialog', { name: /charge sale|cobrar venta/i });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  const confirm = dialog.locator('#sale-payment-confirm');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/**
 * Toasts stack over the cart and a stale one can swallow the click the next
 * step depends on.
 */
export async function dismissVisibleToasts(page: Page): Promise<void> {
  const dismissButtons = page.locator('[role="status"] button[aria-label]');
  while ((await dismissButtons.count()) > 0) {
    await dismissButtons.first().click();
  }
}
