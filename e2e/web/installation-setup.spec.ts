import Database from 'better-sqlite3';
import { test, expect } from './support/empty-installation.js';
import { attachClientIssueTracker, expectNoClientIssues } from './support/app.js';

for (const language of ['en', 'es'] as const) {
  test(`creates the real first owner from an empty installation and preserves ownership after reload (${language})`, async ({
    page,
    installation,
  }, testInfo) => {
    await page.addInitScript(
      locale => localStorage.setItem('puntovivo-language-preference', locale),
      language
    );
    const tracker = attachClientIssueTracker(page);
    if (language === 'es') await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');
    await expect(
      page.getByRole('heading', {
        name: language === 'es' ? 'Empieza con tu negocio.' : 'Start with your business.',
      })
    ).toBeVisible();
    await expect(page.locator('#setup-businessName')).toBeFocused();
    await page.locator('#setup-businessName').fill(`UI Retail ${language}`);
    await page.locator('#setup-siteName').fill('Main Store');
    await page.locator('#setup-countryCode').selectOption('CO');
    await page
      .getByRole('button', { name: language === 'es' ? 'Continuar' : 'Continue', exact: true })
      .click();
    await expect(page.locator('#setup-ownerName')).toBeFocused();
    await page
      .getByRole('button', { name: language === 'es' ? 'Volver' : 'Back', exact: true })
      .click();
    await expect(page.locator('#setup-businessName')).toHaveValue(`UI Retail ${language}`);
    await page
      .getByRole('button', { name: language === 'es' ? 'Continuar' : 'Continue', exact: true })
      .click();
    await page.locator('#setup-ownerName').fill('UI Owner');
    await page.locator('#setup-email').fill(`ui-owner-${language}@example.com`);
    await page.locator('#setup-password').fill('OwnerPassword42!');
    await page.locator('#setup-confirmPassword').fill('OwnerPassword42!');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    // Capture before entering the private code: evidence must not carry a credential.
    await page.screenshot({
      path: testInfo.outputPath(`installation-owner-${language}.png`),
      fullPage: true,
    });
    await page.locator('#setup-token').fill(installation.token);
    await page
      .getByRole('button', {
        name: language === 'es' ? 'Crear mi espacio de trabajo' : 'Create my workspace',
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/company|\/dashboard/, { timeout: 30_000 });
    await page.reload();
    await expect(page.locator('#setup-businessName')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /UI Owner/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Main Store', exact: true })).toBeVisible();
    const db = new Database(installation.databasePath, { readonly: true });
    try {
      expect(db.prepare('SELECT name, email, role FROM users').all()).toEqual([
        { name: 'UI Owner', email: `ui-owner-${language}@example.com`, role: 'admin' },
      ]);
      expect(db.prepare('SELECT name FROM tenants').all()).toEqual([
        { name: `UI Retail ${language}` },
      ]);
      expect(db.prepare('SELECT completion_kind FROM installation_setup').get()).toEqual({
        completion_kind: 'owner_claim',
      });
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'installation.owner_created'"
          )
          .get()
      ).toEqual({ n: 1 });
    } finally {
      db.close();
    }
    await expectNoClientIssues(tracker);
  });
}
