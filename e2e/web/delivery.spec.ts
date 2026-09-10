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
import {
  findLatestSaleForProduct,
  getSaleById,
  getProductStock,
  seedDeliverySaleScenario,
  seedSurfaceGateScenario,
} from './support/db';
import { runAxeOnPage } from './support/a11y';

/** Read-only business evidence; all fulfillment writes in this journey must come from the UI. */
function readDeliveryEvidence(tenantId: string) {
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'), {
    readonly: true,
  });
  try {
    const orders = db
      .prepare(
        'SELECT id, status, version, source, cancellation_reason AS reason FROM delivery_orders WHERE tenant_id = ? ORDER BY created_at, id'
      )
      .all(tenantId) as Array<{
      id: string;
      status: string;
      version: number;
      source: string;
      reason: string | null;
    }>;
    const events = db
      .prepare(
        'SELECT to_status AS status, version FROM delivery_order_events WHERE tenant_id = ? ORDER BY created_at, version'
      )
      .all(tenantId) as Array<{ status: string; version: number }>;
    const saleCount = db
      .prepare('SELECT count(*) AS count FROM sales WHERE tenant_id = ?')
      .get(tenantId) as { count: number };
    return { orders, events, saleCount: saleCount.count };
  } finally {
    db.close();
  }
}

test('delivery creation, courier dispatch and cancellation survive reload without financial side effects', async ({
  page,
}, info) => {
  const scenario = seedSurfaceGateScenario(`delivery-${info.parallelIndex}-${Date.now()}`, {
    delivery: true,
  });
  const tracker = attachClientIssueTracker(page);
  await login(page, { ...scenario.admin, defaultPath: '/company' });
  await page.goto('/delivery');
  await ensureLanguage(page, 'en');
  await page.getByRole('button', { name: 'Create delivery', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create delivery', exact: true });
  await expect(create).toContainText('does not collect payment or deduct inventory');
  await create.getByLabel('Recipient name').fill('Delivery E2E <script>text only</script>');
  await create.getByLabel('Phone').fill('3001234567');
  await create.getByLabel('Delivery address').fill('Calle 10 #20-30');
  await create.getByLabel('Quoted amount (no payment recorded)').fill('12500');
  await runAxeOnPage(page, { include: '[role="dialog"]' });
  await create.getByRole('button', { name: 'Create delivery', exact: true }).click();
  await expect(create).toBeHidden();
  const detail = page.getByTestId('delivery-detail-card');
  await expect(detail).toContainText('Delivery E2E <script>text only</script>');
  await runAxeOnPage(page, { include: '[data-testid="delivery-page"]' });
  await page.getByTestId('delivery-detail-advance').click();
  await expect(page.getByTestId('delivery-status-preparing')).toHaveAttribute(
    'data-active',
    'true'
  );
  const id = readDeliveryEvidence(scenario.tenantId).orders[0]!.id;
  await page.getByTestId(`delivery-card-${id}-cta`).click();
  await expect(page.getByTestId('delivery-detail-advance')).toBeDisabled();
  await page.getByTestId('delivery-detail-courier').fill('Courier E2E');
  await page.getByTestId('delivery-detail-advance').click();
  await expect(page.getByTestId('delivery-status-dispatched')).toHaveAttribute(
    'data-active',
    'true'
  );
  await page.getByTestId(`delivery-card-${id}-cta`).click();
  await expect(detail).toContainText('Courier');
  await page.reload();
  await page.getByTestId('delivery-status-dispatched').click();
  await page.getByTestId(`delivery-card-${id}-cta`).click();
  await expect(page.getByTestId('delivery-detail-courier')).toHaveValue('Courier E2E');
  await page.getByTestId('delivery-detail-cancel').click();
  await expect(page.getByTestId('delivery-detail-cancel-confirm-button')).toBeDisabled();
  await expect(page.getByTestId('delivery-detail-cancel-confirm')).toContainText(
    'does not void the sale or refund payments'
  );
  await page.getByLabel('Cancellation reason').fill('Recipient picked up the order');
  await page.getByTestId('delivery-detail-cancel-confirm-button').click();
  await expect(page.getByTestId('delivery-status-cancelled')).toHaveAttribute(
    'data-active',
    'true'
  );
  await page.getByTestId(`delivery-card-${id}-cta`).click();
  await expect(detail).toContainText('Recipient picked up the order');
  await expect(page.getByTestId('delivery-detail-advance')).toBeDisabled();
  await expect(page.getByTestId('delivery-detail-cancel')).toHaveCount(0);
  await runAxeOnPage(page, { include: '[data-testid="delivery-page"]' });
  await ensureLanguage(page, 'es');
  await page.getByTestId('delivery-status-cancelled').click();
  await page.getByTestId(`delivery-card-${id}-cta`).click();
  await expect(detail).toContainText('Registro manual de entrega');
  await expect(detail).toContainText('Motivo de cancelación');
  const evidence = readDeliveryEvidence(scenario.tenantId);
  expect(evidence.orders).toEqual([
    {
      id,
      status: 'cancelled',
      version: 4,
      source: 'manual',
      reason: 'Recipient picked up the order',
    },
  ]);
  expect(evidence.events).toEqual([
    { status: 'accepted', version: 1 },
    { status: 'preparing', version: 2 },
    { status: 'dispatched', version: 3 },
    { status: 'cancelled', version: 4 },
  ]);
  expect(evidence.saleCount).toBe(0);
  if (process.env.PUNTOVIVO_AUDIT_DIR) {
    await mkdir(process.env.PUNTOVIVO_AUDIT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.PUNTOVIVO_AUDIT_DIR, 'delivery-cancelled-es.png'),
      fullPage: true,
    });
  }
  await expectNoClientIssues(tracker);
});

test('a real completed sale creates a linked delivery without charging or deducting stock again', async ({
  page,
}, info) => {
  const scenario = seedDeliverySaleScenario(`delivery-sale-${info.parallelIndex}-${Date.now()}`);
  const tracker = attachClientIssueTracker(page);
  await login(page, { ...scenario.admin, defaultPath: '/company' });
  await ensureLanguage(page, 'en');
  await page.goto('/sales');
  await page.locator('#sales-product-search-input').fill(scenario.product.sku);
  await page.locator('#sales-product-search-input').press('Enter');
  await page
    .locator('tr', { has: page.getByText(scenario.product.sku) })
    .first()
    .click();
  await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
  await expect(page.getByTestId(`sale-cart-item-${scenario.product.sku}`)).toBeVisible();
  await page.getByRole('button', { name: 'Charge sale', exact: true }).first().click();
  const charge = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByRole('heading', { name: 'Charge Sale' }) })
    .last();
  await charge.getByRole('button', { name: 'Confirm Sale', exact: true }).click();
  await expect(charge).toBeHidden();
  const sale = findLatestSaleForProduct(scenario.product.id, scenario.admin.id);
  expect(sale?.status).toBe('completed');
  expect(sale?.paymentStatus).toBe('paid');
  const stockAfterSale = getProductStock(scenario.product.id);
  expect(stockAfterSale).toBe(7);
  await page.getByTestId('sales-open-last-receipt').click();
  const receipt = page.getByRole('dialog', { name: `Sale ${sale!.saleNumber}` });
  await receipt.getByRole('link', { name: 'Create delivery from this sale', exact: true }).click();
  await expect(page).toHaveURL(/\/delivery\?sale=/);
  const create = page.getByRole('dialog', { name: 'Create delivery', exact: true });
  await expect(create.getByLabel('Choose a sale')).toHaveValue(sale!.id);
  await expect(create).toContainText(sale!.saleNumber);
  await create.getByLabel('Recipient name').fill('Sale recipient');
  await create.getByLabel('Delivery address').fill('Avenida 20 #10-15');
  await create.getByRole('button', { name: 'Create delivery', exact: true }).click();
  await expect(create).toBeHidden();
  await expect(page.getByTestId('delivery-detail-card')).toContainText('Delivery linked to a sale');
  await expect(page.getByTestId('delivery-detail-card')).toContainText(scenario.product.name);
  const evidence = readDeliveryEvidence(scenario.tenantId);
  expect(evidence.orders).toHaveLength(1);
  expect(evidence.orders[0]?.source).toBe('sale');
  expect(evidence.saleCount).toBe(1);
  expect(getProductStock(scenario.product.id)).toBe(stockAfterSale);
  expect(getSaleById(sale!.id)).toMatchObject({
    total: sale!.total,
    status: 'completed',
    paymentStatus: 'paid',
  });
  await page.reload();
  await page.getByTestId(`delivery-card-${evidence.orders[0]!.id}-cta`).click();
  await expect(page.getByTestId('delivery-detail-card')).toContainText(scenario.product.name);
  await page.getByRole('button', { name: 'Create delivery', exact: true }).click();
  await create.getByLabel('Delivery source').selectOption('sale');
  await create.getByLabel('Search by sale number').fill(sale!.saleNumber);
  await expect(
    create.getByLabel('Choose a sale').getByRole('option', { name: new RegExp(sale!.saleNumber) })
  ).toHaveCount(0);
  await expect(create.getByRole('button', { name: 'Create delivery', exact: true })).toBeDisabled();
  await create.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.goto('/audit-logs');
  await page.getByRole('combobox', { name: 'Action', exact: true }).selectOption('delivery.create');
  await expect(
    page.getByRole('cell', { name: 'Delivery created', exact: true }).first()
  ).toBeVisible();
  await expectNoClientIssues(tracker);
});
