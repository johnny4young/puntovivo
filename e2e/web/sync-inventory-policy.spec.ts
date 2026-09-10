import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  loginAs,
} from './support/app';

const databasePath = path.join(process.cwd(), 'packages/server/data/local.db');
function withDatabase<T>(run: (db: Database.Database) => T): T {
  const db = new Database(databasePath);
  db.pragma('busy_timeout = 5000');
  try {
    return run(db);
  } finally {
    db.close();
  }
}

// Dedicated stock fixtures make this recovery test independent of suite order.
// Only conflicts are adversarial: the persisted value and site balance agree.
// This is sync recovery evidence, not qualification of inventory receipt UI.
function createIncidents() {
  return withDatabase(db =>
    db.transaction(() => {
      const owner = db
        .prepare('SELECT tenant_id AS tenantId FROM users WHERE email = ?')
        .get('e2e.admin@local.test') as { tenantId: string };
      const suffix = randomUUID();
      const valuedProductId = `sync-valued-product-${suffix}`;
      const metadataProductId = `sync-metadata-product-${suffix}`;
      const valuedConflictId = `sync-value-conflict-${suffix}`;
      const metadataConflictId = `sync-metadata-conflict-${suffix}`;
      const valuedName = `Local carrying value ${suffix}`;
      const metadataName = `Local catalog label ${suffix}`;
      const site = db
        .prepare('SELECT id FROM sites WHERE tenant_id = ? LIMIT 1')
        .get(owner.tenantId) as { id: string };
      db.prepare(
        'INSERT INTO products (id, tenant_id, name, sku, price, cost, initial_cost, inventory_value_cents, cogs_value_cents, valuation_quantity) VALUES (?, ?, ?, ?, 2, 1, 1, 100, 100, 1)'
      ).run(valuedProductId, owner.tenantId, valuedName, valuedProductId);
      db.prepare(
        'INSERT INTO inventory_balances (id, tenant_id, site_id, product_id, on_hand) VALUES (?, ?, ?, ?, 1)'
      ).run(`sync-balance-${suffix}`, owner.tenantId, site.id, valuedProductId);
      const valued = db
        .prepare(
          'SELECT id, cost, initial_cost, inventory_value_cents, cogs_value_cents, valuation_quantity FROM products WHERE tenant_id = ? AND id = ?'
        )
        .get(owner.tenantId, valuedProductId) as { id: string };
      db.prepare(
        'INSERT INTO products (id, tenant_id, name, sku, price, cost, initial_cost) VALUES (?, ?, ?, ?, 1, 0, 0)'
      ).run(metadataProductId, owner.tenantId, metadataName, metadataProductId);
      const insert = db.prepare(
        "INSERT INTO sync_conflicts (id, tenant_id, entity_type, entity_id, local_data, remote_data, status, created_at) VALUES (?, ?, 'products', ?, ?, ?, 'pending', ?)"
      );
      const now = new Date().toISOString();
      insert.run(
        valuedConflictId,
        owner.tenantId,
        valued.id,
        JSON.stringify({ id: valued.id, name: valuedName, inventoryValueCents: 100 }),
        JSON.stringify({
          id: valued.id,
          name: 'Unverified remote carrying value',
          inventoryValueCents: 0,
        }),
        now
      );
      insert.run(
        metadataConflictId,
        owner.tenantId,
        metadataProductId,
        JSON.stringify({ id: metadataProductId, name: metadataName }),
        JSON.stringify({ id: metadataProductId, name: 'Remote catalog label' }),
        now
      );
      return {
        tenantId: owner.tenantId,
        valued,
        valuedName,
        metadataName,
        metadataProductId,
        valuedConflictId,
        metadataConflictId,
      };
    })()
  );
}

test.describe('inventory sync recovery policy', () => {
  test.describe.configure({ mode: 'serial' });
  for (const language of ['en', 'es'] as const) {
    test(`preserves carrying-value evidence and recovers metadata through UI (${language})`, async ({
      page,
    }, testInfo) => {
      const issueTracker = attachClientIssueTracker(page);
      const fixture = createIncidents();
      const keepLocal = language === 'es' ? /^Mantener local$/ : /^Keep Local$/;
      const merge = language === 'es' ? /^Fusionar$/ : /^Merge$/;
      const remote = language === 'es' ? /^Aceptar remoto$/ : /^Accept Remote$/;
      try {
        await loginAs(page, 'admin');
        await ensureLanguage(page, language);
        await page.goto('/company?tab=data');
        const blocked = page.getByRole('article').filter({ hasText: fixture.valuedName });
        await expect(blocked).toBeVisible();
        await expect(blocked).toContainText(
          language === 'es'
            ? 'La evidencia pendiente se conserva.'
            : 'The pending evidence is preserved.'
        );
        for (const name of [keepLocal, merge, remote])
          await expect(blocked.getByRole('button', { name })).toBeDisabled();
        await expect(blocked.getByRole('button', { name: remote })).not.toHaveClass(/btn-primary/);
        await expect(
          blocked.getByText(
            language === 'es' ? 'Valor de inventario (centavos)' : 'Inventory value (cents)',
            { exact: true }
          )
        ).toHaveCount(2);
        const metadata = page.getByRole('article').filter({ hasText: fixture.metadataName });
        await expect(metadata.getByRole('button', { name: keepLocal })).toBeEnabled();
        await metadata.getByRole('button', { name: keepLocal }).click();
        await page.getByRole('dialog').getByRole('button', { name: keepLocal }).click();
        await expect
          .poll(() =>
            withDatabase(
              db =>
                db
                  .prepare('SELECT status FROM sync_conflicts WHERE id = ? AND tenant_id = ?')
                  .get(fixture.metadataConflictId, fixture.tenantId) as { status: string }
            )
          )
          .toEqual({ status: 'resolved' });
        await page.reload();
        await expect(blocked).toBeVisible();
        await expect(blocked.getByRole('button', { name: remote })).toBeDisabled();
        await expect(
          page.getByRole('article').filter({ hasText: fixture.metadataName })
        ).toHaveCount(0);
        withDatabase(db => {
          expect(
            db
              .prepare(
                'SELECT id, cost, initial_cost, inventory_value_cents, cogs_value_cents, valuation_quantity FROM products WHERE id = ? AND tenant_id = ?'
              )
              .get(fixture.valued.id, fixture.tenantId)
          ).toEqual(fixture.valued);
          expect(
            db
              .prepare('SELECT status FROM sync_conflicts WHERE id = ? AND tenant_id = ?')
              .get(fixture.valuedConflictId, fixture.tenantId)
          ).toEqual({ status: 'pending' });
          const queued = db
            .prepare(
              "SELECT payload FROM sync_outbox WHERE tenant_id = ? AND entity_type = 'products' AND entity_id = ?"
            )
            .all(fixture.tenantId, fixture.metadataProductId) as { payload: string }[];
          expect(queued).toHaveLength(1);
          expect(JSON.parse(queued[0]!.payload)).toEqual({
            id: fixture.metadataProductId,
            name: fixture.metadataName,
          });
        });
        await blocked.scrollIntoViewIfNeeded();
        const evidence = path.join(process.cwd(), 'output/review/transformation-cost/sync-live');
        mkdirSync(evidence, { recursive: true });
        const screenshot = path.join(evidence, `${language}-protected-recovery.png`);
        await page.screenshot({ path: screenshot });
        await testInfo.attach(`protected-recovery-${language}`, {
          path: screenshot,
          contentType: 'image/png',
        });
        await expectNoClientIssues(issueTracker);
      } finally {
        withDatabase(db =>
          db.transaction(() => {
            db.prepare('DELETE FROM sync_outbox WHERE tenant_id = ? AND entity_id = ?').run(
              fixture.tenantId,
              fixture.metadataProductId
            );
            db.prepare('DELETE FROM sync_conflicts WHERE tenant_id = ? AND id IN (?, ?)').run(
              fixture.tenantId,
              fixture.valuedConflictId,
              fixture.metadataConflictId
            );
            db.prepare('DELETE FROM products WHERE tenant_id = ? AND id = ?').run(
              fixture.tenantId,
              fixture.metadataProductId
            );
            db.prepare('DELETE FROM inventory_balances WHERE tenant_id = ? AND product_id = ?').run(
              fixture.tenantId,
              fixture.valued.id
            );
            db.prepare('DELETE FROM products WHERE tenant_id = ? AND id = ?').run(
              fixture.tenantId,
              fixture.valued.id
            );
          })()
        );
      }
    });
  }
});
