import { electronTest as test, expect } from './fixtures.js';
import { E2E_PASSWORD, FIRST_SALE_E2E_EMAIL } from '../shared/baseline.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import {
  recoverBootstrap,
  expectOnlyInjectedBootstrapFailure,
  type BootstrapFault,
} from '../shared/auth-recovery.js';
import { addProductToCart, createProduct, goToRoute, signIn } from './support/journey.js';

for (const fault of [
  { procedure: 'health.check', status: 429 },
  { procedure: 'auth.me', status: 503 },
] satisfies BootstrapFault[]) {
  test(`recovers ${fault.procedure} ${fault.status} through the verified desktop session after reload`, async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    await signIn(page, FIRST_SALE_E2E_EMAIL);
    await page
      .getByTestId('first-sale-guide')
      .getByRole('link', { name: /create product/i })
      .click();
    const sku = 'E2E-BOOT-RECOVERY';
    await createProduct(page, { name: 'Recovery Product', sku, stock: '10' });
    await goToRoute(page, '/sales');
    await addProductToCart(page, sku);
    const cart = page.getByTestId(`sale-cart-item-${sku}`);
    const before = await cart.innerText();
    const injectedUrl = await recoverBootstrap(page, fault, 'en', `electron-${fault.procedure}`);
    await expect(cart).toHaveText(before, { useInnerText: true });
    await page.reload();
    await expect(cart).toHaveText(before, { useInnerText: true });
    expectOnlyInjectedBootstrapFailure(tracker, fault, injectedUrl);
  });
}

// Password rotation revokes the main-process credential as well as the browser
// identity. Drive the real UI; a mocked logout cannot prove IPC custody cleared.
test('password change clears desktop custody before accepting the new credential', async ({
  page,
}, testInfo) => {
  const tracker = attachClientIssueTracker(page);
  await signIn(page, FIRST_SALE_E2E_EMAIL);
  const logoutRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/trpc/auth.logout')) logoutRequests.push(request.url());
  });
  await page.getByRole('button', { name: /^Open user menu/ }).click();
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Change Password', exact: true });
  await dialog.locator('#current-password').fill(E2E_PASSWORD);
  await dialog.locator('#new-password').fill('PuntovivoE2E!456');
  await dialog.locator('#confirm-password').fill('PuntovivoE2E!456');
  await dialog.getByRole('button', { name: 'Change Password', exact: true }).click();
  await expect(page.getByLabel(/email/i)).toBeVisible();
  expect(await page.evaluate(() => window.api?.session?.resume())).toEqual({ token: null });
  expect(logoutRequests).toEqual([]);
  await signIn(page, FIRST_SALE_E2E_EMAIL, 'PuntovivoE2E!456');
  await page.reload();
  await expect(page.getByTestId('first-sale-guide')).toBeVisible();
  const resumed = await page.evaluate(async () =>
    Boolean((await window.api?.session?.resume())?.token)
  );
  expect(resumed).toBe(true);
  await expectNoClientIssues(tracker);
  await testInfo.attach('desktop-password-reentry', {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  });
});
