import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { test, expect } from '@playwright/test';
import { seedSaleScenario } from './support/db';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  login,
} from './support/app';

for (const language of ['en', 'es'] as const) {
  test(`filtered total spans API and table pages and both sites without changing stock (${language})`, async ({
    page,
  }, info) => {
    const scenario = seedSaleScenario(`filtered-${language}-${Date.now()}`);
    const prefix = `QA-FILTER-${language}-${randomUUID().slice(0, 8)}`;
    const targetName = `${prefix} ZZZ Stock Target`;
    const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
    db.pragma('busy_timeout = 5000');
    const snapshot = () =>
      db
        .prepare(
          'SELECT product_id,site_id,on_hand,reserved FROM inventory_balances WHERE tenant_id=? AND product_id IN (SELECT id FROM products WHERE tenant_id=? AND name LIKE ?) ORDER BY product_id,site_id'
        )
        .all(scenario.tenantId, scenario.tenantId, `${prefix}%`);
    try {
      db.transaction(() => {
        db.prepare('UPDATE products SET name=?,min_stock=1 WHERE id=? AND tenant_id=?').run(
          targetName,
          scenario.product.id,
          scenario.tenantId
        );
        db.prepare(
          'UPDATE inventory_balances SET on_hand=10 WHERE product_id=? AND tenant_id=?'
        ).run(scenario.product.id, scenario.tenantId);
        for (let index = 0; index < 150; index++) {
          const id = randomUUID(),
            now = new Date().toISOString();
          db.prepare(
            'INSERT INTO products(id,tenant_id,name,sku,price,cost,min_stock,is_active,created_at,updated_at) VALUES(?,?,?,?,100,0,0,1,?,?)'
          ).run(
            id,
            scenario.tenantId,
            `${prefix} AAA Zero ${String(index).padStart(3, '0')}`,
            `QA-ZERO-${id}`,
            now,
            now
          );
          db.prepare(
            'INSERT INTO unit_x_product(id,product_id,unit_id,equivalence,price,is_base,created_at,updated_at) VALUES(?,?,?,1,100,1,?,?)'
          ).run(randomUUID(), id, scenario.product.unitId, now, now);
          for (const site of scenario.sites)
            db.prepare(
              "INSERT INTO inventory_balances(id,tenant_id,site_id,product_id,on_hand,reserved,sync_status,sync_version,created_at,updated_at) VALUES(?,?,?,?,0,0,'pending',0,?,?)"
            ).run(randomUUID(), scenario.tenantId, site.id, id, now, now);
        }
      }).immediate();
      expect(scenario.sites).toHaveLength(2);
      expect(
        db
          .prepare('SELECT COUNT(*) AS n FROM products WHERE tenant_id=? AND name LIKE ?')
          .get(scenario.tenantId, `${prefix}%`)
      ).toEqual({ n: 151 });
      const before = snapshot();
      const issues = attachClientIssueTracker(page);
      await login(page, {
        ...scenario.admin,
        password: scenario.admin.password,
        defaultPath: '/dashboard',
      });
      await ensureLanguage(page, language);
      await page.goto('/inventory?view=stock');
      // The canonical seed helper shares a tenant; scope this case through the
      // real search filter so earlier cases cannot change its expected total.
      const search = page.getByRole('textbox', {
        name: language === 'en' ? 'Search stock by product...' : 'Buscar stock por producto...',
        exact: true,
      });
      const stockResponse = page.waitForResponse(
        response =>
          response.url().includes('inventory.listStock') &&
          decodeURIComponent(response.url()).includes(prefix) &&
          response.ok()
      );
      await search.fill(prefix);
      const response = await stockResponse;
      const payload = await response.json();
      const procedures = new URL(response.url()).pathname.split('/').at(-1)!.split(',');
      const result = (Array.isArray(payload) ? payload : [payload])[
        procedures.indexOf('inventory.listStock')
      ].result.data;
      const stockPage = result.json ?? result;
      expect(stockPage.items).toHaveLength(100);
      expect(stockPage.totalItems).toBe(151);
      expect(stockPage.totalPages).toBe(2);
      const note =
        language === 'en'
          ? "Stock totals include all products matching the current filters across all pages and sum each site's balances."
          : 'Los totales de stock incluyen todos los productos que coinciden con los filtros actuales en todas las páginas y suman los saldos de cada sede.';
      const total = page
        .locator('.pv-kpi')
        .filter({
          has: page.getByText(language === 'en' ? 'Total Units' : 'Total de unidades', {
            exact: true,
          }),
        })
        .locator('.val');
      await expect(total).toHaveText('20');
      await expect(search).toBeFocused();
      await expect(page.getByText(note, { exact: false })).toBeVisible();
      await expect(page.locator('tbody tr').filter({ hasText: targetName })).toHaveCount(0);
      const filter = page.getByRole('switch', {
        name: language === 'en' ? 'Show low stock only' : 'Mostrar solo stock bajo',
        exact: true,
      });
      await filter.focus();
      await page.keyboard.press('Space');
      await expect(filter).toHaveAttribute('aria-checked', 'true');
      await expect(total).toHaveText('0');
      await page.screenshot({
        path: info.outputPath(`filtered-zero-${language}.png`),
        fullPage: true,
      });
      await page.keyboard.press('Space');
      await expect(filter).toHaveAttribute('aria-checked', 'false');
      await expect(total).toHaveText('20');
      await search.fill(`${prefix} no-match`);
      await expect(total).toHaveText('0');
      await expect(page.locator('tbody tr').filter({ hasText: prefix })).toHaveCount(0);
      await expect(page.locator('tbody')).toHaveText(
        language === 'en' ? 'No results.' : 'Sin resultados.'
      );
      await search.fill(prefix);
      await expect(total).toHaveText('20');
      await expect(search).toBeFocused();
      expect(snapshot()).toEqual(before);
      await page.screenshot({
        path: info.outputPath(`filtered-restored-${language}.png`),
        fullPage: true,
      });
      await info.attach('stock-oracle', {
        body: JSON.stringify({
          matchingProducts: 151,
          namePrefix: prefix,
          sites: scenario.sites.length,
          total: 20,
          balancesUnchanged: true,
        }),
        contentType: 'application/json',
      });
      await expectNoClientIssues(issues);
    } finally {
      db.close();
    }
  });
}
