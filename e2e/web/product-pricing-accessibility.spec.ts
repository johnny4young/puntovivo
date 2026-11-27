import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  E2E_USERS,
  expectNoClientIssues,
  login,
} from './support/app';
import { seedReceiptPrintingScenario } from './support/db';

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

test('products reads redact cost and margin for cashier and flag at-minimum stock as low', async ({
  browser,
}) => {
  const scenario = seedReceiptPrintingScenario(`cost-redaction-${Date.now()}`);
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
  db.pragma('busy_timeout = 5000');
  try {
    db.prepare(
      `update products
       set cost = 120, initial_cost = 120,
           margin_percent1 = 66.67, margin_amount1 = 80,
           min_stock = (select coalesce(sum(on_hand), 0) from inventory_balances where tenant_id = ? and product_id = ?)
       where tenant_id = ? and id = ?`
    ).run(scenario.tenantId, scenario.product.id, scenario.tenantId, scenario.product.id);
  } finally {
    db.close();
  }

  const extractMatchingProduct = async (
    response: import('@playwright/test').Response,
    sku: string
  ) => {
    const raw = (await response.json()) as unknown;
    const entries = Array.isArray(raw) ? raw : [raw];
    for (const entry of entries as Array<{
      result?: {
        data?: {
          items?: Array<Record<string, unknown>>;
          json?: { items?: Array<Record<string, unknown>> };
        };
      };
    }>) {
      const items = entry.result?.data?.json?.items ?? entry.result?.data?.items;
      if (Array.isArray(items)) {
        const match = items.find(item => item.sku === sku);
        if (match) return match;
      }
    }
    return null;
  };

  const waitForProductInProcedure = async (
    page: import('@playwright/test').Page,
    procedure: string,
    sku: string
  ) => {
    let matched: Record<string, unknown> | null = null;
    await page.waitForResponse(async res => {
      if (!res.url().includes('/api/trpc/') || !res.url().includes(procedure) || !res.ok()) {
        return false;
      }
      const item = await extractMatchingProduct(res, sku).catch(() => null);
      if (!item) return false;
      matched = item;
      return true;
    });
    return matched!;
  };

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const adminIssues = attachClientIssueTracker(adminPage);
  try {
    await login(adminPage, { ...scenario.admin, defaultPath: '/dashboard' });
    const adminItemPromise = waitForProductInProcedure(
      adminPage,
      'products.list',
      scenario.product.sku
    );
    await adminPage.goto('/products');
    const adminItem = await adminItemPromise;
    expect(adminItem.cost).toBe(120);
    expect(adminItem.initialCost).toBe(120);
    expect(adminItem.marginPercent1).toBe(66.67);
    const rowEl = adminPage.locator('tbody tr', { hasText: scenario.product.sku });
    await expect(rowEl.locator('.pv-stock.low')).toBeVisible();
    await expectNoClientIssues(adminIssues);
  } finally {
    await adminContext.close();
  }

  const cashierContext = await browser.newContext();
  const cashierPage = await cashierContext.newPage();
  const cashierIssues = attachClientIssueTracker(cashierPage);
  try {
    await login(cashierPage, { ...scenario.cashier, defaultPath: '/sales' });
    const cashierItemPromise = waitForProductInProcedure(
      cashierPage,
      'products.list',
      scenario.product.sku
    );
    await cashierPage.goto('/touch');
    const cashierItem = await cashierItemPromise;
    expect(cashierItem.cost).toBeNull();
    expect(cashierItem.initialCost).toBeNull();
    expect(cashierItem.marginPercent1).toBeNull();
    expect(cashierItem.marginPercent2).toBeNull();
    expect(cashierItem.marginPercent3).toBeNull();
    expect(cashierItem.marginAmount1).toBeNull();
    expect(cashierItem.marginAmount2).toBeNull();
    expect(cashierItem.marginAmount3).toBeNull();
    await expectNoClientIssues(cashierIssues);
  } finally {
    await cashierContext.close();
  }
});
