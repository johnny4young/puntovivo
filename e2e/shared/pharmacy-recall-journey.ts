import { expect, type Page } from '@playwright/test';
import { ensureLanguage } from '../web/support/app.js';
import {
  selectPharmacyOption,
  type PharmacyJourneyTarget,
  type PharmacyMedicine,
} from './pharmacy-operations-journey.js';

/** UI-created sold medicine and its two physical batches from the OTC journey. */
interface RecallJourneyContext {
  medicine: PharmacyMedicine;
  lots: Array<{ number: string; expiry: string }>;
}

/** Recall exposes the affected receipt; its return restores custody, never saleability. */
export async function runPharmacyRecallReturnJourney(
  page: Page,
  target: PharmacyJourneyTarget,
  context: RecallJourneyContext
) {
  const [nearLot, laterLot] = context.lots;
  if (!nearLot || !laterLot) throw new Error('The OTC journey must provide its two exact lots');
  await ensureLanguage(page, 'en');
  await target.navigate('/inventory?view=pharmacy');
  await page.getByRole('tab', { name: 'Recalls', exact: true }).click();
  await page.locator('#pharmacy-recall-scope').selectOption('product');
  await page.locator('#pharmacy-recall-product-search').fill(context.medicine.sku);
  await selectPharmacyOption(page.locator('#pharmacy-recall-product'), context.medicine.sku);
  await page
    .locator('#pharmacy-recall-reason')
    .fill(`E2E supplier safety notice ${context.medicine.sku}`);
  await page.getByRole('button', { name: 'Start recall and block lots', exact: true }).click();
  const detail = page.getByRole('region', { name: 'Recall detail', exact: true });
  await expect(detail).toBeVisible();
  const physicalLots = detail.locator('table').first();
  await expect(physicalLots.getByRole('row').filter({ hasText: nearLot.number })).toContainText(
    'Recalled'
  );
  await expect(physicalLots.getByRole('row').filter({ hasText: laterLot.number })).toContainText(
    'Recalled'
  );
  const affectedSale = detail
    .locator('table')
    .nth(1)
    .getByRole('row')
    .filter({ hasText: nearLot.number });
  await expect(affectedSale).toHaveCount(1);
  await expect(affectedSale).toContainText('Walk-in customer');
  const saleNumber = (await affectedSale.getByRole('cell').first().innerText()).trim();
  expect(saleNumber).not.toBe('');
  await target.screenshot('pharmacy-recall-traces-affected-receipt');

  await target.navigate('/sales');
  await page.getByTestId('sales-open-history').click();
  const history = page.getByTestId('sales-history-drawer');
  await history.getByPlaceholder('Search by invoice...').fill(saleNumber);
  await history.getByRole('button', { name: `View ${saleNumber}`, exact: true }).click();
  await expect(
    page.getByRole('heading', { name: `Sale ${saleNumber}`, exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Refund Sale', exact: true }).click();
  const refund = page.getByRole('dialog', { name: 'Process a return', exact: true });
  await refund
    .getByRole('checkbox', { name: `Return ${context.medicine.name}`, exact: true })
    .check();
  await refund.getByRole('spinbutton', { name: 'Quantity', exact: true }).fill('1');
  await refund.getByRole('button', { name: 'Wrong item', exact: true }).click();
  await refund.getByRole('button', { name: 'Confirm return', exact: true }).click();
  await expect(refund).toBeHidden();
  await expect(page.getByText('Sale refunded and stock restored', { exact: true })).toBeVisible();

  await target.navigate('/inventory?view=pharmacy');
  await page.getByRole('tab', { name: 'Lot safety', exact: true }).click();
  await selectPharmacyOption(page.locator('#pharmacy-lot-product'), context.medicine.sku);
  await selectPharmacyOption(page.locator('#pharmacy-lot-id'), nearLot.number);
  await expect(page.locator('#pharmacy-lot-id option:checked')).toContainText('Recalled · 4');
  await page
    .locator('#pharmacy-lot-reason')
    .fill('E2E cannot release a lot under an active recall');
  await expect(
    page.getByRole('button', { name: 'Release after review', exact: true })
  ).toBeDisabled();
  await target.screenshot('pharmacy-return-keeps-active-recall');
  await ensureLanguage(page, 'es');
  await page.reload();
  await selectPharmacyOption(page.locator('#pharmacy-lot-product'), context.medicine.sku);
  await selectPharmacyOption(page.locator('#pharmacy-lot-id'), nearLot.number);
  await expect(page.locator('#pharmacy-lot-id option:checked')).toContainText('Retirado · 4');
  await target.screenshot('pharmacy-recalled-return-reload-es');
  return { saleNumber };
}
