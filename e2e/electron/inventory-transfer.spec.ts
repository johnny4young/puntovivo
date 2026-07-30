/**
 * The `inventory-transfer` operator journey, run against the desktop app.
 *
 * A manager creates stock at the primary site, ships three units to the
 * secondary site, and receives only two. The journey proves source debit,
 * in-transit stock, destination credit, shortage persistence, and immutable
 * actor-attributed lifecycle evidence after fresh authentication.
 *
 * @module e2e/electron/inventory-transfer
 */

import type { Locator, Page } from '@playwright/test';
import { electronTest as test, expect } from './fixtures.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { E2E_USERS, SECONDARY_SITE_NAME, type E2EUserProfile } from '../shared/baseline.js';
import {
  createProduct,
  dismissVisibleToasts,
  goToRoute,
  pinPrimarySite,
  signIn,
  signOut,
} from './support/journey.js';

const PRODUCT_NAME = 'E2E Transfer Product';
const PRODUCT_SKU = 'E2E-TRANSFER';
const OPENING_STOCK = 6;
const SHIPPED_QUANTITY = 3;
const RECEIVED_QUANTITY = 2;
const SHORTAGE_QUANTITY = SHIPPED_QUANTITY - RECEIVED_QUANTITY;
const IN_TRANSIT_STOCK = OPENING_STOCK - SHIPPED_QUANTITY;
const FINAL_AGGREGATE_STOCK = OPENING_STOCK - SHORTAGE_QUANTITY;
const TRANSFER_NOTE = 'Desktop deferred transfer evidence';
const DISCREPANCY_NOTE = 'One unit arrived damaged';

function baselineUser(role: E2EUserProfile['role']): E2EUserProfile {
  const user = E2E_USERS.find(candidate => candidate.role === role);
  if (!user) throw new Error(`baseline did not seed a ${role}`);
  return user;
}

function transferHistory(page: Page): Locator {
  return page
    .locator('.card')
    .filter({
      has: page.getByRole('heading', { name: /transfer history|historial de transferencias/i }),
    })
    .first();
}

async function openSiteBalances(page: Page, siteName: string): Promise<void> {
  await page.getByRole('button', { name: /by site|por sede/i }).click();
  await page.locator('#inventory-balances-site').selectOption({ label: siteName });
  await page
    .getByPlaceholder(/search balances by product|buscar balances por producto/i)
    .fill(PRODUCT_NAME);
}

async function expectSiteStock(page: Page, siteName: string, expected: number): Promise<void> {
  await openSiteBalances(page, siteName);
  const row = page.locator('tbody tr').filter({ hasText: PRODUCT_SKU }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.locator('td').nth(1)).toHaveText(String(expected));
}

async function expectAggregateStock(page: Page, expected: number): Promise<void> {
  await page.getByRole('button', { name: /stock query|consulta de stock/i }).click();
  await page
    .getByPlaceholder(/search stock by product|buscar stock por producto/i)
    .fill(PRODUCT_NAME);
  const row = page.locator('tbody tr').filter({ hasText: PRODUCT_SKU }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.locator('td').nth(1)).toContainText(String(expected));
}

async function createDeferredTransfer(page: Page, primarySiteName: string): Promise<string> {
  await goToRoute(page, '/inventory');
  await expect(
    page.getByRole('heading', { name: /inventory|inventario/i, level: 1 })
  ).toBeVisible();
  await openSiteBalances(page, primarySiteName);
  await page.getByRole('button', { name: /transfer stock|transferir stock/i }).click();

  const dialog = page
    .locator('[role="dialog"]')
    .filter({
      has: page.getByRole('heading', {
        name: /transfer stock between sites|transferir stock entre sedes/i,
      }),
    })
    .last();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/to site|sede de destino/i).selectOption({ label: SECONDARY_SITE_NAME });
  const productSelect = dialog.getByLabel(/product|producto/i);
  const productValue = await productSelect
    .locator('option')
    .filter({ hasText: PRODUCT_SKU })
    .getAttribute('value');
  expect(productValue, 'transfer product option exposes its stable id').toBeTruthy();
  await productSelect.selectOption(productValue!);
  await dialog.getByLabel(/quantity|cantidad/i).fill(String(SHIPPED_QUANTITY));
  await dialog.getByLabel(/notes|notas/i).fill(TRANSFER_NOTE);
  await dialog.getByLabel(/ship now, receive later|enviar ahora, recibir después/i).check();
  await dialog.getByRole('button', { name: /^transfer$|^transferir$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  const row = transferHistory(page)
    .locator('tbody tr')
    .filter({ hasText: primarySiteName })
    .filter({ hasText: SECONDARY_SITE_NAME })
    .filter({ hasText: /in transit|en tránsito/i })
    .first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const transferId = await row.getAttribute('data-row-id');
  expect(transferId, 'transfer history exposes its stable resource id').toBeTruthy();
  await dismissVisibleToasts(page);
  return transferId!;
}

async function receiveWithShortage(page: Page, transferId: string): Promise<void> {
  const row = transferHistory(page).locator(`tr[data-row-id="${transferId}"]`);
  await row.getByRole('button', { name: /receive|recibir/i }).click();

  const dialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByRole('heading', { name: /receive transfer|recibir transferencia/i }) })
    .last();
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel(new RegExp(`received quantity for ${PRODUCT_NAME}`, 'i'))
    .fill(String(RECEIVED_QUANTITY));
  await dialog.locator('#transfer-receive-discrepancy-notes').fill(DISCREPANCY_NOTE);
  await dialog.getByRole('button', { name: /confirm receipt|confirmar recepción/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await dismissVisibleToasts(page);

  await expect(row).toContainText(/completed|completada/i, { timeout: 15_000 });
  await expect(row).toContainText(/discrepancy|diferencia/i);
}

async function expectPersistentTransferDetails(page: Page, transferId: string): Promise<void> {
  await goToRoute(page, '/inventory');
  await expect(page.getByRole('heading', { name: /inventory|inventario/i, level: 1 })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: /by site|por sede/i }).click();
  const row = transferHistory(page).locator(`tr[data-row-id="${transferId}"]`);
  await expect(row).toContainText(/completed|completada/i, { timeout: 15_000 });
  await expect(row).toContainText(/discrepancy|diferencia/i);
  await row.getByRole('button', { name: /details|detalles/i }).click();

  const dialog = page
    .locator('[role="dialog"]')
    .filter({
      has: page.getByRole('heading', { name: /transfer details|detalle de transferencia/i }),
    })
    .last();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(TRANSFER_NOTE, { exact: true })).toBeVisible();
  await expect(dialog.getByText(DISCREPANCY_NOTE, { exact: true })).toBeVisible();
  await expect(dialog.getByText(String(-SHORTAGE_QUANTITY), { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: /^close$|^cerrar$/i }).click();
  await expect(dialog).toBeHidden();
}

async function expectTransferAudit(
  page: Page,
  options: {
    action: 'transfer.create' | 'transfer.receive';
    manager: E2EUserProfile;
    primarySiteName: string;
  }
): Promise<string> {
  await goToRoute(page, '/audit-logs');
  await expect(
    page.getByRole('heading', { name: /audit log|registro de auditoría/i, level: 1 })
  ).toBeVisible();
  await page.getByLabel(/action|acción/i).selectOption(options.action);
  const expectedAction =
    options.action === 'transfer.create' ? 'Stock transfer recorded' : 'Stock transfer received';
  const row = page
    .locator('tbody tr')
    .filter({ hasText: expectedAction })
    .filter({ hasText: options.manager.name })
    .first();
  await expect(row).toBeVisible({ timeout: 15_000 });

  const expectedSummary =
    options.action === 'transfer.create'
      ? `${SHIPPED_QUANTITY} units · ${options.primarySiteName} → ${SECONDARY_SITE_NAME} · In transit`
      : `${RECEIVED_QUANTITY} of ${SHIPPED_QUANTITY} units received · ${options.primarySiteName} → ${SECONDARY_SITE_NAME} · Shortage ${SHORTAGE_QUANTITY}`;
  await expect(row).toContainText(expectedSummary);
  const resourceId = (await row.locator('td').nth(3).locator('.font-mono').innerText()).trim();
  expect(resourceId, `${options.action} audit exposes its immutable transfer id`).not.toBe('');
  return resourceId;
}

test.describe('inventory transfer on the desktop app', () => {
  test('manager ships and receives a discrepant transfer with persistent evidence', async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    const manager = baselineUser('manager');
    const admin = baselineUser('admin');

    await signIn(page, manager.email);
    await pinPrimarySite(page);
    const primarySiteName = (await page.locator('header button[name="site"]').innerText()).trim();
    await goToRoute(page, '/products');
    await expect(
      page.getByRole('heading', { name: /products|productos/i, level: 1 })
    ).toBeVisible();
    await createProduct(page, {
      name: PRODUCT_NAME,
      sku: PRODUCT_SKU,
      stock: String(OPENING_STOCK),
      price: '4200',
    });

    const transferId = await createDeferredTransfer(page, primarySiteName);
    await expectSiteStock(page, primarySiteName, IN_TRANSIT_STOCK);
    await expectSiteStock(page, SECONDARY_SITE_NAME, 0);
    await expectAggregateStock(page, IN_TRANSIT_STOCK);

    await page.getByRole('button', { name: /by site|por sede/i }).click();
    await receiveWithShortage(page, transferId);
    await expectSiteStock(page, primarySiteName, IN_TRANSIT_STOCK);
    await expectSiteStock(page, SECONDARY_SITE_NAME, RECEIVED_QUANTITY);
    await expectAggregateStock(page, FINAL_AGGREGATE_STOCK);

    // Explicit logout and fresh authentication prove the transfer read side
    // survives a new authenticated session, beyond renderer-reload continuity.
    await signOut(page);
    await signIn(page, manager.email);
    await expectPersistentTransferDetails(page, transferId);

    await signOut(page);
    await signIn(page, admin.email);
    const createResourceId = await expectTransferAudit(page, {
      action: 'transfer.create',
      manager,
      primarySiteName,
    });
    const receiveResourceId = await expectTransferAudit(page, {
      action: 'transfer.receive',
      manager,
      primarySiteName,
    });
    expect(createResourceId).toBe(transferId);
    expect(receiveResourceId).toBe(transferId);

    await signOut(page);
    await signIn(page, admin.email);
    const persistedCreateResourceId = await expectTransferAudit(page, {
      action: 'transfer.create',
      manager,
      primarySiteName,
    });
    const persistedReceiveResourceId = await expectTransferAudit(page, {
      action: 'transfer.receive',
      manager,
      primarySiteName,
    });
    expect(persistedCreateResourceId).toBe(transferId);
    expect(persistedReceiveResourceId).toBe(transferId);

    await expectNoClientIssues(tracker);
  });
});
