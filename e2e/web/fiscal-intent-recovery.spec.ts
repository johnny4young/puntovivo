import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  login,
} from './support/app';
import { seedFiscalProfileScenario } from './support/db';

/** This incident fixture represents a sale already committed before a failed fiscal setup. */
function seedBlockedObligation(scenario: ReturnType<typeof seedFiscalProfileScenario>) {
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  try {
    const saleId = randomUUID();
    const cashSessionId = randomUUID();
    const intentId = randomUUID();
    const saleNumber = `E2E-FISCAL-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const payload = JSON.stringify({
      version: 1,
      requestedAt: now,
      countryCode: 'CO',
      providerId: 'mock-co',
      siteId: scenario.site.id,
      buyerCustomerId: null,
      resolution: null,
      amounts: { subtotal: 100, taxAmount: 0, discountAmount: 0, total: 100 },
      lines: [
        {
          lineNumber: 1,
          productName: 'E2E incident fixture',
          quantity: 1,
          unitPrice: 100,
          discountAmount: 0,
          taxRate: 0,
          taxKind: 'iva',
          taxAmount: 0,
          lineTotal: 100,
        },
      ],
      adapterInput: {
        tenantId: scenario.tenantId,
        source: 'sale',
        sourceId: saleId,
        kind: 'DEE',
        tenantSettings: {},
      },
    });
    db.transaction(() => {
      db.prepare(
        `insert into cash_sessions (id, tenant_id, site_id, cashier_id, register_name,
        opening_float, opening_count_denominations, expected_balance)
        values (?, ?, ?, ?, 'E2E fiscal recovery', 0, '{}', 100)`
      ).run(cashSessionId, scenario.tenantId, scenario.site.id, scenario.admin.id);
      db.prepare(
        `insert into sales (id, tenant_id, sale_number, subtotal, tax_amount, discount_amount, total,
        payment_method, payment_status, status, cash_session_id, created_by, created_at, updated_at)
        values (?, ?, ?, 100, 0, 0, 100, 'cash', 'paid', 'completed', ?, ?, ?, ?)`
      ).run(
        saleId,
        scenario.tenantId,
        saleNumber,
        cashSessionId,
        scenario.admin.id,
        now,
        now
      );
      db.prepare(
        `insert into cash_movements (id, tenant_id, session_id, type, amount, reference_id, created_by)
        values (?, ?, ?, 'sale', 100, ?, ?)`
      ).run(randomUUID(), scenario.tenantId, cashSessionId, saleId, scenario.admin.id);
      db.prepare(
        `insert into fiscal_emission_intents (id, tenant_id, source, source_id, sale_id, kind,
        requested_by_user_id, status, payload, payload_version, attempts, last_error, created_at, updated_at)
        values (?, ?, 'sale', ?, ?, 'DEE', ?, 'blocked', ?, 1, 0, ?, ?, ?)`
      ).run(
        intentId,
        scenario.tenantId,
        saleId,
        saleId,
        scenario.admin.id,
        payload,
        JSON.stringify({ reason: 'numbering_resolution_missing' }),
        now,
        now
      );
    })();
    return { saleId, intentId, saleNumber, payload };
  } finally {
    db.close();
  }
}

function readEvidence(tenantId: string, intentId: string) {
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
  db.pragma('busy_timeout = 5000');
  try {
    const intent = db
      .prepare(
        'select status, payload, fiscal_document_id as documentId from fiscal_emission_intents where tenant_id = ? and id = ?'
      )
      .get(tenantId, intentId) as { status: string; payload: string; documentId: string | null };
    const audit = db
      .prepare(
        "select count(*) as count from audit_logs where tenant_id = ? and resource_id = ? and action = 'fiscal.intent.rearmed'"
      )
      .get(tenantId, intentId) as { count: number };
    return { ...intent, auditCount: audit.count };
  } finally {
    db.close();
  }
}

for (const language of ['en', 'es'] as const) {
  test(`admin rechecks a frozen fiscal obligation without inventing a document (${language})`, async ({
    page,
  }, testInfo) => {
    const scenario = seedFiscalProfileScenario(`intent-${language}-${testInfo.parallelIndex}`);
    const incident = seedBlockedObligation(scenario);
    const tracker = attachClientIssueTracker(page);
    await login(page, { ...scenario.admin, defaultPath: '/company' });
    await ensureLanguage(page, language);
    await page.goto('/operations?tab=fiscal');
    const heading = language === 'en' ? 'Invoices not created yet' : 'Facturas aún no creadas';
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: incident.saleNumber });
    await expect(row).toContainText(language === 'en' ? 'Blocked' : 'Bloqueada');
    const retry = page.getByTestId(`fiscal-intent-retry-${incident.intentId}`);
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect.poll(() => readEvidence(scenario.tenantId, incident.intentId).auditCount).toBe(1);
    await expect
      .poll(() => readEvidence(scenario.tenantId, incident.intentId).status)
      .toBe('blocked');
    expect(readEvidence(scenario.tenantId, incident.intentId)).toMatchObject({
      payload: incident.payload,
      documentId: null,
      auditCount: 1,
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(row).toContainText(language === 'en' ? 'Blocked' : 'Bloqueada');
    await expect(retry).toBeEnabled();
    await expectNoClientIssues(tracker);
    if (process.env.PUNTOVIVO_AUDIT_DIR) {
      await mkdir(process.env.PUNTOVIVO_AUDIT_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(process.env.PUNTOVIVO_AUDIT_DIR, `fiscal-recovery-${language}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }
  });
}
