import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import { runInventoryIdentityCountJourney } from '../shared/inventory-identity-count-journey.js';
import { attachClientIssueTracker, expectNoClientIssues, login } from './support/app.js';
import { seedSurfaceGateScenario } from './support/db.js';

test('exact counts preserve lot custody and serial provenance through reload', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const scenario = seedSurfaceGateScenario(
    `identity-count-${info.parallelIndex}-${Date.now()}`,
    {}
  );
  const tracker = attachClientIssueTracker(page);
  await login(page, { ...scenario.admin, defaultPath: '/company' });
  const result = await runInventoryIdentityCountJourney(page, {
    navigate: route => page.goto(route),
    configureNumbering: true,
    screenshot: name =>
      page.screenshot({
        path: info.outputPath(`${name}.png`),
        fullPage: true,
        animations: 'disabled',
      }),
  });
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'), {
    readonly: true,
  });
  try {
    expect(
      db
        .prepare('SELECT s.status FROM inventory_count_sessions s WHERE tenant_id=?')
        .all(scenario.tenantId)
    ).toEqual([{ status: 'approved' }, { status: 'approved' }, { status: 'approved' }]);
    expect(
      db
        .prepare(
          'SELECT l.on_hand AS quantity,l.status FROM inventory_lots l JOIN products p ON p.id=l.product_id AND p.tenant_id=l.tenant_id WHERE l.tenant_id=? AND p.sku=? ORDER BY l.expires_at'
        )
        .all(scenario.tenantId, result.medicine.sku)
    ).toEqual([
      { quantity: 2, status: 'quarantined' },
      { quantity: 5, status: 'active' },
    ]);
    expect(
      db
        .prepare(
          'SELECT s.serial_number AS serial,s.status,s.stock_status_before_missing AS previous,s.warranty_expires_at AS warranty FROM product_serials s JOIN products p ON p.id=s.product_id AND p.tenant_id=s.tenant_id WHERE s.tenant_id=? AND p.sku=? ORDER BY s.serial_number'
        )
        .all(scenario.tenantId, result.serialSku)
    ).toEqual(
      result.serials.map(serial => ({
        serial,
        status: 'in_stock',
        previous: null,
        warranty: '2030-12-31',
      }))
    );
  } finally {
    db.close();
  }
  expectNoClientIssues(tracker);
});
