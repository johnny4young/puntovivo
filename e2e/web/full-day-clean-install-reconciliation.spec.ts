import Database from 'better-sqlite3';
import { expect, test } from './support/empty-installation.js';
import { attachClientIssueTracker, expectNoClientIssues } from './support/app.js';

test.use({ actionTimeout: 15_000 });

async function addProductToCart(page: import('@playwright/test').Page, sku: string) {
  const search = page.locator('#sales-product-search-input');
  await search.fill(sku);
  await search.press('Enter');
  const dialog = page.getByRole('dialog', { name: /^Add product$/i });
  await dialog.getByTestId(`product-search-row-${sku}`).click();
  await dialog.getByRole('button', { name: /^Add to cart$/i }).click();
  await expect(dialog).toBeHidden();
}

function assertCleanInstallFullDaySqlite(databasePath: string) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });

    const saleRows = db
      .prepare(
        `SELECT id, sale_number, subtotal, discount_amount, tax_amount, tip_amount,
                service_charge_amount, rounding_adjustment, total, status, return_state
         FROM sales
         ORDER BY sale_number ASC`
      )
      .all() as Array<{
      id: string;
      sale_number: string;
      subtotal: number;
      discount_amount: number;
      tax_amount: number;
      tip_amount: number;
      service_charge_amount: number;
      rounding_adjustment: number;
      total: number;
      status: string;
      return_state: string | null;
    }>;

    expect(saleRows).toHaveLength(2);
    for (const row of saleRows) {
      const recomputed =
        row.subtotal -
        row.discount_amount +
        row.tax_amount +
        row.tip_amount +
        row.service_charge_amount +
        row.rounding_adjustment;
      expect(row.total).toBeCloseTo(recomputed, 2);
      const paySum = db
        .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM sale_payments WHERE sale_id = ?')
        .get(row.id) as { total: number };
      expect(paySum.total).toBeCloseTo(row.total, 2);
    }

    const totalsSorted = saleRows.map(r => r.total).sort((a, b) => a - b);
    expect(totalsSorted).toEqual([10_000, 20_000]);
    const returnedSale = saleRows.find(r => r.total === 20_000);
    const intactSale = saleRows.find(r => r.total === 10_000);
    expect(returnedSale?.return_state).toBe('partially_refunded');
    expect(intactSale?.return_state).toBeNull();

    const returnRows = db
      .prepare('SELECT id, sale_id, refund_amount FROM sale_returns')
      .all() as Array<{ id: string; sale_id: string; refund_amount: number }>;
    expect(returnRows).toHaveLength(1);
    expect(returnRows[0]?.sale_id).toBe(returnedSale?.id);
    expect(returnRows[0]?.refund_amount).toBe(10_000);

    const allocSum = db
      .prepare(
        'SELECT COALESCE(SUM(amount), 0) AS total FROM sale_return_payment_allocations WHERE sale_return_id = ?'
      )
      .get(returnRows[0]!.id) as { total: number };
    expect(allocSum.total).toBe(10_000);

    const sessions = db
      .prepare(
        'SELECT opening_float, expected_balance, actual_count, over_short, status FROM cash_sessions'
      )
      .all();
    expect(sessions).toEqual([
      {
        opening_float: 0,
        expected_balance: 20_000,
        actual_count: 20_000,
        over_short: 0,
        status: 'closed',
      },
    ]);

    const cashSigned = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN type IN ('refund', 'paid_out', 'skim') THEN -amount ELSE amount END), 0) AS signed_total
         FROM cash_movements`
      )
      .get() as { signed_total: number };
    expect(cashSigned.signed_total).toBe(20_000);

    expect(db.prepare('SELECT on_hand FROM inventory_balances').all()).toEqual([{ on_hand: 8 }]);
    expect(db.prepare('SELECT total FROM product_stock_totals').all()).toEqual([{ total: 8 }]);

    return {
      salesCount: saleRows.length,
      returnsCount: returnRows.length,
      expectedBalance: 20_000,
      remainingStock: 8,
    };
  } finally {
    db.close();
  }
}

test('clean-install full day: freeze, resume, cash sale, partial return, close and SQLite audit @isolated-journey', async ({
  page,
  installation,
}, info) => {
  test.setTimeout(180_000);
  await page.goto('/login');
  const tracker = attachClientIssueTracker(page);

  await expect(page.locator('#setup-businessName')).toBeVisible();
  await page.evaluate(() => localStorage.setItem('puntovivo-language-preference', 'en'));
  await page.reload();
  await expect(page.locator('#setup-businessName')).toBeVisible();

  await page.locator('#setup-businessName').fill('Full Day Recon Shop');
  await page.locator('#setup-siteName').fill('Main Store');
  await page.locator('#setup-countryCode').selectOption('CO');
  await page.locator('#setup-presetId').selectOption('retail');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  await page.locator('#setup-ownerName').fill('Recon Owner');
  await page.locator('#setup-email').fill('recon-owner@example.com');
  await page.locator('#setup-password').fill('ReconPassword42!');
  await page.locator('#setup-confirmPassword').fill('ReconPassword42!');
  await page.locator('#setup-token').fill(installation.token);
  await page.getByRole('button', { name: 'Create my workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: /Recon Owner/ })).toBeVisible({ timeout: 30_000 });

  // Configure sale numbering sequence.
  await page.goto('/sequentials');
  await page.getByRole('button', { name: 'Configure numbering', exact: true }).click();
  const sequence = page.getByRole('dialog', { name: 'Configure numbering', exact: true });
  await sequence.locator('#sequential-site').selectOption({ label: 'Main Store' });
  await sequence.locator('#sequential-document-type').selectOption('sale');
  await sequence.locator('#sequential-prefix').fill('REC-');
  await sequence.getByRole('button', { name: 'Create sequence', exact: true }).click();
  await expect(sequence).toBeHidden();

  // Import one product with 10 opening stock at 10,000 COP.
  await page.goto('/data-import');
  await page.getByRole('radio', { name: /Real business data/, exact: false }).click();
  await page.locator('#data-import-file').setInputFiles({
    name: 'recon-products.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Name,SKU,Price,Cost,Opening stock,Minimum stock,Tax rate\nReconcile Coffee,RECON-COFFEE,10000,6000,10,1,0'
    ),
  });
  await page.getByRole('button', { name: 'Validate and preview', exact: true }).click();
  await expect(page.getByTestId('data-import-summary-ready')).toContainText('1');
  await page
    .getByLabel('I confirm that this file contains real business data', { exact: false })
    .check();
  await page.getByRole('button', { name: /^Import 1 ready row$/ }).click();
  await expect(page.getByTestId('data-import-report-stockInitialized')).toContainText('1');

  // Open cash register on /sales.
  await page.goto('/sales');
  await page
    .getByRole('button', { name: /^Open cash session$/i })
    .first()
    .click();
  const openDialog = page.getByRole('dialog', { name: /^Open cash session$/i });
  await openDialog.locator('#cash-session-register').fill('Main Register');
  await openDialog.locator('#cash-session-opening-float').fill('0');
  await openDialog.getByRole('button', { name: /^Open session$/i }).click();
  await expect(openDialog).toBeHidden();

  // Freeze/park a qty-2 cart (20,000 COP).
  await addProductToCart(page, 'RECON-COFFEE');
  await addProductToCart(page, 'RECON-COFFEE');
  await expect(page.getByTestId('sale-cart-item-RECON-COFFEE')).toBeVisible();
  await page.getByTestId('checkout-suspend').click();
  await page.getByTestId('suspend-label-input').fill('Frozen Order');
  await page.getByRole('button', { name: 'Suspend', exact: true }).click();
  await expect(page.getByTestId('sales-suspended-count')).toHaveText('1');

  // Complete an immediate cash sale for qty 1 (10,000 COP).
  await addProductToCart(page, 'RECON-COFFEE');
  await page
    .getByRole('button', { name: /^Charge sale$/i })
    .first()
    .click();
  const payment = page.getByTestId('sale-payment-drawer');
  await expect(payment).toBeVisible();
  await payment.locator('#sale-payment-confirm').click();
  await expect(payment).toBeHidden({ timeout: 15_000 });

  // Resume the frozen qty-2 order and complete it in cash (20,000 COP).
  await page.getByTestId('sales-open-suspended').click();
  const draftCard = page.getByTestId('suspended-draft-card').filter({ hasText: 'Frozen Order' });
  await expect(draftCard).toBeVisible();
  await draftCard.getByTestId('suspended-draft-resume').click();
  await expect(draftCard).toBeHidden();
  await expect(page.getByTestId('sale-cart-item-RECON-COFFEE')).toBeVisible();

  await page
    .getByRole('button', { name: /^Charge sale$/i })
    .first()
    .click();
  await expect(payment).toBeVisible();
  await payment.locator('#sale-payment-confirm').click();
  await expect(payment).toBeHidden({ timeout: 15_000 });

  // Perform a partial return (1 of 2 units = 10,000 COP) on the frozen/resumed sale (REC-000001).
  // Draft creation reserved REC-000001 before the immediate cash sale took REC-000002.
  await page.reload();
  await page.getByTestId('sales-open-history').click();
  const history = page.getByTestId('sales-history-drawer');
  await history.getByPlaceholder(/Search by sale number/i).fill('REC-000001');
  await history.getByRole('button', { name: 'View REC-000001', exact: true }).click();

  await page.getByRole('button', { name: 'Refund Sale', exact: true }).first().click();
  const refund = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Process a return' }) })
    .last();
  await refund.getByRole('checkbox', { name: 'Return Reconcile Coffee', exact: true }).check();
  await refund.getByRole('spinbutton', { name: 'Quantity', exact: true }).fill('1');
  await refund.getByRole('button', { name: 'Wrong item', exact: true }).click();
  const confirmReturn = refund.getByRole('button', { name: 'Confirm return', exact: true });
  await expect(confirmReturn).toBeEnabled();
  await confirmReturn.click();
  await expect(refund).toBeHidden({ timeout: 15_000 });

  const receipt = page.getByRole('dialog', { name: /REC-000001/ });
  await receipt
    .getByRole('button', { name: /^Close$/i })
    .first()
    .click();
  await history.getByRole('button', { name: /^Close modal$/i }).click();
  await expect(history).toBeHidden();

  // Close register with exact expected balance (10,000 + 20,000 - 10,000 = 20,000 COP).
  await page.getByRole('button', { name: /^Cash session$/i }).click();
  await page.getByRole('menuitem', { name: /^Close cash session$/i }).click();
  const closeDialog = page.getByRole('dialog', { name: /^Close cash session$/i });
  await closeDialog.locator('#cash-session-closing-count').fill('20000');
  await closeDialog.locator('#cash-session-close-count-3').fill('2');
  await closeDialog.getByRole('button', { name: /^Close session$/i }).click();
  await expect(closeDialog).toBeHidden();

  const dayCloseModal = page.getByRole('dialog', { name: /^Day closed$/i });
  await expect(dayCloseModal.getByTestId('day-close-summary')).toBeVisible();
  await dayCloseModal.getByRole('button', { name: /^Done$/i }).click();

  // Verify the comprehensive /day-close report renders cleanly.
  await page.goto('/day-close');
  await expect(page.getByTestId('day-close-sales-section')).toBeVisible();

  // Independent direct SQLite audit against the clean-install DB file.
  const evidence = assertCleanInstallFullDaySqlite(installation.databasePath);
  await info.attach('sqlite-full-day-reconciliation', {
    body: JSON.stringify(evidence),
    contentType: 'application/json',
  });
  await expectNoClientIssues(tracker);
});
