import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
import { hashStaffPin } from '../../packages/server/src/security/staffPins.js';
import { attachClientIssueTracker, expectNoClientIssues, login, openUserMenu } from './support/app';
import { findLatestSaleForProduct, getAuditLog, seedSaleScenario } from './support/db';
import { addProductToCartViaKeyboard } from './support/sales-keyboard';

const MANAGER_PIN = '975310';

// These flows intentionally mutate the tenant-wide loss-prevention row and
// restore it afterward. Keep the file serial so two policy bands cannot race
// through the shared business E2E tenant.
test.describe.configure({ mode: 'serial' });

interface LossPreventionSnapshot {
  hadValue: boolean;
  value: unknown;
}

interface LossPreventionTrigger {
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

async function captureEvidence(page: Page, name: string) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  await page.evaluate(
    () =>
      new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
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

function snapshotLossPreventionSettings(tenantId: string): LossPreventionSnapshot {
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
  try {
    const row = db
      .prepare('select policy from loss_prevention_settings where tenant_id = ?')
      .get(tenantId) as { policy: string } | undefined;
    return {
      hadValue: row !== undefined,
      value: row ? JSON.parse(row.policy) : null,
    };
  } finally {
    db.close();
  }
}

function restoreLossPreventionSettings(tenantId: string, snapshot: LossPreventionSnapshot): void {
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
  try {
    const now = new Date().toISOString();
    if (snapshot.hadValue) {
      db.prepare(
        `insert into loss_prevention_settings (tenant_id, policy, updated_at)
         values (?, json(?), ?)
         on conflict(tenant_id) do update
         set policy = excluded.policy, updated_at = excluded.updated_at`
      ).run(tenantId, JSON.stringify(snapshot.value), now);
    } else {
      db.prepare('delete from loss_prevention_settings where tenant_id = ?').run(tenantId);
    }
  } finally {
    db.close();
  }
}

function cashierDiscountThreshold(tenantId: string): number | null {
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
  try {
    const row = db
      .prepare(
        `select json_extract(policy, '$.roles.cashier.maxDiscountPercent') as value
         from loss_prevention_settings where tenant_id = ?`
      )
      .get(tenantId) as { value: number | null } | undefined;
    return row?.value ?? null;
  } finally {
    db.close();
  }
}

function findLossPreventionTrigger(args: {
  tenantId: string;
  actorId: string;
  approvalProvided: boolean;
  rule?: 'max_discount' | 'shift_refund_limit';
}): LossPreventionTrigger | null {
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
  try {
    const row = db
      .prepare(
        `select after, metadata
         from audit_logs
         where tenant_id = ?
           and actor_id = ?
           and action = 'loss_prevention.triggered'
           and resource_type = 'loss_prevention_rule'
           and resource_id = ?
           and json_extract(after, '$.approvalProvided') = ?
         order by created_at desc, id desc
         limit 1`
      )
      .get(
        args.tenantId,
        args.actorId,
        args.rule ?? 'max_discount',
        args.approvalProvided ? 1 : 0
      ) as { after: string | null; metadata: string | null } | undefined;
    if (!row) return null;
    return {
      after: row.after ? (JSON.parse(row.after) as Record<string, unknown>) : null,
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
    };
  } finally {
    db.close();
  }
}

function managerRefundPolicy(tenantId: string) {
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
  try {
    return (db
      .prepare(
        `select
           json_extract(policy, '$.version') as version,
           json_extract(policy, '$.roles.manager.shift.refunds.enabled') as enabled,
           json_extract(policy, '$.roles.manager.shift.refunds.maxCount') as maxCount,
           json_extract(policy, '$.roles.manager.shift.refunds.maxAmount') as maxAmount
         from loss_prevention_settings where tenant_id = ?`
      )
      .get(tenantId) ?? null) as {
      version: number;
      enabled: number;
      maxCount: number;
      maxAmount: number;
    } | null;
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
        `select id, status, action, resource_type as resourceType, resource_id as resourceId,
                required_approvals as requiredApprovals,
                json_array_length(approval_evidence) as approvalsCollected
           from manager_approval_requests where reason = ?
           order by requested_at desc, id desc limit 1`
      )
      .get(reason) ?? null) as {
      id: string;
      status: string;
      action: string;
      resourceType: string;
      resourceId: string | null;
      requiredApprovals: number;
      approvalsCollected: number;
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

test('admin policy blocks a cashier discount until exact approval and records evidence (ENG-142a)', async ({
  browser,
}, testInfo) => {
  const scenario = seedSaleScenario(`loss-prevention-${testInfo.parallelIndex}-${Date.now()}`);
  const approvalReason = `Loss prevention threshold ${scenario.product.sku}`;
  const settingsSnapshot = snapshotLossPreventionSettings(scenario.tenantId);
  await configureManagerPin(scenario.manager.id);

  const adminContext = await browser.newContext();
  const cashierContext = await browser.newContext();
  const managerContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const cashierPage = await cashierContext.newPage();
  const managerPage = await managerContext.newPage();
  await adminPage.setViewportSize({ width: 1440, height: 900 });
  await cashierPage.setViewportSize({ width: 1440, height: 900 });
  await managerPage.setViewportSize({ width: 1440, height: 900 });
  const adminTracker = attachClientIssueTracker(adminPage);
  const cashierTracker = attachClientIssueTracker(cashierPage);
  const managerTracker = attachClientIssueTracker(managerPage);

  try {
    await login(adminPage, { ...scenario.admin, defaultPath: '/dashboard' }, { spanish: true });
    await adminPage.goto('/company?tab=controls');
    const policyCard = adminPage.getByTestId('company-loss-prevention-card');
    await expect(policyCard.getByRole('heading', { name: 'Prevención de pérdidas' })).toBeVisible();
    const cashierPolicy = policyCard.getByTestId('loss-prevention-role-cashier');
    await expect(cashierPolicy.getByText('Política para cajeros', { exact: true })).toBeVisible();
    await cashierPolicy.getByLabel('Descuento máximo sin aprobación').fill('5');
    await policyCard.getByRole('button', { name: 'Guardar controles de cobro' }).click();
    await expect.poll(() => cashierDiscountThreshold(scenario.tenantId)).toBe(5);
    await captureEvidence(adminPage, 'eng-142a-admin-controls-desktop-es');
    await adminPage.setViewportSize({ width: 390, height: 844 });
    await expect(policyCard.getByRole('heading', { name: 'Prevención de pérdidas' })).toBeVisible();
    await cashierPolicy.scrollIntoViewIfNeeded();
    await captureEvidence(adminPage, 'eng-142a-admin-controls-mobile-es');

    await login(cashierPage, { ...scenario.cashier, defaultPath: '/sales' });
    await addProductToCartViaKeyboard(cashierPage, scenario.product.sku);
    await cashierPage.getByLabel(`Discount for ${scenario.product.name}`).fill('10');
    await cashierPage.keyboard.press('F1');

    const paymentDialog = cashierPage.getByRole('dialog', { name: /charge sale/i });
    const approvalPanel = paymentDialog.getByTestId('checkout-approval-panel');
    await expect(approvalPanel.getByText('Discounted checkout', { exact: true })).toBeVisible();
    await expect(paymentDialog.getByRole('button', { name: 'Confirm Sale' })).toBeDisabled();
    await approvalPanel.getByLabel('Reason for Discounted checkout').fill(approvalReason);
    await approvalPanel.getByRole('button', { name: 'Request approval' }).click();
    await expect(approvalPanel.getByTestId('checkout-approval-status-sale_discount')).toHaveText(
      'Pending'
    );
    await captureEvidence(cashierPage, 'eng-142a-cashier-policy-blocked-en');

    await login(managerPage, { ...scenario.manager, defaultPath: '/dashboard' }, { spanish: true });
    await openUserMenu(managerPage);
    const queue = managerPage.getByRole('region', { name: 'Aprobaciones' });
    const approvalCard = queue.getByRole('article').filter({ hasText: approvalReason });
    await expect(approvalCard.getByText('Descuento de venta')).toBeVisible();
    await expect(approvalCard.getByText('Solicitud exacta de cobro')).toBeVisible();
    await approvalCard.getByRole('button', { name: 'Aprobar' }).click();
    await approvalCard.getByLabel('Tu PIN de personal').fill(MANAGER_PIN);
    await captureEvidence(managerPage, 'eng-142a-manager-policy-approval-es');
    await approvalCard.getByRole('button', { name: 'Confirmar aprobación' }).click();
    await expect(approvalCard).toBeHidden();

    await expect(approvalPanel.getByTestId('checkout-approval-status-sale_discount')).toHaveText(
      'Approved',
      { timeout: 10_000 }
    );
    await paymentDialog.getByRole('button', { name: 'Confirm Sale' }).click();
    await expect(paymentDialog).toBeHidden({ timeout: 15_000 });
    await expect
      .poll(() => findLatestSaleForProduct(scenario.product.id, scenario.cashier.id))
      .toMatchObject({ status: 'completed', total: 11_250 });

    await expect
      .poll(() =>
        findLossPreventionTrigger({
          tenantId: scenario.tenantId,
          actorId: scenario.cashier.id,
          approvalProvided: true,
        })
      )
      .toMatchObject({
        after: { approvalProvided: true, requiredAction: 'sale_discount' },
        metadata: {
          kind: 'max_discount',
          observedPercent: 10,
          thresholdPercent: 5,
          role: 'cashier',
          siteId: scenario.sites[0]!.id,
        },
      });

    await adminPage.setViewportSize({ width: 1440, height: 900 });
    await adminPage.goto('/audit-logs');
    await adminPage.getByLabel('Acción').selectOption('loss_prevention.triggered');
    const auditTable = adminPage.getByRole('table');
    const triggerCell = auditTable
      .getByRole('cell', { name: 'Regla de prevención de pérdidas activada' })
      .first();
    await expect(triggerCell).toBeVisible();
    await expect(
      auditTable
        .getByRole('cell', {
          name: 'Regla de prevención de pérdidas max_discount',
        })
        .first()
    ).toBeVisible();
    await triggerCell.scrollIntoViewIfNeeded();
    await captureEvidence(adminPage, 'eng-142a-audit-trigger-es');

    await expectNoClientIssues(adminTracker);
    await expectNoClientIssues(cashierTracker);
    await expectNoClientIssues(managerTracker);
  } finally {
    restoreLossPreventionSettings(scenario.tenantId, settingsSnapshot);
    await adminContext.close();
    await cashierContext.close();
    await managerContext.close();
  }
});

test('high-value cashier discount requires two distinct approvers (ENG-142c)', async ({
  browser,
}, testInfo) => {
  const scenario = seedSaleScenario(`dual-approval-${testInfo.parallelIndex}-${Date.now()}`);
  const approvalReason = `Dual approval threshold ${scenario.product.sku}`;
  const settingsSnapshot = snapshotLossPreventionSettings(scenario.tenantId);
  await configureManagerPin(scenario.manager.id);
  await configureManagerPin(scenario.admin.id);

  const adminContext = await browser.newContext();
  const cashierContext = await browser.newContext();
  const managerContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const cashierPage = await cashierContext.newPage();
  const managerPage = await managerContext.newPage();
  await adminPage.setViewportSize({ width: 1440, height: 900 });
  await cashierPage.setViewportSize({ width: 1440, height: 900 });
  await managerPage.setViewportSize({ width: 1440, height: 900 });
  const adminTracker = attachClientIssueTracker(adminPage);
  const cashierTracker = attachClientIssueTracker(cashierPage);
  const managerTracker = attachClientIssueTracker(managerPage);

  try {
    await login(adminPage, { ...scenario.admin, defaultPath: '/dashboard' }, { spanish: true });
    await adminPage.goto('/company?tab=controls');
    const policyCard = adminPage.getByTestId('company-loss-prevention-card');
    const cashierPolicy = policyCard.getByTestId('loss-prevention-role-cashier');
    await cashierPolicy.getByLabel('Descuento máximo sin aprobación').fill('50');
    await cashierPolicy.locator('#loss-prevention-cashier-dual-approval-enabled').check();
    await cashierPolicy.locator('#loss-prevention-cashier-dual-approval-threshold').fill('1000');
    await policyCard.getByRole('button', { name: 'Guardar controles de cobro' }).click();
    await expect
      .poll(() => {
        const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
        try {
          return db
            .prepare(
              `select
                 json_extract(policy, '$.version') as version,
                 json_extract(policy, '$.roles.cashier.maxDiscountPercent') as maxDiscount,
                 json_extract(policy, '$.roles.cashier.dualApproval.enabled') as enabled,
                 json_extract(policy, '$.roles.cashier.dualApproval.thresholdAmount') as threshold
               from loss_prevention_settings where tenant_id = ?`
            )
            .get(scenario.tenantId);
        } finally {
          db.close();
        }
      })
      .toEqual({ version: 3, maxDiscount: 50, enabled: 1, threshold: 1000 });
    await cashierPolicy
      .getByText('Requerir dos aprobaciones por encima de un monto')
      .scrollIntoViewIfNeeded();
    await captureEvidence(adminPage, 'eng-142c-admin-dual-threshold-desktop-es');

    await login(cashierPage, { ...scenario.cashier, defaultPath: '/sales' });
    await addProductToCartViaKeyboard(cashierPage, scenario.product.sku);
    await cashierPage.getByLabel(`Discount for ${scenario.product.name}`).fill('10');
    await cashierPage.keyboard.press('F1');
    const paymentDialog = cashierPage.getByRole('dialog', { name: /charge sale/i });
    const approvalPanel = paymentDialog.getByTestId('checkout-approval-panel');
    await approvalPanel.getByLabel('Reason for Discounted checkout').fill(approvalReason);
    await approvalPanel.getByRole('button', { name: 'Request approval' }).click();
    await expect(approvalPanel.getByTestId('checkout-approval-status-sale_discount')).toHaveText(
      'Pending'
    );
    await expect(approvalPanel.getByText('0 of 2 distinct approvals received')).toBeVisible();
    await expect(paymentDialog.getByRole('button', { name: 'Confirm Sale' })).toBeDisabled();

    await login(managerPage, { ...scenario.manager, defaultPath: '/dashboard' }, { spanish: true });
    await openUserMenu(managerPage);
    const managerQueue = managerPage.getByRole('region', { name: 'Aprobaciones' });
    const managerCard = managerQueue.getByRole('article').filter({ hasText: approvalReason });
    await expect(managerCard.getByText('0 de 2 aprobaciones recibidas')).toBeVisible();
    await managerCard.getByRole('button', { name: 'Aprobar' }).click();
    await managerCard.getByLabel('Tu PIN de personal').fill(MANAGER_PIN);
    await captureEvidence(managerPage, 'eng-142c-manager-first-approval-es');
    await managerCard.getByRole('button', { name: 'Confirmar aprobación' }).click();
    await expect(managerCard).toBeHidden();

    await expect(approvalPanel.getByText('1 of 2 distinct approvals received')).toBeVisible({
      timeout: 10_000,
    });
    await expect(paymentDialog.getByRole('button', { name: 'Confirm Sale' })).toBeDisabled();
    await captureEvidence(cashierPage, 'eng-142c-cashier-awaiting-second-en');

    await openUserMenu(adminPage);
    const adminQueue = adminPage.getByRole('region', { name: 'Aprobaciones' });
    const adminCard = adminQueue.getByRole('article').filter({ hasText: approvalReason });
    await expect(adminCard.getByText('1 de 2 aprobaciones recibidas')).toBeVisible();
    await adminPage
      .getByRole('heading', { name: 'Prevención de pérdidas' })
      .scrollIntoViewIfNeeded();
    await captureEvidence(adminPage, 'eng-142c-admin-awaiting-second-es');
    await adminCard.getByRole('button', { name: 'Aprobar' }).click();
    await adminCard.getByLabel('Tu PIN de personal').fill(MANAGER_PIN);
    const adminConfirm = adminCard.getByRole('button', { name: 'Confirmar aprobación' });
    await adminConfirm.scrollIntoViewIfNeeded();
    await captureEvidence(adminPage, 'eng-142c-admin-second-approval-es');
    await adminConfirm.click();
    await expect(adminCard).toBeHidden();

    await expect(approvalPanel.getByTestId('checkout-approval-status-sale_discount')).toHaveText(
      'Approved',
      { timeout: 10_000 }
    );
    await captureEvidence(cashierPage, 'eng-142c-cashier-dual-approved-en');
    await paymentDialog.getByRole('button', { name: 'Confirm Sale' }).click();
    await expect(paymentDialog).toBeHidden({ timeout: 15_000 });
    await expect
      .poll(() => findApprovalByReason(approvalReason))
      .toMatchObject({
        status: 'consumed',
        action: 'sale_discount',
        requiredApprovals: 2,
        approvalsCollected: 2,
      });

    await expectNoClientIssues(adminTracker);
    await expectNoClientIssues(cashierTracker);
    await expectNoClientIssues(managerTracker);
  } finally {
    restoreLossPreventionSettings(scenario.tenantId, settingsSnapshot);
    await adminContext.close();
    await cashierContext.close();
    await managerContext.close();
  }
});

test('manager shift refund cap requires and consumes an exact approval (ENG-142b)', async ({
  browser,
}, testInfo) => {
  const scenario = seedSaleScenario(`shift-refund-${testInfo.parallelIndex}-${Date.now()}`);
  const approvalReason = `Manager shift refund ${scenario.product.sku}`;
  const settingsSnapshot = snapshotLossPreventionSettings(scenario.tenantId);
  await configureManagerPin(scenario.admin.id);

  const adminContext = await browser.newContext();
  const managerContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const managerPage = await managerContext.newPage();
  await adminPage.setViewportSize({ width: 1440, height: 900 });
  await managerPage.setViewportSize({ width: 1440, height: 900 });
  const adminTracker = attachClientIssueTracker(adminPage);
  const managerTracker = attachClientIssueTracker(managerPage);

  try {
    await login(adminPage, { ...scenario.admin, defaultPath: '/dashboard' }, { spanish: true });
    await adminPage.goto('/company?tab=controls');
    const policyCard = adminPage.getByTestId('company-loss-prevention-card');
    const managerPolicy = policyCard.getByTestId('loss-prevention-role-manager');
    await expect(managerPolicy.getByText('Política para gerentes', { exact: true })).toBeVisible();
    await managerPolicy.locator('#loss-prevention-manager-refunds-enabled').check();
    await managerPolicy.locator('#loss-prevention-manager-refunds-count').fill('0');
    await managerPolicy.locator('#loss-prevention-manager-refunds-amount').fill('1000000');
    await policyCard.getByRole('button', { name: 'Guardar controles de cobro' }).click();
    await expect
      .poll(() => managerRefundPolicy(scenario.tenantId))
      .toEqual({
        version: 3,
        enabled: 1,
        maxCount: 0,
        maxAmount: 1_000_000,
      });
    await managerPolicy.getByText('Límites de acciones por turno').scrollIntoViewIfNeeded();
    await captureEvidence(adminPage, 'eng-142b-admin-shift-controls-desktop-es');
    await adminPage.setViewportSize({ width: 390, height: 844 });
    await managerPolicy.getByText('Limitar reembolsos por turno').scrollIntoViewIfNeeded();
    await captureEvidence(adminPage, 'eng-142b-admin-shift-controls-mobile-es');

    await login(managerPage, { ...scenario.manager, defaultPath: '/dashboard' });
    await managerPage.goto('/sales');
    await expect(managerPage).toHaveURL(/\/sales$/);
    await addProductToCartViaKeyboard(managerPage, scenario.product.sku);
    await managerPage.keyboard.press('F2');
    const paymentDialog = managerPage.getByRole('dialog', { name: /charge sale/i });
    await paymentDialog.getByRole('button', { name: 'Confirm Sale' }).click();
    await expect(paymentDialog).toBeHidden({ timeout: 15_000 });
    await expect
      .poll(() => findLatestSaleForProduct(scenario.product.id, scenario.manager.id))
      .not.toBeNull();
    const sale = findLatestSaleForProduct(scenario.product.id, scenario.manager.id);
    if (!sale) throw new Error('Expected completed manager sale for shift refund cap');

    await managerPage.getByTestId('sales-open-history').click();
    const historyDrawer = managerPage.getByTestId('sales-history-drawer');
    await historyDrawer.getByRole('button', { name: `View ${sale.saleNumber}` }).click();
    const detailsDialog = managerPage.getByRole('dialog', { name: `Sale ${sale.saleNumber}` });
    await detailsDialog.getByRole('button', { name: 'Refund Sale' }).click();
    const refundDialog = managerPage.getByRole('dialog', { name: 'Return sale' });
    const approvalPanel = refundDialog.getByTestId('checkout-approval-panel');
    await expect(approvalPanel.getByText('Refund sale', { exact: true })).toBeVisible();
    await expect(refundDialog.getByRole('button', { name: 'Confirm return' })).toBeDisabled();
    await approvalPanel.getByLabel('Reason for Refund sale').fill(approvalReason);
    await approvalPanel.getByRole('button', { name: 'Request approval' }).click();
    await expect(approvalPanel.getByTestId('checkout-approval-status-sale_refund')).toHaveText(
      'Pending'
    );
    await captureEvidence(managerPage, 'eng-142b-manager-refund-blocked-en');

    await adminPage.setViewportSize({ width: 1440, height: 900 });
    await openUserMenu(adminPage);
    const queue = adminPage.getByRole('region', { name: 'Aprobaciones' });
    const approvalCard = queue.getByRole('article').filter({ hasText: approvalReason });
    await expect(approvalCard.getByText('Reembolso de venta')).toBeVisible();
    await approvalCard.getByRole('button', { name: 'Aprobar' }).click();
    await approvalCard.getByLabel('Tu PIN de personal').fill(MANAGER_PIN);
    await captureEvidence(adminPage, 'eng-142b-admin-refund-approval-es');
    await approvalCard.getByRole('button', { name: 'Confirmar aprobación' }).click();
    await expect(approvalCard).toBeHidden();

    await expect(approvalPanel.getByTestId('checkout-approval-status-sale_refund')).toHaveText(
      'Approved',
      { timeout: 10_000 }
    );
    await captureEvidence(managerPage, 'eng-142b-manager-refund-approved-en');
    await refundDialog.getByRole('button', { name: 'Confirm return' }).click();
    await expect(refundDialog).toBeHidden({ timeout: 15_000 });
    await expect
      .poll(() => findLatestSaleForProduct(scenario.product.id, scenario.manager.id))
      .toMatchObject({ paymentStatus: 'refunded' });
    await expect
      .poll(() => findApprovalByReason(approvalReason))
      .toMatchObject({
        status: 'consumed',
        action: 'sale_refund',
        resourceType: 'sale',
        resourceId: sale.id,
      });
    await expect
      .poll(() =>
        findLossPreventionTrigger({
          tenantId: scenario.tenantId,
          actorId: scenario.manager.id,
          approvalProvided: true,
          rule: 'shift_refund_limit',
        })
      )
      .toMatchObject({
        after: { approvalProvided: true, requiredAction: 'sale_refund' },
        metadata: {
          actionResourceId: sale.id,
          role: 'manager',
          reason: 'limit_exceeded',
          exceeded: ['count'],
          currentCount: 0,
          prospectiveCount: 1,
          maxCount: 0,
        },
      });

    await expectNoClientIssues(adminTracker);
    await expectNoClientIssues(managerTracker);
  } finally {
    restoreLossPreventionSettings(scenario.tenantId, settingsSnapshot);
    await adminContext.close();
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
