/**
 * Pharmacy metadata search is paid for only by tenants that own pharmacy data.
 *
 * `products.list` and the literal lane of `products.search` can match a
 * product through its regulated metadata (active ingredient, generic name,
 * sanitary registration, manufacturer). Evaluating those predicates costs a
 * `pharmacy_product_profiles` join probe for every scanned product, and the
 * search lane is a second full scan of the catalog. A catalog with no pharmacy
 * profile can never match through them, so a retail tenant must not pay for it.
 *
 * The switch is the tenant's own profile data, not the vertical preset:
 * `hasPharmacyOperationalData` documents that leaving the pharmacy preset must
 * not hide medicines that still exist, so a tenant that switched presets keeps
 * finding them by active ingredient.
 *
 * @module __tests__/products-search-pharmacy-scope.test
 */

import type Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { tenants } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

const NOW = '2026-09-11T00:00:00.000Z';

/** A LIKE predicate over any regulated metadata column, as Drizzle renders it. */
const PHARMACY_PREDICATE =
  /"pharmacy_product_profiles"\."(?:active_ingredient|generic_name|sanitary_registration|manufacturer)" LIKE/i;

const TENANTS = {
  retail: 'scope-retail-tenant',
  pharmacy: 'scope-pharmacy-tenant',
  // Left the pharmacy preset but still owns a medicine profile.
  switched: 'scope-switched-tenant',
} as const;

/** Within-token fragments: FTS prefix phrases cannot reach them, LIKE can. */
const METADATA_FRAGMENTS = {
  activeIngredient: 'nerIngredient',
  genericName: 'nerGeneric',
  sanitaryRegistration: 'M00123',
  manufacturer: 'nerMaker',
} as const;

let server: PuntovivoServer;

function liveClient(): Database.Database {
  return (getDatabase() as unknown as { $client: Database.Database }).$client;
}

function callerFor(tenantId: string) {
  return appRouter.createCaller({
    req: {
      server: server.app,
      headers: {},
      user: {
        userId: `${tenantId}-user`,
        email: `${tenantId}@example.test`,
        role: 'admin',
        tenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db: getDatabase(),
    user: { id: `${tenantId}-user`, email: `${tenantId}@example.test`, role: 'admin', tenantId },
    tenantId,
    siteId: null,
  });
}

/** Every SQL statement prepared while `run` executes. */
async function capturingSql<T>(
  run: () => Promise<T>
): Promise<{ result: T; statements: string[] }> {
  const prepare = vi.spyOn(liveClient(), 'prepare');
  try {
    const result = await run();
    return { result, statements: prepare.mock.calls.map(([source]) => String(source)) };
  } finally {
    prepare.mockRestore();
  }
}

function insertProduct(tenantId: string, id: string, name: string, sku: string): void {
  liveClient()
    .prepare(
      `INSERT INTO products (id, tenant_id, name, sku, price, created_at, updated_at)
       VALUES (?, ?, ?, ?, 10, ?, ?)`
    )
    .run(id, tenantId, name, sku, NOW, NOW);
}

function insertMedicineProfile(tenantId: string, productId: string): void {
  liveClient()
    .prepare(
      `INSERT INTO pharmacy_product_profiles (
         product_id, tenant_id, active_ingredient, generic_name, manufacturer,
         sanitary_registration, sanitary_registration_normalized,
         registration_expires_at, classification, requires_cold_chain, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, '2030-12-31', 'otc', 0, ?, ?)`
    )
    .run(
      productId,
      tenantId,
      'Acetaminofen InnerIngredientToken',
      'Paracetamol InnerGenericToken',
      'Laboratorio InnerMakerToken',
      'INVIMA2030M0012345',
      'INVIMA2030M0012345',
      NOW,
      NOW
    );
}

describe('pharmacy metadata search scope', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    for (const [shape, id] of Object.entries(TENANTS)) {
      await db.insert(tenants).values({
        id,
        name: `Scope ${shape}`,
        slug: id,
        settings: { businessType: shape === 'pharmacy' ? 'pharmacy' : 'retail' },
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      });
    }

    insertProduct(TENANTS.retail, 'scope-retail-shelf', 'Shelf widget RetailInnerToken', 'RET-1');
    insertProduct(TENANTS.pharmacy, 'scope-pharmacy-medicine', 'Analgesic tablets', 'PH-1');
    insertMedicineProfile(TENANTS.pharmacy, 'scope-pharmacy-medicine');
    insertProduct(TENANTS.switched, 'scope-switched-medicine', 'Analgesic syrup', 'SW-1');
    insertMedicineProfile(TENANTS.switched, 'scope-switched-medicine');

    // Warm the cached exact, FTS and hydration statements so every capture
    // below records only the statements the lane under test builds per call.
    for (const id of Object.values(TENANTS)) {
      await callerFor(id).products.search({ q: 'warmup' });
    }
  });

  afterAll(async () => {
    await server.close();
  });

  describe('a tenant without pharmacy profiles', () => {
    it('lists by name without evaluating or counting through pharmacy metadata', async () => {
      const caller = callerFor(TENANTS.retail);
      const { result, statements } = await capturingSql(() =>
        caller.products.list({ page: 1, perPage: 20, search: 'etailInner' })
      );

      expect(result.items.map(item => item.id)).toEqual(['scope-retail-shelf']);
      expect(result.totalItems).toBe(1);
      expect(statements.some(statement => PHARMACY_PREDICATE.test(statement))).toBe(false);
      const count = statements.find(statement => /count\(\*\)/i.test(statement));
      expect(count, 'the list page must still count its matches').toBeDefined();
      expect(count).not.toMatch(/pharmacy_product_profiles/);
    });

    it('does not run the pharmacy literal lane when the catalog lane finds nothing', async () => {
      const caller = callerFor(TENANTS.retail);
      const { result, statements } = await capturingSql(() =>
        caller.products.search({ q: METADATA_FRAGMENTS.activeIngredient })
      );

      expect(result.items).toEqual([]);
      expect(statements.some(statement => PHARMACY_PREDICATE.test(statement))).toBe(false);
    });

    it('still honours an explicit pharmacy-only request', async () => {
      // The operator asked for medicines, so the pharmacy lane must run and
      // prove there are none rather than silently falling back to the catalog.
      const caller = callerFor(TENANTS.retail);
      const { result, statements } = await capturingSql(() =>
        caller.products.search({ q: 'etailInner', pharmacyOnly: true })
      );

      expect(result.items).toEqual([]);
      expect(statements.some(statement => PHARMACY_PREDICATE.test(statement))).toBe(true);
    });
  });

  describe('a tenant that owns pharmacy profiles', () => {
    for (const [field, fragment] of Object.entries(METADATA_FRAGMENTS)) {
      it(`matches ${field} through list and both search lanes`, async () => {
        const caller = callerFor(TENANTS.pharmacy);

        const page = await caller.products.list({ page: 1, perPage: 20, search: fragment });
        expect(page.items.map(item => item.id)).toEqual(['scope-pharmacy-medicine']);
        expect(page.totalItems).toBe(1);

        expect((await caller.products.search({ q: fragment })).items.map(item => item.id)).toEqual([
          'scope-pharmacy-medicine',
        ]);
        expect(
          (await caller.products.search({ q: fragment, pharmacyOnly: true })).items.map(
            item => item.id
          )
        ).toEqual(['scope-pharmacy-medicine']);
      });
    }

    it('keeps finding medicines after the tenant leaves the pharmacy preset', async () => {
      // Guards the guard: keying the lane off businessType would pass every
      // retail assertion above and hide this tenant's medicines.
      const caller = callerFor(TENANTS.switched);
      const fragment = METADATA_FRAGMENTS.activeIngredient;

      const page = await caller.products.list({ page: 1, perPage: 20, search: fragment });
      expect(page.items.map(item => item.id)).toEqual(['scope-switched-medicine']);
      expect((await caller.products.search({ q: fragment })).items.map(item => item.id)).toEqual([
        'scope-switched-medicine',
      ]);
    });

    it('never matches another tenant through its pharmacy metadata', async () => {
      const retail = await callerFor(TENANTS.retail).products.list({
        page: 1,
        perPage: 20,
        search: METADATA_FRAGMENTS.manufacturer,
      });
      expect(retail.items).toEqual([]);
      expect(retail.totalItems).toBe(0);
    });
  });
});
