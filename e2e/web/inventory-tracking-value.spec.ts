import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import { attachClientIssueTracker, ensureLanguage, loginAs } from './support/app';

function withDatabase<T>(run: (db: Database.Database) => T): T {
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
  db.pragma('busy_timeout = 5000');
  try {
    return run(db);
  } finally {
    db.close();
  }
}

// A historical negative-stock scenario: the total is zero, but two sites still
// own physical stock. Direct fixtures prove recovery, not inventory receipt UX.
function createFixture() {
  return withDatabase(db =>
    db.transaction(() => {
      const { tenantId } = db
        .prepare('SELECT tenant_id AS tenantId FROM users WHERE email = ?')
        .get('e2e.admin@local.test') as { tenantId: string };
      const sites = db
        .prepare('SELECT id FROM sites WHERE tenant_id = ? AND is_active = 1 ORDER BY id LIMIT 2')
        .all(tenantId) as { id: string }[];
      expect(sites).toHaveLength(2);
      const { id: unitId } = db
        .prepare('SELECT id FROM units WHERE tenant_id = ? AND abbreviation = ?')
        .get(tenantId, 'UND') as { id: string };
      const id = `tracking-value-${randomUUID()}`;
      db.prepare(
        'INSERT INTO products (id, tenant_id, name, sku, price, cost, initial_cost, inventory_value_cents, cogs_value_cents, valuation_quantity) VALUES (?, ?, ?, ?, 2, 1, 1, 0, 0, 0)'
      ).run(id, tenantId, 'Site stock reconciliation', id);
      db.prepare(
        'INSERT INTO unit_x_product (id, product_id, unit_id, equivalence, price, is_base) VALUES (?, ?, ?, 1, 2, 1)'
      ).run(`${id}-unit`, id, unitId);
      for (const [index, site] of sites.entries()) {
        db.prepare(
          'INSERT INTO inventory_balances (id, tenant_id, site_id, product_id, on_hand) VALUES (?, ?, ?, ?, ?)'
        ).run(`${id}-${index}`, tenantId, site.id, id, index === 0 ? 1 : -1);
      }
      return { id, tenantId };
    })()
  );
}

function snapshot(fixture: ReturnType<typeof createFixture>) {
  return withDatabase(db => ({
    product: db
      .prepare(
        'SELECT tracks_stock, tracks_lots, tracks_serials, version, inventory_value_cents, cogs_value_cents, valuation_quantity FROM products WHERE tenant_id = ? AND id = ?'
      )
      .get(fixture.tenantId, fixture.id),
    balances: db
      .prepare(
        'SELECT site_id, on_hand, reserved FROM inventory_balances WHERE tenant_id = ? AND product_id = ? ORDER BY site_id'
      )
      .all(fixture.tenantId, fixture.id),
    outbox: db
      .prepare('SELECT id FROM sync_outbox WHERE tenant_id = ? AND entity_id = ?')
      .all(fixture.tenantId, fixture.id),
    lots: db
      .prepare(
        'SELECT id, on_hand, unit_cost, carrying_value_cents, valuation_quantity FROM inventory_lots WHERE tenant_id = ? AND product_id = ? ORDER BY id'
      )
      .all(fixture.tenantId, fixture.id),
  }));
}

test.describe('inventory tracking value recovery', () => {
  test.describe.configure({ mode: 'serial' });
  for (const language of ['en', 'es'] as const) {
    test(`reads exact and legacy expiry value without rewriting custody (${language})`, async ({
      page,
    }, testInfo) => {
      const fixture = createFixture();
      withDatabase(db =>
        db.transaction(() => {
          db.prepare(
            'UPDATE products SET tracks_lots = 1, inventory_value_cents = NULL, cogs_value_cents = NULL, valuation_quantity = NULL WHERE tenant_id = ? AND id = ?'
          ).run(fixture.tenantId, fixture.id);
          const { site_id: siteId } = db
            .prepare(
              'SELECT site_id FROM inventory_balances WHERE tenant_id = ? AND product_id = ? ORDER BY site_id LIMIT 1'
            )
            .get(fixture.tenantId, fixture.id) as { site_id: string };
          db.prepare(
            'UPDATE inventory_balances SET on_hand = CASE WHEN site_id = ? THEN 5.001 ELSE 0 END WHERE tenant_id = ? AND product_id = ?'
          ).run(siteId, fixture.tenantId, fixture.id);
          const now = new Date().toISOString();
          const expiry = new Date(Date.now() + 5 * 86400000).toISOString();
          for (const [suffix, quantity, unitCost, value] of [
            ['exact', 3.001, 33, 10000],
            ['zero', 1, 10, 0],
            ['legacy', 1, 50, null],
          ] as const) {
            db.prepare(
              "INSERT INTO inventory_lots (id, tenant_id, site_id, product_id, lot_number, expires_at, on_hand, unit_cost, carrying_value_cents, valuation_quantity, status, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)"
            ).run(
              `${fixture.id}-${suffix}`,
              fixture.tenantId,
              siteId,
              fixture.id,
              suffix,
              expiry,
              quantity,
              unitCost,
              value,
              value === null ? null : quantity,
              now
            );
          }
        })()
      );
      const before = snapshot(fixture);
      const tracker = attachClientIssueTracker(page);
      try {
        await loginAs(page, 'admin');
        await ensureLanguage(page, language);
        await page.goto('/inventory?view=expiry');
        for (const [suffix, amount] of [
          ['exact', /(?:COP|\$)\s*100$/],
          ['zero', /(?:COP|\$)\s*0$/],
          ['legacy', /(?:COP|\$)\s*50$/],
        ] as const) {
          await expect(page.getByTestId(`expiry-risk-${fixture.id}-${suffix}`)).toHaveText(amount);
        }
        const directory = path.join(
          process.cwd(),
          'output/review/transformation-cost/readers-live'
        );
        mkdirSync(directory, { recursive: true });
        const screenshot = path.join(directory, `${language}-expiry-value.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        await testInfo.attach('expiry-value', { path: screenshot, contentType: 'image/png' });
        await page.reload();
        await expect(page.getByTestId(`expiry-risk-${fixture.id}-exact`)).toHaveText(
          /(?:COP|\$)\s*100$/
        );
        expect(snapshot(fixture)).toEqual(before);
        expect(tracker.getIssues()).toEqual([]);
      } finally {
        await page.close();
        withDatabase(db =>
          db.transaction(() => {
            db.prepare('DELETE FROM inventory_lots WHERE tenant_id = ? AND product_id = ?').run(
              fixture.tenantId,
              fixture.id
            );
            db.prepare('DELETE FROM inventory_balances WHERE tenant_id = ? AND product_id = ?').run(
              fixture.tenantId,
              fixture.id
            );
            db.prepare('DELETE FROM unit_x_product WHERE product_id = ?').run(fixture.id);
            db.prepare('DELETE FROM products WHERE tenant_id = ? AND id = ?').run(
              fixture.tenantId,
              fixture.id
            );
          })()
        );
      }
    });
    test(`preserves per-site stock and explains denied tracking change (${language})`, async ({
      page,
    }, testInfo) => {
      const fixture = createFixture();
      const before = snapshot(fixture);
      const tracker = attachClientIssueTracker(page);
      const es = language === 'es';
      try {
        await loginAs(page, 'admin');
        await ensureLanguage(page, language);
        await page.goto('/products');
        await page
          .getByPlaceholder(es ? 'Buscar productos...' : 'Search products...')
          .fill(fixture.id);
        const row = page.locator('tbody tr').filter({ hasText: fixture.id });
        await row.getByRole('button', { name: es ? 'Ver detalle' : 'View details' }).click();
        await page
          .getByTestId('product-details-drawer')
          .getByRole('button', { name: es ? 'Editar producto' : 'Edit product' })
          .click();
        const dialog = page.getByRole('dialog', { name: es ? 'Editar producto' : 'Edit Product' });
        await dialog
          .getByRole('checkbox', {
            name: es ? 'Ítem de servicio (sin inventario)' : 'Service item (no inventory)',
          })
          .check();
        const responsePromise = page.waitForResponse(
          response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/trpc/products.update'
        );
        await dialog.getByRole('button', { name: es ? 'Guardar cambios' : 'Save Changes' }).click();
        const response = await responsePromise;
        expect(response.status()).toBe(409);
        expect(await response.json()).toEqual([
          expect.objectContaining({
            error: expect.objectContaining({
              data: expect.objectContaining({
                errorCode: 'PRODUCT_TRACKING_REQUIRES_EMPTY_INVENTORY',
              }),
            }),
          }),
        ]);
        const alert = dialog.getByRole('alert');
        await expect(alert).toHaveText(
          es
            ? 'Antes de cambiar el seguimiento, concilia las existencias, reservas y el valor de inventario de este producto en todas las sedes. Incluso una cantidad pequeña puede conservar valor.'
            : "Before changing inventory tracking, reconcile this product's stock, reservations and inventory value at every site. Even a small remaining quantity may still carry value."
        );
        expect(snapshot(fixture)).toEqual(before);
        await alert.scrollIntoViewIfNeeded();
        const directory = path.join(
          process.cwd(),
          'output/review/transformation-cost/tracking-live'
        );
        mkdirSync(directory, { recursive: true });
        const screenshot = path.join(directory, `${language}-stock-reconciliation.png`);
        await dialog.screenshot({ path: screenshot });
        await testInfo.attach('stock-reconciliation', {
          path: screenshot,
          contentType: 'image/png',
        });
        await dialog.getByRole('button', { name: es ? 'Cancelar' : 'Cancel' }).click();
        await page
          .getByRole('button', { name: es ? 'Descartar cambios' : 'Discard changes' })
          .click();
        await page.reload();
        await page
          .getByPlaceholder(es ? 'Buscar productos...' : 'Search products...')
          .fill(fixture.id);
        await expect(page.locator('tbody tr').filter({ hasText: fixture.id })).toBeVisible();
        expect(snapshot(fixture)).toEqual(before);
        const issues = tracker.getIssues();
        expect(issues.filter(issue => issue.startsWith('response:'))).toEqual([
          `response:409 ${response.url()}`,
        ]);
        const other = issues.filter(issue => !issue.startsWith('response:'));
        expect(other.length).toBeLessThanOrEqual(1);
        for (const issue of other)
          expect(issue).toBe(
            'console:Failed to load resource: the server responded with a status of 409 (Conflict)'
          );
      } finally {
        await page.close();
        withDatabase(db =>
          db.transaction(() => {
            db.prepare('DELETE FROM inventory_balances WHERE tenant_id = ? AND product_id = ?').run(
              fixture.tenantId,
              fixture.id
            );
            db.prepare('DELETE FROM unit_x_product WHERE product_id = ?').run(fixture.id);
            db.prepare('DELETE FROM products WHERE tenant_id = ? AND id = ?').run(
              fixture.tenantId,
              fixture.id
            );
          })()
        );
      }
    });
  }
});
