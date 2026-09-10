import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  login,
} from './support/app';
import { getRestaurantServiceEvidence, seedRestaurantServiceScenario } from './support/db';

async function capture(page: Page, name: string) {
  if (!process.env.PUNTOVIVO_AUDIT_DIR) return;
  await mkdir(process.env.PUNTOVIVO_AUDIT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(process.env.PUNTOVIVO_AUDIT_DIR, name + '.png'),
    fullPage: true,
    animations: 'disabled',
  });
}
async function addProduct(page: Page, sku: string) {
  await page.getByTestId('voice-ordering-manual-add').click();
  const dialog = page.getByRole('dialog', { name: /^(Search|Buscar)$/ });
  await dialog.getByPlaceholder(/SKU/).fill(sku);
  await dialog.getByTestId(`product-search-row-${sku}`).click();
  await dialog.getByRole('button', { name: /^(Search|Buscar)$/ }).click();
  await expect(dialog).toBeHidden();
}
for (const language of ['en', 'es'] as const)
  test(`site catalog survives manager edits and cashier settlement (${language})`, async ({
    page,
    browser,
  }, info) => {
    const scenario = seedRestaurantServiceScenario(`catalog-${info.parallelIndex}-${Date.now()}`),
      es = language === 'es';
    const tableName = `Catalog table ${scenario.product.sku.slice(-6)}`,
      addonName = `Cheese ${scenario.product.sku.slice(-6)}`,
      label = `Catalog check ${scenario.product.sku.slice(-6)}`;
    const tracker = attachClientIssueTracker(page);
    await login(page, { ...scenario.admin, defaultPath: '/dashboard' });
    await page.goto('/restaurants/tables');
    await page.getByTestId('restaurant-tables-create-cta').click();
    const tableDialog = page.getByRole('dialog', { name: 'Create table' });
    await tableDialog.getByTestId('restaurant-table-name').fill(tableName);
    await tableDialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(tableDialog).toBeHidden();
    await ensureLanguage(page, language);
    await page.goto('/restaurants/modifiers');
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: es ? 'Adicionales de restaurante' : 'Restaurant add-ons',
      })
    ).toBeVisible();
    await page
      .getByRole('button', { name: es ? 'Crear adicional' : 'Create add-on', exact: true })
      .click();
    let dialog = page.getByRole('dialog');
    await dialog
      .getByLabel(es ? 'Nombre del adicional' : 'Add-on name', { exact: true })
      .fill(addonName);
    await dialog
      .getByLabel(es ? 'Precio por adicional' : 'Price per add-on', { exact: true })
      .fill('1500');
    await dialog.getByLabel(es ? 'Máximo por plato' : 'Maximum per plate').fill('2');
    await dialog.getByRole('button', { name: es ? 'Guardar' : 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: es ? 'Adicional guardado' : 'Add-on saved' })
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: addonName, exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await expect
      .poll(async () => (await page.getByTestId('modifier-catalog-page').boundingBox())?.width ?? 0)
      .toBeGreaterThanOrEqual(320);
    await capture(page, `modifier-catalog-manager-mobile-${language}`);

    const cashierContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: { width: 390, height: 844 },
    });
    const till = await cashierContext.newPage(),
      tillTracker = attachClientIssueTracker(till);
    try {
      await login(till, { ...scenario.cashier, defaultPath: '/sales' });
      await ensureLanguage(till, language);
      await till.goto('/m');
      await till.getByTestId('voice-ordering-table-select').selectOption({ label: tableName });
      await till.getByTestId('voice-ordering-check-label').fill(label);
      await addProduct(till, scenario.product.sku);
      await expect(till.getByTestId('voice-ordering-modifier-price')).toHaveAttribute(
        'readonly',
        ''
      );
      await till
        .getByRole('button', { name: es ? 'Elegir adicional aprobado' : 'Choose approved add-on' })
        .click();
      let picker = till.getByRole('dialog');
      await picker.getByRole('button', { name: new RegExp(addonName) }).click();
      await expect(picker).toBeHidden();
      await expect(till.getByTestId('voice-ordering-modifier-name')).toHaveAttribute(
        'readonly',
        ''
      );
      await till.getByTestId('voice-ordering-modifier-quantity').fill('2');
      await expect(till.getByTestId('voice-ordering-modifier-price')).toHaveValue('1500');
      await capture(till, `modifier-catalog-cashier-mobile-${language}`);

      // Manager changes the catalog after the cashier selected it. No silent reprice.
      await page
        .getByRole('button', { name: `${es ? 'Editar' : 'Edit'} ${addonName}`, exact: true })
        .click();
      dialog = page.getByRole('dialog');
      await dialog
        .getByLabel(es ? 'Precio por adicional' : 'Price per add-on', { exact: true })
        .fill('2000');
      await dialog.getByRole('button', { name: es ? 'Guardar' : 'Save', exact: true }).click();
      await expect(dialog).toBeHidden();
      const rejection = till.waitForResponse(
        response =>
          response.url().includes('restaurantServices.openCheck') && response.status() === 409
      );
      await till.getByTestId('voice-ordering-save').click();
      expect(await (await rejection).text()).toContain('RESTAURANT_MODIFIER_CHANGED');
      await expect(
        till.getByText(es ? /Este adicional cambió/ : /This add-on changed/)
      ).toBeVisible();
      await expect(till.getByTestId('voice-ordering-modifier-price')).toHaveValue('1500');
      await till
        .getByRole('button', {
          name: `${es ? 'Eliminar modificador' : 'Remove modifier'} ${addonName}`,
          exact: true,
        })
        .click();
      await till
        .getByRole('button', { name: es ? 'Elegir adicional aprobado' : 'Choose approved add-on' })
        .click();
      picker = till.getByRole('dialog');
      await picker.getByRole('button', { name: new RegExp(addonName) }).click();
      await expect(till.getByTestId('voice-ordering-modifier-price')).toHaveValue('2000');
      await till.getByTestId('voice-ordering-save').click();
      await expect(till.getByTestId('voice-ordering-cart-empty')).toBeVisible();
      await expect
        .poll(() => getRestaurantServiceEvidence(scenario.tenantId, tableName, scenario.cashier.id))
        .toMatchObject({
          saleTotal: 14_500,
          checkLabel: label,
          lines: [{ modifierName: addonName, modifierQuantity: 1, modifierPriceDelta: 2000 }],
        });

      // Archive via UI, then reload and settle the already accepted frozen amount.
      await page
        .getByRole('button', { name: `${es ? 'Editar' : 'Edit'} ${addonName}`, exact: true })
        .click();
      dialog = page.getByRole('dialog');
      await dialog
        .getByLabel(es ? 'Disponible para nuevos pedidos' : 'Available for new orders')
        .uncheck();
      await dialog.getByRole('button', { name: es ? 'Guardar' : 'Save', exact: true }).click();
      await expect(dialog).toBeHidden();
      await page
        .getByLabel(es ? 'Mostrar adicionales archivados' : 'Show archived add-ons')
        .check();
      await expect(
        page
          .getByTestId('modifier-catalog-page')
          .getByRole('listitem')
          .filter({ hasText: addonName })
          .getByText(es ? 'Archivado' : 'Archived', { exact: true })
      ).toBeVisible();
      await till.reload();
      await till.getByTestId('voice-ordering-table-select').selectOption({ label: tableName });
      await expect(till.getByTestId('voice-ordering-open-checks')).toContainText(/14[.,]500/);
      await till.setViewportSize({ width: 1280, height: 900 });
      await till.goto('/sales');
      await till.getByTestId('sales-open-suspended').click();
      await till
        .getByTestId('suspended-draft-card')
        .filter({ hasText: label })
        .getByTestId('suspended-draft-resume')
        .click();
      await expect(till.getByTestId(`sale-cart-item-${scenario.product.sku}`)).toBeVisible();
      await till.keyboard.press('F2');
      const payment = till.getByRole('dialog', { name: /^(Charge Sale|Cobrar venta)$/ });
      await expect(payment).toBeVisible();
      await payment.getByRole('button', { name: /^(Confirm Sale|Confirmar venta)$/ }).click();
      await expect
        .poll(() => getRestaurantServiceEvidence(scenario.tenantId, tableName, scenario.cashier.id))
        .toMatchObject({ saleStatus: 'completed', saleTotal: 14_500, checkStatus: 'settled' });
      // Only the explicitly asserted stale-command 409 is expected; every unrelated diagnostic still fails.
      const diagnostics = tillTracker.getIssues();
      expect(
        diagnostics.filter(
          issue =>
            !/^response:409 .*\/api\/trpc\/restaurantServices\.openCheck/.test(issue) &&
            issue !==
              'console:Failed to load resource: the server responded with a status of 409 (Conflict)'
        )
      ).toEqual([]);
      expect(
        diagnostics.filter(issue => /^response:409 .*restaurantServices\.openCheck/.test(issue))
      ).toHaveLength(1);
    } finally {
      await cashierContext.close();
    }
    await page.goto('/audit-logs');
    const actionFilter = page.getByRole('combobox', {
      name: es ? 'Acción' : 'Action',
      exact: true,
    });
    await actionFilter.selectOption('restaurant_modifier.save');
    await expect(actionFilter).toContainText(
      es ? 'Adicional de restaurante guardado' : 'Restaurant add-on saved'
    );
    const resourceFilter = page.getByRole('combobox', {
      name: es ? 'Tipo de recurso' : 'Resource type',
      exact: true,
    });
    await resourceFilter.selectOption('restaurant_modifier');
    await expect(resourceFilter).toContainText(
      es ? 'Adicional de restaurante' : 'Restaurant add-on'
    );
    await expect(
      page
        .locator('tbody')
        .getByText(es ? 'Adicional de restaurante guardado' : 'Restaurant add-on saved', {
          exact: true,
        })
        .first()
    ).toBeVisible();
    await expectNoClientIssues(tracker);
  });
