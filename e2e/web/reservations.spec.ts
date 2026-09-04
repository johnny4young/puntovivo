import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  login,
} from './support/app';
import { seedReservationSaleScenario, getProductStock } from './support/db';
import { runAxeOnPage } from './support/a11y';

/** Read-only reconciliation: reservations, service and sales are written exclusively through UI. */
function evidence(tenantId: string) {
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'), {
    readonly: true,
  });
  try {
    const reservations = db
      .prepare(
        'SELECT id,status,version,table_id AS tableId,service_id AS serviceId FROM restaurant_reservations WHERE tenant_id=? ORDER BY created_at,id'
      )
      .all(tenantId) as Array<{
      id: string;
      status: string;
      version: number;
      tableId: string | null;
      serviceId: string | null;
    }>;
    const events = db
      .prepare(
        'SELECT kind,version FROM reservation_events WHERE tenant_id=? ORDER BY created_at,version'
      )
      .all(tenantId) as Array<{ kind: string; version: number }>;
    const services = db
      .prepare('SELECT id,status FROM restaurant_services WHERE tenant_id=?')
      .all(tenantId) as Array<{ id: string; status: string }>;
    const sales = db
      .prepare('SELECT id,status FROM sales WHERE tenant_id=?')
      .all(tenantId) as Array<{ id: string; status: string }>;
    return { reservations, events, services, sales };
  } finally {
    db.close();
  }
}
async function createTable(page: Page, name: string) {
  await page.goto('/restaurants/tables');
  await page.getByTestId('restaurant-tables-create-cta').click();
  const dialog = page.getByRole('dialog', { name: 'Create table' });
  await dialog.getByTestId('restaurant-table-name').fill(name);
  await dialog.getByTestId('restaurant-table-seat-count').fill('4');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
}
async function reserveAndArrive(
  page: Page,
  tenantId: string,
  tableName: string,
  guestName: string
) {
  await page.goto('/reservations');
  await page.getByRole('button', { name: 'New reservation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New reservation', exact: true });
  await dialog.getByLabel('Guest name').fill(guestName);
  await dialog.getByLabel('Contact phone').fill('3001234567');
  await dialog
    .getByRole('combobox', { name: 'Table', exact: true })
    .selectOption({ label: `${tableName} · 4` });
  // This service starts now, independently of whether the default next-hour slot is tomorrow.
  const times = await page.evaluate(() => {
    const local = (ms: number) => {
      const date = new Date(ms);
      return new Date(ms - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    };
    return { start: local(Date.now()), end: local(Date.now() + 3_600_000) };
  });
  await dialog.getByLabel('Starts at').fill(times.start);
  await dialog.getByLabel('Ends at').fill(times.end);
  await runAxeOnPage(page, { include: '[role="dialog"]' });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  const row = evidence(tenantId).reservations.at(-1)!;
  const card = page.getByTestId(`reservation-${row.id}`);
  await expect(card).toContainText(guestName);
  expect(evidence(tenantId).sales).toEqual([]);
  await card.getByRole('button', { name: 'Record arrival', exact: true }).click();
  await expect(card).toContainText('Arrived');
  expect(evidence(tenantId).sales).toEqual([]);
  await page.reload();
  await expect(card).toContainText('Arrived');
  return row.id;
}

test('future booking selects its day and conflicting booking shows the real localized rejection', async ({
  page,
}, info) => {
  const scenario = seedReservationSaleScenario(
    `future-reservation-${info.parallelIndex}-${Date.now()}`
  );
  const tracker = attachClientIssueTracker(page);
  await login(page, { ...scenario.admin, defaultPath: '/company' });
  await ensureLanguage(page, 'en');
  await createTable(page, 'Tomorrow table');
  await page.goto('/reservations');
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('cancelled');
  const times = await page.evaluate(() => {
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(12, 0, 0, 0);
    const end = new Date(start.getTime() + 3_600_000);
    const local = (date: Date) =>
      new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    return { start: local(start), end: local(end) };
  });
  const open = async (name: string) => {
    await page.getByRole('button', { name: 'New reservation', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New reservation', exact: true });
    await dialog.getByLabel('Guest name').fill(name);
    await dialog
      .getByRole('combobox', { name: 'Table', exact: true })
      .selectOption({ label: 'Tomorrow table · 4' });
    await dialog.getByLabel('Starts at').fill(times.start);
    await dialog.getByLabel('Ends at').fill(times.end);
    return dialog;
  };
  const first = await open('Tomorrow guest');
  await first.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(first).toBeHidden();
  await expect(page.getByLabel('Day', { exact: true })).toHaveValue(times.start.slice(0, 10));
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Tomorrow guest', exact: true })).toBeVisible();
  const duplicate = await open('Conflicting guest');
  const rejectionPromise = page.waitForResponse(
    response =>
      new URL(response.url()).pathname === '/api/trpc/reservations.create' &&
      response.status() === 409
  );
  await duplicate.getByRole('button', { name: 'Save', exact: true }).click();
  const rejection = await rejectionPromise;
  expect(JSON.stringify(await rejection.json())).toContain(
    '"errorCode":"RESERVATION_SLOT_CONFLICT"'
  );
  await expect(duplicate.getByRole('alert')).toHaveText(
    'The table is occupied or has an overlapping reservation. Review its schedule before trying again.'
  );
  expect(evidence(scenario.tenantId).reservations).toHaveLength(1);
  expect(evidence(scenario.tenantId).sales).toEqual([]);
  await capture(page, 'reservation-future-overlap-en.png');
  // This negative case requires exactly its one expected rejection, not a global 409 allowance.
  expect(tracker.getIssues().sort()).toEqual(
    [
      'console:Failed to load resource: the server responded with a status of 409 (Conflict)',
      `response:409 ${rejection.url()}`,
    ].sort()
  );
});
async function addTraditionalItem(page: Page, sku: string) {
  await page.locator('#sales-product-search-input').fill(sku);
  await page.locator('#sales-product-search-input').press('Enter');
  await page
    .locator('tr', { has: page.getByText(sku) })
    .first()
    .click();
  await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
}
async function capture(page: Page, name: string) {
  if (!process.env.PUNTOVIVO_AUDIT_DIR) return;
  await mkdir(process.env.PUNTOVIVO_AUDIT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.PUNTOVIVO_AUDIT_DIR, name), fullPage: true });
}

test('reservation arrival, explicit traditional check, settlement and reload reconcile', async ({
  page,
}, info) => {
  const scenario = seedReservationSaleScenario(`reservation-${info.parallelIndex}-${Date.now()}`);
  const tracker = attachClientIssueTracker(page);
  await login(page, { ...scenario.admin, defaultPath: '/company' });
  await ensureLanguage(page, 'en');
  const tableName = 'Reservation Patio',
    guestName = 'Ada <script>text only</script>';
  await createTable(page, tableName);
  const id = await reserveAndArrive(page, scenario.tenantId, tableName, guestName);
  await runAxeOnPage(page, { include: '[data-testid="reservations-page"]' });
  await page.getByTestId(`reservation-${id}`).getByRole('link', { name: 'Go to sales' }).click();
  await addTraditionalItem(page, scenario.product.sku);
  await page.getByTestId('checkout-suspend').click();
  await page.getByTestId('suspend-table-select').selectOption({ label: tableName });
  const selection = page.getByRole('checkbox', {
    name: `Seat reservation for ${guestName} (2 guests)`,
  });
  await expect(selection).not.toBeChecked();
  const suspend = page.getByRole('button', { name: 'Suspend', exact: true });
  await expect(suspend).toBeDisabled();
  await selection.check();
  await expect(page.getByTestId('suspend-guest-count')).toHaveValue('2');
  await expect(page.getByTestId('suspend-guest-count')).toBeDisabled();
  await suspend.click();
  await expect(page.getByTestId('suspend-label-input')).toBeHidden();
  await expect.poll(() => evidence(scenario.tenantId).reservations[0]?.status).toBe('seated');
  expect(evidence(scenario.tenantId).events.map(event => event.kind)).toEqual([
    'created',
    'arrived',
    'seated',
  ]);
  expect(evidence(scenario.tenantId).sales).toHaveLength(1);
  expect(getProductStock(scenario.product.id)).toBe(7);
  await page.reload();
  await page.getByTestId('checkout-open-suspended-panel').click();
  const draft = page.getByTestId('suspended-draft-card').filter({ hasText: tableName });
  await draft.getByTestId('suspended-draft-resume').click();
  await page.getByRole('button', { name: 'Charge sale', exact: true }).first().click();
  const charge = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByRole('heading', { name: 'Charge Sale' }) })
    .last();
  await charge.getByRole('button', { name: 'Confirm Sale', exact: true }).click();
  await expect(charge).toBeHidden();
  expect(evidence(scenario.tenantId).services[0]?.status).toBe('closed');
  expect(evidence(scenario.tenantId).sales[0]?.status).toBe('completed');
  expect(getProductStock(scenario.product.id)).toBe(7);
  await page.goto('/reservations');
  await ensureLanguage(page, 'es');
  await expect(page.getByTestId(`reservation-${id}`)).toContainText('Sentada');
  await page.reload();
  await expect(page.getByTestId(`reservation-${id}`)).toContainText('Sentada');
  await capture(page, 'reservation-seated-es.png');
  await expectNoClientIssues(tracker);
});

for (const surface of ['/m', '/touch/voice'] as const) {
  test(`arrived reservation requires explicit selection on ${surface}`, async ({ page }, info) => {
    const scenario = seedReservationSaleScenario(
      `reservation-surface-${info.parallelIndex}-${Date.now()}`
    );
    const tracker = attachClientIssueTracker(page);
    await login(page, { ...scenario.admin, defaultPath: '/company' });
    await ensureLanguage(page, 'en');
    const tableName = 'Surface reservation';
    await createTable(page, tableName);
    const id = await reserveAndArrive(page, scenario.tenantId, tableName, 'Grace');
    await page.goto(surface);
    await page.getByTestId('voice-ordering-table-select').selectOption({ label: tableName });
    await page.getByTestId('voice-ordering-manual-add').click();
    const search = page.getByRole('dialog', { name: 'Search', exact: true });
    await search.getByPlaceholder('Search by SKU, name, or barcode').fill(scenario.product.sku);
    await search.getByTestId(`product-search-row-${scenario.product.sku}`).click();
    await search.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(search).toBeHidden();
    await expect(page.getByTestId('voice-ordering-save')).toBeDisabled();
    await page.getByRole('checkbox', { name: 'Seat reservation for Grace (2 guests)' }).check();
    await expect(page.getByTestId('voice-ordering-guest-count')).toHaveValue('2');
    await page.getByTestId('voice-ordering-save').click();
    await expect(page.getByTestId('voice-ordering-cart-empty')).toBeVisible();
    expect(evidence(scenario.tenantId).reservations.find(row => row.id === id)?.status).toBe(
      'seated'
    );
    expect(evidence(scenario.tenantId).sales).toHaveLength(1);
    await page.reload();
    await page.goto('/reservations');
    await expect(page.getByTestId(`reservation-${id}`)).toContainText('Seated');
    if (surface === '/m') {
      await page.setViewportSize({ width: 390, height: 844 });
      await runAxeOnPage(page, { include: '[data-testid="reservations-page"]' });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      await capture(page, 'reservation-mobile-seated.png');
    }
    await expectNoClientIssues(tracker);
  });
}
