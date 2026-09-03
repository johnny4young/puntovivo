import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  login,
} from './support/app';
import { readKitchenEvidence, seedKitchenScenario } from './support/kds';
import { runAxeOnPage } from './support/a11y';

test('kitchen routing, structured preparation and versioned transitions survive reload', async ({
  page,
}, testInfo) => {
  const scenario = seedKitchenScenario(`kitchen-${testInfo.parallelIndex}-${Date.now()}`);
  const tracker = attachClientIssueTracker(page);
  const code = `grill-${Date.now()}`;
  await login(page, { ...scenario.admin, defaultPath: '/dashboard' });
  await page.goto('/kds');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    `Kitchen · ${scenario.sites[0]!.name}`
  );
  await page.getByRole('button', { name: 'Kitchen settings', exact: true }).click();
  const config = page.getByRole('dialog', { name: 'Kitchen settings' });
  await config.getByLabel(/Code \(/).fill(code);
  await config.getByLabel('Station name', { exact: true }).fill('E2E Grill');
  await config.getByRole('button', { name: 'Save station', exact: true }).click();
  await expect(config.getByRole('button', { name: 'Edit E2E Grill', exact: true })).toBeVisible();
  await config.getByLabel('Search by name or SKU').fill(scenario.product.sku);
  const route = config.getByRole('combobox', { name: scenario.product.name, exact: true });
  const routingForm = config.locator('form').filter({
    has: page.getByRole('combobox', { name: scenario.product.name, exact: true }),
  });
  await expect(route).toBeEnabled();
  await route.selectOption({ label: 'E2E Grill' });
  await routingForm.getByRole('button', { name: 'Save routing', exact: true }).click();
  await expect(
    routingForm.getByRole('button', { name: 'Save routing', exact: true })
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.goto('/restaurants/tables');
  await page.getByTestId('restaurant-tables-create-cta').click();
  const tableName = `E2E Kitchen ${Date.now()}`;
  const table = page.getByRole('dialog', { name: 'Create table' });
  await table.getByTestId('restaurant-table-name').fill(tableName);
  await table.getByTestId('restaurant-table-seat-count').fill('2');
  await table.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(table).toBeHidden();
  await page.goto('/m');
  await page.getByTestId('voice-ordering-table-select').selectOption({ label: tableName });
  await page.getByTestId('voice-ordering-guest-count').fill('2');
  await page.getByTestId('voice-ordering-manual-add').click();
  const search = page.getByRole('dialog', { name: 'Search', exact: true });
  await search.getByPlaceholder('Search by SKU, name, or barcode').fill(scenario.product.sku);
  await search.getByTestId(`product-search-row-${scenario.product.sku}`).click();
  await search.getByRole('button', { name: 'Search', exact: true }).click();
  const row = page.getByTestId('voice-ordering-cart-row');
  await row
    .getByTestId('voice-ordering-note-input')
    .fill('No onions <script>not executable</script>');
  await row.getByTestId('voice-ordering-course-select').selectOption('starter');
  await row.getByTestId('voice-ordering-seat-select').selectOption('2');
  await row.getByTestId('voice-ordering-modifier-name').fill('Extra cheese');
  await row.getByTestId('voice-ordering-modifier-price').fill('1500');
  await page.getByTestId('voice-ordering-save').click();
  await expect(page.getByTestId('voice-ordering-cart-empty')).toBeVisible();
  await page.goto('/kds');
  const card = page.getByTestId('kds-order-card').filter({ hasText: scenario.product.name });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Course: Starter');
  await expect(card).toContainText('Extra cheese');
  await expect(card).not.toContainText('1500');
  await expect(card).toContainText('No onions <script>not executable</script>');
  await runAxeOnPage(page, { include: '[data-testid="kds-board"]' });
  const before = readKitchenEvidence(scenario.tenantId, scenario.product.id);
  expect(before.tickets).toHaveLength(1);
  expect(before.tickets[0]!.station).toBe(code);
  // Actual browser connectivity loss, not a mocked navigator flag. No kitchen
  // mutation may be queued from stale preparation while the device is offline.
  let offlineWrites = 0;
  let checkingOffline = false;
  page.on('request', request => {
    if (checkingOffline && request.method() === 'POST' && /\/api\/trpc\/kds\./.test(request.url()))
      offlineWrites++;
  });
  try {
    checkingOffline = true;
    await page.context().setOffline(true);
    await expect(page.getByRole('status').filter({ hasText: 'Offline.' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Start line', exact: true })).toBeDisabled();
    await expect(card.getByTestId('kds-order-ready')).toBeDisabled();
    await expect(
      card.getByRole('button', { name: 'Resend notification (same ticket)', exact: true })
    ).toBeDisabled();
    expect(readKitchenEvidence(scenario.tenantId, scenario.product.id).events).toEqual([
      'submitted',
    ]);
  } finally {
    await page.context().setOffline(false);
    checkingOffline = false;
  }
  expect(offlineWrites).toBe(0);
  await expect(page.getByRole('status').filter({ hasText: 'Offline.' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Start line', exact: true }).click();
  await expect(card).toContainText('Preparing');
  await card.getByRole('button', { name: 'Line ready', exact: true }).click();
  await expect(card).toHaveAttribute('data-order-status', 'ready');
  await card.getByTestId('kds-order-recall').click();
  await expect(card).toHaveAttribute('data-order-status', 'pending');
  await card
    .getByRole('button', { name: 'Resend notification (same ticket)', exact: true })
    .click();
  await expect
    .poll(() => readKitchenEvidence(scenario.tenantId, scenario.product.id).events)
    .toContain('resent');
  await page.reload();
  await expect(card).toBeVisible();
  const after = readKitchenEvidence(scenario.tenantId, scenario.product.id);
  expect(after.tickets).toHaveLength(1);
  expect(after.tickets[0]).toMatchObject({
    id: before.tickets[0]!.id,
    snapshot: before.tickets[0]!.snapshot,
    status: 'pending',
  });
  expect(after.events).toEqual(['submitted', 'preparing', 'ready', 'recalled', 'resent']);
  await page.goto('/dashboard');
  await ensureLanguage(page, 'es');
  await page.goto('/kds');
  await expect(card).toContainText('Tiempo: Entrada');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    `Cocina · ${scenario.sites[0]!.name}`
  );
  const directory = process.env.PUNTOVIVO_AUDIT_DIR;
  if (directory) {
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, 'kitchen-durable-es.png'), fullPage: true });
  }
  await expectNoClientIssues(tracker);
});

test('an open peer kitchen receives station configuration changes without reload', async ({
  page,
}, testInfo) => {
  const scenario = seedKitchenScenario(`kitchen-peer-${testInfo.parallelIndex}-${Date.now()}`);
  await login(page, { ...scenario.admin, defaultPath: '/dashboard' });
  await page.goto('/kds');
  const peer = await page.context().newPage();
  const tracker = attachClientIssueTracker(peer);
  try {
    await peer.goto('/kds');
    await expect(peer.getByRole('combobox', { name: 'Station', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Kitchen settings', exact: true }).click();
    const config = page.getByRole('dialog', { name: 'Kitchen settings' });
    await config.getByLabel(/Code \(/).fill(`peer-${Date.now()}`);
    await config.getByLabel('Station name', { exact: true }).fill('E2E Peer station');
    await config.getByRole('button', { name: 'Save station', exact: true }).click();
    await expect(config.getByRole('button', { name: 'Edit E2E Peer station' })).toBeVisible();
    // Configuration changes do not emit order events. A separate open display
    // must still converge within the board's 30-second freshness contract.
    await expect(peer.getByRole('option', { name: 'E2E Peer station', exact: true })).toHaveCount(
      1,
      {
        timeout: 35_000,
      }
    );
    await expectNoClientIssues(tracker);
  } finally {
    await peer.close();
  }
});
