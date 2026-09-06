import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { ensureLanguage } from '../web/support/app.js';
import {
  selectPharmacyOption,
  type PharmacyJourneyTarget,
  type PharmacyMedicine,
} from './pharmacy-operations-journey.js';

/** UI-created custody after one OTC sale and a cold-chain quarantine. */
interface TransferCustodyContext {
  medicine: PharmacyMedicine;
  lots: Array<{ number: string; expiry: string }>;
  providerName: string;
}

async function switchSite(page: Page, name: string) {
  const selector = page.locator('header button[name="site"]');
  if ((await selector.innerText()).trim() !== name) {
    await selector.click();
    await page.getByRole('listbox').getByRole('option', { name, exact: true }).click();
  }
  await expect(selector).toHaveText(name);
}

/** Transfer physical batches without releasing quarantine, then return an exact source batch. */
export async function runPharmacyTransferReturnJourney(
  page: Page,
  target: PharmacyJourneyTarget,
  context: TransferCustodyContext
) {
  const branchName = `E2E pharmacy destination ${randomUUID().slice(0, 8)}`;
  const quarantinedLot = context.lots[0]!.number;
  const activeLot = context.lots[1]!.number;
  await ensureLanguage(page, 'en');
  const originName = (await page.locator('header button[name="site"]').innerText()).trim();

  // Read the purchase identity from its supplier row, as an operator would.
  // This unique supplier has exactly one receipt in this isolated journey.
  await target.navigate('/purchases');
  const purchaseRow = page.locator('tbody tr').filter({ hasText: context.providerName });
  await expect(purchaseRow).toHaveCount(1);
  const purchaseNumber = (await purchaseRow.getByRole('cell').first().innerText()).trim();
  expect(purchaseNumber).not.toBe('');
  await purchaseRow.getByRole('button', { name: `View ${purchaseNumber}`, exact: true }).click();
  let dialog = page.getByRole('dialog', { name: `Purchase ${purchaseNumber}`, exact: true });
  await expect(dialog).toContainText(`${quarantinedLot} · received 4 · available to return 3`);
  await expect(dialog).toContainText(`${activeLot} · received 4 · available to return 4`);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();

  await target.navigate('/sites');
  await page.getByRole('button', { name: 'Add Site', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Create Site', exact: true });
  await dialog.locator('#site-name').fill(branchName);
  await dialog.getByRole('button', { name: 'Create Site', exact: true }).click();
  await expect(dialog).toBeHidden();
  await target.navigate('/inventory');
  await page.getByRole('button', { name: 'By Site', exact: true }).click();
  await selectPharmacyOption(page.locator('#inventory-balances-site'), originName);
  const originId = await page.locator('#inventory-balances-site').inputValue();
  await page.getByRole('button', { name: 'Transfer stock', exact: true }).click();
  dialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Transfer stock between sites', exact: true }),
  });
  await selectPharmacyOption(
    dialog.getByRole('combobox', { name: 'To site', exact: true }),
    branchName
  );
  const branchId = await dialog
    .getByRole('combobox', { name: 'To site', exact: true })
    .inputValue();
  await selectPharmacyOption(
    dialog.getByRole('combobox', { name: 'Product', exact: true }),
    context.medicine.sku
  );
  await dialog.getByLabel(`Quantity from lot ${quarantinedLot}`, { exact: true }).fill('1');
  await dialog.getByLabel(`Quantity from lot ${activeLot}`, { exact: true }).fill('2');
  await dialog.getByRole('checkbox', { name: /^Ship now, receive later/ }).check();
  await dialog.locator('textarea').fill('E2E exact cold-chain custody transfer');
  await dialog.getByRole('button', { name: 'Transfer', exact: true }).click();
  await expect(dialog).toBeHidden();
  const history = page.locator('.card').filter({
    has: page.getByRole('heading', { name: 'Transfer history', exact: true }),
  });
  const transfer = history.locator('tbody tr').filter({ hasText: branchName });
  await expect(transfer).toHaveCount(1);
  await expect(transfer).toContainText('In transit');
  await target.screenshot('pharmacy-lot-transfer-in-transit');

  await switchSite(page, branchName);
  await transfer.getByRole('button', { name: 'Receive', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Receive transfer', exact: true });
  await expect(
    dialog.getByLabel(`Quantity from lot ${quarantinedLot}`, { exact: true })
  ).toHaveValue('1');
  await expect(dialog.getByLabel(`Quantity from lot ${activeLot}`, { exact: true })).toHaveValue(
    '2'
  );
  await expect(dialog).toContainText('quarantined');
  await dialog.getByRole('button', { name: 'Confirm receipt', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(transfer).toContainText('Completed');
  await page.reload();
  await target.navigate('/inventory?view=pharmacy');
  await selectPharmacyOption(page.locator('#pharmacy-lot-product'), context.medicine.sku);
  await selectPharmacyOption(page.locator('#pharmacy-lot-id'), quarantinedLot);
  await expect(page.locator('#pharmacy-lot-id option:checked')).toContainText('Quarantined · 1');
  await selectPharmacyOption(page.locator('#pharmacy-lot-id'), activeLot);
  await expect(page.locator('#pharmacy-lot-id option:checked')).toContainText('Active · 2');
  await target.screenshot('pharmacy-transfer-destination-preserves-quarantine');

  await switchSite(page, originName);
  await target.navigate('/purchases');
  await page.getByPlaceholder('Search by purchase number...').fill(purchaseNumber);
  await page.getByRole('button', { name: `View ${purchaseNumber}`, exact: true }).click();
  dialog = page.getByRole('dialog', { name: `Purchase ${purchaseNumber}`, exact: true });
  await expect(dialog).toContainText(`${quarantinedLot} · received 4 · available to return 2`);
  await expect(dialog).toContainText(`${activeLot} · received 4 · available to return 2`);
  await dialog.getByRole('button', { name: 'Return Items', exact: true }).click();
  dialog = page.getByRole('dialog', { name: `Return Items for ${purchaseNumber}`, exact: true });
  await dialog.getByLabel(`Quantity from lot ${quarantinedLot}`, { exact: true }).fill('1');
  const reason = 'E2E supplier return after cold-chain quarantine';
  await dialog.getByLabel('Reason', { exact: true }).fill(reason);
  await dialog.getByRole('button', { name: 'Record Return', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await page.getByPlaceholder('Search by purchase number...').fill(purchaseNumber);
  await page.getByRole('button', { name: `View ${purchaseNumber}`, exact: true }).click();
  dialog = page.getByRole('dialog', { name: `Purchase ${purchaseNumber}`, exact: true });
  await expect(dialog).toContainText(reason);
  await expect(dialog).toContainText(`${quarantinedLot} · received 4 · available to return 1`);
  await target.screenshot('pharmacy-exact-lot-supplier-return');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await ensureLanguage(page, 'es');
  await target.navigate('/inventory?view=pharmacy');
  await selectPharmacyOption(page.locator('#pharmacy-lot-product'), context.medicine.sku);
  await selectPharmacyOption(page.locator('#pharmacy-lot-id'), quarantinedLot);
  await expect(page.locator('#pharmacy-lot-id option:checked')).toContainText('En cuarentena · 1');
  await selectPharmacyOption(page.locator('#pharmacy-lot-id'), activeLot);
  await expect(page.locator('#pharmacy-lot-id option:checked')).toContainText('Activo · 2');
  await target.screenshot('pharmacy-source-lot-return-reload-es');
  return { originId, branchId, branchName, purchaseNumber };
}
