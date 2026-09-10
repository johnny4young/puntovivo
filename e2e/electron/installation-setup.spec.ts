import { electronTest as test, expect } from './fixtures.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';

test.use({ emptyInstallation: true });
test('creates its first real owner via trusted main IPC and reloads the owned workspace', async ({
  page,
}, testInfo) => {
  const tracker = attachClientIssueTracker(page);
  await expect(page.locator('#setup-businessName')).toBeVisible({ timeout: 30_000 });
  // Structured clone permits cycles, but the fixed JSON transport does not.
  // Failure must stay inside main and must not consume first-use ownership.
  const cyclicResult = await page.evaluate(async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const session = window.api!.session;
    return session.completeSetup(cyclic as Parameters<typeof session.completeSetup>[0]);
  });
  expect(cyclicResult).toEqual({ ok: false, errorCode: 'INTERNAL_SERVER_ERROR' });
  await page.locator('#setup-businessName').fill('Electron First Retail');
  await page.locator('#setup-siteName').fill('Main Store');
  await page.locator('#setup-countryCode').selectOption('CO');
  await page.getByRole('button', { name: /^(Continue|Continuar)$/ }).click();
  await expect(page.locator('#setup-ownerName')).toBeFocused();
  await page.locator('#setup-ownerName').fill('Desktop Owner');
  await page.locator('#setup-email').fill('desktop-owner@example.com');
  await page.locator('#setup-password').fill('OwnerPassword42!');
  await page.locator('#setup-confirmPassword').fill('OwnerPassword42!');
  await expect(page.locator('#setup-token')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('installation-desktop-owner.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: /^(Create my workspace|Crear mi espacio de trabajo)$/ })
    .click();
  await expect(page).toHaveURL(/\/company|\/dashboard/, { timeout: 30_000 });
  await page.reload();
  await expect(page.locator('#setup-businessName')).toHaveCount(0);
  await expect(page.getByText('Electron First Retail').first()).toBeVisible({ timeout: 30_000 });
  // A consumed capability cannot claim ownership again, even from the trusted renderer.
  const rejected = await page.evaluate(() =>
    window.api!.session.completeSetup({
      ownerName: 'Other',
      businessName: 'Other',
      siteName: 'Other',
      email: 'other@example.com',
      password: 'OwnerPassword42!',
      countryCode: 'CO',
      presetId: 'retail',
    })
  );
  expect(rejected).toEqual({ ok: false, errorCode: 'SETUP_ALREADY_COMPLETED' });
  await expectNoClientIssues(tracker);
});
