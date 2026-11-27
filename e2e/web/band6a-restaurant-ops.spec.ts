import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  login,
} from './support/app';
import { seedRestaurantServiceScenario } from './support/db';

function enableKdsAndTipSplit(tenantId: string): void {
  const db = new Database(join(process.cwd(), 'packages/server/data/local.db'));
  db.pragma('busy_timeout = 5000');
  try {
    db.prepare(
      `update tenants
       set settings = json_set(
         case when json_valid(settings) then settings else '{}' end,
         '$.modules.kds', json('true'),
         '$.modules.tip-split', json('true')
       )
       where id = ?`
    ).run(tenantId);
  } finally {
    db.close();
  }
}

test.describe('Band 6A — Restaurant rounds, station printer, precheck, equal split & modifier BOM', () => {
  test('appends round 2 to the same check, previews non-fiscal precheck (Ley 1935/2018), and splits equally as cashier', async ({
    page,
  }, info) => {
    const scenario = seedRestaurantServiceScenario(
      `band6a-ops-${info.parallelIndex}-${Date.now()}`
    );
    enableKdsAndTipSplit(scenario.tenantId);

    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // 1. Admin creates a table, configures KDS station TCP printer, and creates a modifier + BOM ingredient.
    await login(page, { ...scenario.admin, defaultPath: '/dashboard' });
    await ensureLanguage(page, 'es');

    const tableName = `Mesa 6A ${Date.now().toString().slice(-4)}`;
    await page.goto('/restaurants/tables');
    await page.getByTestId('restaurant-tables-create-cta').click();
    const tableDialog = page.getByRole('dialog');
    await tableDialog.getByTestId('restaurant-table-name').fill(tableName);
    await tableDialog.getByRole('button', { name: /^Guardar$/i }).click();
    await expect(tableDialog).toBeHidden({ timeout: 15_000 });

    // Configure station thermal printer on /kds
    await page.goto('/kds', { waitUntil: 'domcontentloaded' });
    const configBtn = page.getByRole('button', { name: /configurar|configuración/i }).first();
    await expect(configBtn).toBeVisible({ timeout: 15_000 });
    await configBtn.click();
    const kdsDialog = page.getByRole('dialog');
    await expect(kdsDialog).toBeVisible();
    const editMainBtn = kdsDialog.getByRole('button', { name: /editar/i }).first();
    if (await editMainBtn.isVisible().catch(() => false)) {
      await editMainBtn.click();
    } else {
      const mainSetupBtn = kdsDialog.getByRole('button', {
        name: /configurar cocina predeterminada/i,
      });
      if (await mainSetupBtn.isVisible().catch(() => false)) {
        await mainSetupBtn.click();
      }
    }
    await kdsDialog.getByTestId('kds-station-printer-mode').selectOption('tcp');
    await kdsDialog.getByTestId('kds-station-printer-host').fill('192.168.1.50');
    await kdsDialog.getByTestId('kds-station-printer-port').fill('9100');
    await kdsDialog.getByRole('button', { name: /guardar estación/i }).click();
    await expect(kdsDialog).toContainText('192.168.1.50:9100', { timeout: 15_000 });
    await page.keyboard.press('Escape');

    // Create modifier and attach BOM ingredient on /restaurants/modifiers
    await page.goto('/restaurants/modifiers');
    await page.getByRole('button', { name: /crear adicional/i }).click();
    const modDialog = page.getByRole('dialog');
    const modName = `Extra Salsa ${Date.now().toString().slice(-4)}`;
    await modDialog.getByLabel(/nombre del adicional/i).fill(modName);
    await modDialog.getByLabel(/precio por adicional/i).fill('2000');
    await modDialog.getByRole('button', { name: /^Guardar$/i }).click();
    await expect(modDialog).toBeHidden({ timeout: 15_000 });

    await page.getByRole('button', { name: new RegExp(`Editar ${modName}`, 'i') }).click();
    const editModDialog = page.getByRole('dialog');
    await expect(editModDialog.getByTestId('modifier-bom-section')).toBeVisible({
      timeout: 15_000,
    });
    await editModDialog.getByTestId('modifier-bom-search').fill(scenario.product.sku);
    await expect(
      editModDialog.locator(
        `[data-testid="modifier-bom-select"] option[value="${scenario.product.id}"]`
      )
    ).toBeAttached({ timeout: 15_000 });
    await editModDialog.getByTestId('modifier-bom-select').selectOption(scenario.product.id);
    await editModDialog.getByTestId('modifier-bom-qty').fill('0.5');
    await editModDialog.getByTestId('modifier-bom-add').click();
    await editModDialog.getByTestId('modifier-bom-save').click();
    await expect(editModDialog.getByTestId('modifier-bom-saved')).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');

    // 2. Open /touch/voice, send Round 1 & Round 2 onto the SAME check, inspect Precheck, and split equally!
    await page.goto('/touch/voice', { waitUntil: 'domcontentloaded' });
    const tableSelect = page.getByTestId('voice-ordering-table-select');
    await expect(tableSelect).toBeVisible({ timeout: 15_000 });
    await tableSelect.selectOption(tableName);

    const addDishAndSend = async () => {
      await page.getByTestId('voice-ordering-manual-add').click();
      const searchDialog = page.getByRole('dialog');
      await expect(searchDialog).toBeVisible();
      await searchDialog.getByPlaceholder(/SKU/i).fill(scenario.product.sku);
      const row = searchDialog.getByTestId(`product-search-row-${scenario.product.sku}`);
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.click();
      const confirmBtn = searchDialog.getByRole('button', { name: /^(Search|Buscar)$/ });
      if (await confirmBtn.isVisible().catch(() => false)) {
        await confirmBtn.click();
      }
      await expect(page.getByTestId('plate-sheet')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('plate-sheet-submit').click();
      await page.getByTestId('voice-ordering-save').click();
    };

    // Send Round 1
    await addDishAndSend();
    await expect(page.getByTestId('order-rail-sent-round')).toHaveCount(1, { timeout: 15_000 });

    // Send Round 2 onto the SAME open check (must remain 1 check with 2 rounds!)
    await addDishAndSend();
    await expect(page.getByTestId('order-rail-sent-round')).toHaveCount(2, { timeout: 15_000 });

    // Open Precheck modal and verify Ley 1935/2018 + editable tip without closing the check
    await page.getByTestId('voice-ordering-precheck').click();
    const precheckModal = page.getByTestId('precheck-modal');
    await expect(precheckModal).toBeVisible({ timeout: 15_000 });
    await expect(precheckModal).toContainText(/No es factura de venta/i);
    await expect(precheckModal.getByTestId('precheck-legal-notice')).toContainText(
      'Ley 1935 de 2018'
    );
    await precheckModal.getByTestId('precheck-tip-preset-15').click();
    await expect(precheckModal.getByTestId('precheck-tip-input')).toHaveValue('15');
    await page.keyboard.press('Escape');
    await expect(precheckModal).toBeHidden();

    // Split equally into 2 payable checks from RestaurantSplitSheet
    await page.getByTestId('voice-ordering-split').click();
    const splitSheet = page.getByTestId('split-sheet');
    await expect(splitSheet).toBeVisible({ timeout: 15_000 });
    await expect(splitSheet.getByTestId('split-sheet-account')).toHaveCount(1);
    await splitSheet.getByTestId('split-sheet-equal-parts').fill('2');
    await splitSheet.getByTestId('split-sheet-equal-apply').click();
    await expect(splitSheet.getByTestId('split-sheet-account')).toHaveCount(2, { timeout: 15_000 });

    await expectNoClientIssues(tracker);
  });
});
