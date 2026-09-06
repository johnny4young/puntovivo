import { expect, test } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login } from './support/app';
import { getProductStock, seedSaleScenario } from './support/db';
import {
  recoverBootstrap,
  expectOnlyInjectedBootstrapFailure,
  type BootstrapFault,
} from '../shared/auth-recovery';

for (const locale of ['en', 'es'] as const) {
  for (const fault of [
    { procedure: 'health.check', status: 429 },
    { procedure: 'auth.refresh', status: 503 },
    { procedure: 'auth.me', status: 'offline' },
  ] satisfies BootstrapFault[]) {
    test(`recovers ${fault.procedure} ${fault.status} in ${locale} without exposing or discarding the cart`, async ({
      page,
    }, testInfo) => {
      const scenario = seedSaleScenario(`recovery-${testInfo.parallelIndex}-${Date.now()}`);
      const stock = getProductStock(scenario.product.id);
      const tracker = attachClientIssueTracker(page);
      await login(
        page,
        { ...scenario.cashier, defaultPath: '/sales' },
        { spanish: locale === 'es' }
      );
      await page.locator('#sales-product-search-input').fill(scenario.product.sku);
      await page.locator('#sales-product-search-input').press('Enter');
      const dialog = page.getByRole('dialog', { name: /add product|agregar producto/i });
      await dialog.getByTestId(`product-search-row-${scenario.product.sku}`).click();
      await dialog.getByRole('button', { name: /add to cart|agregar al carrito/i }).click();
      const cart = page.getByTestId(`sale-cart-item-${scenario.product.sku}`);
      await expect(cart).toBeVisible();
      const before = await cart.innerText();
      const injectedUrl = await recoverBootstrap(page, fault, locale, `web-${fault.procedure}`);
      await expect(cart).toBeVisible();
      await expect(cart).toHaveText(before, { useInnerText: true });
      await page.reload();
      await expect(cart).toHaveText(before, { useInnerText: true });
      expect(getProductStock(scenario.product.id)).toBe(stock);
      expectOnlyInjectedBootstrapFailure(tracker, fault, injectedUrl);
    });
  }
}

for (const locale of ['en', 'es'] as const) {
  test(`changes the password from the deferred account dialog and signs in again in ${locale}`, async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedSaleScenario(
      `account-password-${locale}-${testInfo.parallelIndex}-${Date.now()}`
    );
    const spanish = locale === 'es';
    await login(page, { ...scenario.cashier, defaultPath: '/sales' }, { spanish });
    const stock = getProductStock(scenario.product.id);
    await page
      .getByRole('button', { name: spanish ? /^Abre el menú de usuario/ : /^Open user menu/ })
      .click();
    await page
      .getByRole('button', {
        name: spanish ? 'Cambiar contraseña' : 'Change password',
        exact: true,
      })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('#current-password')).toBeVisible();
    await dialog.locator('#current-password').fill(scenario.cashier.password);
    const newPassword = 'PuntovivoE2E!456';
    await dialog.locator('#new-password').fill(newPassword);
    await dialog.locator('#confirm-password').fill(newPassword);
    await dialog
      .getByRole('button', {
        name: spanish ? 'Cambiar contraseña' : 'Change Password',
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/login$/);
    await login(
      page,
      { ...scenario.cashier, password: newPassword, defaultPath: '/sales' },
      { spanish }
    );
    await page.reload();
    await expect(page.locator('#sales-product-search-input')).toBeVisible();
    expect(getProductStock(scenario.product.id)).toBe(stock);
    await expectNoClientIssues(tracker);
  });
}

test('explicit re-entry survives reload and establishes CSRF before a new login', async ({
  page,
  context,
}, testInfo) => {
  const scenario = seedSaleScenario(`recovery-account-${testInfo.parallelIndex}-${Date.now()}`);
  await login(page, { ...scenario.cashier, defaultPath: '/sales' });
  await page.route(
    '**/api/trpc/health.check?*',
    route =>
      route.fulfill({
        status: 503,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': 'http://localhost:3000',
          'access-control-allow-credentials': 'true',
        },
        body: JSON.stringify([
          {
            error: {
              code: -32603,
              message: 'Synthetic unavailable boundary',
              data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 503 },
            },
          },
        ]),
      }),
    { times: 1 }
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'We could not verify your session' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign in again', exact: true }).click();
  await expect(page.locator('#email')).toBeVisible();
  // Keep the previous httpOnly refresh cookie but remove only its CSRF peer.
  // A new account must not auto-resume it, nor POST before safe bootstrap.
  await context.clearCookies({ name: 'puntovivo_csrf' });
  const allowHealth = createDeferred<void>();
  const healthStarted = createDeferred<void>();
  await page.route('**/api/trpc/health.check?*', async route => {
    healthStarted.resolve();
    await allowHealth.promise;
    await route.continue();
  });
  let refreshes = 0;
  let logins = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname.split('/').at(-1)?.split(',').includes('auth.refresh'))
      refreshes += 1;
    if (new URL(request.url()).pathname.split('/').at(-1)?.split(',').includes('auth.login'))
      logins += 1;
  });
  await page.reload();
  await expect(page.locator('#email')).toBeVisible();
  await page.locator('#email').fill(scenario.cashier.email);
  await page.locator('#password').fill(scenario.cashier.password);
  await page.getByRole('button', { name: 'Enter workspace', exact: true }).click();
  await healthStarted.promise;
  expect(refreshes).toBe(0);
  expect(logins).toBe(0);
  const loggedIn = page.waitForResponse(
    response =>
      new URL(response.url()).pathname.split('/').at(-1)?.split(',').includes('auth.login') &&
      response.status() === 200
  );
  allowHealth.resolve();
  await loggedIn;
  await expect(page).toHaveURL(/\/sales$/);
  expect(logins).toBe(1);
  expect(refreshes).toBe(0);
  await page.unroute('**/api/trpc/health.check?*');
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
}
