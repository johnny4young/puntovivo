import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  expectSuccessToast,
  login,
} from './support/app';
import {
  findLatestSaleForProduct,
  getCustomerValueEvidence,
  getSalePaymentEvidence,
  getSalePromotionEvidence,
  getSaleReturnPaymentEvidence,
  seedPromotionCustomerValueScenario,
} from './support/db';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function captureAuditScreenshot(page: Page, name: string, locator?: Locator) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  const screenshotPath = path.join(auditDir, `${name}.png`);
  if (locator) {
    await locator.screenshot({ path: screenshotPath, animations: 'disabled' });
    return;
  }
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
}

async function configureCustomerValue(page: Page) {
  await page.goto('/company?tab=general');

  const enabled = page.getByTestId('loyalty-enabled-toggle');
  await expect(enabled).toBeVisible({ timeout: 15_000 });
  if (!(await enabled.isChecked())) {
    await enabled.click();
    await expect(enabled).toBeChecked();
  }
  await expect(enabled).toBeEnabled();

  // One point earned per COP 2,500 makes the post-sale balance easy to
  // reconcile without relying on a renderer-side calculation.
  const rate = page.getByTestId('loyalty-rate-input');
  await rate.fill('2500');
  const saveRate = page.getByTestId('loyalty-save-rate');
  if (await saveRate.isEnabled()) {
    await saveRate.click();
    await expect(saveRate).toBeDisabled();
  }

  const redemptionEnabled = page.getByTestId('loyalty-redemption-toggle');
  await expect(redemptionEnabled).toBeEnabled();
  if (!(await redemptionEnabled.isChecked())) {
    await redemptionEnabled.click();
    await expect(redemptionEnabled).toBeChecked();
  }
  await expect(redemptionEnabled).toBeEnabled();

  const redemptionValue = page.getByTestId('loyalty-redemption-value-input');
  await redemptionValue.fill('1250');
  const saveValue = page.getByTestId('loyalty-save-redemption-value');
  if (await saveValue.isEnabled()) {
    await saveValue.click();
    await expect(saveValue).toBeDisabled();
  }
}

async function createAndActivatePromotion(
  page: Page,
  input: {
    name: string;
    productName: string;
    productSku: string;
    customerName: string;
    siteId: string;
  }
) {
  await page.goto('/promotions');
  await page.getByRole('button', { name: 'Create promotion' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create promotion draft' });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Promotion name').fill(input.name);
  await dialog.getByLabel('Discount percentage').fill('20');
  await dialog.getByLabel('Site').selectOption(input.siteId);
  await dialog.getByLabel('Product scope').selectOption('product');
  await dialog.getByPlaceholder('Search by product name or code').fill(input.productSku);
  await dialog.getByRole('button', { name: new RegExp(escapeRegExp(input.productSku)) }).click();
  await dialog
    .getByPlaceholder('Leave empty for all customers or search for one')
    .fill(input.customerName);
  await dialog.getByRole('button', { name: input.customerName, exact: true }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expectSuccessToast(page, 'Promotion draft created');

  const card = page.locator('article').filter({ hasText: input.name });
  await expect(card).toContainText('Draft');
  await card.getByRole('button', { name: 'Activate' }).click();
  await expect(card).toContainText('Active');
  await expect(card).toContainText(input.productName);
  await expect(card).toContainText(input.customerName);
  return card;
}

async function addProductToCart(page: Page, product: { name: string; sku: string }) {
  await page.goto('/sales');
  const search = page.locator('#sales-product-search-input');
  await search.fill(product.sku);
  await search.press('Enter');

  const productRow = page.locator('tr', { has: page.getByText(product.sku) }).first();
  await expect(productRow).toBeVisible();
  await productRow.click();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByTestId(`sale-cart-item-${product.sku}`)).toBeVisible();
}

async function openSaleDetails(page: Page, saleNumber: string, language: 'en' | 'es') {
  await page.getByTestId('sales-open-history').click();
  const history = page.getByTestId('sales-history-drawer');
  await expect(history).toBeVisible();
  await history
    .getByPlaceholder(language === 'es' ? 'Buscar por factura...' : 'Search by invoice...')
    .fill(saleNumber);
  await history
    .getByRole('button', {
      name: `${language === 'es' ? 'Ver' : 'View'} ${saleNumber}`,
    })
    .click();
  const details = page.getByRole('dialog', {
    name: `${language === 'es' ? 'Venta' : 'Sale'} ${saleNumber}`,
  });
  await expect(details).toBeVisible();
  return details;
}

test.describe('retail promotions and customer value', () => {
  test('admin configures, applies and reloads one promotion with points and store credit', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const scenario = seedPromotionCustomerValueScenario(
      `promotion-customer-value-${testInfo.parallelIndex}-${Date.now()}`
    );
    const tracker = attachClientIssueTracker(page);
    const promotionName = `E2E saver ${scenario.product.sku}`;

    await login(page, { ...scenario.admin, defaultPath: '/dashboard' });
    await configureCustomerValue(page);
    const promotionCard = await createAndActivatePromotion(page, {
      name: promotionName,
      productName: scenario.product.name,
      productSku: scenario.product.sku,
      customerName: scenario.customer.name,
      siteId: scenario.sites[0]!.id,
    });
    await captureAuditScreenshot(page, 'promotion-active', promotionCard);

    await addProductToCart(page, scenario.product);
    await page.getByRole('button', { name: 'Charge sale' }).first().click();
    const payment = page.getByTestId('sale-payment-drawer');
    await expect(payment).toBeVisible();
    await payment.locator('#sale-payment-customer').selectOption(scenario.customer.id);
    await expect(payment.getByTestId('customer-loyalty-chip')).toContainText(
      `${scenario.initialPoints} points`
    );
    await expect(payment.getByTestId('customer-store-credit-chip')).toBeVisible();

    const promotionSummary = payment.getByTestId('promotion-summary');
    await expect(promotionSummary).toContainText(promotionName);
    await expect(promotionSummary).toContainText('Promotions save');

    await payment.getByRole('button', { name: 'Split payment across tenders' }).click();
    await expect(payment.getByText('Split payment', { exact: true })).toBeVisible();

    const firstMethod = payment.getByRole('combobox', { name: 'Method for tender 1' });
    await firstMethod.selectOption('loyalty');
    await payment.getByRole('spinbutton', { name: 'Points for tender 1' }).fill('2');
    await expect(payment.getByRole('spinbutton', { name: 'Amount for tender 1' })).toHaveValue(
      '2500'
    );

    await payment.getByRole('button', { name: 'Add payment method' }).click();
    const secondMethod = payment.getByRole('combobox', { name: 'Method for tender 2' });
    await secondMethod.selectOption('store_credit');
    await expect(payment.getByRole('spinbutton', { name: 'Amount for tender 2' })).toHaveValue(
      '2500'
    );

    await payment.getByRole('button', { name: 'Add payment method' }).click();
    await expect(payment.getByRole('combobox', { name: 'Method for tender 3' })).toHaveValue(
      'card'
    );
    await expect(payment.getByRole('spinbutton', { name: 'Amount for tender 3' })).toHaveValue(
      '5000'
    );
    await expect(payment.getByText(`${scenario.initialPoints} points available`)).toBeVisible();
    await captureAuditScreenshot(page, 'checkout-customer-value', payment);

    const confirm = payment.getByRole('button', { name: 'Confirm Sale' });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(payment).toBeHidden({ timeout: 15_000 });
    await expectSuccessToast(page, 'Sale completed');

    await expect
      .poll(() => findLatestSaleForProduct(scenario.product.id, scenario.admin.id), {
        timeout: 15_000,
      })
      .not.toBeNull();
    const sale = findLatestSaleForProduct(scenario.product.id, scenario.admin.id);
    expect(sale).not.toBeNull();
    expect(sale?.total).toBe(10_000);

    expect(getSalePromotionEvidence(scenario.tenantId, sale!.id)).toEqual([
      { name: promotionName, discountPct: 20, discountAmount: 2_500 },
    ]);
    const payments = getSalePaymentEvidence(scenario.tenantId, sale!.id);
    expect(payments).toHaveLength(3);
    expect(payments).toEqual(
      expect.arrayContaining([
        { method: 'loyalty', amount: 2_500, loyaltyPoints: 2 },
        { method: 'store_credit', amount: scenario.initialStoreCredit, loyaltyPoints: null },
        { method: 'card', amount: 5_000, loyaltyPoints: null },
      ])
    );
    // Earning excludes the COP 2,500 paid with points: opening 6 - redeemed
    // 2 + floor(7,500 / 2,500) earned = 7. Store credit remains eligible.
    expect(getCustomerValueEvidence(scenario.tenantId, scenario.customer.id)).toEqual({
      points: 7,
      pointsLedger: 7,
      storeCredit: 0,
      storeCreditLedger: 0,
    });

    // The read side must survive a renderer reload and preserve the frozen
    // promotion/payment evidence independently of the active rule.
    await page.reload();
    const englishDetails = await openSaleDetails(page, sale!.saleNumber, 'en');
    await expect(englishDetails).toContainText(`${promotionName} · saved`);
    await expect(englishDetails.getByText('Loyalty points', { exact: true })).toBeVisible();
    await expect(englishDetails.getByText('Store credit', { exact: true })).toBeVisible();
    await expect(englishDetails.getByText('2 points', { exact: true })).toBeVisible();

    await ensureLanguage(page, 'es');
    const spanishDetails = await openSaleDetails(page, sale!.saleNumber, 'es');
    await expect(spanishDetails).toContainText(`${promotionName} · ahorro de`);
    await expect(spanishDetails.getByText('Puntos de lealtad', { exact: true })).toBeVisible();
    await expect(spanishDetails.getByText('Crédito de tienda', { exact: true })).toBeVisible();
    await expect(spanishDetails.getByText('2 puntos', { exact: true })).toBeVisible();
    await captureAuditScreenshot(page, 'sale-customer-value-es', spanishDetails);

    // Return the exact ticket through the real composer. Internal tenders are
    // restored to their source ledgers regardless of the external card path.
    await ensureLanguage(page, 'en');
    const returnDetails = await openSaleDetails(page, sale!.saleNumber, 'en');
    await returnDetails.getByRole('button', { name: 'Refund Sale', exact: true }).click();
    const refundDialog = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: 'Process a return' }) })
      .last();
    await expect(refundDialog).toBeVisible();
    await refundDialog.getByRole('button', { name: 'Select all remaining' }).click();
    await refundDialog.getByRole('button', { name: 'Wrong item', exact: true }).click();
    const cardReference = refundDialog.getByRole('textbox', { name: /Card.*5[,.]000/ });
    await expect(cardReference).toBeVisible();
    await cardReference.fill('e2e-card-return-ref');
    await captureAuditScreenshot(page, 'return-customer-value', refundDialog);

    const confirmReturn = refundDialog.getByRole('button', {
      name: 'Confirm return',
      exact: true,
    });
    await expect(confirmReturn).toBeEnabled();
    await confirmReturn.click();
    await expect(refundDialog).toBeHidden({ timeout: 15_000 });
    await expectSuccessToast(page, 'Sale refunded and stock restored');

    await expect
      .poll(() => getCustomerValueEvidence(scenario.tenantId, scenario.customer.id), {
        timeout: 15_000,
      })
      .toEqual({
        points: scenario.initialPoints,
        pointsLedger: scenario.initialPoints,
        storeCredit: scenario.initialStoreCredit,
        storeCreditLedger: scenario.initialStoreCredit,
      });
    const returnPayments = getSaleReturnPaymentEvidence(scenario.tenantId, sale!.id);
    expect(returnPayments).toHaveLength(3);
    expect(returnPayments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          originalMethod: 'loyalty',
          destination: 'loyalty',
          amount: 2_500,
          loyaltyPoints: 2,
        }),
        expect.objectContaining({
          originalMethod: 'store_credit',
          destination: 'store_credit',
          amount: 2_500,
          loyaltyPoints: null,
        }),
        expect.objectContaining({
          originalMethod: 'card',
          destination: 'external',
          amount: 5_000,
          loyaltyPoints: null,
          externalReference: 'e2e-card-return-ref',
        }),
      ])
    );

    await page.reload();
    const returnedDetails = await openSaleDetails(page, sale!.saleNumber, 'en');
    await expect(returnedDetails.getByText('Refunded', { exact: true }).first()).toBeVisible();

    await expectNoClientIssues(tracker);
  });
});
