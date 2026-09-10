import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import { runPharmacyOtcCustodyJourney } from '../shared/pharmacy-operations-journey.js';
import { runPharmacyTransferReturnJourney } from '../shared/pharmacy-transfer-journey.js';
import { attachClientIssueTracker, expectNoClientIssues, login } from './support/app.js';
import { seedSurfaceGateScenario } from './support/db.js';

test.use({ actionTimeout: 15_000 });

test('pharmacy exact lots preserve quarantine through site receipt and supplier return', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const scenario = seedSurfaceGateScenario(
    `pharmacy-transfers-${info.parallelIndex}-${Date.now()}`,
    {}
  );
  const tracker = attachClientIssueTracker(page);
  await login(page, { ...scenario.admin, defaultPath: '/company' });
  const target = {
    navigate: (route: string) => page.goto(route),
    screenshot: (name: string) =>
      page.screenshot({
        path: info.outputPath(`${name}.png`),
        fullPage: true,
        animations: 'disabled' as const,
      }),
    configureNumbering: true,
  };
  const result = await runPharmacyOtcCustodyJourney(page, target);
  const custody = await runPharmacyTransferReturnJourney(page, target, result);
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'), {
    readonly: true,
  });
  try {
    const product = db
      .prepare('SELECT id FROM products WHERE tenant_id=? AND sku=?')
      .get(scenario.tenantId, result.medicine.sku) as { id: string };
    for (const siteId of [custody.originId, custody.branchId]) {
      expect(
        db
          .prepare(
            `SELECT lot_number AS number,on_hand AS quantity,status FROM inventory_lots
        WHERE tenant_id=? AND site_id=? AND product_id=? ORDER BY expires_at,id`
          )
          .all(scenario.tenantId, siteId, product.id)
      ).toEqual([
        { number: result.lots[0]!.number, quantity: 1, status: 'quarantined' },
        { number: result.lots[1]!.number, quantity: 2, status: 'active' },
      ]);
      expect(
        db
          .prepare(
            'SELECT on_hand AS quantity FROM inventory_balances WHERE tenant_id=? AND site_id=? AND product_id=?'
          )
          .get(scenario.tenantId, siteId, product.id)
      ).toEqual({ quantity: 3 });
    }
    expect(
      db
        .prepare(
          `SELECT t.status,i.quantity,i.received_quantity AS received FROM transfer_orders t
      JOIN transfer_order_items i ON i.transfer_order_id=t.id
      WHERE t.tenant_id=? AND t.from_site_id=? AND t.to_site_id=? AND i.product_id=?`
        )
        .all(scenario.tenantId, custody.originId, custody.branchId, product.id)
    ).toEqual([{ status: 'completed', quantity: 3, received: 3 }]);
    expect(
      db
        .prepare(
          `SELECT l.lot_number_snapshot AS number,l.source_status_snapshot AS status,l.quantity,l.received_quantity AS received
      FROM transfer_order_item_lots l JOIN transfer_order_items i ON i.id=l.transfer_order_item_id
      WHERE l.tenant_id=? AND i.product_id=? ORDER BY l.expires_at_snapshot,l.id`
        )
        .all(scenario.tenantId, product.id)
    ).toEqual([
      { number: result.lots[0]!.number, status: 'quarantined', quantity: 1, received: 1 },
      { number: result.lots[1]!.number, status: 'active', quantity: 2, received: 2 },
    ]);
    expect(
      db
        .prepare(
          `SELECT count(*) AS count,sum(r.return_amount) AS amount FROM purchase_returns r
      JOIN purchases p ON p.id=r.purchase_id AND p.tenant_id=r.tenant_id
      WHERE r.tenant_id=? AND p.purchase_number=?`
        )
        .get(scenario.tenantId, custody.purchaseNumber)
    ).toEqual({ count: 1, amount: 500 });
    expect(
      db
        .prepare(
          `SELECT l.lot_number AS number,r.base_quantity AS quantity,r.unit_cost AS cost
      FROM purchase_return_item_lots r
      JOIN inventory_lots l ON l.id=r.inventory_lot_id AND l.tenant_id=r.tenant_id
      WHERE r.tenant_id=? AND l.product_id=? AND l.site_id=?`
        )
        .all(scenario.tenantId, product.id, custody.originId)
    ).toEqual([{ number: result.lots[0]!.number, quantity: 1, cost: 500 }]);
  } finally {
    db.close();
  }
  await expectNoClientIssues(tracker);
});
