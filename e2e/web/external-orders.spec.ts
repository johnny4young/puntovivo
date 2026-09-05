import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
import {
  prepareSandboxEnvelope,
  sendSandboxEnvelope,
} from '../../packages/server/src/services/external-orders/simulator';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  login,
} from './support/app';
import { seedExternalOrderScenario, getProductStock } from './support/db';
import { runAxeOnPage } from './support/a11y';

/** The journey only reads SQLite; connector, inbox, stock and payment writes use UI or signed HTTP. */
function evidence(tenantId: string) {
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'), {
    readonly: true,
  });
  try {
    return {
      orders: db
        .prepare(
          'SELECT id,external_id AS externalId,status,version,sale_id AS saleId FROM external_orders WHERE tenant_id=? ORDER BY external_id'
        )
        .all(tenantId) as Array<{
        id: string;
        externalId: string;
        status: string;
        version: number;
        saleId: string | null;
      }>,
      sales: db
        .prepare(
          'SELECT id,status,payment_status AS paymentStatus,total FROM sales WHERE tenant_id=?'
        )
        .all(tenantId) as Array<{
        id: string;
        status: string;
        paymentStatus: string;
        total: number;
      }>,
      receipts: (
        db
          .prepare('SELECT count(*) AS count FROM external_order_receipts WHERE tenant_id=?')
          .get(tenantId) as { count: number }
      ).count,
      payments: (
        db
          .prepare(
            "SELECT count(*) AS count FROM cash_movements WHERE tenant_id=? AND type = 'sale'"
          )
          .get(tenantId) as { count: number }
      ).count,
    };
  } finally {
    db.close();
  }
}
async function setupConnector(page: Page) {
  await page.goto('/external-orders');
  await ensureLanguage(page, 'en');
  await page.getByRole('button', { name: 'Connectors', exact: true }).click();
  await page.getByRole('button', { name: 'Create connector', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create connector', exact: true });
  await dialog.getByLabel('Connector name').fill('Signed sandbox E2E');
  await dialog.getByRole('button', { name: 'Generate secure key' }).click();
  const secret = await dialog.getByLabel('Signing key', { exact: true }).inputValue();
  await expect(dialog.getByLabel('Signing key', { exact: true })).toHaveAttribute(
    'type',
    'password'
  );
  const save = dialog.getByRole('button', { name: 'Create connector', exact: true });
  await expect(save).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await save.click();
  await expect(dialog).toBeHidden();
  const connectorId = await page.getByLabel('Connector ID', { exact: true }).inputValue();
  await page.reload();
  await expect(page.getByLabel('Signing key', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  return { secret, connectorId };
}
function creation(sku: string, orderId = 'order-ui-1') {
  return {
    schemaVersion: 1,
    eventId: `${orderId}-create`,
    orderId,
    kind: 'order.created',
    order: {
      customerName: 'Customer <script>text only</script>',
      phone: '3001234567',
      address: 'Calle 10 #20-30',
      currencyCode: 'COP',
      quotedTotal: 1,
      items: [{ productCode: sku, quantity: 1.001 }],
    },
  };
}
async function send(connector: { secret: string; connectorId: string }, event: unknown) {
  const envelope = prepareSandboxEnvelope(
    connector.connectorId,
    connector.secret,
    JSON.stringify(event)
  );
  const result = await sendSandboxEnvelope('http://127.0.0.1:8090', envelope);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return envelope;
}
/** Execute the shipped CLI too: private key file, exact event bytes, fresh transport retries, no secret logs. */
async function exerciseSimulatorCli(
  connector: { secret: string; connectorId: string },
  event: unknown
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'puntovivo-external-simulator-'));
  try {
    const keyPath = path.join(directory, 'signing-key'),
      eventPath = path.join(directory, 'event.json');
    await writeFile(keyPath, connector.secret, { mode: 0o600 });
    await writeFile(eventPath, JSON.stringify(event), { mode: 0o600 });
    const require = createRequire(path.join(process.cwd(), 'packages/server/package.json'));
    const result = await promisify(execFile)(
      process.execPath,
      [
        '--import',
        require.resolve('tsx'),
        path.join(process.cwd(), 'packages/server/src/scripts/simulate-external-order.ts'),
        '--origin',
        'http://127.0.0.1:8090',
        '--connector',
        connector.connectorId,
        '--secret-file',
        keyPath,
        '--event-file',
        eventPath,
        '--repeat',
        '2',
        '--fresh-retry',
      ],
      { timeout: 45_000 }
    );
    expect(result.stderr).toBe('');
    expect(
      result.stdout
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))
    ).toEqual([
      { attempt: 1, httpStatus: 200, accepted: true },
      { attempt: 2, httpStatus: 200, accepted: true },
    ]);
    expect(result.stdout).not.toContain(connector.secret);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
async function accept(page: Page, externalId: string) {
  await page.reload();
  await page.getByRole('button', { name: new RegExp(externalId) }).click();
  const detail = page.getByTestId('external-order-detail');
  await detail.getByRole('button', { name: 'Review local prices' }).click();
  await expect(detail).toContainText('The local total differs from the source quote');
  const accept = detail.getByRole('button', { name: 'Accept and create draft' });
  await expect(accept).toBeDisabled();
  await detail.getByRole('checkbox', { name: /I reviewed the local products/ }).check();
  await runAxeOnPage(page, { include: '[data-testid="external-orders-page"]' });
  await accept.click();
  await expect(detail.getByRole('link', { name: 'Open suspended sales' })).toBeVisible();
  return detail;
}
async function capture(page: Page, name: string) {
  if (!process.env.PUNTOVIVO_AUDIT_DIR) return;
  await mkdir(process.env.PUNTOVIVO_AUDIT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.PUNTOVIVO_AUDIT_DIR, name), fullPage: true });
}

test('signed request, duplicate delivery, explicit prices and real checkout reconcile after reload', async ({
  page,
}, info) => {
  const scenario = seedExternalOrderScenario(`external-${info.parallelIndex}-${Date.now()}`);
  const tracker = attachClientIssueTracker(page);
  await login(page, { ...scenario.admin, defaultPath: '/company' });
  const connector = await setupConnector(page),
    event = creation(scenario.product.sku);
  const envelope = await send(connector, event);
  const duplicate = await sendSandboxEnvelope('http://127.0.0.1:8090', envelope);
  expect(duplicate.status).toBe(200);
  await send(connector, event); // Fresh nonce, same immutable event identity.
  await exerciseSimulatorCli(connector, event);
  expect(evidence(scenario.tenantId)).toMatchObject({ sales: [], receipts: 1, payments: 0 });
  expect(getProductStock(scenario.product.id)).toBe(8);
  const detail = await accept(page, event.orderId);
  expect(evidence(scenario.tenantId).sales).toHaveLength(1);
  expect(evidence(scenario.tenantId).sales[0]?.paymentStatus).toBe('pending');
  expect(evidence(scenario.tenantId).payments).toBe(0);
  expect(getProductStock(scenario.product.id)).toBeCloseTo(6.999, 3);
  await detail.getByRole('link', { name: 'Open suspended sales' }).click();
  const draft = page.getByTestId('suspended-draft-card').filter({ hasText: event.orderId });
  await draft.getByTestId('suspended-draft-resume').click();
  await page.getByRole('button', { name: 'Charge sale', exact: true }).first().click();
  const charge = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByRole('heading', { name: 'Charge Sale' }) })
    .last();
  await charge.getByRole('button', { name: 'Confirm Sale', exact: true }).click();
  await expect(charge).toBeHidden();
  expect(evidence(scenario.tenantId).sales).toHaveLength(1);
  expect(evidence(scenario.tenantId).sales[0]).toMatchObject({
    status: 'completed',
    paymentStatus: 'paid',
  });
  expect(evidence(scenario.tenantId).payments).toBe(1);
  expect(getProductStock(scenario.product.id)).toBeCloseTo(6.999, 3);
  await page.goto('/external-orders');
  await page.getByRole('combobox', { name: 'Order status' }).selectOption('accepted');
  await page.getByRole('button', { name: new RegExp(event.orderId) }).click();
  await expect(detail.getByRole('link', { name: 'Create delivery from this sale' })).toBeVisible();
  await detail.getByRole('link', { name: 'Open sale details' }).click();
  await expect(page.getByRole('dialog', { name: /Sale DEL-/ })).toBeVisible();
  await page.reload();
  await expect(page.locator('#sales-product-search-input')).toBeVisible();
  await expect(page.getByRole('dialog', { name: /Sale DEL-/ })).toBeHidden();
  await page.goto('/external-orders');
  await ensureLanguage(page, 'es');
  await page.getByRole('combobox').selectOption('accepted');
  await page.getByRole('button', { name: new RegExp(event.orderId) }).click();
  await expect(detail).toContainText('Venta vinculada');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  // The shell animates its desktop margin on resize; no-overflow alone can pass while content is clipped.
  await expect
    .poll(async () => {
      const box = await page.getByTestId('external-orders-page').boundingBox();
      return !!box && box.x >= 0 && box.x <= 20 && box.width >= 340 && box.x + box.width <= 390;
    })
    .toBe(true);
  await capture(page, 'external-accepted-mobile-es.png');
  await runAxeOnPage(page, { include: '[data-testid="external-orders-page"]' });
  await expectNoClientIssues(tracker);
});

test('signed cancellation cannot silently refund; UI discard restores stock and rotation rejects the old key', async ({
  page,
}, info) => {
  const scenario = seedExternalOrderScenario(`external-cancel-${info.parallelIndex}-${Date.now()}`);
  const tracker = attachClientIssueTracker(page);
  await login(page, { ...scenario.admin, defaultPath: '/company' });
  const connector = await setupConnector(page),
    event = creation(scenario.product.sku, 'order-ui-cancel');
  await send(connector, event);
  let detail = await accept(page, event.orderId);
  await send(connector, {
    schemaVersion: 1,
    eventId: 'cancel-source',
    orderId: event.orderId,
    kind: 'order.cancelled',
    reason: 'Customer cancelled',
  });
  await page.reload();
  await page.getByRole('combobox', { name: 'Order status' }).selectOption('cancel_requested');
  await page.getByRole('button', { name: new RegExp(event.orderId) }).click();
  detail = page.getByTestId('external-order-detail');
  await expect(detail).toContainText('No refund is automatic');
  await detail.getByLabel('Reason', { exact: true }).fill('Reversal reviewed');
  await expect(
    detail.getByRole('button', { name: 'Confirm cancellation resolved' })
  ).toBeDisabled();
  expect(evidence(scenario.tenantId).payments).toBe(0);
  expect(getProductStock(scenario.product.id)).toBeCloseTo(6.999, 3);
  await detail.getByRole('link', { name: 'Open suspended sales' }).click();
  const draft = page.getByTestId('suspended-draft-card').filter({ hasText: event.orderId });
  await draft.getByTestId('suspended-draft-discard').click();
  await page
    .getByRole('dialog', { name: 'Discard draft?' })
    .getByRole('button', { name: 'Discard draft', exact: true })
    .click();
  await expect(draft).toBeHidden();
  expect(getProductStock(scenario.product.id)).toBe(8);
  await page.goto('/external-orders');
  await page.getByRole('combobox', { name: 'Order status' }).selectOption('cancelled');
  await page.getByRole('button', { name: new RegExp(event.orderId) }).click();
  await expect(detail).toContainText('Cancelled');
  expect(evidence(scenario.tenantId).sales[0]?.status).toBe('cancelled');
  expect(evidence(scenario.tenantId).payments).toBe(0);
  await page.getByRole('button', { name: 'Connectors', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate key', exact: true }).click();
  const rotate = page.getByRole('dialog', { name: 'Rotate key', exact: true });
  await rotate.getByRole('button', { name: 'Generate secure key' }).click();
  const newSecret = await rotate.getByLabel('Signing key', { exact: true }).inputValue();
  await rotate.getByRole('checkbox').check();
  await rotate.getByRole('button', { name: 'Rotate key', exact: true }).click();
  await expect(rotate).toBeHidden();
  const old = prepareSandboxEnvelope(
    connector.connectorId,
    connector.secret,
    JSON.stringify(creation(scenario.product.sku, 'old-key'))
  );
  expect((await sendSandboxEnvelope('http://127.0.0.1:8090', old)).status).toBe(401);
  const tombstone = {
    schemaVersion: 1,
    eventId: 'early-cancel',
    orderId: 'out-of-order',
    kind: 'order.cancelled',
    reason: 'Cancelled before create',
  };
  await send({ ...connector, secret: newSecret }, tombstone);
  await send({ ...connector, secret: newSecret }, creation(scenario.product.sku, 'out-of-order'));
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  await page.getByRole('combobox', { name: 'Order status' }).selectOption('cancelled');
  await page.getByRole('button', { name: /out-of-order/ }).click();
  await expect(detail).toContainText('will not be reopened automatically');
  expect(evidence(scenario.tenantId).sales).toHaveLength(1);
  await capture(page, 'external-cancellation-en.png');
  await expectNoClientIssues(tracker);
});
