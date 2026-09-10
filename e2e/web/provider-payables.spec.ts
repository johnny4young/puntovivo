import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  attachClientIssueTracker,
  expectNoClientIssues,
  expectSuccessToast,
  login,
} from './support/app';
import { runAxeOnPage } from './support/a11y';
import {
  getProviderPayableTotals,
  seedProviderPayableScenario,
  setProviderActive,
} from './support/db';

function formatCop(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

async function captureEvidence(page: Page, name: string) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  await page.screenshot({
    path: path.join(auditDir, `${name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}

async function openSupplierAccount(page: Page, providerName: string) {
  await page.goto('/provider-payables');
  await page.getByPlaceholder('Search providers...').fill(providerName);
  const row = page.locator('tr', { hasText: providerName }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Open account' }).click();
  const dialog = page.getByRole('dialog', { name: `Supplier account · ${providerName}` });
  await expect(dialog.getByTestId('provider-payables-overview')).toBeVisible({ timeout: 15_000 });
  return dialog;
}

test.describe('web supplier payables', () => {
  test('manager explicitly registers and settles a supplier account from the UI', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedProviderPayableScenario(
      `provider-payables-${testInfo.parallelIndex}-${Date.now()}`
    );

    await login(page, {
      email: scenario.manager.email,
      password: scenario.manager.password,
      defaultPath: '/dashboard',
    });

    const dialog = await openSupplierAccount(page, scenario.provider.name);
    await runAxeOnPage(page);
    await expect(dialog.getByText('Completed purchases without supplier invoice')).toBeVisible();
    expect(getProviderPayableTotals(scenario.provider.id)).toEqual({
      invoices: 0,
      payments: 0,
      credits: 0,
      allocations: 0,
      balance: 0,
    });

    const invoiceNumber = `FAC-E2E-${Date.now()}`;
    await dialog.getByRole('button', { name: 'Register invoice' }).click();
    await dialog.getByLabel('Completed purchase').selectOption(scenario.purchase.id);
    await expect(dialog.getByLabel('Amount')).toHaveValue(String(scenario.purchase.total));
    await dialog.getByLabel('Supplier document number').fill(invoiceNumber);
    await dialog.getByRole('button', { name: 'Save invoice' }).click();
    await expect(dialog.getByTestId('provider-payable-form')).toHaveCount(0);
    await expectSuccessToast(page, 'Supplier invoice registered');
    await expect(dialog.getByText(invoiceNumber, { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText('Completed purchases without supplier invoice')).toHaveCount(0);
    await captureEvidence(page, 'pr3-provider-invoice-aging');

    await dialog.getByRole('button', { name: 'Opening balance' }).click();
    await dialog.getByLabel('Amount').fill('75');
    await dialog.getByLabel('Required opening-balance note').fill('Signed opening statement');
    await dialog.getByRole('button', { name: 'Save opening balance' }).click();
    await expect(dialog.getByTestId('provider-payable-form')).toHaveCount(0);
    await expectSuccessToast(page, 'Opening balance registered');

    const creditNumber = `NC-E2E-${Date.now()}`;
    await dialog.getByRole('button', { name: 'Supplier credit' }).click();
    await dialog.getByLabel('Supplier document number').fill(creditNumber);
    await dialog.getByLabel('Amount').fill('25');
    await dialog.getByLabel('Reason').fill('Authorized supplier allowance');
    await dialog.getByRole('button', { name: 'Save credit' }).click();
    await expect(dialog.getByTestId('provider-payable-form')).toHaveCount(0);
    await expectSuccessToast(page, 'Supplier credit registered');

    await dialog.getByRole('button', { name: 'Record payment' }).click();
    await dialog.getByLabel('Amount').fill('12550');
    await dialog.getByLabel('Reference').fill('BANK-E2E-001');
    await dialog.getByRole('button', { name: 'Save payment' }).click();
    await expect(dialog.getByTestId('provider-payable-form')).toHaveCount(0);
    await expectSuccessToast(page, 'Supplier payment registered');

    const balanceCard = dialog.locator('.card-inset').filter({ hasText: 'Outstanding' });
    await expect(balanceCard).toContainText(formatCop(0));
    await expect(dialog.getByText('Paid', { exact: true })).toHaveCount(2);
    await expect(dialog.getByText(creditNumber, { exact: true })).toBeVisible();
    await expect(dialog.getByText('BANK-E2E-001', { exact: true })).toBeVisible();
    await captureEvidence(page, 'pr3-provider-account-settled');

    expect(getProviderPayableTotals(scenario.provider.id)).toEqual({
      invoices: 12_575,
      payments: 12_550,
      credits: 25,
      allocations: 12_575,
      balance: 0,
    });

    await dialog.getByRole('button', { name: 'Close modal', exact: true }).click();
    setProviderActive(scenario.tenantId, scenario.provider.id, false);
    await page.reload();
    const reloaded = await openSupplierAccount(page, scenario.provider.name);
    await expect(page.locator('tr', { hasText: scenario.provider.name }).first()).toContainText(
      'Inactive'
    );
    await expect(reloaded.getByText(invoiceNumber, { exact: true }).first()).toBeVisible();
    await expect(reloaded.locator('.card-inset').filter({ hasText: 'Outstanding' })).toContainText(
      formatCop(0)
    );
    await expectNoClientIssues(tracker);
  });
});
