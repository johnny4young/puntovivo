import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { ensureLanguage } from '../web/support/app.js';
import {
  runPharmacyOtcCustodyJourney,
  selectPharmacyOption,
  type PharmacyJourneyTarget,
} from './pharmacy-operations-journey.js';

/** Open a count using operator controls and assert the actual response remains blind. */
async function startCount(
  page: Page,
  target: PharmacyJourneyTarget,
  name: string,
  sku: string,
  absentSerials: string[] = []
) {
  await target.navigate('/inventory');
  await page.getByRole('button', { name: 'Counts & Restock', exact: true }).click();
  await page.getByRole('button', { name: 'New count', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Start blind count' });
  await create.getByLabel('Products', { exact: true }).fill(sku);
  await create.getByRole('checkbox', { name: `Select ${name}`, exact: true }).check();
  const response = page.waitForResponse(
    candidate =>
      candidate.request().method() === 'POST' &&
      new URL(candidate.url()).pathname.includes('inventory.createCountSession')
  );
  await create.getByRole('button', { name: 'Start count', exact: true }).click();
  const actual = await response;
  expect(actual.status()).toBe(200);
  const body = await actual.text();
  for (const serial of absentSerials) expect(body).not.toContain(serial);
  const dialog = page.getByRole('dialog', { name: 'Inventory count', exact: true });
  await expect(dialog.getByText('Blind mode is active')).toBeVisible();
  await expect(dialog.getByRole('columnheader', { name: 'Expected', exact: true })).toHaveCount(0);
  return dialog;
}

/** Shared live web/Electron acceptance: precise lot variance, then serial shortage and rediscovery. */
export async function runInventoryIdentityCountJourney(page: Page, target: PharmacyJourneyTarget) {
  const foundation = await runPharmacyOtcCustodyJourney(page, target);
  await ensureLanguage(page, 'en');
  let dialog = await startCount(page, target, foundation.medicine.name, foundation.medicine.sku);
  await expect(
    dialog.getByRole('button', { name: 'Submit for review', exact: true })
  ).toBeDisabled();
  await dialog
    .getByRole('spinbutton', {
      name: `Counted quantity for ${foundation.medicine.name}, lot ${foundation.lots[0]!.number}`,
      exact: true,
    })
    .fill('2');
  await dialog
    .getByRole('spinbutton', {
      name: `Counted quantity for ${foundation.medicine.name}, lot ${foundation.lots[1]!.number}`,
      exact: true,
    })
    .fill('5');
  await dialog.getByRole('button', { name: 'Save progress', exact: true }).click();
  await expect(page.getByText('Count progress saved', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Counts & Restock', exact: true }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).first().click();
  dialog = page.getByRole('dialog', { name: 'Inventory count', exact: true });
  await expect(
    dialog.getByRole('spinbutton', {
      name: `Counted quantity for ${foundation.medicine.name}, lot ${foundation.lots[0]!.number}`,
      exact: true,
    })
  ).toHaveValue('2');
  await dialog.getByRole('button', { name: 'Submit for review', exact: true }).click();
  await expect(dialog.getByText('Awaiting approval', { exact: true })).toBeVisible();
  await expect(dialog.getByText('2 identity discrepancies', { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole('columnheader', { name: 'Net quantity change', exact: true })
  ).toBeVisible();
  await dialog.locator('summary').filter({ hasText: 'Review exact identities' }).click();
  await expect(dialog.getByText('Expected 3 · Counted 2', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Expected 4 · Counted 5', { exact: true })).toBeVisible();
  await target.screenshot('identity-count-lot-review-en');
  await dialog.getByRole('button', { name: 'Approve discrepancies', exact: true }).click();
  await expect(dialog.getByText('Approved', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await target.navigate('/inventory?view=pharmacy');
  await selectPharmacyOption(page.locator('#pharmacy-lot-product'), foundation.medicine.sku);
  await selectPharmacyOption(page.locator('#pharmacy-lot-id'), foundation.lots[0]!.number);
  await expect(page.locator('#pharmacy-lot-id option:checked')).toContainText('Quarantined · 2');
  await selectPharmacyOption(page.locator('#pharmacy-lot-id'), foundation.lots[1]!.number);
  await expect(page.locator('#pharmacy-lot-id option:checked')).toContainText('Active · 5');

  const suffix = randomUUID().slice(0, 8);
  const name = `E2E Count Tablet ${suffix}`;
  const sku = `COUNT-SERIAL-${suffix}`;
  const serials = [`COUNT-${suffix}-A`, `COUNT-${suffix}-B`].map(code => code.toUpperCase());
  await target.navigate('/products');
  await page.getByRole('button', { name: 'Add Product', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Create Product', exact: true });
  await dialog.locator('#product-name').fill(name);
  await dialog.locator('#product-sku').fill(sku);
  await dialog.getByRole('tab', { name: 'Pharmacy', exact: true }).click();
  await dialog.getByRole('checkbox', { name: /^Manage this product as a medicine/ }).uncheck();
  await dialog.getByRole('tab', { name: 'General', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Track lots and expiry', exact: true }).uncheck();
  await dialog.getByRole('checkbox', { name: 'Track serial numbers', exact: true }).check();
  await dialog.getByRole('tab', { name: 'Units', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add Unit', exact: true }).click();
  await dialog
    .getByRole('tabpanel', { name: 'Units', exact: true })
    .locator('select')
    .selectOption({ index: 1 });
  await dialog.getByRole('checkbox', { name: 'Base unit', exact: true }).check();
  await dialog.getByRole('button', { name: 'Create Product', exact: true }).click();
  await expect(dialog).toBeHidden();
  await target.navigate('/inventory');
  await page.getByRole('button', { name: 'New Entry', exact: true }).click();
  dialog = page.getByRole('dialog', { name: /Select Product for Initial Inventory/ });
  await dialog.getByPlaceholder('Search by SKU, name, or barcode').fill(sku);
  await dialog.getByTestId(`product-search-row-${sku}`).click();
  await dialog.getByRole('button', { name: 'Record Entry', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Receive Serialized Units', exact: true });
  await dialog.getByLabel('Serial numbers', { exact: true }).fill(serials.join('\n'));
  await dialog.getByLabel('Warranty expiry (optional)', { exact: true }).fill('2030-12-31');
  await dialog.getByRole('button', { name: 'Save Entry', exact: true }).click();
  await expect(dialog).toBeHidden();

  for (const [index, codes] of [[serials[0]!], serials].entries()) {
    dialog = await startCount(page, target, name, sku, serials);
    await dialog
      .getByRole('textbox', { name: `Counted serial numbers for ${name}`, exact: true })
      .fill(codes.join('\n').toLowerCase());
    await target.screenshot(`identity-count-serial-blind-${index}`);
    await dialog.getByRole('button', { name: 'Submit for review', exact: true }).click();
    await expect(dialog.getByText('Awaiting approval', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Approve discrepancies', exact: true }).click();
    await expect(dialog.getByText('Approved', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await target.navigate('/inventory');
    await page.getByLabel('Serial number', { exact: true }).fill(serials[1]!.toLowerCase());
    await page.getByRole('button', { name: 'Look up', exact: true }).click();
    const card = page.locator('dl').filter({ hasText: name });
    await expect(card).toContainText(index === 0 ? 'Missing after physical count' : 'In stock');
    await page.reload();
  }
  await ensureLanguage(page, 'es');
  await page.reload();
  await page.getByLabel('Número de serie', { exact: true }).fill(serials[1]!.toLowerCase());
  await page.getByRole('button', { name: 'Consultar', exact: true }).click();
  await expect(page.locator('dl').filter({ hasText: name })).toContainText('En stock');
  await target.screenshot('identity-count-serial-restored-es');
  await page.getByRole('button', { name: 'Conteos y reposición', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir', exact: true }).first().click();
  dialog = page.getByRole('dialog', { name: 'Conteo de inventario', exact: true });
  await expect(dialog.getByText('Aprobado', { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole('columnheader', { name: 'Cambio neto de cantidad', exact: true })
  ).toBeVisible();
  const review = dialog.locator('summary').filter({ hasText: 'Revisar identidades exactas' });
  await expect(review).toContainText('1 diferencia por identidad');
  await review.click();
  await expect(dialog.getByText('Esperado 0 · Contado 1', { exact: true })).toBeVisible();
  await target.screenshot('identity-count-review-es');

  return { ...foundation, serialSku: sku, serials };
}
