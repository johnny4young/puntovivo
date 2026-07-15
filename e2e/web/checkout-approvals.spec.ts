import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
import { hashStaffPin } from '../../packages/server/src/security/staffPins.js';
import { attachClientIssueTracker, expectNoClientIssues, login, openUserMenu } from './support/app';
import { findLatestSaleForProduct, seedSaleScenario } from './support/db';
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
    await expect(approvalPanel.getByText('Discounted checkout')).toBeVisible();
    await approvalPanel.getByLabel('Reason').fill(approvalReason);
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
