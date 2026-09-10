import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { ensureLanguage } from '../web/support/app.js';
import {
  createPharmacyMedicine,
  openPharmacyCheckout,
  pharmacyDay,
  receivePharmacyLots,
  selectPharmacyOption,
  setPharmacyCountry,
  type PharmacyJourneyTarget,
  type PharmacyMedicine,
} from './pharmacy-operations-journey.js';
import { expectPharmacyCommandRejected } from './pharmacy-rejection-assertions.js';

/** Already-created operator subjects; the next negative cases never mutate fixture DB state. */
interface ExpiryPolicyContext {
  unitName: string;
  providerName: string;
  prescription: PharmacyMedicine;
  controlled: PharmacyMedicine;
  customerName: string;
}

/** Expired stock/evidence fail at the authority; unsupported countries remain OTC-only. */
export async function runPharmacyExpiryPolicyJourney(
  page: Page,
  target: PharmacyJourneyTarget,
  context: ExpiryPolicyContext
) {
  const suffix = randomUUID().slice(0, 8);
  const medicine = {
    name: `E2E expired custody ${suffix}`,
    sku: `E2E-EXPIRED-${suffix}`,
    ingredient: `E2E expired ingredient ${suffix}`,
    registration: `E2E-EXPIRED-REG-${suffix}`,
  };
  const expiredLot = `EXPIRED-${suffix}`;
  const validLot = `VALID-${suffix}`;
  await ensureLanguage(page, 'en');
  await createPharmacyMedicine(page, target, medicine, context.unitName, 'otc');
  await receivePharmacyLots(page, target, medicine, context.providerName, [
    { number: expiredLot, expiry: pharmacyDay(-1), quantity: 2 },
  ]);
  await target.navigate('/inventory?view=pharmacy');
  await selectPharmacyOption(page.locator('#pharmacy-lot-product'), medicine.sku);
  await selectPharmacyOption(page.locator('#pharmacy-lot-id'), expiredLot);
  await expect(page.locator('#pharmacy-lot-id option:checked')).toContainText('Expired · 2');

  await target.navigate('/sales');
  let dialog = await openPharmacyCheckout(page, medicine.sku, medicine.sku);
  await expect(dialog).toContainText('No prescription evidence is required for this OTC medicine.');
  const expiredStockRejection = await expectPharmacyCommandRejected(page, {
    procedure: 'sales.create',
    status: 409,
    errorCode: 'LOT_STOCK_INCONSISTENT',
    act: () => dialog.locator('#sale-payment-confirm').click(),
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText('Lot stock or provenance is inconsistent. Reconcile it before continuing.', {
      exact: true,
    })
  ).toBeVisible();
  await target.screenshot('pharmacy-expired-lot-sale-rejected');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Clear cart', exact: true }).click();
  await expect(page.getByTestId(`sale-cart-item-${medicine.sku}`)).toHaveCount(0);

  // A correctly ordered but already-expired prescription is distinct from
  // the invalid date ordering checked by the ordinary dispensing journey.
  dialog = await openPharmacyCheckout(page, context.prescription.sku, context.prescription.sku);
  await selectPharmacyOption(dialog.getByLabel('Customer', { exact: true }), context.customerName);
  await dialog.locator('summary').filter({ hasText: 'Record prescription evidence' }).click();
  await dialog
    .getByLabel('Prescription reference', { exact: true })
    .fill(`E2E-EXPIRED-RX-${suffix}`);
  await dialog
    .getByLabel('Prescriber name', { exact: true })
    .fill(`E2E historical prescriber ${suffix}`);
  await dialog
    .getByLabel('Prescriber credential', { exact: true })
    .fill(`E2E historical credential ${suffix}`);
  await dialog.getByLabel('Authorized quantity', { exact: true }).fill('1');
  await dialog.getByLabel('Valid from', { exact: true }).fill(pharmacyDay(-10));
  await dialog.getByLabel('Expires on', { exact: true }).fill(pharmacyDay(-1));
  await dialog.getByRole('button', { name: 'Record evidence', exact: true }).click();
  const expiredEvidenceRejection = await expectPharmacyCommandRejected(page, {
    procedure: 'pharmacy.approveEvidence',
    status: 412,
    errorCode: 'PHARMACY_EVIDENCE_EXPIRED',
    act: () =>
      dialog.getByRole('button', { name: 'Approve and select evidence', exact: true }).click(),
  });
  await expect(dialog).toContainText(
    "The prescription evidence is not effective on today's business date."
  );
  await expect(dialog.locator('#sale-payment-confirm')).toBeDisabled();
  await target.screenshot('pharmacy-expired-evidence-approval-rejected');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Clear cart', exact: true }).click();
  await expect(page.getByTestId(`sale-cart-item-${context.prescription.sku}`)).toHaveCount(0);

  // Receive a separate valid batch rather than altering the expired batch.
  // OTC can operate under the fallback policy; regulated classes cannot.
  await receivePharmacyLots(page, target, medicine, context.providerName, [
    { number: validLot, expiry: pharmacyDay(90), quantity: 2 },
  ]);
  await setPharmacyCountry(page, target, 'US');
  await target.navigate('/sales');
  dialog = await openPharmacyCheckout(page, medicine.sku, medicine.sku);
  await expect(dialog).toContainText('Policy context: US');
  await expect(dialog).toContainText('No prescription evidence is required for this OTC medicine.');
  await dialog.locator('#sale-payment-confirm').click();
  await expect(dialog).toBeHidden();
  for (const regulated of [context.prescription, context.controlled]) {
    dialog = await openPharmacyCheckout(page, regulated.sku, regulated.sku);
    await expect(dialog).toContainText('Policy context: US');
    await expect(dialog).toContainText(
      'This regulated medicine cannot be sold because no reviewed policy is available for the active country and date.'
    );
    await expect(dialog.locator('#sale-payment-confirm')).toBeDisabled();
    await dialog
      .getByRole('region', { name: 'Pharmacy policy', exact: true })
      .scrollIntoViewIfNeeded();
    await target.screenshot(`pharmacy-unsupported-policy-${regulated.sku}`);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Clear cart', exact: true }).click();
    await expect(page.getByTestId(`sale-cart-item-${regulated.sku}`)).toHaveCount(0);
  }
  await page.reload();
  await target.navigate('/inventory?view=pharmacy');
  await selectPharmacyOption(page.locator('#pharmacy-lot-product'), medicine.sku);
  await selectPharmacyOption(page.locator('#pharmacy-lot-id'), expiredLot);
  await expect(page.locator('#pharmacy-lot-id option:checked')).toContainText('Expired · 2');
  await selectPharmacyOption(page.locator('#pharmacy-lot-id'), validLot);
  await expect(page.locator('#pharmacy-lot-id option:checked')).toContainText('Active · 1');
  await target.screenshot('pharmacy-fallback-otc-consumes-only-valid-lot');
  return {
    medicine,
    expiredLot,
    validLot,
    rejections: [expiredStockRejection, expiredEvidenceRejection],
  };
}
