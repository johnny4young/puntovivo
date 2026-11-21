import { expect, test } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login } from './support/app';
import { getTillPaymentEvidence, seedCustomerAccountScenario } from './support/db';

test.describe('Register store credit', () => {
  test('shows the customer debt, projects Fiar and takes an abono into the drawer', async ({
    page,
  }, info) => {
    const scenario = seedCustomerAccountScenario(`fiado-${info.parallelIndex}-${Date.now()}`);
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page, {
      email: scenario.cashier.email,
      password: scenario.cashier.password,
      defaultPath: '/sales',
    });

    const bar = page.locator('#sales-product-search-input');
    await bar.fill(`@${scenario.customer.name}`);
    const option = page.getByRole('option', { name: new RegExp(scenario.customer.name) });
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.click();

    const owed = page.getByTestId('customer-account-owed');
    await expect(owed).toHaveText(/owes \D*84[.,]300 of \D*150[.,]000/);
    await expect(page.getByTestId('checkout-credit')).toBeDisabled();
    await expect(page.getByTestId('sales-tender-credit')).toHaveCount(0);

    await bar.fill(scenario.product.sku);
    await bar.press('Enter');
    const productDialog = page.getByRole('dialog', { name: /add product/i });
    await productDialog.getByTestId(`product-search-row-${scenario.product.sku}`).click();
    await productDialog.getByRole('button', { name: /add to cart/i }).click();
    await expect(page.getByTestId(`sale-cart-item-${scenario.product.sku}`)).toBeVisible();
    await expect(page.getByTestId('checkout-credit')).toBeEnabled();
    await expect(page.getByTestId('checkout-credit-projection')).toHaveText(/would owe \D*\d/);

    await page.getByTestId('customer-account-pay').click();
    const abono = page.getByRole('dialog', { name: `Payment from ${scenario.customer.name}` });
    await abono.getByTestId('customer-ledger-amount-input').fill('30000');
    await abono.getByRole('button', { name: 'Take payment' }).click();
    await expect(abono).toBeHidden();
    await expect(owed).toHaveText(/owes \D*54[.,]300 of/);

    expect(
      getTillPaymentEvidence(scenario.tenantId, scenario.cashSessionId, scenario.customer.id)
    ).toEqual({ movementAmount: 30_000, ledgerAmount: -30_000, balance: 54_300 });
    await expectNoClientIssues(tracker);
  });
});
