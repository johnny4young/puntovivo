import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  E2E_USERS,
  expectNoClientIssues,
  login,
} from './support/app';

test('each price tier exposes distinct named controls in EN and ES', async ({ page }) => {
  const issues = attachClientIssueTracker(page);
  await login(page, E2E_USERS.admin);
  await page.goto('/products');
  for (const language of ['en', 'es'] as const) {
    await ensureLanguage(page, language);
    await page
      .getByRole('button', {
        name: language === 'en' ? 'Add Product' : 'Agregar producto',
        exact: true,
      })
      .click();
    const dialog = page.getByRole('dialog', {
      name: language === 'en' ? 'Create Product' : 'Crear producto',
      exact: true,
    });
    await dialog
      .getByRole('button', {
        name: language === 'en' ? 'Advanced settings' : 'Opciones avanzadas',
        exact: true,
      })
      .click();
    await dialog
      .getByRole('tab', { name: language === 'en' ? 'Pricing' : 'Precios', exact: true })
      .click();
    for (const tier of [1, 2, 3]) {
      const group = dialog.getByRole('group', {
        name: language === 'en' ? `Price Tier ${tier}` : `Tarifa de precio ${tier}`,
        exact: true,
      });
      const price = group.getByRole('spinbutton', {
        name: language === 'en' ? 'Sale Price' : 'Precio de venta',
        exact: true,
      });
      await expect(price).toBeVisible();
      await expect(
        group.getByRole('spinbutton', {
          name: language === 'en' ? 'Margin %' : 'Margen %',
          exact: true,
        })
      ).toBeVisible();
      await expect(
        group.getByRole('spinbutton', {
          name: language === 'en' ? 'Margin Amount' : 'Valor de margen',
          exact: true,
        })
      ).toBeVisible();
      // Clicking the actual label must focus its input, not another tier.
      await group
        .locator('label')
        .filter({ hasText: language === 'en' ? /^Sale Price$/ : /^Precio de venta$/ })
        .click();
      await expect(price).toBeFocused();
    }
    if (process.env.PUNTOVIVO_AUDIT_DIR) {
      await mkdir(process.env.PUNTOVIVO_AUDIT_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(process.env.PUNTOVIVO_AUDIT_DIR, `product-pricing-labels-${language}.png`),
        fullPage: true,
      });
    }
    await dialog
      .getByRole('button', { name: language === 'en' ? 'Cancel' : 'Cancelar', exact: true })
      .click();
    await expect(dialog).toBeHidden();
  }
  await expectNoClientIssues(issues);
});
