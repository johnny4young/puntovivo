import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page } from '@playwright/test';
import { ensureLanguage } from '../web/support/app.js';

/** Target-specific navigation and evidence capture for the same operator workflow. */
export interface PharmacyJourneyTarget {
  navigate: (route: string) => Promise<unknown>;
  screenshot: (name: string) => Promise<unknown>;
  /** Identity/site provisioning is explicit; no medicine or stock is seeded. */
  configureNumbering: boolean;
}

export async function selectPharmacyOption(select: Locator, text: string) {
  const option = select.locator('option').filter({ hasText: text });
  await expect(option).toHaveCount(1);
  const value = await option.getAttribute('value');
  if (!value) throw new Error(`Missing stable option identity for ${text}`);
  await select.selectOption(value);
}

async function dismissToasts(page: Page) {
  const buttons = page.locator('[role="status"] button[aria-label]');
  while ((await buttons.count()) > 0) await buttons.first().click();
}

export function pharmacyDay(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Country is an explicit operator setting, never implied by a business preset. */
export async function setPharmacyCountry(
  page: Page,
  target: PharmacyJourneyTarget,
  country: string
) {
  await target.navigate('/company?tab=locale');
  await page.getByTestId('locale-country-select').selectOption(country);
  const saved = page.waitForResponse(
    response =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/trpc/tenantLocale.update')
  );
  await page.getByTestId('locale-save').click();
  expect((await saved).status()).toBe(200);
  await page.reload();
  await expect(page.getByTestId('locale-country-select')).toHaveValue(country);
}

/** Non-clinical identifiers created by the operator for a disposable medicine. */
export interface PharmacyMedicine {
  name: string;
  sku: string;
  ingredient: string;
  registration: string;
}

/** Create the actual pharmacy extension and base-unit assignment through UI. */
export async function createPharmacyMedicine(
  page: Page,
  target: PharmacyJourneyTarget,
  medicine: PharmacyMedicine,
  unitName: string,
  classification: 'otc' | 'prescription' | 'controlled',
  coldChain = false
) {
  await target.navigate('/products');
  await expect(
    page.getByRole('heading', { name: 'Products', exact: true, level: 1 })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add Product', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Product', exact: true });
  await dialog.locator('#product-name').fill(medicine.name);
  await dialog.locator('#product-sku').fill(medicine.sku);
  await dialog.getByRole('tab', { name: 'Pricing', exact: true }).click();
  await dialog.locator('input[name="price"]').fill('1000');
  await dialog.getByRole('tab', { name: 'Pharmacy', exact: true }).click();
  await expect(
    dialog.getByRole('checkbox', { name: /Manage this product as a medicine/ })
  ).toBeChecked();
  await dialog.getByLabel('Active ingredient', { exact: true }).fill(medicine.ingredient);
  await dialog.getByLabel('Generic name', { exact: true }).fill(medicine.ingredient);
  await dialog
    .getByLabel('Dispensing classification', { exact: true })
    .selectOption(classification);
  await dialog.getByLabel('Sanitary registration', { exact: true }).fill(medicine.registration);
  await dialog.getByLabel('Registration expiry', { exact: true }).fill(pharmacyDay(365));
  await dialog.getByRole('checkbox', { name: /Requires cold chain/ }).setChecked(coldChain);
  await dialog.getByRole('tab', { name: 'Units', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add Unit', exact: true }).click();
  await selectPharmacyOption(
    dialog.getByRole('tabpanel', { name: 'Units' }).locator('select'),
    unitName
  );
  await dialog.getByRole('checkbox', { name: 'Base unit', exact: true }).check();
  await dialog.getByRole('button', { name: 'Create Product', exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** Receive exact base quantities; no inventory or lot is inserted by the fixture. */
export async function receivePharmacyLots(
  page: Page,
  target: PharmacyJourneyTarget,
  medicine: PharmacyMedicine,
  providerName: string,
  lots: Array<{ number: string; expiry: string; quantity: number }>
) {
  await target.navigate('/purchases');
  // Client-side desktop navigation can update the URL before the previous
  // Products page unmounts. Both screens expose an Add Product button.
  await expect(
    page.getByRole('heading', { name: 'Purchases', exact: true, level: 1 })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add Product', exact: true }).first().click();
  let dialog = page.getByRole('dialog', { name: 'Add Product to Purchase', exact: true });
  await dialog.getByPlaceholder('Search by SKU, name, or barcode').fill(medicine.sku);
  await dialog.locator('tr').filter({ hasText: medicine.sku }).click();
  await dialog.getByRole('button', { name: 'Add to purchase', exact: true }).click();
  await expect(dialog).toBeHidden();
  const purchaseRow = page.locator('tr').filter({ hasText: medicine.sku });
  await purchaseRow
    .locator('input[type="number"]')
    .first()
    .fill(String(lots.reduce((sum, lot) => sum + lot.quantity, 0)));
  await purchaseRow.locator('input[type="number"]').nth(1).fill('500');
  await page.getByRole('button', { name: 'Register Purchase', exact: true }).first().click();
  dialog = page.getByRole('dialog', { name: 'Register Purchase', exact: true });
  await dialog.locator('#purchase-provider').selectOption({ label: providerName });
  for (let index = 1; index < lots.length; index++) {
    await dialog.getByRole('button', { name: 'Add lot', exact: true }).click();
  }
  for (const [index, lot] of lots.entries()) {
    await dialog.getByLabel('Lot number', { exact: true }).nth(index).fill(lot.number);
    await dialog.getByLabel('Expiry date', { exact: true }).nth(index).fill(lot.expiry);
    await dialog.getByLabel('Base quantity', { exact: true }).nth(index).fill(String(lot.quantity));
  }
  await dialog.getByRole('button', { name: 'Register Purchase', exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** Search the catalog as an operator, then open the authoritative payment checks. */
export async function openPharmacyCheckout(page: Page, query: string, sku: string) {
  await dismissToasts(page);
  await page.getByRole('button', { name: 'Search products', exact: true }).first().click();
  const search = page.getByRole('dialog', { name: 'Add product', exact: true });
  await search.getByRole('textbox', { name: 'Search', exact: true }).fill(query);
  await search.getByTestId(`product-search-row-${sku}`).click();
  await search.getByRole('button', { name: 'Add to cart', exact: true }).click();
  await expect(search).toBeHidden();
  await page.keyboard.press('F2');
  const checkout = page.getByRole('dialog', { name: 'Charge Sale', exact: true });
  await expect(checkout).toBeVisible();
  return checkout;
}

/** Real UI foundation for the pharmacy day; no prescription/legal certification claim. */
export async function runPharmacyOtcCustodyJourney(page: Page, target: PharmacyJourneyTarget) {
  const suffix = randomUUID().slice(0, 8);
  const medicine = {
    name: `E2E OTC custody ${suffix}`,
    sku: `E2E-PHARM-${suffix}`,
    ingredient: `E2E ingredient ${suffix}`,
    registration: `E2E-REG-${suffix}`,
  };
  const unitName = `E2E pharmacy pack ${suffix}`;
  const providerName = `E2E pharmacy supplier ${suffix}`;
  const lots = [
    { number: `PH-${suffix}-NEAR`, expiry: pharmacyDay(30) },
    { number: `PH-${suffix}-LATER`, expiry: pharmacyDay(60) },
  ];

  await ensureLanguage(page, 'en');
  await setPharmacyCountry(page, target, 'CO');
  await target.navigate('/company?tab=readiness');
  await page.getByTestId('company-guided-step-businessType').click();
  const pharmacyPreset = page.getByTestId('business-type-pharmacy');
  await pharmacyPreset.click();
  await expect(pharmacyPreset).toHaveAttribute('aria-pressed', 'true');

  await target.navigate('/units');
  await page.getByRole('button', { name: 'Add Unit', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Create Unit', exact: true });
  await dialog.locator('#unit-name').fill(unitName);
  await dialog.locator('#unit-abbreviation').fill(`P${suffix.slice(0, 4)}`);
  await dialog.getByRole('button', { name: 'Create Unit', exact: true }).click();
  await expect(dialog).toBeHidden();

  if (target.configureNumbering) {
    await target.navigate('/sequentials');
    for (const kind of ['sale', 'purchase']) {
      await page.getByRole('button', { name: 'Configure numbering', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Configure numbering', exact: true });
      await dialog.locator('#sequential-site').selectOption({ index: 1 });
      await dialog.locator('#sequential-document-type').selectOption(kind);
      await dialog.locator('#sequential-prefix').fill(`PH-${kind[0]}-${suffix}-`);
      await dialog.getByRole('button', { name: 'Create sequence', exact: true }).click();
      await expect(dialog).toBeHidden();
    }
  }

  await target.navigate('/providers');
  await page.getByRole('button', { name: 'Add Provider', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Create Provider', exact: true });
  await dialog.locator('#provider-name').fill(providerName);
  await dialog.getByRole('button', { name: 'Create Provider', exact: true }).click();
  await expect(dialog).toBeHidden();

  await createPharmacyMedicine(page, target, medicine, unitName, 'otc', true);
  await receivePharmacyLots(
    page,
    target,
    medicine,
    providerName,
    lots.map(lot => ({ ...lot, quantity: 4 }))
  );

  await target.navigate('/sales');
  await page.getByRole('button', { name: 'Open cash session', exact: true }).first().click();
  dialog = page.getByRole('dialog', { name: 'Open cash session', exact: true });
  await dialog.locator('#cash-session-register').fill(`Pharmacy ${suffix}`);
  await dialog.locator('#cash-session-opening-float').fill('0');
  await dialog.getByRole('button', { name: 'Open session', exact: true }).click();
  await expect(dialog).toBeHidden();
  dialog = await openPharmacyCheckout(page, medicine.ingredient, medicine.sku);
  await expect(dialog).toContainText('Policy context: CO');
  await expect(dialog).toContainText('No prescription evidence is required for this OTC medicine.');
  await expect(dialog.locator('#sale-payment-confirm')).toBeEnabled();
  await dialog.locator('#sale-payment-confirm').click();
  await expect(dialog).toBeHidden();
  await target.screenshot('pharmacy-otc-sale');

  await target.navigate('/inventory?view=pharmacy');
  await page.getByLabel('Search medicines', { exact: true }).fill(medicine.registration);
  await selectPharmacyOption(page.locator('#pharmacy-lot-product'), medicine.sku);
  await selectPharmacyOption(page.locator('#pharmacy-lot-id'), lots[0]!.number);
  await expect(page.locator('#pharmacy-lot-id option:checked')).toContainText('Active · 3');
  await page.locator('#pharmacy-lot-reason').fill(`E2E cold-chain incident ${suffix}`);
  await page.getByRole('button', { name: 'Record cold-chain incident', exact: true }).click();
  await expect(page.locator('#pharmacy-lot-id option:checked')).toContainText('Quarantined · 3');
  await target.screenshot('pharmacy-quarantined-lot-en');

  await ensureLanguage(page, 'es');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Operaciones de seguridad farmacéutica' })
  ).toBeVisible();
  await selectPharmacyOption(page.locator('#pharmacy-lot-product'), medicine.sku);
  await selectPharmacyOption(page.locator('#pharmacy-lot-id'), lots[0]!.number);
  await expect(page.locator('#pharmacy-lot-id option:checked')).toContainText('En cuarentena · 3');
  await target.screenshot('pharmacy-quarantined-lot-reload-es');
  return { medicine, lots, unitName, providerName };
}
