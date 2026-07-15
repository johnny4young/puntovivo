import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
import { hashStaffPin } from '../../packages/server/src/security/staffPins.js';
import { attachClientIssueTracker, expectNoClientIssues, login, openUserMenu } from './support/app';
import { findLatestSaleForProduct, getAuditLog, seedSaleScenario } from './support/db';
import { addProductToCartViaKeyboard } from './support/sales-keyboard';

const MANAGER_PIN = '975310';

async function captureEvidence(page: Page, name: string) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  await page.screenshot({
    animations: 'disabled',
    fullPage: false,
    path: path.join(auditDir, `${name}.png`),
  });
}

async function configureManagerPin(userId: string) {
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
  try {
    db.prepare('update users set staff_pin_hash = ?, updated_at = ? where id = ?').run(
      await hashStaffPin(MANAGER_PIN),
      new Date().toISOString(),
      userId
    );
  } finally {
    db.close();
  }
}

function configureMockCashDrawer(tenantId: string, siteId: string) {
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
  const id = `e2e_drawer_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const now = new Date().toISOString();
  const previouslyActive = db
    .prepare(
      `select id from site_peripherals
       where tenant_id = ? and site_id = ? and kind = 'cash_drawer' and is_active = 1`
    )
    .all(tenantId, siteId) as Array<{ id: string }>;
  db.prepare(
    `update site_peripherals set is_active = 0, updated_at = ?
     where tenant_id = ? and site_id = ? and kind = 'cash_drawer' and is_active = 1`
  ).run(now, tenantId, siteId);
  db.prepare(
    `insert into site_peripherals (
      id, tenant_id, site_id, kind, driver, config_json, display_name,
      is_active, created_at, updated_at
    ) values (?, ?, ?, 'cash_drawer', 'escpos', ?, ?, 1, ?, ?)`
  ).run(id, tenantId, siteId, JSON.stringify({ channel: 'mock' }), 'E2E cash drawer', now, now);
  db.close();

  return () => {
    const cleanupDb = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
    try {
      cleanupDb.prepare('delete from site_peripherals where id = ?').run(id);
      for (const row of previouslyActive) {
        cleanupDb
          .prepare('update site_peripherals set is_active = 1, updated_at = ? where id = ?')
          .run(new Date().toISOString(), row.id);
      }
    } finally {
      cleanupDb.close();
    }
  };
}

function findApprovalByReason(reason: string) {
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
  try {
    return (db
      .prepare(
        `select id, status, action, resource_type as resourceType, resource_id as resourceId
           from manager_approval_requests where reason = ?
           order by requested_at desc, id desc limit 1`
      )
      .get(reason) ?? null) as {
      id: string;
      status: string;
      action: string;
      resourceType: string;
      resourceId: string | null;
    } | null;
  } finally {
    db.close();
  }
}

test('cashier requests and consumes an exact discount approval (ENG-106c2)', async ({
  browser,
}, testInfo) => {
  const scenario = seedSaleScenario(`checkout-approval-${testInfo.parallelIndex}-${Date.now()}`);
  const approvalReason = `Documented price match ${scenario.product.sku}`;
  await configureManagerPin(scenario.manager.id);

  const cashierContext = await browser.newContext();
  const managerContext = await browser.newContext();
  const cashierPage = await cashierContext.newPage();
  const managerPage = await managerContext.newPage();
  await managerPage.setViewportSize({ width: 1440, height: 900 });
  const cashierTracker = attachClientIssueTracker(cashierPage);
  const managerTracker = attachClientIssueTracker(managerPage);

  try {
    await login(cashierPage, {
      ...scenario.cashier,
      defaultPath: '/sales',
    });
    await addProductToCartViaKeyboard(cashierPage, scenario.product.sku);
    await cashierPage.getByLabel(`Discount for ${scenario.product.name}`).fill('10');
    await cashierPage.keyboard.press('F1');

    const paymentDialog = cashierPage.getByRole('dialog', {
      name: /charge sale/i,
    });
    const approvalPanel = paymentDialog.getByTestId('checkout-approval-panel');
    await expect(approvalPanel.getByText('Discounted checkout', { exact: true })).toBeVisible();
    await approvalPanel.getByLabel('Reason for Discounted checkout').fill(approvalReason);
    await approvalPanel.getByRole('button', { name: 'Request approval' }).click();
    await expect(approvalPanel.getByTestId('checkout-approval-status-sale_discount')).toHaveText(
      'Pending'
    );
    await captureEvidence(cashierPage, 'eng-106c2-cashier-request-en');

    await login(managerPage, { ...scenario.manager, defaultPath: '/dashboard' }, { spanish: true });
    await expect(managerPage.getByText('Ventas de hoy').first()).toBeVisible();
    await openUserMenu(managerPage);
    const queue = managerPage.getByRole('region', { name: 'Aprobaciones' });
    const checkoutCard = queue.getByRole('article').filter({ hasText: approvalReason });
    await expect(checkoutCard.getByText('Descuento de venta')).toBeVisible();
    await expect(checkoutCard.getByText('Solicitud exacta de cobro')).toBeVisible();
    await expect(checkoutCard.getByText(/COP\s+1[.,]250/)).toBeVisible();
    const approveButton = checkoutCard.getByRole('button', { name: 'Aprobar' });
    await approveButton.scrollIntoViewIfNeeded();
    await captureEvidence(managerPage, 'eng-106c2-manager-queue-es');
    await approveButton.click();
    await checkoutCard.getByLabel('Tu PIN de personal').fill(MANAGER_PIN);
    await checkoutCard.getByRole('button', { name: 'Confirmar aprobación' }).click();
    await expect(checkoutCard).toBeHidden();

    await expect(approvalPanel.getByTestId('checkout-approval-status-sale_discount')).toHaveText(
      'Approved',
      { timeout: 10_000 }
    );
    await captureEvidence(cashierPage, 'eng-106c2-cashier-approved-en');
    await paymentDialog.getByRole('button', { name: 'Confirm Sale' }).click();
    await expect(paymentDialog).toBeHidden({ timeout: 15_000 });
    await expect
      .poll(() => findLatestSaleForProduct(scenario.product.id, scenario.cashier.id))
      .toMatchObject({ status: 'completed', total: 11_250 });

    await expectNoClientIssues(cashierTracker);
    await expectNoClientIssues(managerTracker);
  } finally {
    await cashierContext.close();
    await managerContext.close();
  }
});

test('cashier consumes exact refund and drawer grants without an elevated session (ENG-106c3)', async ({
  browser,
}, testInfo) => {
  const scenario = seedSaleScenario(`post-sale-approval-${testInfo.parallelIndex}-${Date.now()}`);
  const refundReason = `Refund verified ${scenario.product.sku}`;
  const drawerReason = `Open drawer for change ${scenario.product.sku}`;
  const restoreDrawer = configureMockCashDrawer(scenario.tenantId, scenario.sites[0]!.id);
  await configureManagerPin(scenario.manager.id);

  const cashierContext = await browser.newContext();
  const managerContext = await browser.newContext();
  const cashierPage = await cashierContext.newPage();
  const managerPage = await managerContext.newPage();
  await cashierPage.setViewportSize({ width: 1440, height: 900 });
  await managerPage.setViewportSize({ width: 1440, height: 900 });
  const cashierTracker = attachClientIssueTracker(cashierPage);
  const managerTracker = attachClientIssueTracker(managerPage);

  try {
    await login(cashierPage, { ...scenario.cashier, defaultPath: '/sales' });
    await addProductToCartViaKeyboard(cashierPage, scenario.product.sku);
    await cashierPage.keyboard.press('F2');
    const paymentDialog = cashierPage.getByRole('dialog', { name: /charge sale/i });
    await paymentDialog.getByRole('button', { name: 'Confirm Sale' }).click();
    await expect(paymentDialog).toBeHidden({ timeout: 15_000 });
    await expect
      .poll(() => findLatestSaleForProduct(scenario.product.id, scenario.cashier.id))
      .not.toBeNull();
    const sale = findLatestSaleForProduct(scenario.product.id, scenario.cashier.id);
    if (!sale) throw new Error('Expected completed sale for post-sale approval');

    await cashierPage.getByTestId('sales-open-history').click();
    const historyDialog = cashierPage.getByRole('dialog', { name: 'History' });
    const historyDrawer = cashierPage.getByTestId('sales-history-drawer');
    await historyDrawer.getByRole('button', { name: `View ${sale.saleNumber}` }).click();
    const detailsDialog = cashierPage.getByRole('dialog', { name: `Sale ${sale.saleNumber}` });
    await detailsDialog.getByRole('button', { name: 'Refund Sale' }).click();
    const refundDialog = cashierPage.getByRole('dialog', { name: 'Return sale' });
    await expect(refundDialog).toBeVisible();
    await cashierPage.getByLabel('Reason for Refund sale').fill(refundReason);
    await refundDialog.getByRole('button', { name: 'Request approval' }).click();
    await captureEvidence(cashierPage, 'eng-106c3-cashier-refund-pending-en');

    await login(managerPage, { ...scenario.manager, defaultPath: '/dashboard' }, { spanish: true });
    await openUserMenu(managerPage);
    const queue = managerPage.getByRole('region', { name: 'Aprobaciones' });
    const refundCard = queue.getByRole('article').filter({ hasText: refundReason });
    await expect(refundCard.getByText('Reembolso de venta')).toBeVisible();
    await refundCard.getByRole('button', { name: 'Aprobar' }).click();
    await refundCard.getByLabel('Tu PIN de personal').fill(MANAGER_PIN);
    await refundCard.getByRole('button', { name: 'Confirmar aprobación' }).click();
    await expect(refundCard).toBeHidden();

    await expect(cashierPage.getByTestId('checkout-approval-status-sale_refund')).toHaveText(
      'Approved',
      { timeout: 10_000 }
    );
    await captureEvidence(cashierPage, 'eng-106c3-cashier-refund-approved-en');
    await refundDialog.getByRole('button', { name: 'Confirm return' }).click();
    await expect(refundDialog).toBeHidden({ timeout: 15_000 });
    await expect
      .poll(() => findLatestSaleForProduct(scenario.product.id, scenario.cashier.id))
      .toMatchObject({ paymentStatus: 'refunded' });
    await expect
      .poll(() => findApprovalByReason(refundReason))
      .toMatchObject({
        status: 'consumed',
        action: 'sale_refund',
        resourceType: 'sale',
        resourceId: sale.id,
      });

    await historyDialog.getByRole('button', { name: 'Close modal' }).click();
    await expect(historyDialog).toBeHidden();
    if (await detailsDialog.isVisible()) {
      await detailsDialog.getByRole('button', { name: 'Close modal' }).click();
      await expect(detailsDialog).toBeHidden();
    }

    await cashierPage.getByTestId('sales-kick-drawer').click();
    const drawerDialog = cashierPage.getByRole('dialog', { name: 'Drawer approval' });
    const drawerPanel = drawerDialog.getByTestId('checkout-approval-panel');
    await drawerPanel.getByLabel('Reason for Open cash drawer').fill(drawerReason);
    await drawerPanel.getByRole('button', { name: 'Request approval' }).click();
    await expect(drawerPanel.getByTestId('checkout-approval-status-cash_drawer_open')).toHaveText(
      'Pending'
    );

    const drawerCard = queue.getByRole('article').filter({ hasText: drawerReason });
    await expect(drawerCard.getByText('Abrir cajón de efectivo')).toBeVisible({ timeout: 10_000 });
    await drawerCard.getByRole('button', { name: 'Aprobar' }).click();
    await drawerCard.getByLabel('Tu PIN de personal').fill(MANAGER_PIN);
    await drawerCard.getByRole('button', { name: 'Confirmar aprobación' }).click();
    await expect(drawerCard).toBeHidden();
    await expect(drawerPanel.getByTestId('checkout-approval-status-cash_drawer_open')).toHaveText(
      'Approved',
      { timeout: 10_000 }
    );
    await captureEvidence(cashierPage, 'eng-106c3-cashier-drawer-approved-en');
    await drawerDialog.getByRole('button', { name: 'Open cash drawer' }).click();
    await expect(drawerDialog).toBeHidden({ timeout: 15_000 });
    await expect
      .poll(() => findApprovalByReason(drawerReason))
      .toMatchObject({
        status: 'consumed',
        action: 'cash_drawer_open',
        resourceType: 'site',
        resourceId: scenario.sites[0]!.id,
      });
    await expect.poll(() => getAuditLog('cash_drawer.open', scenario.sites[0]!.id)).not.toBeNull();

    await expectNoClientIssues(cashierTracker);
    await expectNoClientIssues(managerTracker);
  } finally {
    restoreDrawer();
    await cashierContext.close();
    await managerContext.close();
  }
});
