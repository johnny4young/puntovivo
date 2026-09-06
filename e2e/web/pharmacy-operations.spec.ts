import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import {
  runPharmacyOtcCustodyJourney,
  type PharmacyJourneyTarget,
} from '../shared/pharmacy-operations-journey.js';
import { runPharmacyPrescriptionJourney } from '../shared/pharmacy-prescription-journey.js';
import { runPharmacyRecallReturnJourney } from '../shared/pharmacy-recall-journey.js';
import { runPharmacyExpiryPolicyJourney } from '../shared/pharmacy-expiry-policy-journey.js';
import { expectOnlyVerifiedPharmacyRejections } from '../shared/pharmacy-rejection-assertions.js';
import { attachClientIssueTracker, login } from './support/app.js';
import { seedSurfaceGateScenario } from './support/db.js';

test.use({ actionTimeout: 15_000 });

test('pharmacy day preserves OTC lot custody and consumes approved prescription evidence once', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  // Only initial identity, company and site are seeded. Operational catalog,
  // units, numbering, supplier, receipt, cash and sale are all created from UI.
  // First-run tenant/admin GUI creation remains a separate acceptance boundary.
  const scenario = seedSurfaceGateScenario(
    `pharmacy-operations-${info.parallelIndex}-${Date.now()}`,
    {}
  );
  const tracker = attachClientIssueTracker(page);
  await login(page, { ...scenario.admin, defaultPath: '/company' });
  const target: PharmacyJourneyTarget = {
    navigate: route => page.goto(route),
    screenshot: name =>
      page.screenshot({
        path: info.outputPath(`${name}.png`),
        fullPage: true,
        animations: 'disabled',
      }),
    configureNumbering: true,
  };
  const result = await runPharmacyOtcCustodyJourney(page, target);
  const prescription = await runPharmacyPrescriptionJourney(page, target, {
    ...result,
    approverEmail: scenario.admin.email,
  });
  const recall = await runPharmacyRecallReturnJourney(page, target, result);
  const expiry = await runPharmacyExpiryPolicyJourney(page, target, {
    ...result,
    prescription: prescription.medicine,
    controlled: prescription.controlled,
    customerName: prescription.customerName,
  });
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'), {
    readonly: true,
  });
  try {
    const lots = db
      .prepare(
        `
      SELECT l.lot_number AS number,l.on_hand AS quantity,l.status
      FROM inventory_lots l JOIN products p ON p.id=l.product_id AND p.tenant_id=l.tenant_id
      WHERE l.tenant_id=? AND l.site_id=? AND p.sku=? ORDER BY l.expires_at,l.id
    `
      )
      .all(scenario.tenantId, scenario.site.id, result.medicine.sku);
    expect(lots).toEqual([
      { number: result.lots[0]!.number, quantity: 4, status: 'recalled' },
      { number: result.lots[1]!.number, quantity: 4, status: 'recalled' },
    ]);
    expect(
      db
        .prepare(
          `
      SELECT b.on_hand AS quantity FROM inventory_balances b
      JOIN products p ON p.id=b.product_id AND p.tenant_id=b.tenant_id
      WHERE b.tenant_id=? AND b.site_id=? AND p.sku=?
    `
        )
        .get(scenario.tenantId, scenario.site.id, result.medicine.sku)
    ).toEqual({ quantity: 8 });
    expect(
      db
        .prepare(
          `
      SELECT payment_status AS paymentStatus FROM sales WHERE tenant_id=? AND sale_number=?
    `
        )
        .get(scenario.tenantId, recall.saleNumber)
    ).toEqual({ paymentStatus: 'refunded' });
    expect(
      db
        .prepare('SELECT count(*) AS count FROM sales WHERE tenant_id=? AND status=?')
        .get(scenario.tenantId, 'completed')
    ).toEqual({ count: 3 });
    expect(
      db
        .prepare('SELECT count(*) AS count FROM pharmacy_prescription_evidence WHERE tenant_id=?')
        .get(scenario.tenantId)
    ).toEqual({ count: 2 });
    const evidence = db
      .prepare(
        `
      SELECT e.status,e.authorized_quantity AS authorized,e.dispensed_quantity AS dispensed,
        e.sealed_evidence AS sealed,
        (SELECT sum(d.quantity) FROM pharmacy_dispensations d
         WHERE d.tenant_id=e.tenant_id AND d.evidence_id=e.id) AS allocated
      FROM pharmacy_prescription_evidence e
      JOIN products p ON p.id=e.product_id AND p.tenant_id=e.tenant_id
      WHERE e.tenant_id=? AND p.sku=? AND e.status='consumed'
    `
      )
      .get(scenario.tenantId, prescription.medicine.sku);
    expect(evidence).toMatchObject({
      status: 'consumed',
      authorized: 1,
      dispensed: 1,
      allocated: 1,
    });
    expect(evidence).toHaveProperty('sealed', expect.any(String));
    expect(JSON.stringify(evidence)).not.toContain(prescription.reference);
    const authorization = db
      .prepare(
        `
      SELECT sealed_credential AS sealed,status FROM pharmacy_professional_authorizations
      WHERE tenant_id=? AND user_id=? AND site_id=?
    `
      )
      .get(scenario.tenantId, scenario.admin.id, scenario.site.id);
    expect(authorization).toMatchObject({ sealed: expect.any(String), status: 'active' });
    expect(JSON.stringify(authorization)).not.toContain(prescription.credential);
    expect(
      db
        .prepare(
          `
      SELECT b.on_hand AS quantity FROM inventory_balances b
      JOIN products p ON p.id=b.product_id AND p.tenant_id=b.tenant_id
      WHERE b.tenant_id=? AND b.site_id=? AND p.sku=?
    `
        )
        .get(scenario.tenantId, scenario.site.id, prescription.medicine.sku)
    ).toEqual({ quantity: 2 });
    expect(
      db
        .prepare(
          `
      SELECT b.on_hand AS quantity FROM inventory_balances b
      JOIN products p ON p.id=b.product_id AND p.tenant_id=b.tenant_id
      WHERE b.tenant_id=? AND b.site_id=? AND p.sku=?
    `
        )
        .get(scenario.tenantId, scenario.site.id, prescription.controlled.sku)
    ).toEqual({ quantity: 1 });
    expect(
      db
        .prepare(
          `
      SELECT e.status,e.dispensed_quantity AS dispensed,e.approved_by AS approvedBy
      FROM pharmacy_prescription_evidence e
      JOIN products p ON p.id=e.product_id AND p.tenant_id=e.tenant_id
      WHERE e.tenant_id=? AND p.sku=? AND e.status='pending'
    `
        )
        .all(scenario.tenantId, prescription.medicine.sku)
    ).toEqual([{ status: 'pending', dispensed: 0, approvedBy: null }]);
    expect(
      db
        .prepare(
          `
      SELECT l.lot_number AS number,l.on_hand AS quantity,l.status
      FROM inventory_lots l JOIN products p ON p.id=l.product_id AND p.tenant_id=l.tenant_id
      WHERE l.tenant_id=? AND l.site_id=? AND p.sku=? ORDER BY l.expires_at,l.id
    `
        )
        .all(scenario.tenantId, scenario.site.id, expiry.medicine.sku)
    ).toEqual([
      { number: expiry.expiredLot, quantity: 2, status: 'expired' },
      { number: expiry.validLot, quantity: 1, status: 'active' },
    ]);
    expect(
      db
        .prepare(
          `
      SELECT expected_balance AS balance FROM cash_sessions
      WHERE tenant_id=? AND site_id=? AND cashier_id=? AND status='open'
    `
        )
        .all(scenario.tenantId, scenario.site.id, scenario.admin.id)
    ).toEqual([{ balance: 2000 }]);
  } finally {
    db.close();
  }
  expectOnlyVerifiedPharmacyRejections(tracker, expiry.rejections);
});
