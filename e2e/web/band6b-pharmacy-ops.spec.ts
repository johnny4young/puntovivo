import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  login,
} from './support/app';
import { seedSurfaceGateScenario } from './support/db';

function seedBand6bPharmacyScenario(seed: string) {
  const scenario = seedSurfaceGateScenario(seed, {});
  const db = new Database(join(process.cwd(), 'packages/server/data/local.db'));
  db.pragma('busy_timeout = 5000');
  const now = new Date().toISOString();
  const suffix = seed.slice(-6).replace(/[^a-zA-Z0-9]/g, 'x');
  const unitId = `u-6b-${suffix}`;
  const boxId = `p-6b-box-${suffix}`;
  const blisterId = `p-6b-blis-${suffix}`;
  const boxLotId = `lot-6b-box-${suffix}`;
  const customerId = `cust-6b-${suffix}`;
  const boxSku = `LOR-BOX-${suffix}`;
  const blisterSku = `LOR-BLIS-${suffix}`;
  const lotNumber = `L-6B-${suffix}`;
  const expiryDate = '2028-12-31';
  const registration = `INVIMA 2025M-6B${suffix}`;
  const customerName = `Paciente 6B ${suffix}`;

  try {
    db.transaction(() => {
      db.prepare('update tenants set settings = ?, updated_at = ? where id = ?').run(
        JSON.stringify({
          businessType: 'pharmacy',
          modules: { pharmacy: true },
          registerZones: { 'pharmacy-lot': true },
        }),
        now,
        scenario.tenantId
      );
      db.prepare(
        `insert into tenant_locale_settings (tenant_id, country_code, updated_at)
         values (?, 'CO', ?)
         on conflict(tenant_id) do update set country_code = 'CO', updated_at = excluded.updated_at`
      ).run(scenario.tenantId, now);

      db.prepare(
        `insert into units (
          id, tenant_id, name, abbreviation, dimension, standard_code,
          reference_factor, is_active, created_at, updated_at
        ) values (?, ?, 'Unidad', 'UND', 'count', 'H87', 1, 1, ?, ?)`
      ).run(unitId, scenario.tenantId, now, now);

      const meds = [
        {
          id: boxId,
          name: `Loratadina Marca Caja x 30 ${suffix}`,
          sku: boxSku,
          price: 30000,
          cost: 15000,
          presentation: 'Caja x 30 tabletas',
          doses: 30,
          stock: 2,
        },
        {
          id: blisterId,
          name: `Loratadina Genfar Blíster x 10 ${suffix}`,
          sku: blisterSku,
          price: 6000,
          cost: 3000,
          presentation: 'Blíster x 10 tabletas',
          doses: 10,
          stock: 0,
        },
      ];

      for (const m of meds) {
        db.prepare(
          `insert into products (
            id, tenant_id, name, sku, price, price2, price3, cost, initial_cost,
            tracks_stock, tracks_lots, tracks_serials, is_active, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0, 1, ?, ?)`
        ).run(
          m.id,
          scenario.tenantId,
          m.name,
          m.sku,
          m.price,
          m.price,
          m.price,
          m.cost,
          m.cost,
          now,
          now
        );
        db.prepare(
          `insert into unit_x_product (
            id, product_id, unit_id, equivalence, price, is_base, created_at, updated_at
          ) values (?, ?, ?, 1, ?, 1, ?, ?)`
        ).run(`uxp-${m.id}`, m.id, unitId, m.price, now, now);
        db.prepare(
          `insert into pharmacy_product_profiles (
            product_id, tenant_id, active_ingredient, generic_name, concentration,
            dosage_form, administration_route, presentation, doses_per_pack,
            sanitary_registration, sanitary_registration_normalized, registration_expires_at,
            classification, requires_cold_chain, created_at, updated_at
          ) values (?, ?, 'Loratadina', 'Loratadina', '10 mg', 'Tableta', 'Oral', ?, ?, ?, ?, '2029-12-31', 'otc', 0, ?, ?)`
        ).run(
          m.id,
          scenario.tenantId,
          m.presentation,
          m.doses,
          registration,
          registration.toUpperCase(),
          now,
          now
        );
      }

      // Seed active lot & site balance for box SKU
      db.prepare(
        `insert into inventory_lots (
          id, tenant_id, site_id, product_id, lot_number, expires_at,
          on_hand, unit_cost, carrying_value_cents, valuation_quantity,
          status, received_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, 2, 15000, 3000000, 2, 'active', ?, ?, ?)`
      ).run(
        boxLotId,
        scenario.tenantId,
        scenario.site.id,
        boxId,
        lotNumber,
        expiryDate,
        now,
        now,
        now
      );

      db.prepare(
        `insert into inventory_balances (
          id, tenant_id, site_id, product_id, on_hand, created_at, updated_at
        ) values (?, ?, ?, ?, 2, ?, ?)`
      ).run(`bal-${boxId}`, scenario.tenantId, scenario.site.id, boxId, now, now);

      db.prepare(
        `insert into customers (
          id, tenant_id, name, tax_id, is_active, privacy_status, created_at, updated_at
        ) values (?, ?, ?, '1020304050', 1, 'active', ?, ?)`
      ).run(customerId, scenario.tenantId, customerName, now, now);
    })();
  } finally {
    db.close();
  }

  return {
    ...scenario,
    boxId,
    blisterId,
    boxSku,
    blisterSku,
    lotNumber,
    registration,
    customerId,
    customerName,
  };
}

test.describe('Band 6B — Pharmacy fractionation, per-dose generics, Res. 1403 logbook, INVIMA & FNE', () => {
  test('fractionates box to blister preserving FEFO lot, logs Res. 1403 excursion, imports INVIMA CSV, and shows per-dose generic + allergy alert in POS', async ({
    page,
  }, info) => {
    const scenario = seedBand6bPharmacyScenario(`band6b-ops-${info.parallelIndex}-${Date.now()}`);
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    await login(page, { ...scenario.admin, defaultPath: '/company' });
    await ensureLanguage(page, 'es');

    // 1. Open Pharmacy Operations Panel
    await page.goto('/inventory?view=pharmacy', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#pharmacy-tab-fractionation')).toBeVisible({ timeout: 15_000 });

    // 2. Regulated fractionation: 1 Box -> 3 Blisters preserving lot & registration
    await page.locator('#pharmacy-tab-fractionation').click();
    await expect(page.getByTestId('pharmacy-fractionation-panel')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('pharmacy-frac-source-product').selectOption(scenario.boxId);
    await expect(
      page.locator(`[data-testid="pharmacy-frac-source-lot"] option[value^="lot-6b"]`)
    ).toBeAttached({ timeout: 15_000 });
    const lotValue = await page
      .locator(`[data-testid="pharmacy-frac-source-lot"] option[value^="lot-6b"]`)
      .getAttribute('value');
    await page.getByTestId('pharmacy-frac-source-lot').selectOption(lotValue!);
    await page.getByTestId('pharmacy-frac-target-product').selectOption(scenario.blisterId);
    await page.getByTestId('pharmacy-frac-source-qty').fill('1');
    await page.getByTestId('pharmacy-frac-target-qty').fill('3');
    await page.getByTestId('pharmacy-frac-reason').fill('Apertura de caja para venta por blíster');
    await page.getByTestId('pharmacy-frac-submit').click();
    await expect(page.getByTestId('pharmacy-frac-history-row').first()).toContainText(
      scenario.lotNumber,
      { timeout: 15_000 }
    );

    // 3. Daily Temperature & Humidity Logbook (Res. 1403/2007) — out-of-range fridge reading
    await page.locator('#pharmacy-tab-environmental').click();
    await expect(page.getByTestId('pharmacy-environmental-panel')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('pharmacy-env-period').selectOption('afternoon');
    await page.getByTestId('pharmacy-env-zone').selectOption('refrigerator');
    await page.getByTestId('pharmacy-env-temp').fill('10.2');
    await expect(page.getByTestId('pharmacy-env-out-of-range-alert')).toBeVisible();
    await page.getByTestId('pharmacy-env-action').fill('Traslado inmediato a nevera de respaldo');
    await page.getByTestId('pharmacy-env-submit').click();
    await expect(page.getByTestId('pharmacy-env-deviation-count')).toHaveText('1', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('pharmacy-env-row').first()).toContainText(/Fuera de rango/i);

    // 4. INVIMA / CUM catalog importer
    await page.locator('#pharmacy-tab-invima').click();
    await expect(page.getByTestId('pharmacy-invima-panel')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('pharmacy-invima-load-sample').click();
    await page.getByTestId('pharmacy-invima-import').click();
    await expect(page.getByTestId('pharmacy-invima-row')).toHaveCount(3, { timeout: 15_000 });

    // 5. FNE tab -> register patient allergy to Loratadina
    await page.locator('#pharmacy-tab-fne').click();
    await expect(page.getByTestId('pharmacy-fne-panel')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('pharmacy-allergy-customer').selectOption(scenario.customerId);
    await page.getByTestId('pharmacy-allergy-ingredient').fill('Loratadina');
    await page.getByTestId('pharmacy-allergy-add').click();
    await expect(page.getByTestId('pharmacy-fne-panel')).toContainText('Loratadina', {
      timeout: 15_000,
    });

    // 6. POS Register (/sales): per-dose generic comparator & allergy safety alert
    await page.goto('/sales', { waitUntil: 'domcontentloaded' });
    const searchBtn = page.getByRole('button', { name: /^Buscar$/i }).first();
    await expect(searchBtn).toBeVisible({ timeout: 15_000 });
    await searchBtn.click();

    const searchDialog = page.getByRole('dialog');
    await expect(searchDialog).toBeVisible({ timeout: 15_000 });
    await searchDialog.getByPlaceholder(/SKU/i).fill(scenario.boxSku);
    const boxRow = searchDialog.getByTestId(`product-search-row-${scenario.boxSku}`);
    await expect(boxRow).toBeVisible({ timeout: 15_000 });
    await boxRow.click();
    await expect(
      searchDialog.getByTestId(`product-generic-choose-${scenario.blisterSku}`)
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      searchDialog.getByTestId(`product-generic-dose-${scenario.blisterSku}`)
    ).toBeVisible();

    // Pick the cheaper-per-dose blister alternative and add it to the cart
    await searchDialog.getByTestId(`product-generic-choose-${scenario.blisterSku}`).click();
    await expect(searchDialog.getByTestId(`product-search-row-${scenario.blisterSku}`)).toBeVisible(
      { timeout: 15_000 }
    );
    await searchDialog.getByRole('button', { name: /agregar al carrito/i }).click();
    await expect(searchDialog).toBeHidden({ timeout: 10_000 });

    // Attach customer with Loratadina allergy and verify alert appears in register
    const omnibox = page.getByRole('combobox', { name: /producto/i });
    await omnibox.fill(`@${scenario.customerName}`);
    const customerOption = page
      .getByRole('option', { name: new RegExp(scenario.customerName, 'i') })
      .first();
    await expect(customerOption).toBeVisible({ timeout: 10_000 });
    await customerOption.click();
    await expect(page.getByTestId('pharmacy-allergy-alert')).toBeVisible({ timeout: 15_000 });

    await expectNoClientIssues(tracker);
  });
});
