/** Reservation-to-sale lifecycle, isolated from kitchen configuration to retain the production HTTP rate budget. */
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { electronTest as test, expect, IS_PACKAGED_RUN } from './fixtures.js';
import { E2E_USERS } from '../shared/baseline.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import {
  createProduct,
  dismissVisibleToasts,
  goToRoute,
  openCashSession,
  pinPrimarySite,
  signIn,
} from './support/journey.js';

test('explicit reservation seating survives reload and settles through an ordinary Electron sale', async ({
  page,
}) => {
  const tracker = attachClientIssueTracker(page),
    admin = E2E_USERS.find(user => user.role === 'admin');
  if (!admin) throw new Error('E2E admin fixture is missing');
  await signIn(page, admin.email);
  await pinPrimarySite(page);
  await goToRoute(page, '/products');
  await createProduct(page, {
    name: 'E2E Reserved Plate',
    sku: 'E2E-RESERVED-PLATE',
    stock: '10',
    price: '12500',
  });
  await goToRoute(page, '/sales');
  await openCashSession(page, 'E2E Reservation Register');
  await dismissVisibleToasts(page);
  await goToRoute(page, '/restaurants/tables');
  await page.getByTestId('restaurant-tables-create-cta').click();
  const table = page.getByRole('dialog', { name: 'Create table' });
  await table.getByTestId('restaurant-table-name').fill('E2E Reservation Patio');
  await table.getByTestId('restaurant-table-seat-count').fill('4');
  await table.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(table).toBeHidden();
  await goToRoute(page, '/reservations');
  await page.getByRole('button', { name: 'New reservation', exact: true }).click();
  const reservation = page.getByRole('dialog', { name: 'New reservation', exact: true });
  await reservation.getByLabel('Guest name').fill('E2E Desktop Guest');
  await reservation
    .getByRole('combobox', { name: 'Table', exact: true })
    .selectOption({ label: 'E2E Reservation Patio · 4' });
  const times = await page.evaluate(() => {
    const local = (ms: number) => {
      const date = new Date(ms);
      return new Date(ms - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    };
    return { start: local(Date.now()), end: local(Date.now() + 3_600_000) };
  });
  await reservation.getByLabel('Starts at').fill(times.start);
  await reservation.getByLabel('Ends at').fill(times.end);
  await reservation.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(reservation).toBeHidden();
  const card = page
    .locator('[data-testid^="reservation-"]')
    .filter({ has: page.getByText('E2E Desktop Guest', { exact: true }) })
    .first();
  await card.getByRole('button', { name: 'Record arrival', exact: true }).click();
  await expect(card).toContainText('Arrived');
  await goToRoute(page, '/m');
  await page
    .getByTestId('voice-ordering-table-select')
    .selectOption({ label: 'E2E Reservation Patio' });
  await page.getByTestId('voice-ordering-manual-add').click();
  const search = page.getByRole('dialog', { name: 'Search', exact: true });
  await search.getByPlaceholder('Search by SKU, name, or barcode').fill('E2E-RESERVED-PLATE');
  await search.getByTestId('product-search-row-E2E-RESERVED-PLATE').click();
  await search.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(search).toBeHidden();
  await expect(page.getByTestId('voice-ordering-save')).toBeDisabled();
  await page
    .getByRole('checkbox', { name: 'Seat reservation for E2E Desktop Guest (2 guests)' })
    .check();
  await page.getByTestId('voice-ordering-save').click();
  await expect(page.getByTestId('voice-ordering-cart-empty')).toBeVisible();
  await goToRoute(page, '/reservations');
  await expect(card).toContainText('Seated');
  await page.reload();
  await expect(card).toContainText('Seated');
  await goToRoute(page, '/sales');
  await page.getByTestId('sales-open-suspended').click();
  const draft = page
    .getByTestId('suspended-draft-card')
    .filter({ hasText: 'E2E Reservation Patio' });
  await expect(draft).toHaveCount(1);
  await draft.getByTestId('suspended-draft-resume').click();
  await expect(page.getByTestId('sale-cart-item-E2E-RESERVED-PLATE')).toBeVisible();
  await page.keyboard.press('F2');
  const payment = page.getByRole('dialog', { name: 'Charge Sale' });
  await expect(payment).toBeVisible();
  await payment.locator('#sale-payment-confirm').click();
  await expect(payment).toBeHidden();
  await goToRoute(page, '/reservations');
  await expect(card).toContainText('Seated');
  if (process.env.PUNTOVIVO_AUDIT_DIR) {
    await dismissVisibleToasts(page);
    await mkdir(process.env.PUNTOVIVO_AUDIT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(
        process.env.PUNTOVIVO_AUDIT_DIR,
        `reservation-electron-${IS_PACKAGED_RUN ? 'packaged' : 'dev'}.png`
      ),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await expectNoClientIssues(tracker);
});
