import { expect, test, type Page } from '@playwright/test';
import {
  attachClientIssueTracker,
  expectNoClientIssues,
  expectSuccessToast,
  login,
} from './support/app';
import {
  getInventoryBalance,
  getProductStock,
  seedSaleScenario,
} from './support/db';

// Maps TEST-PLAN quotation cases into the automated surface.
// Current coverage:
//   QUOT-01 — page header + New button (exercised indirectly by QUOT-02)
//   QUOT-02 — create draft quotation with one product line
//   QUOT-08 — send a draft (Draft → Sent)
//   QUOT-09 — accept a sent quotation (Sent → Accepted)
//   QUOT-15 — inventory unchanged across the whole lifecycle
//   QUOT-19 — mark accepted as converted (terminal state)
//
// The lifecycle test below collapses those six ids into a single focused
// flow that walks draft → sent → accepted → converted and re-checks
// inventory at every transition. QUOT-12 (delete a draft) and QUOT-13
// (delete action hidden on non-drafts) used to live here as separate
// E2E tests; they were retired in favour of the equivalent component
// tests in `apps/web/src/features/quotations/QuotationsHistoryTable.test.tsx`
// (cases "exposes Delete on draft rows" + "omits Delete on non-draft
// rows"). Component-level coverage runs ~1000× faster and pins the same
// UI invariant without booting a browser. The lifecycle E2E stays
// because it crosses frontend + tRPC + DB with inventory invariants
// that component tests cannot reach.

async function openNewQuotationModal(page: Page) {
  await page.goto('/quotations');
  await page.getByRole('button', { name: 'New quotation' }).click();
  const dialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByRole('heading', { name: 'New quotation' }) })
    .last();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

async function fillQuotationLine(
  dialog: ReturnType<Page['locator']>,
  args: {
    productId: string;
    quantity: number;
  }
) {
  // The create modal initialises with a single empty line row
  // (`useState([emptyLine()])` in QuotationCreateModal). Tests fill that
  // first row directly — clicking "Add product" would duplicate the row
  // and trip strict-mode multiplicity on `getByLabel('Product')`.
  await dialog.getByLabel('Product').first().selectOption(args.productId);
  await dialog.getByLabel('Qty').first().fill(String(args.quantity));
}

function getHistoryRow(page: Page, quotationNumber: string) {
  // Quotation rows do not yet surface a data-row-id attribute (their row
  // data uses `id` via DataTable, same as transfers). Searching by the
  // visible, unique quotation number keeps the selector stable.
  return page.locator('tr', { hasText: quotationNumber }).first();
}

async function readQuotationNumberFromHistory(page: Page): Promise<string> {
  // After a successful create the newest row — sorted by created_at desc —
  // is at the top of the table body and its first cell carries the COT-
  // sequential.
  const firstCell = page.locator('tbody tr').first().getByRole('cell').first();
  await expect(firstCell).toBeVisible();
  const text = (await firstCell.textContent())?.trim() ?? '';
  const match = text.match(/COT-\d+/);
  if (!match) {
    throw new Error(`Could not parse quotation number from history cell: "${text}"`);
  }
  return match[0];
}

test.describe('web quotations', () => {
  test('manager walks a quotation through draft → sent → accepted → converted without touching inventory', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedSaleScenario(`quot-lifecycle-${testInfo.parallelIndex}-${Date.now()}`);

    // Snapshot inventory BEFORE the quotation. QUOT-15 asserts that no
    // transition alters stock; quotations are pre-sale documents.
    const preStock = getProductStock(scenario.product.id);
    const preBySiteA = getInventoryBalance(scenario.sites[0].id, scenario.product.id)?.onHand;
    const preBySiteB = getInventoryBalance(scenario.sites[1].id, scenario.product.id)?.onHand;

    await login(page, {
      email: scenario.manager.email,
      password: scenario.manager.password,
      defaultPath: '/dashboard',
    });

    const createDialog = await openNewQuotationModal(page);
    await fillQuotationLine(createDialog, { productId: scenario.product.id, quantity: 2 });
    await createDialog.getByRole('button', { name: 'Save quotation' }).click();
    await expect(createDialog).toBeHidden({ timeout: 15_000 });
    await expectSuccessToast(page, 'Quotation saved');

    const quotationNumber = await readQuotationNumberFromHistory(page);
    const row = getHistoryRow(page, quotationNumber);
    await expect(row).toContainText('Draft');

    // QUOT-08: Draft → Sent via the Send action.
    await row.getByRole('button', { name: 'Send' }).click();
    await expect(getHistoryRow(page, quotationNumber)).toContainText('Sent');

    // QUOT-09: Sent → Accepted.
    await getHistoryRow(page, quotationNumber).getByRole('button', { name: 'Accept' }).click();
    await expect(getHistoryRow(page, quotationNumber)).toContainText('Accepted');

    // QUOT-19: Accepted → Converted (terminal).
    await getHistoryRow(page, quotationNumber)
      .getByRole('button', { name: 'Mark as converted' })
      .click();
    await expect(getHistoryRow(page, quotationNumber)).toContainText('Converted');

    // QUOT-15: inventory must be identical across the full lifecycle.
    expect(getProductStock(scenario.product.id)).toBe(preStock);
    expect(getInventoryBalance(scenario.sites[0].id, scenario.product.id)?.onHand).toBe(preBySiteA);
    expect(getInventoryBalance(scenario.sites[1].id, scenario.product.id)?.onHand).toBe(preBySiteB);

    // Converted is terminal — transition actions collapse back to Details only.
    await expect(
      getHistoryRow(page, quotationNumber).getByRole('button', { name: 'Send' })
    ).toHaveCount(0);
    await expect(
      getHistoryRow(page, quotationNumber).getByRole('button', { name: 'Expire' })
    ).toHaveCount(0);

    await expectNoClientIssues(tracker);
  });

});
