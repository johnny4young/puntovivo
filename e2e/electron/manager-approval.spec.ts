/**
 * The `manager-approval` operator journey, run against the desktop app.
 *
 * An admin provisions the manager's one-way staff PIN, a cashier requests an
 * approval bound to one exact discounted checkout, and the manager approves it
 * inline at the blocked register. The cashier's authenticated session and exact
 * cart remain mounted while the server records the manager as decision actor.
 * A second identical checkout must remain blocked, and the audit trail must
 * correlate requester, approver, and consumer by one immutable request id.
 *
 * @module e2e/electron/manager-approval
 */

import type { Locator, Page } from '@playwright/test';
import { electronTest as test, expect } from './fixtures.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { E2E_USERS, type E2EUserProfile } from '../shared/baseline.js';
import {
  addProductToCart,
  createProduct,
  dismissVisibleToasts,
  goToRoute,
  openCashSession,
  pinPrimarySite,
  signIn,
  signOut,
} from './support/journey.js';

const PRODUCT_NAME = 'E2E Approval Product';
const PRODUCT_SKU = 'E2E-APPROVAL';
const MANAGER_PIN = '975310';
const APPROVAL_REASON = 'Documented price match for desktop approval';

function baselineUser(role: E2EUserProfile['role']): E2EUserProfile {
  const user = E2E_USERS.find(candidate => candidate.role === role);
  if (!user) throw new Error(`baseline did not seed a ${role}`);
  return user;
}

async function configureManagerPin(page: Page, manager: E2EUserProfile): Promise<void> {
  await goToRoute(page, '/users');
  const row = page.locator('tbody tr').filter({ hasText: manager.name }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole('button', { name: `Manage staff PIN for ${manager.name}` }).click();

  const dialog = page.getByRole('dialog', { name: 'Manage staff PIN' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#staff-pin').fill(MANAGER_PIN);
  await dialog.getByRole('button', { name: 'Save PIN' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(row).toContainText('Configured');
}

async function openDiscountedCheckout(page: Page): Promise<{
  payment: Locator;
  approval: Locator;
}> {
  await addProductToCart(page, PRODUCT_SKU);
  await page.getByLabel(`Discount for ${PRODUCT_NAME}`).fill('10');
  await page.keyboard.press('F1');

  const payment = page.getByRole('dialog', { name: /charge sale|cobrar venta/i });
  await expect(payment).toBeVisible({ timeout: 15_000 });
  const approval = payment.getByTestId('checkout-approval-panel');
  await expect(approval.getByText('Discounted checkout', { exact: true })).toBeVisible();
  return { payment, approval };
}

async function requestApproval(page: Page): Promise<{
  payment: Locator;
  approval: Locator;
}> {
  const { payment, approval } = await openDiscountedCheckout(page);
  await expect(payment.locator('#sale-payment-confirm')).toBeDisabled();
  await approval.getByLabel('Reason for Discounted checkout').fill(APPROVAL_REASON);
  await approval.getByRole('button', { name: 'Request approval' }).click();
  await expect(approval.getByTestId('checkout-approval-status-sale_discount')).toHaveText(
    'Pending'
  );
  return { payment, approval };
}

async function approveAndConsumeAtRegister(
  checkout: { payment: Locator; approval: Locator },
  manager: E2EUserProfile
): Promise<void> {
  const inlineDecision = checkout.approval.getByTestId('inline-approval-sale_discount');
  await expect(inlineDecision).toBeVisible();
  const responsible = inlineDecision.getByLabel('Responsible person');
  await expect(responsible).toContainText(manager.name);
  await expect(responsible).not.toHaveValue('');
  await inlineDecision.getByLabel('Their staff PIN').fill(MANAGER_PIN);
  await inlineDecision.getByRole('button', { name: 'Approve checkout' }).click();
  await expect(checkout.approval.getByTestId('checkout-approval-status-sale_discount')).toHaveText(
    'Approved',
    { timeout: 15_000 }
  );
  await expect(checkout.payment).toBeVisible();
  await expect(checkout.payment.locator('#sale-payment-confirm')).toBeEnabled();
  await checkout.payment.locator('#sale-payment-confirm').click();
  await expect(checkout.payment).toBeHidden({ timeout: 15_000 });
}

async function proveConsumedApprovalCannotBeReused(page: Page): Promise<void> {
  await dismissVisibleToasts(page);
  const nextCheckout = await openDiscountedCheckout(page);
  const approvalStatus = nextCheckout.approval.getByTestId(
    'checkout-approval-status-sale_discount'
  );
  // Consumption rebinds the request to the completed sale id. The same
  // checkout hash therefore has no reusable grant and returns to the explicit
  // request state rather than exposing the consumed row as usable authority.
  await expect(approvalStatus).toHaveText('Not requested', { timeout: 15_000 });
  await expect(nextCheckout.payment.locator('#sale-payment-confirm')).toBeDisabled();
  await expect(
    nextCheckout.approval.getByRole('button', { name: 'Request approval' })
  ).toBeVisible();
  // Finish the rejected second checkout before using the shell's logout.
  // The old synthetic session reset hid this still-open payment dialog.
  await page.keyboard.press('Escape');
  await expect(nextCheckout.payment).toBeHidden();
}

async function selectAuditAction(page: Page, action: string): Promise<void> {
  await page.getByLabel(/action/i).selectOption(action);
}

async function approvalRequestId(page: Page, cashier: E2EUserProfile): Promise<string> {
  await selectAuditAction(page, 'manager_approval.request');
  const row = page.locator('tbody tr').filter({ hasText: cashier.name }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText('Manager approval requested');
  const requestId = (await row.locator('td').nth(3).locator('.font-mono').innerText()).trim();
  expect(requestId, 'approval request audit exposes its immutable resource id').not.toBe('');
  return requestId;
}

async function expectApprovalAudit(
  page: Page,
  options: {
    action: 'manager_approval.approve' | 'manager_approval.consume';
    actor: E2EUserProfile;
    requestId: string;
  }
): Promise<void> {
  await selectAuditAction(page, options.action);
  const row = page
    .locator('tbody tr')
    .filter({ hasText: options.requestId })
    .filter({ hasText: options.actor.name })
    .first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(
    options.action === 'manager_approval.approve'
      ? 'Manager approval granted'
      : 'Manager approval consumed'
  );
}

test.describe('manager approval on the desktop app', () => {
  test('binds a discounted checkout to fresh manager authority and one audit trail', async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    const admin = baselineUser('admin');
    const manager = baselineUser('manager');
    const cashier = baselineUser('cashier');

    await signIn(page, admin.email);
    await pinPrimarySite(page);
    await configureManagerPin(page, manager);
    await goToRoute(page, '/products');
    await createProduct(page, {
      name: PRODUCT_NAME,
      sku: PRODUCT_SKU,
      stock: '3',
      price: '12500',
    });

    await signOut(page);
    await signIn(page, cashier.email);
    await pinPrimarySite(page);
    await goToRoute(page, '/sales');
    await openCashSession(page, 'E2E Approval Register');
    await dismissVisibleToasts(page);
    const checkout = await requestApproval(page);
    await approveAndConsumeAtRegister(checkout, manager);
    await expect(page.getByTestId(`sale-cart-item-${PRODUCT_SKU}`)).toBeHidden();
    await proveConsumedApprovalCannotBeReused(page);

    await signOut(page);
    await signIn(page, admin.email);
    await goToRoute(page, '/audit-logs');
    const requestId = await approvalRequestId(page, cashier);
    await expectApprovalAudit(page, {
      action: 'manager_approval.approve',
      actor: manager,
      requestId,
    });
    await expectApprovalAudit(page, {
      action: 'manager_approval.consume',
      actor: cashier,
      requestId,
    });

    await page.reload();
    await expect(
      page.getByRole('button', { name: `Open user menu for ${admin.name}` })
    ).toBeVisible({ timeout: 30_000 });
    await goToRoute(page, '/audit-logs');
    await expectApprovalAudit(page, {
      action: 'manager_approval.consume',
      actor: cashier,
      requestId,
    });

    await expectNoClientIssues(tracker);
  });
});
