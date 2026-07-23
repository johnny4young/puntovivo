import { randomUUID } from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  loginAs,
} from './support/app';

const DB_PATH = path.join(process.cwd(), 'packages/server/data/local.db');
const RETRIABLE_PAYMENT_STATUSES = ['declined', 'timeout', 'retrying', 'dead_letter'] as const;

interface PaymentIncidentFixture {
  id: string;
  tenantId: string;
  reference: string;
  baselineAttentionCount: number;
}

function withDatabase<T>(read: (db: Database.Database) => T): T {
  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 5000');
  try {
    return read(db);
  } finally {
    db.close();
  }
}

function insertPaymentIncident(): PaymentIncidentFixture {
  return withDatabase(db => {
    const user = db
      .prepare('select tenant_id as tenantId from users where email = ?')
      .get('e2e.admin@local.test') as { tenantId: string } | undefined;
    if (!user) throw new Error('E2E admin tenant was not seeded');

    const placeholders = RETRIABLE_PAYMENT_STATUSES.map(() => '?').join(', ');
    const baseline = db
      .prepare(
        `select count(*) as count from payment_outbox
         where tenant_id = ? and status in (${placeholders})`
      )
      .get(user.tenantId, ...RETRIABLE_PAYMENT_STATUSES) as { count: number };
    const id = `e2e-payment-recovery-${randomUUID()}`;
    const reference = `E2E-RECOVERY-${randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(
      `insert into payment_outbox (
        id, tenant_id, rail_id, kind, status, amount, currency_code, reference,
        payload, payload_version, attempts, last_error, priority, created_at, updated_at
      ) values (?, ?, 'wompi', 'charge', 'declined', 12500, 'COP', ?, json(?), 1, 2, json(?), 100, ?, ?)`
    ).run(
      id,
      user.tenantId,
      reference,
      JSON.stringify({ source: 'e2e-operational-recovery' }),
      JSON.stringify({ message: 'E2E provider decline' }),
      now,
      now
    );
    return {
      id,
      tenantId: user.tenantId,
      reference,
      baselineAttentionCount: baseline.count,
    };
  });
}

function paymentIncidentState(fixture: PaymentIncidentFixture): {
  status: string | null;
  retryAudits: number;
} {
  return withDatabase(db => {
    const row = db.prepare('select status from payment_outbox where id = ?').get(fixture.id) as
      { status: string } | undefined;
    const audit = db
      .prepare(
        `select count(*) as count from audit_logs
         where tenant_id = ? and action = 'payment.retry'
           and resource_type = 'payment_outbox' and resource_id = ?`
      )
      .get(fixture.tenantId, fixture.id) as { count: number };
    return { status: row?.status ?? null, retryAudits: audit.count };
  });
}

function cleanupPaymentIncident(fixture: PaymentIncidentFixture): void {
  withDatabase(db => {
    db.transaction(() => {
      db.prepare(
        `delete from audit_logs
         where tenant_id = ? and resource_type = 'payment_outbox' and resource_id = ?`
      ).run(fixture.tenantId, fixture.id);
      db.prepare('delete from payment_outbox where tenant_id = ? and id = ?').run(
        fixture.tenantId,
        fixture.id
      );
    })();
  });
}

test.describe('operational recovery ownership', () => {
  test.describe.configure({ mode: 'serial' });

  test('admin sees the six-service contract and reaches only supported recovery surfaces', async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    await loginAs(page, 'admin');
    await page.goto('/operations');

    const board = page.getByTestId('operational-readiness-board');
    await expect(board).toBeVisible();
    await expect(board.getByText('Every signal has an owner')).toBeVisible();
    await expect(board.locator('[data-testid^="operational-service-"]')).toHaveCount(6);
    await expect(page.getByTestId('operational-service-fiscal')).toContainText('Store manager');
    await expect(page.getByTestId('operational-service-fiscal')).toContainText('15 min');
    await expect(page.getByTestId('operational-service-backup')).toContainText(
      'Successful snapshot within 30 h'
    );
    await expect(board.getByText('7 executable drills')).toBeVisible();
    await expect(page.getByTestId('operational-desktop-required-backup')).toContainText(
      'Desktop app required'
    );
    await expect(page.getByTestId('operational-action-backup')).toHaveCount(0);

    await page.getByTestId('operational-action-fiscal').click();
    await expect(page).toHaveURL(/\/operations\?tab=fiscal$/);
    await expect(page.getByTestId('operations-tab-fiscal')).toHaveAttribute(
      'aria-selected',
      'true'
    );

    await page.goto('/operations');
    await page.getByTestId('operational-action-sync').click();
    await expect(page).toHaveURL(/\/company\?tab=data$/);
    await expect(page.getByTestId('company-tab-data')).toHaveAttribute('aria-current', 'page');
    await expectNoClientIssues(tracker);
  });

  test('admin recovers a real declined payment and the attention queue refreshes', async ({
    page,
  }) => {
    const fixture = insertPaymentIncident();
    const tracker = attachClientIssueTracker(page);
    try {
      await loginAs(page, 'admin');
      await page.goto('/operations');

      const attentionRow = page.getByTestId('needs-attention-row-payments');
      await expect(attentionRow).toContainText(
        `${fixture.baselineAttentionCount + 1} item${fixture.baselineAttentionCount === 0 ? '' : 's'} pending`
      );
      await page.getByTestId('needs-attention-cta-payments').click();
      await expect(page).toHaveURL(/\/operations\?tab=payments$/);
      await expect(page.getByText(fixture.reference)).toBeVisible();

      await page.getByTestId(`payment-retry-${fixture.id}`).click();
      await page.getByRole('button', { name: /^Confirm$/ }).click();

      await expect.poll(() => paymentIncidentState(fixture)).toMatchObject({ retryAudits: 1 });
      expect(RETRIABLE_PAYMENT_STATUSES).not.toContain(paymentIncidentState(fixture).status);

      await page.getByTestId('operations-tab-attention').click();
      if (fixture.baselineAttentionCount === 0) {
        await expect(page.getByTestId('needs-attention-row-payments')).toHaveCount(0);
      } else {
        await expect(page.getByTestId('needs-attention-row-payments')).toContainText(
          `${fixture.baselineAttentionCount} item${fixture.baselineAttentionCount === 1 ? '' : 's'} pending`
        );
      }
      await expectNoClientIssues(tracker);
    } finally {
      cleanupPaymentIncident(fixture);
    }
  });

  test('manager gets a Spanish administrator handoff without querying desktop-only state', async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    await loginAs(page, 'manager', { spanish: true });
    await ensureLanguage(page, 'es');
    await page.goto('/operations');

    const board = page.getByTestId('operational-readiness-board');
    await expect(board.getByText('Cada señal tiene un responsable')).toBeVisible();
    await expect(board.locator('[data-testid^="operational-service-"]')).toHaveCount(6);
    const backup = page.getByTestId('operational-service-backup');
    await expect(backup).toContainText('Administrador');
    await expect(backup).toContainText('Transferir al administrador');
    await expect(page.getByTestId('operational-action-backup')).toHaveCount(0);

    await page.getByTestId('operational-action-payments').click();
    await expect(page).toHaveURL(/\/operations\?tab=payments$/);
    await expect(page.getByTestId('operations-tab-payments')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expectNoClientIssues(tracker);
  });
});
