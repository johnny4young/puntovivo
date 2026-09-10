import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { ensureLanguage } from '../web/support/app.js';
import {
  createPharmacyMedicine,
  openPharmacyCheckout,
  pharmacyDay,
  receivePharmacyLots,
  selectPharmacyOption,
  type PharmacyJourneyTarget,
} from './pharmacy-operations-journey.js';

/** Existing UI-created procurement context; employee identity is a test prerequisite. */
interface PrescriptionJourneyContext {
  unitName: string;
  providerName: string;
  approverEmail: string;
}

/** A valid approval is consumed once; missing identity/evidence stays visibly blocked. */
export async function runPharmacyPrescriptionJourney(
  page: Page,
  target: PharmacyJourneyTarget,
  context: PrescriptionJourneyContext
) {
  const suffix = randomUUID().slice(0, 8);
  const medicine = {
    name: `E2E prescription custody ${suffix}`,
    sku: `E2E-RX-${suffix}`,
    ingredient: `E2E prescription ingredient ${suffix}`,
    registration: `E2E-RX-REG-${suffix}`,
  };
  const customerName = `E2E authorized buyer ${suffix}`;
  const reference = `E2E-RX-REFERENCE-${suffix}`;
  const credential = `E2E-VERIFIED-CREDENTIAL-${suffix}`;

  await ensureLanguage(page, 'en');
  await createPharmacyMedicine(page, target, medicine, context.unitName, 'prescription');
  await receivePharmacyLots(page, target, medicine, context.providerName, [
    { number: `RX-${suffix}`, expiry: pharmacyDay(90), quantity: 3 },
  ]);

  await target.navigate('/inventory?view=pharmacy');
  await page.getByRole('tab', { name: 'Professional authorizations', exact: true }).click();
  const employeeRead = page.waitForResponse(
    response =>
      response.ok() &&
      response.url().includes('/api/trpc/users.list') &&
      decodeURIComponent(response.url()).includes(context.approverEmail)
  );
  await page.getByLabel('Search employees', { exact: true }).fill(context.approverEmail);
  await employeeRead;
  const employees = page.locator('#pharmacy-authorization-user');
  await expect(employees.locator('option:not([value=""])')).toHaveCount(1);
  await employees.selectOption({ index: 1 });
  await page.getByLabel('Verified credential', { exact: true }).fill(credential);
  await page.getByLabel('Valid from', { exact: true }).fill(pharmacyDay(-1));
  await page.getByLabel('Valid until', { exact: true }).fill(pharmacyDay(365));
  await page.getByRole('button', { name: 'Register authorization', exact: true }).click();
  await expect(page.getByLabel('Verified credential', { exact: true })).toHaveValue('');
  await expect(
    page.getByText('Professional authorization registered', { exact: true })
  ).toBeVisible();

  await target.navigate('/customers');
  await page.getByRole('button', { name: 'Add Customer', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Create Customer', exact: true });
  await dialog.locator('#customer-name').fill(customerName);
  await dialog.getByRole('button', { name: 'Create Customer', exact: true }).click();
  await expect(dialog).toBeHidden();

  await target.navigate('/sales');
  dialog = await openPharmacyCheckout(page, medicine.sku, medicine.sku);
  await expect(dialog.locator('#sale-payment-confirm')).toBeDisabled();
  await expect(dialog).toContainText(
    'Select the authorized customer before dispensing this medicine.'
  );
  await selectPharmacyOption(dialog.getByLabel('Customer', { exact: true }), customerName);
  await expect(dialog).toContainText('No approved evidence has enough remaining quantity.');
  await expect(dialog.locator('#sale-payment-confirm')).toBeDisabled();
  await dialog
    .getByRole('region', { name: 'Pharmacy policy', exact: true })
    .scrollIntoViewIfNeeded();
  await target.screenshot('pharmacy-prescription-blocked-without-evidence');

  await dialog.locator('summary').filter({ hasText: 'Record prescription evidence' }).click();
  await dialog.getByLabel('Prescription reference', { exact: true }).fill(reference);
  await dialog.getByLabel('Prescriber name', { exact: true }).fill(`E2E prescriber ${suffix}`);
  await dialog.getByLabel('Prescriber credential', { exact: true }).fill(`E2E license ${suffix}`);
  await dialog.getByLabel('Authorized quantity', { exact: true }).fill('1');
  await dialog.getByLabel('Valid from', { exact: true }).fill(pharmacyDay(0));
  await dialog.getByLabel('Expires on', { exact: true }).fill(pharmacyDay(-1));
  await expect(dialog.getByRole('button', { name: 'Record evidence', exact: true })).toBeDisabled();
  await expect(dialog).toContainText('The prescription expiry cannot be before its start date.');
  await dialog.getByLabel('Expires on', { exact: true }).fill(pharmacyDay(30));
  await dialog.getByRole('button', { name: 'Record evidence', exact: true }).click();
  await expect(dialog.getByLabel('Prescription reference', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('Prescriber credential', { exact: true })).toHaveValue('');
  await expect(dialog.locator('#sale-payment-confirm')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Approve and select evidence', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: /^Select evidence / })).toBeChecked();
  await expect(dialog.locator('#sale-payment-confirm')).toBeEnabled();
  await dialog
    .getByRole('region', { name: 'Pharmacy policy', exact: true })
    .scrollIntoViewIfNeeded();
  await target.screenshot('pharmacy-prescription-approved-for-checkout');
  await dialog.locator('#sale-payment-confirm').click();
  await expect(dialog).toBeHidden();

  // A second cart cannot select the exhausted authorization, even after reload.
  await page.reload();
  dialog = await openPharmacyCheckout(page, medicine.sku, medicine.sku);
  await selectPharmacyOption(dialog.getByLabel('Customer', { exact: true }), customerName);
  await expect(dialog).toContainText('No approved evidence has enough remaining quantity.');
  await expect(dialog.getByRole('checkbox', { name: /^Select evidence / })).toHaveCount(0);
  await expect(dialog.locator('#sale-payment-confirm')).toBeDisabled();
  await dialog
    .getByRole('region', { name: 'Pharmacy policy', exact: true })
    .scrollIntoViewIfNeeded();
  await target.screenshot('pharmacy-consumed-evidence-cannot-be-reused');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Clear cart', exact: true }).click();
  await expect(page.getByTestId(`sale-cart-item-${medicine.sku}`)).toHaveCount(0);

  // Registration, stock and a professional authorization are not a controlled-
  // medicine license. The product must remain blocked without an override.
  const controlled = {
    name: `E2E controlled custody ${suffix}`,
    sku: `E2E-CONTROLLED-${suffix}`,
    ingredient: `E2E controlled ingredient ${suffix}`,
    registration: `E2E-CONTROLLED-REG-${suffix}`,
  };
  await createPharmacyMedicine(page, target, controlled, context.unitName, 'controlled');
  await receivePharmacyLots(page, target, controlled, context.providerName, [
    { number: `CONTROLLED-${suffix}`, expiry: pharmacyDay(90), quantity: 1 },
  ]);
  await target.navigate('/sales');
  dialog = await openPharmacyCheckout(page, controlled.sku, controlled.sku);
  await expect(dialog).toContainText(
    'Controlled medicines are disabled until the required external authorization is validated.'
  );
  await expect(dialog.locator('#sale-payment-confirm')).toBeDisabled();
  await expect(
    dialog.getByRole('button', { name: 'Approve and select evidence', exact: true })
  ).toHaveCount(0);
  await dialog
    .getByRole('region', { name: 'Pharmacy policy', exact: true })
    .scrollIntoViewIfNeeded();
  await target.screenshot('pharmacy-controlled-medicine-remains-blocked');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Clear cart', exact: true }).click();
  await expect(page.getByTestId(`sale-cart-item-${controlled.sku}`)).toHaveCount(0);

  await target.navigate('/inventory?view=pharmacy');
  await page.getByRole('tab', { name: 'Prescription evidence', exact: true }).click();
  await page.locator('#pharmacy-evidence-status').selectOption('consumed');
  const evidence = page.getByRole('row').filter({ hasText: medicine.name });
  await expect(evidence).toHaveCount(1);
  await expect(evidence).toContainText('Consumed');
  await expect(evidence).toContainText(customerName);
  await expect(page.getByText(reference, { exact: true })).toHaveCount(0);
  await expect(page.getByText(credential, { exact: true })).toHaveCount(0);
  await target.screenshot('pharmacy-consumed-evidence-register');
  return { medicine, controlled, reference, credential, customerName };
}
