import { electronTest as test, expect } from './fixtures.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';

const OWNER_EMAIL = 'sole-owner@example.com';
const RECOVERED_PASSWORD = 'RecoveredOwner42!';

test.use({ emptyInstallation: true });
test('lets the sole owner without a recovery code reset the password from this computer', async ({
  page,
}, testInfo) => {
  const tracker = attachClientIssueTracker(page);
  await expect(page.locator('#setup-businessName')).toBeVisible({ timeout: 30_000 });
  await page.locator('#setup-businessName').fill('Solo Owner Retail');
  await page.locator('#setup-siteName').fill('Main Store');
  await page.locator('#setup-countryCode').selectOption('CO');
  await page.getByRole('button', { name: /^(Continue|Continuar)$/ }).click();
  await page.locator('#setup-ownerName').fill('Solo Owner');
  await page.locator('#setup-email').fill(OWNER_EMAIL);
  await page.locator('#setup-password').fill('ForgottenOwner42!');
  await page.locator('#setup-confirmPassword').fill('ForgottenOwner42!');
  await page
    .getByRole('button', { name: /^(Create my workspace|Crear mi espacio de trabajo)$/ })
    .click();
  await expect(page).toHaveURL(/\/company|\/dashboard/, { timeout: 30_000 });

  // Admins without a code are asked once; declining keeps the local path open.
  await page.getByRole('button', { name: /^(Not now|Ahora no)$/ }).click({ timeout: 30_000 });
  expect(await page.evaluate(() => window.api!.session.ownerRecovery.status())).toEqual({
    available: true,
  });

  await page.getByRole('button', { name: /user menu|menú de usuario/i }).click();
  await page.getByRole('button', { name: /^(Sign out|Cerrar sesión)$/ }).click();
  await page
    .getByRole('button', { name: /^(Forgot your password\?|¿Olvidaste tu contraseña\?)$/ })
    .click({ timeout: 30_000 });
  await expect(
    page.getByText(/only user of this installation|único usuario de esta instalación/)
  ).toBeVisible();
  await expect(page.locator('#recovery-code')).toHaveCount(0);

  await page.locator('#recovery-email').fill(OWNER_EMAIL);
  await page.locator('#recovery-new-password').fill(RECOVERED_PASSWORD);
  await page.locator('#recovery-confirm-password').fill(RECOVERED_PASSWORD);
  await page.screenshot({ path: testInfo.outputPath('owner-local-recovery.png'), fullPage: true });
  await page.getByRole('button', { name: /^(Save password|Guardar contraseña)$/ }).click();
  await expect(page.getByText(/Password updated|Contraseña actualizada/)).toBeVisible({
    timeout: 30_000,
  });

  await expect(page.locator('#email')).toHaveValue(OWNER_EMAIL);
  await page.locator('#password').fill(RECOVERED_PASSWORD);
  await page
    .getByRole('button', { name: /^(Enter workspace|Entrar al espacio de trabajo)$/ })
    .click();
  await expect(page).toHaveURL(/\/company|\/dashboard/, { timeout: 30_000 });
  await expectNoClientIssues(tracker);
});
