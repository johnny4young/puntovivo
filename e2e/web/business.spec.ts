import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  expectSuccessToast,
  login,
  openUserMenu,
  resetSession,
} from './support/app';
import {
  findLatestSaleForProduct,
  findLatestPurchaseForProduct,
  findLatestTransferByNotes,
  getAuditLog,
  getEmployeeShift,
  getInventoryBalance,
  getLatestCashSessionForCashierSite,
  getProductStock,
  getPurchaseById,
  getPurchaseReturnByPurchaseId,
  getSaleById,
  getSaleReturnBySaleId,
  getTransferById,
  getTransferItems,
  seedCashierWithoutSession,
  seedCashSessionScenario,
  seedPurchaseScenario,
  seedSaleScenario,
  seedTransferScenario,
} from './support/db';

const PRERELEASE_MONEY_TAG = '@prerelease-money';

async function capturePrereleaseEvidence(
  page: Page,
  name: string,
  options: { fullPage?: boolean; locator?: Locator } = {}
) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;

  await mkdir(auditDir, { recursive: true });
  if (options.locator) {
    await options.locator.screenshot({
      path: path.join(auditDir, `${name}.png`),
      animations: 'disabled',
    });
    return;
  }
  await page.screenshot({
    path: path.join(auditDir, `${name}.png`),
    fullPage: options.fullPage ?? true,
    animations: 'disabled',
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function pollForRecord<T>(reader: () => T | null, timeout = 10_000): Promise<T> {
  await expect
    .poll(() => reader(), { timeout })
    .not.toBeNull();

  const record = reader();
  if (record === null) {
    throw new Error('Expected record to be available after polling');
  }

  return record;
}

function formatUsd(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

async function createCompletedCashSale(
  page: Page,
  product: { name: string; sku: string }
) {
  await page.goto('/sales');
  await page.locator('#sales-product-search-input').fill(product.sku);
  await page.locator('#sales-product-search-input').press('Enter');

  const productRow = page.locator('tr', { has: page.getByText(product.sku) }).first();
  await expect(productRow).toBeVisible();
  await productRow.click();

  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('button', { name: 'Add to cart' })).toHaveCount(0);
  await expect(page.getByTestId(`sale-cart-item-${product.sku}`)).toBeVisible();

  await page.getByRole('button', { name: 'Charge sale' }).first().click();
  const chargeDialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByRole('heading', { name: 'Charge Sale' }) })
    .last();
  await expect(chargeDialog).toBeVisible();
  await chargeDialog.getByRole('button', { name: 'Confirm Sale' }).click();
  // Dialog close is the deterministic success signal; toast is auxiliary.
  await expect(chargeDialog).toBeHidden({ timeout: 15_000 });
  await expectSuccessToast(page, 'Sale completed');
}

async function createCompletedPurchase(
  page: Page,
  args: {
    product: { name: string; sku: string };
    provider: { id: string; name: string };
    quantity?: number;
    notes?: string;
  }
) {
  await page.goto('/purchases');
  await page.getByRole('button', { name: 'Add Product' }).first().click();

  const productDialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByRole('heading', { name: 'Add Product to Purchase' }) })
    .last();
  await expect(productDialog).toBeVisible();
  await productDialog.getByPlaceholder('Search by SKU, name, or barcode').fill(args.product.sku);
  await expect(productDialog.getByText(args.product.sku)).toBeVisible({ timeout: 30_000 });
  // Row-by-SKU is more stable than row-by-name: SKUs are unique, product
  // names may collide with branding text elsewhere in the dialog, and using
  // `hasText` (a string literal) avoids the inner-locator scoping trap
  // where `productDialog.getByText(...)` would be re-evaluated relative to
  // each row during `filter()` evaluation.
  const productRow = productDialog.locator('tr', { hasText: args.product.sku }).first();
  await productRow.click();
  await productDialog.getByRole('button', { name: 'Add to purchase' }).click();
  await expect(productDialog).toHaveCount(0);

  const purchaseRow = page.locator('tr', { has: page.getByText(args.product.sku) }).first();
  await expect(purchaseRow).toBeVisible();
  if ((args.quantity ?? 1) !== 1) {
    await purchaseRow.locator('input[type="number"]').first().fill(String(args.quantity));
  }

  await page.getByRole('button', { name: 'Register Purchase' }).first().click();
  const finalizeDialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByRole('heading', { name: 'Register Purchase' }) })
    .last();
  // Modal open can lag behind the click under heavy worker contention —
  // the render is React-lazy and the dropdown data query may still be in
  // flight. 15 s keeps it bounded without blanket-inflating other timeouts.
  await expect(finalizeDialog).toBeVisible({ timeout: 15_000 });
  await finalizeDialog.locator('#purchase-provider').selectOption(args.provider.id);
  if (args.notes) {
    await finalizeDialog.locator('#purchase-notes').fill(args.notes);
  }
  await finalizeDialog.getByRole('button', { name: 'Register Purchase' }).click();
  await expect(finalizeDialog).toBeHidden({ timeout: 15_000 });
  await expectSuccessToast(page, 'Purchase registered');
}

async function openSaleDetails(page: Page, saleNumber: string) {
  await page.goto('/sales');
  await page.getByTestId('sales-open-history').click();
  const historyDrawer = page.getByTestId('sales-history-drawer');
  await expect(historyDrawer).toBeVisible();
  await historyDrawer.getByPlaceholder('Search by invoice...').fill(saleNumber);
  const viewButton = historyDrawer.getByRole('button', { name: `View ${saleNumber}` });
  await expect(viewButton).toBeVisible();
  await viewButton.click();
  await expect(page.getByRole('heading', { name: `Sale ${saleNumber}` })).toBeVisible();
}

async function openPurchaseDetails(page: Page, purchaseNumber: string) {
  await page.goto('/purchases');
  await page.getByPlaceholder('Search by purchase number...').fill(purchaseNumber);
  const viewButton = page.getByRole('button', { name: `View ${purchaseNumber}` });
  await expect(viewButton).toBeVisible();
  await viewButton.click();
  await expect(page.getByRole('heading', { name: `Purchase ${purchaseNumber}` })).toBeVisible();
}

async function assertInventoryBalanceInUi(
  page: Page,
  args: {
    siteId: string;
    productName: string;
    productSku: string;
    expectedOnHand: number;
  }
) {
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'By Site' }).click();
  const siteSelect = page.locator('#inventory-balances-site');
  await expect(siteSelect).toBeVisible();
  await siteSelect.selectOption(args.siteId);
  // The Balances DataTable filters by its `productName` accessor; typing
  // only the SKU would match zero rows. We search by name (narrows the
  // visible set) and then pick the row by SKU (unique, unambiguous).
  await page.getByPlaceholder('Search balances by product…').fill(args.productName);

  // Balances columns: [0] product+sku, [1] onHand, [2] reserved, [3] available.
  const row = page.locator('tr', { hasText: args.productSku }).first();
  await expect(row).toBeVisible();
  await expect(row.getByRole('cell').nth(1)).toHaveText(String(args.expectedOnHand));
}

async function assertAggregateStockInUi(
  page: Page,
  args: {
    productName: string;
    productSku: string;
    expectedStock: number;
  }
) {
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'Stock Query' }).click();
  // The Stock Query DataTable filters by its `name` accessor; searching by
  // SKU alone would hit no rows. Name narrows, SKU pinpoints the row.
  await page.getByPlaceholder('Search stock by product...').fill(args.productName);

  const row = page.locator('tr', { hasText: args.productSku }).first();
  await expect(row).toBeVisible();
  // Stock cell is inside a <span>; scoping the exact-match text search to
  // the row avoids the "stock=12 lives somewhere else in the page too" trap.
  await expect(row.getByText(String(args.expectedStock), { exact: true }).first()).toBeVisible();
}

async function createDeferredTransfer(
  page: Page,
  args: {
    fromSiteId: string;
    toSiteId: string;
    productId: string;
    notes: string;
    quantity: number;
  }
) {
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'By Site' }).click();
  await page.locator('#inventory-balances-site').selectOption(args.fromSiteId);
  await page.getByRole('button', { name: 'Transfer stock' }).click();

  const dialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByRole('heading', { name: 'Transfer stock between sites' }) })
    .last();
  await expect(dialog).toBeVisible();
  await dialog.locator('select').nth(1).selectOption(args.toSiteId);
  await dialog.locator('select').nth(2).selectOption(args.productId);
  await dialog.locator('input[type="number"]').fill(String(args.quantity));
  await dialog.locator('textarea').fill(args.notes);
  await dialog.getByLabel('Ship now, receive later').check();
  await dialog.getByRole('button', { name: 'Transfer' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expectSuccessToast(page, 'Transfer recorded');
}

function getTransferHistorySection(page: Page) {
  return page.locator('.card').filter({
    has: page.getByRole('heading', { name: 'Transfer history' }),
  }).first();
}

// Locate a transfer-history row deterministically by its domain id.
// Under parallel test execution, multiple transfers coexist in the shared
// history; a position-based `.first()` would race. The `data-row-id`
// attribute on the DataTable <tr> maps 1:1 to `transfer_orders.id`.
function getTransferRow(page: Page, transferId: string) {
  return getTransferHistorySection(page).locator(`tr[data-row-id="${transferId}"]`);
}

async function switchToSite(page: Page, targetSiteName: string) {
  // The header site selector button always displays the currently-active
  // site's name. When tests need to pin the active site to a specific one
  // (e.g. when seeding data for a known site) we cannot rely on the tenant
  // default — we explicitly open the switcher and pick the target.
  const header = page.locator('header');
  const currentButton = header.getByRole('button', {
    name: new RegExp(`^${escapeRegExp(targetSiteName)}$`),
  });
  if ((await currentButton.count()) > 0) {
    return;
  }
  // The switcher button text is dynamic (it shows the current site). Using
  // the role+position (it is between the tenant-scoped controls and the
  // Notifications button) is more stable than trying to predict the label.
  await header
    .getByRole('button', { name: /Main Site|Branch Site|E2E Branch Site/i })
    .first()
    .click();
  await page.getByRole('option', { name: targetSiteName }).click();
  await expect(
    header.getByRole('button', {
      name: new RegExp(`^${escapeRegExp(targetSiteName)}$`),
    })
  ).toBeVisible();
}

async function assertCashClosureInOperationsReport(
  page: Page,
  args: {
    registerName: string;
    signedOverShort: string;
  }
) {
  await page.goto('/operations?tab=cash');
  const closureRow = page.locator('tr').filter({ has: page.getByText(args.registerName) }).first();
  await expect(closureRow).toBeVisible();
  await expect(closureRow).toContainText(args.signedOverShort);
}

async function assertAuditEventInUi(
  page: Page,
  args: {
    action: string;
    expectedActor: string;
    expectedText?: RegExp | string;
  }
) {
  await page.goto('/audit-logs');
  await page.getByLabel('Action').selectOption(args.action);
  const row = page
    .locator('tbody tr')
    .filter({ has: page.getByText(args.expectedActor) })
    .first();
  await expect(row).toBeVisible();
  if (args.expectedText) {
    await expect(row.getByText(args.expectedText)).toBeVisible();
  }
}

test.describe('web business flows', () => {
  test('cashier completes a sale and sensitive actions remain grant-gated', { tag: PRERELEASE_MONEY_TAG }, async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedSaleScenario(`sale-create-${testInfo.parallelIndex}-${Date.now()}`);

    await login(page, {
      email: scenario.cashier.email,
      password: scenario.cashier.password,
      defaultPath: '/sales',
    });

    await createCompletedCashSale(page, scenario.product);

    const sale = await pollForRecord(() =>
      findLatestSaleForProduct(scenario.product.id, scenario.cashier.id)
    );

    expect(sale.status).toBe('completed');
    expect(sale.paymentStatus).toBe('paid');
    expect(sale.siteId).toBeTruthy();

    expect(getProductStock(scenario.product.id)).toBe(scenario.product.totalStock - 1);
    expect(getInventoryBalance(sale.siteId!, scenario.product.id)?.onHand).toBe(
      scenario.product.stockPerSite - 1
    );

    await openSaleDetails(page, sale.saleNumber);
    await expect(page.getByRole('button', { name: 'Refund Sale', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Void Sale', exact: true })).toBeVisible();

    await capturePrereleaseEvidence(page, 'prerelease-sale-details');
    await expectNoClientIssues(tracker);
  });

  test('manager refunds a completed sale and the refund restores inventory plus audit evidence', { tag: PRERELEASE_MONEY_TAG }, async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedSaleScenario(`sale-refund-${testInfo.parallelIndex}-${Date.now()}`);

    await login(page, {
      email: scenario.cashier.email,
      password: scenario.cashier.password,
      defaultPath: '/sales',
    });
    await createCompletedCashSale(page, scenario.product);

    const sale = await pollForRecord(() =>
      findLatestSaleForProduct(scenario.product.id, scenario.cashier.id)
    );

    await resetSession(page);
    await login(page, {
      email: scenario.manager.email,
      password: scenario.manager.password,
      defaultPath: '/dashboard',
    });
    await openSaleDetails(page, sale.saleNumber);

    await expect(page.getByRole('button', { name: 'Refund Sale', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Void Sale', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Refund Sale', exact: true }).first().click();
    // ENG-084 V8 reskin — the trigger keeps the legacy "Refund Sale" copy,
    // but the editorial Overlay primitive uses "Return sale" heading + a
    // "Confirm return" CTA inside.
    const refundDialog = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: 'Return sale' }) })
      .last();
    await expect(refundDialog).toBeVisible();
    await refundDialog.getByRole('button', { name: 'Confirm return', exact: true }).click();
    await expect(refundDialog).toBeHidden({ timeout: 15_000 });
    await expectSuccessToast(page, 'Sale refunded and stock restored');

    await expect
      .poll(() => getSaleById(sale.id), { timeout: 10_000 })
      .toMatchObject({ paymentStatus: 'refunded', status: 'completed' });

    const saleReturn = await pollForRecord(() => getSaleReturnBySaleId(sale.id));

    expect(getProductStock(scenario.product.id)).toBe(scenario.product.totalStock);
    expect(getInventoryBalance(sale.siteId!, scenario.product.id)?.onHand).toBe(
      scenario.product.stockPerSite
    );

    const audit = await pollForRecord(() => getAuditLog('sale.return', sale.id));

    expect(audit.after?.refundId).toBe(saleReturn.id);

    await assertInventoryBalanceInUi(page, {
      siteId: sale.siteId!,
      productName: scenario.product.name,
      productSku: scenario.product.sku,
      expectedOnHand: scenario.product.stockPerSite,
    });
    await assertAggregateStockInUi(page, {
      productName: scenario.product.name,
      productSku: scenario.product.sku,
      expectedStock: scenario.product.totalStock,
    });

    await resetSession(page);
    await login(page, {
      email: scenario.admin.email,
      password: scenario.admin.password,
      defaultPath: '/dashboard',
    });
    await assertAuditEventInUi(page, {
      action: 'sale.return',
      expectedActor: scenario.manager.email,
      expectedText: /Sale refunded|Venta reembolsada/i,
    });

    await capturePrereleaseEvidence(page, 'prerelease-refund-audit');
    await expectNoClientIssues(tracker);
  });

  test('admin voids a completed sale and the void restores inventory plus audit evidence', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedSaleScenario(`sale-void-${testInfo.parallelIndex}-${Date.now()}`);

    await login(page, {
      email: scenario.cashier.email,
      password: scenario.cashier.password,
      defaultPath: '/sales',
    });
    await createCompletedCashSale(page, scenario.product);

    const sale = await pollForRecord(() =>
      findLatestSaleForProduct(scenario.product.id, scenario.cashier.id)
    );

    await resetSession(page);
    await login(page, {
      email: scenario.admin.email,
      password: scenario.admin.password,
      defaultPath: '/dashboard',
    });
    await openSaleDetails(page, sale.saleNumber);

    await expect(page.getByRole('button', { name: 'Refund Sale', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Void Sale', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Void Sale', exact: true }).first().click();
    const voidDialog = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: 'Void Sale' }) })
      .last();
    await expect(voidDialog).toBeVisible();
    await voidDialog.getByRole('button', { name: 'Void Sale', exact: true }).click();
    await expect(voidDialog).toBeHidden({ timeout: 15_000 });
    await expectSuccessToast(page, 'Sale voided and stock restored');

    await expect
      .poll(() => getSaleById(sale.id), { timeout: 10_000 })
      .toMatchObject({ status: 'voided', paymentStatus: 'paid' });

    expect(getProductStock(scenario.product.id)).toBe(scenario.product.totalStock);
    expect(getInventoryBalance(sale.siteId!, scenario.product.id)?.onHand).toBe(
      scenario.product.stockPerSite
    );

    const audit = await pollForRecord(() => getAuditLog('sale.void', sale.id));

    expect(audit.before?.saleNumber).toBe(sale.saleNumber);
    expect(audit.after?.status).toBe('voided');

    await assertInventoryBalanceInUi(page, {
      siteId: sale.siteId!,
      productName: scenario.product.name,
      productSku: scenario.product.sku,
      expectedOnHand: scenario.product.stockPerSite,
    });
    await assertAggregateStockInUi(page, {
      productName: scenario.product.name,
      productSku: scenario.product.sku,
      expectedStock: scenario.product.totalStock,
    });
    await assertAuditEventInUi(page, {
      action: 'sale.void',
      expectedActor: scenario.admin.email,
      expectedText: /Sale voided|Venta anulada/i,
    });

    await expectNoClientIssues(tracker);
  });

  test('manager adjusts stock and the adjustment writes audit plus synchronized balances', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedSaleScenario(`inventory-adjust-${testInfo.parallelIndex}-${Date.now()}`);
    const targetSite = scenario.sites[0];
    const nextPrimaryStock = scenario.product.stockPerSite + 4;
    const nextAggregateStock = scenario.product.totalStock + 4;

    await login(page, {
      email: scenario.manager.email,
      password: scenario.manager.password,
      defaultPath: '/dashboard',
    });
    await page.goto('/inventory');

    await page.locator('header').getByRole('button', {
      name: new RegExp(scenario.sites.map(site => escapeRegExp(site.name)).join('|')),
    }).click();
    await page.getByRole('option', { name: targetSite.name }).click();

    await page.getByRole('button', { name: 'Stock Query' }).click();
    await page.getByPlaceholder('Search stock by product...').fill(scenario.product.name);

    // Seeded product names derive from `seed = parallelIndex-Date.now()`
    // which can collide across runs if the Date.now() prefix lands in the
    // same minute. SKUs carry a `randomUUID().slice(0,6)` suffix and are
    // globally unique, so we pick the row by SKU to avoid clicking an
    // older test's product.
    const stockRow = page.locator('tr', { hasText: scenario.product.sku }).first();
    await expect(stockRow).toBeVisible();
    await stockRow.getByTitle('Adjust stock').click();

    await expect(
      page.getByRole('heading', { name: new RegExp(escapeRegExp(scenario.product.name)) })
    ).toBeVisible();
    await page.locator('#inventory-new-stock').fill(String(nextAggregateStock));
    await page.locator('#inventory-adjustment-notes').fill('E2E stock adjustment');
    await page.getByRole('button', { name: 'Save Adjustment' }).click();
    await expect(
      page.getByRole('heading', { name: new RegExp(escapeRegExp(scenario.product.name)) })
    ).toHaveCount(0);

    const audit = await pollForRecord(() =>
      getAuditLog('inventory.adjust_stock', scenario.product.id)
    );

    expect(audit.before?.stock).toBe(scenario.product.totalStock);
    expect(audit.after?.stock).toBe(nextAggregateStock);
    expect(audit.metadata?.siteId).toBe(targetSite.id);

    expect(getProductStock(scenario.product.id)).toBe(nextAggregateStock);
    expect(getInventoryBalance(targetSite.id, scenario.product.id)?.onHand).toBe(
      nextPrimaryStock
    );

    await assertAggregateStockInUi(page, {
      productName: scenario.product.name,
      productSku: scenario.product.sku,
      expectedStock: nextAggregateStock,
    });
    await assertInventoryBalanceInUi(page, {
      siteId: targetSite.id,
      productName: scenario.product.name,
      productSku: scenario.product.sku,
      expectedOnHand: nextPrimaryStock,
    });

    await resetSession(page);
    await login(page, {
      email: scenario.admin.email,
      password: scenario.admin.password,
      defaultPath: '/dashboard',
    });
    await assertAuditEventInUi(page, {
      action: 'inventory.adjust_stock',
      expectedActor: scenario.manager.email,
      expectedText: /Stock adjusted|Stock ajustado/i,
    });

    await expectNoClientIssues(tracker);
  });

  test('manager records a completed purchase and inventory increases at the receiving site', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedPurchaseScenario(`purchase-complete-${testInfo.parallelIndex}-${Date.now()}`);

    await login(page, {
      email: scenario.manager.email,
      password: scenario.manager.password,
      defaultPath: '/dashboard',
    });
    await createCompletedPurchase(page, {
      product: scenario.product,
      provider: scenario.provider,
      quantity: 2,
      notes: 'E2E completed purchase',
    });

    const purchase = await pollForRecord(() =>
      findLatestPurchaseForProduct(scenario.product.id, scenario.manager.id)
    );

    expect(purchase.status).toBe('completed');
    expect(purchase.providerId).toBe(scenario.provider.id);
    expect(getProductStock(scenario.product.id)).toBe(scenario.product.totalStock + 2);
    expect(getInventoryBalance(purchase.siteId, scenario.product.id)?.onHand).toBe(
      (scenario.product.siteStockBySiteId[purchase.siteId] ?? 0) + 2
    );

    await openPurchaseDetails(page, purchase.purchaseNumber);
    // Scope to the purchase details drawer: the provider name and status
    // badge render in both the purchase list row and the drawer itself, so
    // an unscoped getByText would trip strict-mode multiplicity.
    const purchaseDetailsDrawer = page.getByRole('dialog', { name: new RegExp(`Purchase ${escapeRegExp(purchase.purchaseNumber)}`) });
    await expect(purchaseDetailsDrawer.getByText(scenario.provider.name)).toBeVisible();
    await expect(purchaseDetailsDrawer.getByText('Completed', { exact: true })).toBeVisible();

    await assertInventoryBalanceInUi(page, {
      siteId: purchase.siteId,
      productName: scenario.product.name,
      productSku: scenario.product.sku,
      expectedOnHand: (scenario.product.siteStockBySiteId[purchase.siteId] ?? 0) + 2,
    });
    await assertAggregateStockInUi(page, {
      productName: scenario.product.name,
      productSku: scenario.product.sku,
      expectedStock: scenario.product.totalStock + 2,
    });

    await expectNoClientIssues(tracker);
  });

  test('manager returns part of a completed purchase and the supplier return reduces stock', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedPurchaseScenario(`purchase-return-${testInfo.parallelIndex}-${Date.now()}`);

    await login(page, {
      email: scenario.manager.email,
      password: scenario.manager.password,
      defaultPath: '/dashboard',
    });
    await createCompletedPurchase(page, {
      product: scenario.product,
      provider: scenario.provider,
      quantity: 2,
      notes: 'E2E purchase to return',
    });

    const purchase = await pollForRecord(() =>
      findLatestPurchaseForProduct(scenario.product.id, scenario.manager.id)
    );

    await openPurchaseDetails(page, purchase.purchaseNumber);
    await expect(page.getByRole('button', { name: 'Return Items', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Void Purchase', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Return Items', exact: true }).click();
    const returnDialog = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: `Return Items for ${purchase.purchaseNumber}` }) })
      .last();
    await expect(returnDialog).toBeVisible();
    await returnDialog.locator('input[type="number"]').first().fill('1');
    await returnDialog.locator('#purchase-return-reason').fill('E2E supplier return');
    await returnDialog.getByRole('button', { name: 'Record Return' }).click();
    await expect(returnDialog).toBeHidden({ timeout: 15_000 });
    await expectSuccessToast(page, 'Purchase return recorded and stock reduced');

    await expect
      .poll(() => getPurchaseById(purchase.id), { timeout: 10_000 })
      .toMatchObject({ status: 'partial_returned' });

    const purchaseReturn = await pollForRecord(() => getPurchaseReturnByPurchaseId(purchase.id));

    expect(purchaseReturn.reason).toBe('E2E supplier return');
    expect(purchaseReturn.total).toBe(purchase.total / 2);
    expect(getProductStock(scenario.product.id)).toBe(scenario.product.totalStock + 1);
    expect(getInventoryBalance(purchase.siteId, scenario.product.id)?.onHand).toBe(
      (scenario.product.siteStockBySiteId[purchase.siteId] ?? 0) + 1
    );

    // Scope to the purchase details drawer: status + reason render in
    // both the list row and the drawer after the mutation invalidates.
    const purchaseDetailsDrawer = page.getByRole('dialog', { name: new RegExp(`Purchase ${escapeRegExp(purchase.purchaseNumber)}`) });
    await expect(purchaseDetailsDrawer.getByText('Partial returned').first()).toBeVisible();
    // "E2E supplier return" appears in multiple places in the drawer: in
    // the returned-items panel, in the notes, and in the audit summary.
    // We only need to verify it rendered at all.
    await expect(purchaseDetailsDrawer.getByText('E2E supplier return').first()).toBeVisible();
    await assertInventoryBalanceInUi(page, {
      siteId: purchase.siteId,
      productName: scenario.product.name,
      productSku: scenario.product.sku,
      expectedOnHand: (scenario.product.siteStockBySiteId[purchase.siteId] ?? 0) + 1,
    });
    await assertAggregateStockInUi(page, {
      productName: scenario.product.name,
      productSku: scenario.product.sku,
      expectedStock: scenario.product.totalStock + 1,
    });

    await expectNoClientIssues(tracker);
  });

  test('admin voids a completed purchase and purchase audit plus balances stay consistent', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedPurchaseScenario(`purchase-void-${testInfo.parallelIndex}-${Date.now()}`);

    await login(page, {
      email: scenario.manager.email,
      password: scenario.manager.password,
      defaultPath: '/dashboard',
    });
    await createCompletedPurchase(page, {
      product: scenario.product,
      provider: scenario.provider,
      quantity: 2,
      notes: 'E2E purchase to void',
    });

    const purchase = await pollForRecord(() =>
      findLatestPurchaseForProduct(scenario.product.id, scenario.manager.id)
    );

    await resetSession(page);
    await login(page, {
      email: scenario.admin.email,
      password: scenario.admin.password,
      defaultPath: '/dashboard',
    });
    await openPurchaseDetails(page, purchase.purchaseNumber);
    await expect(page.getByRole('button', { name: 'Return Items', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Void Purchase', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Void Purchase', exact: true }).click();
    const confirmDialog = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: 'Void Purchase' }) })
      .last();
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Void Purchase', exact: true }).click();
    await expect(confirmDialog).toBeHidden({ timeout: 15_000 });
    await expectSuccessToast(page, 'Purchase voided and stock reversed');

    await expect
      .poll(() => getPurchaseById(purchase.id), { timeout: 10_000 })
      .toMatchObject({ status: 'voided' });

    const audit = await pollForRecord(() => getAuditLog('purchase.void', purchase.id));

    expect(audit.before?.purchaseNumber).toBe(purchase.purchaseNumber);
    expect(audit.after?.status).toBe('voided');
    expect(getProductStock(scenario.product.id)).toBe(scenario.product.totalStock);
    expect(getInventoryBalance(purchase.siteId, scenario.product.id)?.onHand).toBe(
      scenario.product.siteStockBySiteId[purchase.siteId] ?? 0
    );

    await assertInventoryBalanceInUi(page, {
      siteId: purchase.siteId,
      productName: scenario.product.name,
      productSku: scenario.product.sku,
      expectedOnHand: scenario.product.siteStockBySiteId[purchase.siteId] ?? 0,
    });
    await assertAggregateStockInUi(page, {
      productName: scenario.product.name,
      productSku: scenario.product.sku,
      expectedStock: scenario.product.totalStock,
    });
    await assertAuditEventInUi(page, {
      action: 'purchase.void',
      expectedActor: scenario.admin.email,
      expectedText: /Purchase voided|Compra anulada/i,
    });

    await expectNoClientIssues(tracker);
  });

  test('manager transfers stock between sites, receives with discrepancy, and balances shrink by the shortage', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedTransferScenario(`transfer-receive-${testInfo.parallelIndex}-${Date.now()}`);
    const [originSite, destinationSite] = scenario.sites;
    const transferNotes = `E2E deferred transfer ${Date.now()}`;

    await login(page, {
      email: scenario.manager.email,
      password: scenario.manager.password,
      defaultPath: '/dashboard',
    });
    await createDeferredTransfer(page, {
      fromSiteId: originSite.id,
      toSiteId: destinationSite.id,
      productId: scenario.product.id,
      quantity: 3,
      notes: transferNotes,
    });

    const transfer = await pollForRecord(() => findLatestTransferByNotes(transferNotes));

    expect(transfer.status).toBe('in_transit');
    expect(getProductStock(scenario.product.id)).toBe(scenario.product.totalStock - 3);
    expect(getInventoryBalance(originSite.id, scenario.product.id)?.onHand).toBe(
      (scenario.product.siteStockBySiteId[originSite.id] ?? 0) - 3
    );
    expect(getInventoryBalance(destinationSite.id, scenario.product.id)?.onHand).toBe(
      scenario.product.siteStockBySiteId[destinationSite.id] ?? 0
    );

    const transferRow = getTransferRow(page, transfer.id);
    await expect(transferRow).toContainText('In transit');
    await transferRow.getByRole('button', { name: 'Receive' }).click();

    const receiveDialog = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: 'Receive transfer' }) })
      .last();
    await expect(receiveDialog).toBeVisible();
    await receiveDialog
      .getByLabel(`Received quantity for ${scenario.product.name}`)
      .fill('2');
    await receiveDialog
      .locator('#transfer-receive-discrepancy-notes')
      .fill('One unit arrived damaged');
    await receiveDialog.getByRole('button', { name: 'Confirm receipt' }).click();
    await expect(receiveDialog).toBeHidden({ timeout: 15_000 });
    await expectSuccessToast(page, 'Transfer received');

    await expect
      .poll(() => getTransferById(transfer.id), { timeout: 10_000 })
      .toMatchObject({
        status: 'completed',
        discrepancyNotes: 'One unit arrived damaged',
      });

    const transferItem = getTransferItems(transfer.id)[0];

    expect(transferItem?.receivedQuantity).toBe(2);
    expect(getProductStock(scenario.product.id)).toBe(scenario.product.totalStock - 1);
    expect(getInventoryBalance(originSite.id, scenario.product.id)?.onHand).toBe(
      (scenario.product.siteStockBySiteId[originSite.id] ?? 0) - 3
    );
    expect(getInventoryBalance(destinationSite.id, scenario.product.id)?.onHand).toBe(2);

    await assertInventoryBalanceInUi(page, {
      siteId: destinationSite.id,
      productName: scenario.product.name,
      productSku: scenario.product.sku,
      expectedOnHand: 2,
    });

    const completedRow = getTransferRow(page, transfer.id);
    await expect(completedRow).toContainText('Completed');
    await expect(completedRow).toContainText('Discrepancy');
    await completedRow.getByRole('button', { name: 'Details' }).click();

    const detailsDialog = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: 'Transfer details' }) })
      .last();
    await expect(detailsDialog).toBeVisible();
    await expect(detailsDialog.getByText('One unit arrived damaged')).toBeVisible();
    await expect(detailsDialog.getByText('-1', { exact: true })).toBeVisible();

    await expectNoClientIssues(tracker);
  });

  test('cashier closes a cash session with an overage and the closure is visible in audit plus reporting', { tag: PRERELEASE_MONEY_TAG }, async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedCashSessionScenario(`cash-close-${testInfo.parallelIndex}-${Date.now()}`);
    const expectedOverShort = 1000;

    await login(page, {
      email: scenario.cashier.email,
      password: scenario.cashier.password,
      defaultPath: '/sales',
    });
    await page.goto('/sales');
    // The cashier has open cash sessions at both sites (global-setup seeds
    // one session per site). The scenario prepared the register we want to
    // close at `scenario.activeSite` (sites[0]); the tenant default may be
    // sites[1], so we must explicitly switch to ensure the Close button on
    // the Sales page targets the prepared session.
    await switchToSite(page, scenario.activeSite.name);
    await page.getByRole('button', { name: 'Close cash session' }).first().click();

    const closeDialog = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: 'Close cash session' }) })
      .last();
    await expect(closeDialog).toBeVisible();
    await closeDialog.locator('#cash-session-closing-count').fill('2000');
    await closeDialog.locator('#cash-session-close-count-6').fill('2');
    await closeDialog.getByRole('button', { name: 'Close session' }).click();
    await expect(closeDialog).toBeHidden({ timeout: 15_000 });
    await expectSuccessToast(
      page,
      new RegExp(`${escapeRegExp(scenario.registerName)} closed with an overage`)
    );

    await expect
      .poll(
        () => getLatestCashSessionForCashierSite(scenario.cashier.id, scenario.activeSite.id),
        { timeout: 10_000 }
      )
      .toMatchObject({
        id: scenario.cashSessionId,
        status: 'closed',
        actualCount: 2000,
        overShort: expectedOverShort,
      });

    const audit = await pollForRecord(() => getAuditLog('cash_session.close', scenario.cashSessionId));

    expect(audit.after?.actualCount).toBe(2000);
    expect(audit.after?.overShort).toBe(expectedOverShort);
    expect(audit.metadata?.registerName).toBe(scenario.registerName);

    await resetSession(page);
    await login(page, {
      email: scenario.admin.email,
      password: scenario.admin.password,
      defaultPath: '/dashboard',
    });
    await assertCashClosureInOperationsReport(page, {
      registerName: scenario.registerName,
      signedOverShort: formatUsd(expectedOverShort),
    });
    await assertAuditEventInUi(page, {
      action: 'cash_session.close',
      expectedActor: scenario.cashier.email,
      expectedText: `Over/short: ${formatUsd(expectedOverShort)}`,
    });

    await capturePrereleaseEvidence(page, 'prerelease-cash-close-audit');
    await expectNoClientIssues(tracker);
  });

  test('cashier closes a cash session with a shortage and the shortage renders as a negative over/short', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedCashSessionScenario(`cash-short-${testInfo.parallelIndex}-${Date.now()}`);
    const shortageAmount = 300;
    const expectedOverShort = -shortageAmount;
    const actualCount = scenario.expectedBalance - shortageAmount; // 700

    await login(page, {
      email: scenario.cashier.email,
      password: scenario.cashier.password,
      defaultPath: '/sales',
    });
    await page.goto('/sales');
    await switchToSite(page, scenario.activeSite.name);
    await page.getByRole('button', { name: 'Close cash session' }).first().click();

    const closeDialog = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: 'Close cash session' }) })
      .last();
    await expect(closeDialog).toBeVisible();
    // The Close button is disabled unless the denomination grid sums to
    // `actualCount` (cashSessionTotalsMatch in CashSessionCloseModal.tsx).
    // Denominations live at fixed indices in the seeded template:
    //   [0]100000 [1]50000 [2]20000 [3]10000 [4]5000 [5]2000
    //   [6]1000  [7]500   [8]200   [9]100   [10]50
    // For actualCount=700 we count one 500 bill + one 200 bill.
    await closeDialog.locator('#cash-session-closing-count').fill(String(actualCount));
    await closeDialog.locator('#cash-session-close-count-7').fill('1'); // 500
    await closeDialog.locator('#cash-session-close-count-8').fill('1'); // 200
    await closeDialog.getByRole('button', { name: 'Close session' }).click();
    await expect(closeDialog).toBeHidden({ timeout: 15_000 });
    await expectSuccessToast(
      page,
      new RegExp(`${escapeRegExp(scenario.registerName)} closed with a shortage`)
    );

    await expect
      .poll(
        () => getLatestCashSessionForCashierSite(scenario.cashier.id, scenario.activeSite.id),
        { timeout: 10_000 }
      )
      .toMatchObject({
        id: scenario.cashSessionId,
        status: 'closed',
        actualCount,
        overShort: expectedOverShort,
      });

    const audit = await pollForRecord(() => getAuditLog('cash_session.close', scenario.cashSessionId));

    expect(audit.after?.actualCount).toBe(actualCount);
    expect(audit.after?.overShort).toBe(expectedOverShort);

    await resetSession(page);
    await login(page, {
      email: scenario.admin.email,
      password: scenario.admin.password,
      defaultPath: '/dashboard',
    });
    await assertCashClosureInOperationsReport(page, {
      registerName: scenario.registerName,
      signedOverShort: `-${formatUsd(shortageAmount)}`,
    });

    await expectNoClientIssues(tracker);
  });

  test('cashier closes a cash session exactly balanced and the closure reports a zero over/short', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedCashSessionScenario(`cash-balanced-${testInfo.parallelIndex}-${Date.now()}`);
    const actualCount = scenario.expectedBalance; // 1000

    await login(page, {
      email: scenario.cashier.email,
      password: scenario.cashier.password,
      defaultPath: '/sales',
    });
    await page.goto('/sales');
    await switchToSite(page, scenario.activeSite.name);
    await page.getByRole('button', { name: 'Close cash session' }).first().click();

    const closeDialog = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: 'Close cash session' }) })
      .last();
    await expect(closeDialog).toBeVisible();
    // actualCount=1000 is one $1000 bill at denomination index 6.
    await closeDialog.locator('#cash-session-closing-count').fill(String(actualCount));
    await closeDialog.locator('#cash-session-close-count-6').fill('1');
    await closeDialog.getByRole('button', { name: 'Close session' }).click();
    await expect(closeDialog).toBeHidden({ timeout: 15_000 });
    // When actual == expected the i18n closeBalancedDescription fires:
    //   "{{registerName}} closed balanced at {{amount}}."
    await expectSuccessToast(
      page,
      new RegExp(`${escapeRegExp(scenario.registerName)} closed balanced`)
    );

    await expect
      .poll(
        () => getLatestCashSessionForCashierSite(scenario.cashier.id, scenario.activeSite.id),
        { timeout: 10_000 }
      )
      .toMatchObject({
        id: scenario.cashSessionId,
        status: 'closed',
        actualCount,
        overShort: 0,
      });

    const audit = await pollForRecord(() => getAuditLog('cash_session.close', scenario.cashSessionId));
    expect(audit.after?.overShort).toBe(0);

    await expectNoClientIssues(tracker);
  });

  test('manager receives a transfer with no discrepancy and the destination gains exactly what was shipped', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedTransferScenario(`transfer-perfect-${testInfo.parallelIndex}-${Date.now()}`);
    const [originSite, destinationSite] = scenario.sites;
    const shippedQty = 3;
    const transferNotes = `E2E perfect transfer ${Date.now()}`;

    await login(page, {
      email: scenario.manager.email,
      password: scenario.manager.password,
      defaultPath: '/dashboard',
    });
    await createDeferredTransfer(page, {
      fromSiteId: originSite.id,
      toSiteId: destinationSite.id,
      productId: scenario.product.id,
      quantity: shippedQty,
      notes: transferNotes,
    });

    const transfer = await pollForRecord(() => findLatestTransferByNotes(transferNotes));
    expect(transfer.status).toBe('in_transit');

    const transferRow = getTransferRow(page, transfer.id);
    await transferRow.getByRole('button', { name: 'Receive' }).click();

    const receiveDialog = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: 'Receive transfer' }) })
      .last();
    await expect(receiveDialog).toBeVisible();
    // Do not change received quantity — defaults to shipped. Confirm directly.
    await receiveDialog.getByRole('button', { name: 'Confirm receipt' }).click();
    await expect(receiveDialog).toBeHidden({ timeout: 15_000 });
    await expectSuccessToast(page, 'Transfer received');

    await expect
      .poll(() => getTransferById(transfer.id), { timeout: 10_000 })
      .toMatchObject({ status: 'completed', discrepancyNotes: null });

    // No discrepancy: origin down by shipped, destination up by shipped,
    // total stock unchanged.
    expect(getProductStock(scenario.product.id)).toBe(scenario.product.totalStock);
    expect(getInventoryBalance(destinationSite.id, scenario.product.id)?.onHand).toBe(shippedQty);

    const completedRow = getTransferRow(page, transfer.id);
    await expect(completedRow).toContainText('Completed');
    await expect(completedRow).not.toContainText('Discrepancy');

    await expectNoClientIssues(tracker);
  });

  test('manager cannot confirm a receipt claiming more than was shipped', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedTransferScenario(`transfer-over-${testInfo.parallelIndex}-${Date.now()}`);
    const [originSite, destinationSite] = scenario.sites;
    const shippedQty = 2;
    const transferNotes = `E2E over-receipt test ${Date.now()}`;

    await login(page, {
      email: scenario.manager.email,
      password: scenario.manager.password,
      defaultPath: '/dashboard',
    });
    await createDeferredTransfer(page, {
      fromSiteId: originSite.id,
      toSiteId: destinationSite.id,
      productId: scenario.product.id,
      quantity: shippedQty,
      notes: transferNotes,
    });

    const transfer = await pollForRecord(() => findLatestTransferByNotes(transferNotes));
    expect(transfer.status).toBe('in_transit');

    const transferRow = getTransferRow(page, transfer.id);
    await transferRow.getByRole('button', { name: 'Receive' }).click();

    const receiveDialog = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: 'Receive transfer' }) })
      .last();
    await expect(receiveDialog).toBeVisible();
    // Attempt to receive MORE than was shipped — the form keeps Confirm
    // disabled (client-side validation in InventoryTransferReceiveModal).
    await receiveDialog
      .getByLabel(`Received quantity for ${scenario.product.name}`)
      .fill(String(shippedQty + 1));
    await expect(
      receiveDialog.getByRole('button', { name: 'Confirm receipt' })
    ).toBeDisabled();

    // The transfer must stay in_transit — no partial-receive or
    // completed state can land while the receipt is over-shipped.
    await expect
      .poll(() => getTransferById(transfer.id)?.status, { timeout: 3_000 })
      .toBe('in_transit');

    // Balances stay untouched beyond the create-time debit: origin shrank
    // by shipped, destination still has zero.
    expect(getInventoryBalance(destinationSite.id, scenario.product.id)?.onHand).toBe(0);

    await expectNoClientIssues(tracker);
  });

  test('cashier completes a split-payment sale with cash + card and both tenders render in the details drawer (SALES-19 / SALES-22)', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedSaleScenario(`sale-split-${testInfo.parallelIndex}-${Date.now()}`);
    const cashPortion = 5_000;
    const cardPortion = 7_500; // product price is 12,500 (see seedBusinessProduct)
    const expectedTotal = cashPortion + cardPortion;

    await login(page, {
      email: scenario.cashier.email,
      password: scenario.cashier.password,
      defaultPath: '/sales',
    });
    await page.goto('/sales');
    await page.locator('#sales-product-search-input').fill(scenario.product.sku);
    await page.locator('#sales-product-search-input').press('Enter');

    const productRow = page.locator('tr', { hasText: scenario.product.sku }).first();
    await expect(productRow).toBeVisible();
    await productRow.click();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByRole('button', { name: 'Add to cart' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Charge sale' }).first().click();
    const chargeDialog = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: 'Charge Sale' }) })
      .last();
    await expect(chargeDialog).toBeVisible({ timeout: 15_000 });

    // Flip to split mode, tender 0 defaults to cash. Set its amount and
    // add a second tender (card).
    await chargeDialog
      .getByRole('button', { name: 'Split payment across tenders' })
      .click();
    await chargeDialog.getByLabel('Amount for tender 1').fill(String(cashPortion));
    await chargeDialog.getByRole('button', { name: 'Add payment method' }).click();
    await chargeDialog.getByLabel('Method for tender 2').selectOption('card');
    await chargeDialog.getByLabel('Amount for tender 2').fill(String(cardPortion));

    // Once tenders sum to the total, the Confirm button becomes enabled.
    const confirm = chargeDialog.getByRole('button', { name: 'Confirm Sale' });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(chargeDialog).toBeHidden({ timeout: 15_000 });
    await expectSuccessToast(page, 'Sale completed');

    const sale = await pollForRecord(() =>
      findLatestSaleForProduct(scenario.product.id, scenario.cashier.id)
    );

    expect(sale.status).toBe('completed');
    expect(sale.paymentStatus).toBe('paid');
    expect(sale.total).toBe(expectedTotal);

    // SALES-22: opening the sale details drawer shows one row per tender.
    await openSaleDetails(page, sale.saleNumber);
    const drawer = page.getByRole('dialog', { name: new RegExp(`Sale ${escapeRegExp(sale.saleNumber)}`) });
    await expect(drawer.getByText(/Cash/i).first()).toBeVisible();
    await expect(drawer.getByText(/Card/i).first()).toBeVisible();

    await expectNoClientIssues(tracker);
  });

  test('cashier opens a cash session from zero and completes the linked attendance lifecycle (CASH-01 / CASH-03 / ENG-140d)', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedCashierWithoutSession(`cash-open-${testInfo.parallelIndex}-${Date.now()}`);
    const openingFloat = 1000;
    const registerName = `E2E Open ${testInfo.parallelIndex} ${Date.now()}`;

    await login(page, {
      email: scenario.cashier.email,
      password: scenario.cashier.password,
      defaultPath: '/sales',
    });
    await page.goto('/sales');
    // Pin the UI to a known site so the DB assertion below reads the
    // session from the site where it actually got opened (the tenant
    // default may be sites[1] = Branch Site).
    const targetSite = scenario.sites[0];
    await switchToSite(page, targetSite.name);

    // CASH-01: with no open session, the primary CTA on the Sales page
    // is "Open cash session" (Charge is disabled).
    const openButton = page.getByRole('button', { name: 'Open cash session' }).first();
    await expect(openButton).toBeEnabled();
    await openButton.click();

    const openDialog = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: 'Open cash session' }) })
      .last();
    await expect(openDialog).toBeVisible({ timeout: 15_000 });

    // Set register name + opening float, then count one $1000 bill at
    // denomination index 6 (value 1000) so the grid sums to the float
    // and the Open-session button becomes enabled.
    await openDialog.locator('#cash-session-register').fill(registerName);
    await openDialog.locator('#cash-session-opening-float').fill(String(openingFloat));
    await openDialog.locator('#cash-session-count-6').fill('1');

    const confirm = openDialog.getByRole('button', { name: 'Open session' });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(openDialog).toBeHidden({ timeout: 15_000 });
    await expectSuccessToast(page, 'Cash session opened');
    await expectSuccessToast(page, /attendance shift started automatically/i);

    // After opening, the cashier now has exactly one open session with
    // the prepared register + float at the pinned site.
    await expect
      .poll(
        () => {
          const latest = getLatestCashSessionForCashierSite(scenario.cashier.id, targetSite.id);
          if (!latest) return null;
          return {
            status: latest.status,
            registerName: latest.registerName,
            openingFloat: latest.openingFloat,
            employeeShiftId: latest.employeeShiftId,
          };
        },
        { timeout: 10_000 }
      )
      .toMatchObject({ status: 'open', openingFloat, employeeShiftId: expect.any(String) });

    const openedSession = getLatestCashSessionForCashierSite(scenario.cashier.id, targetSite.id);
    if (!openedSession?.employeeShiftId) {
      throw new Error('Expected the cash session to link an attendance shift');
    }
    expect(getEmployeeShift(openedSession.employeeShiftId)).toMatchObject({
      userId: scenario.cashier.id,
      siteId: targetSite.id,
      clockedOutAt: null,
    });

    await openUserMenu(page);
    let timeClock = page.getByRole('region', { name: 'Time clock' });
    await expect(timeClock.getByTestId('active-cash-session-shift-guard')).toContainText(
      `Close ${registerName} before clocking out`
    );
    await expect(timeClock.getByRole('button', { name: 'Clock out' })).toBeDisabled();
    await capturePrereleaseEvidence(page, 'eng-140d-cash-attendance-guard-en', {
      locator: page.locator('#header-user-menu'),
    });
    await openUserMenu(page);

    await page.getByRole('button', { name: 'Close cash session' }).first().click();
    const closeDialog = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: 'Close cash session' }) })
      .last();
    await expect(closeDialog).toBeVisible();
    await closeDialog.locator('#cash-session-closing-count').fill(String(openingFloat));
    await closeDialog.locator('#cash-session-close-count-6').fill('1');
    await closeDialog.getByRole('button', { name: 'Close session' }).click();
    await expect(closeDialog).toBeHidden({ timeout: 15_000 });
    await expectSuccessToast(page, /attendance remains open until you clock out/i);

    const dayClose = page.getByRole('dialog', { name: 'Day closed' });
    await expect(dayClose.getByTestId('day-close-summary')).toBeVisible({ timeout: 15_000 });
    await dayClose.getByRole('button', { name: 'Done' }).click();
    await expect(dayClose).toBeHidden();

    await openUserMenu(page);
    timeClock = page.getByRole('region', { name: 'Time clock' });
    await expect(timeClock.getByText(/Clocked in/)).toBeVisible();
    await expect(timeClock.getByTestId('active-cash-session-shift-guard')).toHaveCount(0);
    await expect(timeClock.getByRole('button', { name: 'Clock out' })).toBeEnabled();
    expect(getEmployeeShift(openedSession.employeeShiftId)?.clockedOutAt).toBeNull();
    await capturePrereleaseEvidence(page, 'eng-140d-cash-closed-attendance-open-en', {
      locator: page.locator('#header-user-menu'),
    });
    await openUserMenu(page);

    await ensureLanguage(page, 'es');
    await page.setViewportSize({ width: 390, height: 844 });
    await openUserMenu(page);
    const reloj = page.getByRole('region', { name: 'Control de turno' });
    await expect(reloj.getByText(/Entrada registrada/)).toBeVisible();
    await expect(reloj.getByRole('button', { name: 'Marcar salida' })).toBeEnabled();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await capturePrereleaseEvidence(page, 'eng-140d-cash-closed-attendance-mobile-es', {
      locator: page.locator('#header-user-menu'),
    });
    await reloj.getByRole('button', { name: 'Marcar salida' }).click();
    await expect(reloj.getByRole('button', { name: 'Marcar entrada' })).toBeVisible();
    await expect
      .poll(() => getEmployeeShift(openedSession.employeeShiftId!)?.clockedOutAt)
      .not.toBeNull();

    await expectNoClientIssues(tracker);
  });

  test('cashier records a manual paid-in movement and the drawer balance reflects the inflow (CASH-05)', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedCashSessionScenario(`cash-movement-${testInfo.parallelIndex}-${Date.now()}`);
    const topUpAmount = 250;

    await login(page, {
      email: scenario.cashier.email,
      password: scenario.cashier.password,
      defaultPath: '/sales',
    });
    await page.goto('/sales');
    await switchToSite(page, scenario.activeSite.name);

    await page.getByRole('button', { name: 'Record movement' }).first().click();
    const movementDialog = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: 'Record cash movement' }) })
      .last();
    await expect(movementDialog).toBeVisible({ timeout: 15_000 });

    await movementDialog.locator('#cash-session-movement-type').selectOption('paid_in');
    await movementDialog.locator('#cash-session-movement-amount').fill(String(topUpAmount));
    await movementDialog
      .locator('#cash-session-movement-note')
      .fill('E2E top-up to sustain the drawer');
    await movementDialog.getByRole('button', { name: 'Save movement' }).click();
    await expect(movementDialog).toBeHidden({ timeout: 15_000 });
    await expectSuccessToast(page, 'Cash movement recorded');

    // Expected balance jumps from the seeded opening float by exactly
    // the paid-in amount.
    await expect
      .poll(
        () => getLatestCashSessionForCashierSite(scenario.cashier.id, scenario.activeSite.id),
        { timeout: 10_000 }
      )
      .toMatchObject({
        id: scenario.cashSessionId,
        expectedBalance: scenario.expectedBalance + topUpAmount,
      });

    await expectNoClientIssues(tracker);
  });

  test('cashier parks a cart, charges a second one, resumes the first, and charges it via completeDraft (ENG-018b / 018c round-trip)', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedSaleScenario(
      `park-roundtrip-${testInfo.parallelIndex}-${Date.now()}`
    );

    await login(page, {
      email: scenario.cashier.email,
      password: scenario.cashier.password,
      defaultPath: '/sales',
    });
    const activeSite = scenario.sites[0];
    expect(activeSite, 'seed scenario should include an active site').toBeTruthy();
    await switchToSite(page, activeSite.name);

    const stockBefore = getProductStock(scenario.product.id);
    expect(stockBefore).toBe(scenario.product.totalStock);

    // --- Cart A: add one unit, then suspend with a label ------------------
    await page.locator('#sales-product-search-input').fill(scenario.product.sku);
    await page.locator('#sales-product-search-input').press('Enter');
    const firstProductRow = page
      .locator('tr', { has: page.getByText(scenario.product.sku) })
      .first();
    await expect(firstProductRow).toBeVisible();
    await firstProductRow.click();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByRole('button', { name: 'Add to cart' })).toHaveCount(0);

    await page.getByTestId('checkout-suspend').click();
    const labelInput = page.getByTestId('suspend-label-input');
    await expect(labelInput).toBeVisible();
    await labelInput.fill('Mesa 5');
    await page.getByRole('button', { name: 'Suspend', exact: true }).click();
    await expectSuccessToast(page, 'Sale suspended');

    // Cart A is now a server draft — stock is still reserved.
    const stockAfterSuspend = getProductStock(scenario.product.id);
    expect(stockAfterSuspend).toBe(scenario.product.totalStock - 1);

    // --- Cart B: add one unit and charge normally -------------------------
    await page.locator('#sales-product-search-input').fill(scenario.product.sku);
    await page.locator('#sales-product-search-input').press('Enter');
    const secondProductRow = page
      .locator('tr', { has: page.getByText(scenario.product.sku) })
      .first();
    await expect(secondProductRow).toBeVisible();
    await secondProductRow.click();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByRole('button', { name: 'Add to cart' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Charge sale' }).first().click();
    const chargeDialogB = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: 'Charge Sale' }) })
      .last();
    await expect(chargeDialogB).toBeVisible();
    await chargeDialogB.getByRole('button', { name: 'Confirm Sale' }).click();
    await expect(chargeDialogB).toBeHidden({ timeout: 15_000 });
    await expectSuccessToast(page, 'Sale completed');

    // Cart B completed → a second unit left stock permanently.
    const stockAfterChargeB = getProductStock(scenario.product.id);
    expect(stockAfterChargeB).toBe(scenario.product.totalStock - 2);

    // --- Resume cart A from the suspended panel ---------------------------
    await page.getByTestId('checkout-open-suspended-panel').click();
    const draftCard = page.getByTestId('suspended-draft-card').first();
    await expect(draftCard).toBeVisible();
    await expect(draftCard).toContainText('Mesa 5');
    await draftCard.getByTestId('suspended-draft-resume').click();
    await expectSuccessToast(page, 'Sale resumed');

    const resumedBanner = page.getByTestId('resumed-cart-banner');
    await expect(resumedBanner).toBeVisible();

    // --- Charge the resumed cart via completeDraft -----------------------
    await page.getByRole('button', { name: 'Charge sale' }).first().click();
    const chargeDialogA = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: 'Charge Sale' }) })
      .last();
    await expect(chargeDialogA).toBeVisible();
    await chargeDialogA.getByRole('button', { name: 'Confirm Sale' }).click();
    await expect(chargeDialogA).toBeHidden({ timeout: 15_000 });
    await expectSuccessToast(page, 'Sale completed');

    // Stock settled at -2 because cart A was already debited at
    // create-draft time (ENG-018 baseline model). completeDraft does
    // NOT re-debit — the whole point of ENG-018c.
    const stockFinal = getProductStock(scenario.product.id);
    expect(stockFinal).toBe(scenario.product.totalStock - 2);

    // Per-site inventory balance should mirror the product-level total.
    expect(
      getInventoryBalance(activeSite.id, scenario.product.id)?.onHand
    ).toBe(scenario.product.stockPerSite - 2);

    // Audit trail of the draft → completed transition is exercised by
    // the server-side test `completeDraft flips a non-suspended draft
    // to completed` in sales-park-and-reprint.test.ts; this E2E is
    // focused on the UX end-to-end round-trip.

    await expectNoClientIssues(tracker);
  });
});
