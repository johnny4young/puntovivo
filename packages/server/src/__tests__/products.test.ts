import { TRPCError } from '@trpc/server';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  categories,
  companies,
  inventoryBalances,
  inventoryMovements,
  inventoryLots,
  locations,
  products,
  productTaxComponents,
  providers,
  sites,
  syncOutbox,
  tenants,
  unitXProduct,
  units,
  users,
  vatRates,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { applyInventoryBalanceDelta } from '../services/inventory-balances/apply-delta.js';
import { buildProductVariantPreview } from '../application/products/createVariantMatrix.js';
import { __withExpectedTestLogs } from '../logging/logger.js';
import { buildProductFtsQuery, productSearchTenantScope } from '../services/products/fts-search.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { makeEnvelopeHeadersProxy } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let categoryId: string;
let providerId: string;
let secondaryProviderId: string;
let inactiveProviderId: string;
let vatRateId: string;
let baseUnitId: string;
let boxUnitId: string;
let locationId: string;
let primarySiteId: string;
let testDeviceId: string;

function liveClient(): Database.Database {
  return (getDatabase() as unknown as { $client: Database.Database }).$client;
}

function createTestContext(): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: {},
    user: {
      userId,
      email: 'admin@localhost',
      role: 'admin',
      tenantId,
    },
    jwtVerify: async () => {},
  } as unknown as Context['req'];

  return {
    req: mockReq,
    res: {} as Context['res'],
    db,
    user: {
      id: userId,
      email: 'admin@localhost',
      role: 'admin',
      tenantId,
    },
    tenantId,
    siteId: null,
  };
}

function createCriticalTestContext(): Context {
  const context = createTestContext();
  return {
    ...context,
    siteId: primarySiteId,
    req: {
      ...context.req,
      headers: makeEnvelopeHeadersProxy({
        getDeviceId: () => testDeviceId,
        getSiteId: () => primarySiteId,
      }),
    } as Context['req'],
  };
}

describe('Products tRPC Router', () => {
  beforeAll(async () => {
    server = await createServer({
      dbPath: ':memory:',
      verbose: false,
    });

    const db = getDatabase();
    const seededUser = await db
      .select()
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!seededUser) {
      throw new Error('Expected seeded admin user');
    }

    const seededVatRate = await db
      .select()
      .from(vatRates)
      .where(and(eq(vatRates.tenantId, seededUser.tenantId), eq(vatRates.name, 'IVA 19%')))
      .get();
    if (!seededVatRate) {
      throw new Error('Expected seeded VAT rate');
    }

    tenantId = seededUser.tenantId;
    userId = seededUser.id;
    vatRateId = seededVatRate.id;
    categoryId = nanoid();
    providerId = nanoid();
    secondaryProviderId = nanoid();
    inactiveProviderId = nanoid();
    const seededUnits = await db.select().from(units).where(eq(units.tenantId, tenantId)).all();
    const baseUnit = seededUnits.find(unit => unit.abbreviation === 'UND');
    const boxUnit = seededUnits.find(unit => unit.abbreviation === 'CJ');
    if (!baseUnit || !boxUnit) {
      throw new Error('Expected seeded units');
    }
    baseUnitId = baseUnit.id;
    boxUnitId = boxUnit.id;
    locationId = nanoid();

    const primarySite = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!primarySite) {
      throw new Error('Expected seeded primary site');
    }
    primarySiteId = primarySite.id;
    testDeviceId = (
      await registerDeviceService(db, {
        tenantId,
        userId,
        kind: 'web',
        name: 'products.test',
      })
    ).deviceId;

    await db.insert(categories).values({
      id: categoryId,
      tenantId,
      name: 'Beverages',
      description: null,
      parentId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Acme Supply',
      taxId: null,
      phone: null,
      email: null,
      address: null,
      cityId: null,
      contactName: 'Main Vendor',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.insert(providers).values({
      id: secondaryProviderId,
      tenantId,
      name: 'Backup Supply',
      taxId: null,
      phone: null,
      email: null,
      address: null,
      cityId: null,
      contactName: 'Secondary Vendor',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.insert(providers).values({
      id: inactiveProviderId,
      tenantId,
      name: 'Inactive Supply',
      taxId: null,
      phone: null,
      email: null,
      address: null,
      cityId: null,
      contactName: 'Inactive Vendor',
      isActive: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.insert(locations).values({
      id: locationId,
      tenantId,
      code: 'A-01',
      name: 'Front Shelf',
      description: 'Primary retail shelf',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('creates, lists, updates, and soft deletes products with normalized pricing', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.products.create({
      name: 'Orange Juice',
      sku: 'OJ-001',
      description: 'Fresh juice',
      categoryId,
      providerId,
      vatRateId,
      locationId,
      barcode: '1234567890',
      imageUrl: null,
      cost: 100,
      initialCost: 90,
      price: 120,
      price2: 140,
      price3: 160,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      stock: 20,
      minStock: 5,
      isActive: true,
      unitAssignments: [
        { unitId: baseUnitId, equivalence: 1, price: 120, isBase: true },
        {
          unitId: boxUnitId,
          equivalence: 6,
          price: 680,
          price2: 630.125,
          price3: 600.124,
          isBase: false,
        },
      ],
    });

    expect(created.taxRate).toBe(19);
    expect(created.marginAmount1).toBe(20);
    expect(created.marginPercent2).toBe(40);
    expect(created.categoryName).toBe('Beverages');
    expect(created.providerName).toBe('Acme Supply');
    expect(created.vatRateName).toBe('IVA 19%');
    expect(created.locationName).toBe('Front Shelf');
    expect(created.unitAssignments).toHaveLength(2);
    expect(created.unitAssignments.find(item => item.isBase)?.unitId).toBe(baseUnitId);
    expect(created.unitAssignments.find(item => item.unitId === boxUnitId)).toMatchObject({
      price: 680,
      price2: 630.13,
      price3: 600.12,
    });

    const listed = await caller.products.list({ page: 1, perPage: 20, search: 'Orange' });
    expect(listed.items.some(item => item.id === created.id)).toBe(true);

    const updated = await caller.products.update({
      id: created.id,
      version: created.version,
      cost: 110,
      marginPercent1: 25,
      marginPercent2: 40,
      marginPercent3: 55,
      price: 120,
      price2: 140,
      price3: 160,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      stock: 18,
      unitAssignments: [
        { unitId: baseUnitId, equivalence: 1, price: 120, isBase: true },
        {
          unitId: boxUnitId,
          equivalence: 12,
          price: 1320,
          price2: 1240,
          price3: 1200,
          isBase: false,
        },
      ],
    });

    expect(updated.cost).toBe(110);
    expect(updated.price).toBe(120);
    expect(updated.marginAmount1).toBe(10);
    expect(updated.marginPercent1).toBeCloseTo(9.09, 2);
    expect(updated.unitAssignments.find(item => item.unitId === boxUnitId)?.equivalence).toBe(12);
    expect(updated.unitAssignments.find(item => item.unitId === boxUnitId)).toMatchObject({
      price2: 1240,
      price3: 1200,
    });

    const removed = await caller.products.delete({ id: created.id });
    expect(removed.success).toBe(true);

    const fetched = await caller.products.getById({ id: created.id });
    expect(fetched.isActive).toBe(false);
  });

  it('persists up to four tenant-owned product tax components and keeps a legacy summary', async () => {
    const db = getDatabase();
    const caller = appRouter.createCaller(createTestContext());
    const incRateId = nanoid();
    await db.insert(vatRates).values({
      id: incRateId,
      tenantId,
      name: `INC 8 ${incRateId}`,
      rate: 8,
      kind: 'inc',
      isActive: true,
    });

    const created = await caller.products.create({
      name: 'Mixed tax product',
      sku: `MIX-${nanoid(6)}`,
      price: 127,
      taxComponents: [{ vatRateId }, { vatRateId: incRateId }],
    });
    expect(created).toMatchObject({ taxRate: 27, taxKind: 'iva', vatRateId });
    expect(created.taxComponents).toEqual([
      expect.objectContaining({ vatRateId, taxKind: 'iva', taxRate: 19, position: 0 }),
      expect.objectContaining({ vatRateId: incRateId, taxKind: 'inc', taxRate: 8, position: 1 }),
    ]);
    expect(
      await db
        .select()
        .from(productTaxComponents)
        .where(
          and(
            eq(productTaxComponents.tenantId, tenantId),
            eq(productTaxComponents.productId, created.id)
          )
        )
    ).toHaveLength(2);

    const renamed = await caller.products.update({
      id: created.id,
      version: created.version,
      name: 'Mixed tax product renamed',
    });
    expect(renamed.taxComponents).toEqual([
      expect.objectContaining({ vatRateId, taxKind: 'iva', taxRate: 19, position: 0 }),
      expect.objectContaining({ vatRateId: incRateId, taxKind: 'inc', taxRate: 8, position: 1 }),
    ]);

    await db.update(vatRates).set({ isActive: false }).where(eq(vatRates.id, incRateId));
    const editedWithUnchangedFormPayload = await caller.products.update({
      id: renamed.id,
      version: renamed.version,
      name: 'Mixed tax product after catalog deactivation',
      vatRateId,
      taxRate: 27,
      taxComponents: [{ vatRateId }, { vatRateId: incRateId }],
    });
    expect(editedWithUnchangedFormPayload.taxComponents).toEqual([
      expect.objectContaining({ vatRateId, taxKind: 'iva', taxRate: 19 }),
      expect.objectContaining({ vatRateId: incRateId, taxKind: 'inc', taxRate: 8 }),
    ]);

    expect(() =>
      db
        .insert(productTaxComponents)
        .values({
          id: nanoid(),
          tenantId,
          productId: created.id,
          componentKey: 'overflow:position-4',
          vatRateId,
          taxKind: 'iva',
          taxRate: 0,
          position: 4,
        })
        .run()
    ).toThrow();

    const foreignTenantId = nanoid();
    const foreignRateId = nanoid();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign tax tenant',
      slug: `foreign-tax-${foreignTenantId}`,
    });
    await db.insert(vatRates).values({
      id: foreignRateId,
      tenantId: foreignTenantId,
      name: 'Foreign IVA',
      rate: 5,
      kind: 'iva',
      isActive: true,
    });
    await expect(
      caller.products.create({
        name: 'Foreign component probe',
        sku: `FOREIGN-${nanoid(6)}`,
        taxComponents: [{ vatRateId: foreignRateId }],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'TAX_COMPONENTS_INVALID' } });
  });

  it('searches products with base unit data and optional filters', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.products.create({
      name: 'Sparkling Water',
      sku: 'SW-001',
      description: null,
      categoryId,
      providerId,
      vatRateId,
      locationId: null,
      barcode: '9988776655',
      imageUrl: null,
      cost: 50,
      initialCost: 50,
      price: 75,
      price2: 80,
      price3: 90,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      stock: 15,
      minStock: 3,
      isActive: true,
      unitAssignments: [
        { unitId: baseUnitId, equivalence: 1, price: 75, isBase: true },
        { unitId: boxUnitId, equivalence: 12, price: 840, isBase: false },
      ],
    });

    const result = await caller.products.search({
      q: 'Sparkling',
      categoryId,
      providerId,
      isActive: true,
    });

    const match = result.items.find(item => item.id === created.id);
    expect(match).toBeDefined();
    expect(match?.baseUnitId).toBe(baseUnitId);
    expect(match?.baseUnitAbbreviation).toBe('UND');
    expect(match?.baseUnitPrice).toBe(75);
    expect(match?.unitAssignments).toHaveLength(2);
  });

  it('filters services only when an inventory caller opts in', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const suffix = nanoid(8);
    const service = await caller.products.create({
      name: `Setup labor sharedfilter ${suffix}`,
      sku: `SERVICE-FILTER-${suffix}`,
      price: 25,
      tracksStock: false,
    });
    const physical = await caller.products.create({
      name: `Setup cable sharedfilter ${suffix}`,
      sku: `PHYSICAL-FILTER-${suffix}`,
      price: 10,
      stock: 3,
    });

    const generalExact = await caller.products.search({ q: service.sku });
    expect(generalExact.items.map(item => item.id)).toEqual([service.id]);
    const inventoryExact = await caller.products.search({ q: service.sku, tracksStock: true });
    expect(inventoryExact.items).toEqual([]);

    const inventoryText = await caller.products.search({
      q: `sharedfilter ${suffix}`,
      tracksStock: true,
    });
    expect(inventoryText.items.map(item => item.id)).toEqual([physical.id]);
    const serviceText = await caller.products.search({
      q: `sharedfilter ${suffix}`,
      tracksStock: false,
    });
    expect(serviceText.items.map(item => item.id)).toEqual([service.id]);
  });

  it('takes tenant-safe indexed lanes for exact SKU and barcode searches', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const suffix = nanoid(8);
    const exactSku = `C1-SKU-${suffix}`;
    const baseBarcode = `C1-BASE-${suffix}`;
    const packagingBarcode = `C1-PACK-${suffix}`;
    const exactProduct = await caller.products.create({
      name: 'Indexed SKU target',
      sku: exactSku,
      barcode: baseBarcode,
      price: 10,
      stock: 1,
    });
    await caller.products.create({
      name: `Substring decoy ${exactSku} ${baseBarcode}`,
      sku: `C1-DECOY-${suffix}`,
      price: 10,
      stock: 1,
    });
    const packagedProduct = await caller.products.create({
      name: 'Indexed packaging target',
      sku: `C1-PACKAGED-${suffix}`,
      price: 10,
      stock: 1,
      unitAssignments: [
        { unitId: baseUnitId, equivalence: 1, price: 10, isBase: true },
        {
          unitId: boxUnitId,
          equivalence: 12,
          price: 110,
          isBase: false,
          barcode: packagingBarcode,
        },
      ],
    });

    const otherTenantId = `c1-other-${suffix}`;
    const now = new Date().toISOString();
    await getDatabase().insert(tenants).values({
      id: otherTenantId,
      name: 'C1 Other Tenant',
      slug: otherTenantId,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await getDatabase()
      .insert(products)
      .values({
        id: `c1-other-product-${suffix}`,
        tenantId: otherTenantId,
        name: 'Cross-tenant exact collision',
        sku: exactSku,
        barcode: baseBarcode,
        price: 10,
        createdAt: now,
        updatedAt: now,
      });

    const bySku = await caller.products.search({ q: `  ${exactSku}  ` });
    expect(bySku.items.map(item => item.id)).toEqual([exactProduct.id]);

    const byBaseBarcode = await caller.products.search({ q: baseBarcode });
    expect(byBaseBarcode.items.map(item => item.id)).toEqual([exactProduct.id]);

    const byPackagingBarcode = await caller.products.search({ q: packagingBarcode });
    expect(byPackagingBarcode.items.map(item => item.id)).toEqual([packagedProduct.id]);

    const sqlite = liveClient();
    const skuPlan = sqlite
      .prepare('EXPLAIN QUERY PLAN SELECT id FROM products WHERE tenant_id = ? AND sku = ?')
      .all(tenantId, exactSku) as Array<{ detail: string }>;
    expect(skuPlan.some(row => row.detail.includes('idx_products_tenant_sku'))).toBe(true);

    const barcodePlan = sqlite
      .prepare('EXPLAIN QUERY PLAN SELECT id FROM products WHERE tenant_id = ? AND barcode = ?')
      .all(tenantId, baseBarcode) as Array<{ detail: string }>;
    expect(barcodePlan.some(row => row.detail.includes('idx_products_tenant_barcode'))).toBe(true);

    const packagingPlan = sqlite
      .prepare(
        'EXPLAIN QUERY PLAN SELECT products.id FROM unit_x_product INNER JOIN products ON unit_x_product.product_id = products.id WHERE unit_x_product.barcode = ? AND products.tenant_id = ?'
      )
      .all(packagingBarcode, tenantId) as Array<{ detail: string }>;
    expect(
      packagingPlan.some(row => row.detail.includes('idx_unit_x_product_barcode_product'))
    ).toBe(true);
  });

  it('ranks tenant-safe FTS candidates and keeps trigger state consistent', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const db = getDatabase();
    const suffix = nanoid(8);
    const target = await caller.products.create({
      name: `Café Montaña Especial ${suffix}`,
      sku: `C2-TARGET-${suffix}`,
      description: 'High altitude roast',
      categoryId,
      providerId,
      price: 20,
      stock: 3,
      isActive: true,
    });
    const descriptionDecoy = await caller.products.create({
      name: `Reference notes ${suffix}`,
      sku: `C2-DECOY-${suffix}`,
      description: 'Cafe Montana archive',
      categoryId,
      providerId: secondaryProviderId,
      price: 20,
      stock: 3,
      isActive: true,
    });
    const inactive = await caller.products.create({
      name: `Cafe Montana inactive ${suffix}`,
      sku: `C2-INACTIVE-${suffix}`,
      categoryId,
      providerId,
      price: 20,
      stock: 3,
      isActive: false,
    });

    const now = new Date().toISOString();
    const otherTenantId = `c2-other-${suffix}`;
    const otherTenantProductId = `c2-other-product-${suffix}`;
    const variantParentId = `c2-parent-${suffix}`;
    await db.insert(tenants).values({
      id: otherTenantId,
      name: 'C2 Other Tenant',
      slug: otherTenantId,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(products).values([
      {
        id: otherTenantProductId,
        tenantId: otherTenantId,
        name: `Cafe Montana foreign ${suffix}`,
        sku: `C2-FOREIGN-${suffix}`,
        price: 20,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: variantParentId,
        tenantId,
        name: `Cafe Montana parent ${suffix}`,
        sku: `C2-PARENT-${suffix}`,
        catalogType: 'variant_parent',
        price: 20,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const ranked = await caller.products.search({ q: 'cafe mont', isActive: true });
    expect(ranked.items[0]?.id).toBe(target.id);
    expect(ranked.items.map(item => item.id)).toContain(descriptionDecoy.id);
    expect(ranked.items.map(item => item.id)).not.toContain(otherTenantProductId);
    expect(ranked.items.map(item => item.id)).not.toContain(variantParentId);
    await expect(caller.products.search({ q: '" OR * ( NEAR -' })).resolves.toEqual({
      items: [],
    });

    const filtered = await caller.products.search({
      q: 'cafe mont',
      categoryId,
      providerId,
      isActive: true,
    });
    expect(filtered.items.map(item => item.id)).toEqual([target.id]);
    expect(filtered.items.map(item => item.id)).not.toContain(inactive.id);

    const renamed = await caller.products.update({
      id: target.id,
      version: target.version,
      name: `Café Cordillera Especial ${suffix}`,
    });
    const oldName = await caller.products.search({ q: 'cafe mont', providerId });
    expect(oldName.items.map(item => item.id)).not.toContain(renamed.id);
    const newName = await caller.products.search({ q: 'cafe cord' });
    expect(newName.items[0]?.id).toBe(renamed.id);

    const ephemeralId = `c2-ephemeral-${suffix}`;
    await db.insert(products).values({
      id: ephemeralId,
      tenantId,
      name: `Ephemeral Trigger ${suffix}`,
      sku: `C2-EPHEMERAL-${suffix}`,
      price: 20,
      createdAt: now,
      updatedAt: now,
    });
    expect(
      (await caller.products.search({ q: `ephemeral trig ${suffix}` })).items.map(item => item.id)
    ).toContain(ephemeralId);
    await db.delete(products).where(eq(products.id, ephemeralId));
    expect(
      (await caller.products.search({ q: `ephemeral trig ${suffix}` })).items.map(item => item.id)
    ).not.toContain(ephemeralId);

    const sqlite = liveClient();
    const sqliteTenantScope = sqlite
      .prepare("SELECT 't' || lower(hex(cast(? AS blob))) AS scope")
      .get('tienda/ñ') as { scope: string };
    expect(sqliteTenantScope.scope).toBe(productSearchTenantScope('tienda/ñ'));
    const ftsCount = sqlite.prepare('SELECT count(*) AS count FROM product_search_fts').get() as {
      count: number;
    };
    const productCount = sqlite
      .prepare("SELECT count(*) AS count FROM products WHERE catalog_type <> 'variant_parent'")
      .get() as { count: number };
    expect(ftsCount.count).toBe(productCount.count);
    expect(() =>
      sqlite
        .prepare("INSERT INTO product_search_fts(product_search_fts) VALUES('integrity-check')")
        .run()
    ).not.toThrow();

    const matchQuery = buildProductFtsQuery(tenantId, 'cafe cord');
    expect(matchQuery).not.toBeNull();
    const plan = sqlite
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT product_search_fts.product_id
         FROM product_search_fts
         INNER JOIN products ON products.id = product_search_fts.product_id
         WHERE product_search_fts MATCH ?
           AND product_search_fts.tenant_id = ?
           AND products.tenant_id = ?
         LIMIT ?`
      )
      .all(matchQuery, tenantId, tenantId, 20) as Array<{ detail: string }>;
    expect(plan.some(row => row.detail.includes('VIRTUAL TABLE INDEX'))).toBe(true);
    expect(
      plan.some(
        row =>
          row.detail.includes('sqlite_autoindex_products_1') || row.detail.includes('PRIMARY KEY')
      )
    ).toBe(true);
  });

  it('rejects unknown product locations', async () => {
    const caller = appRouter.createCaller(createTestContext());

    await expect(
      caller.products.create({
        name: 'Broken Location Product',
        sku: 'BL-001',
        description: null,
        categoryId,
        providerId,
        vatRateId,
        locationId: 'missing-location',
        barcode: null,
        imageUrl: null,
        cost: 10,
        initialCost: 10,
        price: 12,
        price2: 13,
        price3: 14,
        marginPercent1: 0,
        marginPercent2: 0,
        marginPercent3: 0,
        marginAmount1: 0,
        marginAmount2: 0,
        marginAmount3: 0,
        taxRate: 0,
        stock: 1,
        minStock: 0,
        isActive: true,
        unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 12, isBase: true }],
      })
    ).rejects.toMatchObject<Partial<TRPCError>>({
      code: 'BAD_REQUEST',
      message: 'Selected location was not found or is inactive',
    });
  });

  it('normalizes provider assignments and derives the primary provider from the assignment set', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.products.create({
      name: 'Provider Bundle',
      sku: 'PB-001',
      description: null,
      categoryId,
      providerId: secondaryProviderId,
      providerAssignments: [{ providerId }, { providerId: secondaryProviderId }],
      vatRateId,
      locationId: null,
      barcode: null,
      imageUrl: null,
      cost: 25,
      initialCost: 25,
      price: 40,
      price2: 42,
      price3: 45,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      stock: 5,
      minStock: 1,
      isActive: true,
      unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 40, isBase: true }],
    });

    expect(created.providerId).toBe(secondaryProviderId);
    expect(created.providerAssignments?.map(assignment => assignment.providerId).sort()).toEqual(
      [secondaryProviderId, providerId].sort()
    );

    const updated = await caller.products.update({
      id: created.id,
      version: created.version,
      providerId,
    });

    expect(updated.providerId).toBe(providerId);
    expect(updated.providerAssignments?.map(assignment => assignment.providerId).sort()).toEqual(
      [providerId, secondaryProviderId].sort()
    );
  });

  it('rejects invalid provider assignments before they reach persistence', async () => {
    const caller = appRouter.createCaller(createTestContext());

    await expect(
      caller.products.create({
        name: 'Bad Provider Product',
        sku: 'BP-001',
        description: null,
        categoryId,
        providerAssignments: [{ providerId }, { providerId }],
        vatRateId,
        locationId: null,
        barcode: null,
        imageUrl: null,
        cost: 25,
        initialCost: 25,
        price: 40,
        price2: 42,
        price3: 45,
        marginPercent1: 0,
        marginPercent2: 0,
        marginPercent3: 0,
        marginAmount1: 0,
        marginAmount2: 0,
        marginAmount3: 0,
        taxRate: 0,
        stock: 5,
        minStock: 1,
        isActive: true,
        unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 40, isBase: true }],
      })
    ).rejects.toThrow();

    await caller.products
      .create({
        name: 'Inactive Provider Product',
        sku: 'IP-001',
        description: null,
        categoryId,
        providerAssignments: [{ providerId: inactiveProviderId }],
        vatRateId,
        locationId: null,
        barcode: null,
        imageUrl: null,
        cost: 25,
        initialCost: 25,
        price: 40,
        price2: 42,
        price3: 45,
        marginPercent1: 0,
        marginPercent2: 0,
        marginPercent3: 0,
        marginAmount1: 0,
        marginAmount2: 0,
        marginAmount3: 0,
        taxRate: 0,
        stock: 5,
        minStock: 1,
        isActive: true,
        unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 40, isBase: true }],
      })
      .then(() => {
        throw new Error('expected create to fail');
      })
      .catch(error => {
        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).code).toBe('BAD_REQUEST');
        expect((error as TRPCError).message).toContain('selected providers');
      });
  });

  // ferreterías (2.5 m cable) and supermarkets (0.75 kg
  // produce) need fractional stock. This test locks in the end-to-end
  // contract: Zod validation accepts decimals, SQLite round-trips them, and
  // `products.update` preserves precision.
  it('accepts and round-trips fractional stock values', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.products.create({
      name: 'THHN Cable',
      sku: 'CABLE-THHN-12',
      description: 'Electrical cable sold by the meter',
      categoryId,
      providerId,
      vatRateId,
      locationId,
      barcode: null,
      imageUrl: null,
      cost: 2000,
      initialCost: 2000,
      price: 3500,
      price2: 3500,
      price3: 3500,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      stock: 2.5,
      minStock: 0.25,
      isActive: true,
      unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 3500, isBase: true }],
    });

    expect(created.stock).toBe(2.5);
    expect(created.minStock).toBe(0.25);
    expect(created.sellByFraction).toBe(false);
    expect(created.fractionStep).toBeNull();
    expect(created.fractionMinimum).toBeNull();

    const fetched = await caller.products.getById({ id: created.id });
    expect(fetched.stock).toBe(2.5);
    expect(fetched.minStock).toBe(0.25);

    const updated = await caller.products.update({
      id: created.id,
      version: created.version,
      stock: 0.75,
      minStock: 0.1,
    });
    expect(updated.stock).toBe(0.75);
    expect(updated.minStock).toBe(0.1);

    // Round-trip via list as well — it uses a different SELECT path.
    const listed = await caller.products.list({
      page: 1,
      perPage: 20,
      search: 'THHN',
    });
    const match = listed.items.find(item => item.id === created.id);
    expect(match?.stock).toBe(0.75);
  });

  it('applies an absolute stock update without double-counting other-site balances', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const db = getDatabase();
    const now = new Date().toISOString();

    // A second, non-primary site (later createdAt) that already holds stock, so
    // the product's tenant-wide total is > 0 while the primary-site balance row
    // does not exist yet.
    const branchCompanyId = nanoid();
    const branchSiteId = nanoid();
    await db.insert(companies).values({
      id: branchCompanyId,
      tenantId,
      name: 'Branch Co',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: branchSiteId,
      tenantId,
      companyId: branchCompanyId,
      name: 'Branch Warehouse',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // stock: 0 on create makes no balance row, so no primary-site row exists.
    const created = await caller.products.create({
      name: 'Multi-site Widget',
      sku: `MS-${nanoid(6)}`,
      description: null,
      categoryId,
      providerId,
      vatRateId,
      locationId,
      barcode: null,
      imageUrl: null,
      cost: 100,
      initialCost: 100,
      price: 200,
      price2: 200,
      price3: 200,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      stock: 0,
      minStock: 0,
      isActive: true,
      unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 200, isBase: true }],
    });

    // 30 units already at the branch site; the primary site still has no row.
    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId: branchSiteId,
      productId: created.id,
      onHand: 30,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });

    // Absolute tenant-wide stock -> 50. The delta (50 - 30) is applied to the
    // primary site; the branch's 30 must NOT be double-counted (would land 80).
    const updated = await caller.products.update({
      id: created.id,
      version: created.version,
      stock: 50,
    });
    expect(updated.stock).toBe(50);

    const fetched = await caller.products.getById({ id: created.id });
    expect(fetched.stock).toBe(50);

    const movement = await db
      .select()
      .from(inventoryMovements)
      .where(
        and(eq(inventoryMovements.tenantId, tenantId), eq(inventoryMovements.productId, created.id))
      )
      .get();
    expect(movement).toMatchObject({
      type: 'adjustment',
      quantity: 20,
      previousStock: 30,
      newStock: 50,
      reference: 'product-update',
    });
  });

  it('rolls back catalog edits when a cross-site stock reduction is unsafe', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const db = getDatabase();
    const now = new Date().toISOString();
    const branchCompanyId = nanoid();
    const branchSiteId = nanoid();
    await db.insert(companies).values({
      id: branchCompanyId,
      tenantId,
      name: 'Rollback Branch Co',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: branchSiteId,
      tenantId,
      companyId: branchCompanyId,
      name: 'Rollback Branch',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const created = await caller.products.create({
      name: 'Atomic stock product',
      sku: `ATOMIC-STOCK-${nanoid(6)}`,
      stock: 5,
    });
    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId: branchSiteId,
      productId: created.id,
      onHand: 10,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      caller.products.update({
        id: created.id,
        version: created.version,
        name: 'This name must roll back',
        stock: 2,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'INVENTORY_ADJUSTMENT_SITE_STOCK_INSUFFICIENT' },
    });

    const persisted = await caller.products.getById({ id: created.id });
    expect(persisted.name).toBe('Atomic stock product');
    expect(persisted.version).toBe(created.version);
    expect(persisted.stock).toBe(15);

    const balances = await db
      .select({ siteId: inventoryBalances.siteId, onHand: inventoryBalances.onHand })
      .from(inventoryBalances)
      .where(
        and(eq(inventoryBalances.tenantId, tenantId), eq(inventoryBalances.productId, created.id))
      )
      .all();
    expect(balances).toEqual(
      expect.arrayContaining([
        { siteId: primarySiteId, onHand: 5 },
        { siteId: branchSiteId, onHand: 10 },
      ])
    );

    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(
        and(eq(inventoryMovements.tenantId, tenantId), eq(inventoryMovements.productId, created.id))
      )
      .all();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      previousStock: 0,
      newStock: 5,
      reference: 'product-create',
    });
  });

  it('stores and updates product-level fraction policy fields', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.products.create({
      name: 'Cable flexible',
      sku: 'FLEX-CABLE-01',
      description: null,
      categoryId,
      providerId,
      vatRateId,
      locationId,
      barcode: null,
      imageUrl: null,
      cost: 1500,
      initialCost: 1500,
      price: 2200,
      price2: 2200,
      price3: 2200,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      stock: 12,
      minStock: 1,
      sellByFraction: true,
      fractionStep: 0.25,
      fractionMinimum: 0.5,
      isActive: true,
      unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 2200, isBase: true }],
    });

    expect(created.sellByFraction).toBe(true);
    expect(created.fractionStep).toBe(0.25);
    expect(created.fractionMinimum).toBe(0.5);

    const updated = await caller.products.update({
      id: created.id,
      version: created.version,
      fractionStep: 0.5,
      fractionMinimum: 1,
    });

    expect(updated.sellByFraction).toBe(true);
    expect(updated.fractionStep).toBe(0.5);
    expect(updated.fractionMinimum).toBe(1);

    const searched = await caller.products.search({
      q: 'FLEX-CABLE',
      isActive: true,
    });
    const match = searched.items.find(item => item.id === created.id);
    expect(match?.sellByFraction).toBe(true);
    expect(match?.fractionStep).toBe(0.5);
    expect(match?.fractionMinimum).toBe(1);
  });

  it('rejects invalid fraction policy configurations before persistence', async () => {
    const caller = appRouter.createCaller(createTestContext());

    await expect(
      caller.products.create({
        name: 'Broken Fraction Policy',
        sku: 'BROKEN-FRAC-01',
        description: null,
        categoryId,
        providerId,
        vatRateId,
        locationId: null,
        barcode: null,
        imageUrl: null,
        cost: 10,
        initialCost: 10,
        price: 15,
        price2: 15,
        price3: 15,
        marginPercent1: 0,
        marginPercent2: 0,
        marginPercent3: 0,
        marginAmount1: 0,
        marginAmount2: 0,
        marginAmount3: 0,
        taxRate: 0,
        stock: 5,
        minStock: 1,
        sellByFraction: true,
        fractionStep: 0.25,
        fractionMinimum: 0.3,
        isActive: true,
        unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 15, isBase: true }],
      })
    ).rejects.toThrow(/Fraction minimum must align/);
  });

  it('enables lot tracking only from zero stock and forbids direct stock edits', async () => {
    const caller = appRouter.createCaller(createTestContext());

    await expect(
      caller.products.create({
        name: 'Unsafe tracked product',
        sku: `LOT-UNSAFE-${nanoid()}`,
        stock: 2,
        tracksLots: true,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_LOT_TRACKING_REQUIRES_ZERO_STOCK' },
    });

    const legacy = await caller.products.create({
      name: 'Legacy stock before lots',
      sku: `LOT-LEGACY-${nanoid()}`,
      stock: 3,
    });
    await expect(
      caller.products.update({
        id: legacy.id,
        version: legacy.version,
        tracksLots: true,
        stock: 0,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_LOT_TRACKING_REQUIRES_ZERO_STOCK' },
    });

    const emptied = await caller.products.update({
      id: legacy.id,
      version: legacy.version,
      stock: 0,
    });
    const tracked = await caller.products.update({
      id: emptied.id,
      version: emptied.version,
      tracksLots: true,
      stock: 0,
    });
    expect(tracked.tracksLots).toBe(true);

    await expect(
      caller.products.update({
        id: tracked.id,
        version: tracked.version,
        tracksLots: true,
        stock: 1,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_LOT_TRACKING_STOCK_MANAGED' },
    });
  });

  it('blocks disabling lot tracking while a tenant-scoped lot has stock', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const tracked = await caller.products.create({
      name: 'Tracked batch product',
      sku: `LOT-ACTIVE-${nanoid()}`,
      stock: 0,
      tracksLots: true,
    });
    const site = await getDatabase()
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.tenantId, tenantId))
      .get();
    expect(site).toBeDefined();
    const lotId = nanoid();
    await getDatabase()
      .insert(inventoryLots)
      .values({
        id: lotId,
        tenantId,
        siteId: site!.id,
        productId: tracked.id,
        lotNumber: `LOT-${lotId}`,
        onHand: 4,
        unitCost: 10,
        status: 'active',
      });

    await expect(
      caller.products.update({
        id: tracked.id,
        version: tracked.version,
        tracksLots: false,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_LOT_TRACKING_HAS_ACTIVE_LOTS' },
    });

    await getDatabase()
      .update(inventoryLots)
      .set({ onHand: -0.5 })
      .where(eq(inventoryLots.id, lotId))
      .run();
    await expect(
      caller.products.update({
        id: tracked.id,
        version: tracked.version,
        tracksLots: false,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_LOT_TRACKING_HAS_ACTIVE_LOTS' },
    });

    await getDatabase()
      .update(inventoryLots)
      .set({ onHand: 0, status: 'depleted' })
      .where(eq(inventoryLots.id, lotId))
      .run();
    const disabled = await caller.products.update({
      id: tracked.id,
      version: tracked.version,
      tracksLots: false,
    });
    expect(disabled.tracksLots).toBe(false);
  });

  it('rejects lot opt-in when non-zero site balances cancel in the tenant total', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const db = getDatabase();
    const now = new Date().toISOString();
    const product = await caller.products.create({
      name: 'Offset site balances',
      sku: `LOT-OFFSET-${nanoid()}`,
      stock: 0,
    });
    const primarySite = await db
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.tenantId, tenantId))
      .get();
    expect(primarySite).toBeDefined();
    const companyId = nanoid();
    const branchSiteId = nanoid();
    await db.insert(companies).values({
      id: companyId,
      tenantId,
      name: `Offset Company ${companyId}`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: branchSiteId,
      tenantId,
      companyId,
      name: `Offset Site ${branchSiteId}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(inventoryBalances).values([
      {
        id: nanoid(),
        tenantId,
        siteId: primarySite!.id,
        productId: product.id,
        onHand: 5,
        reserved: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: nanoid(),
        tenantId,
        siteId: branchSiteId,
        productId: product.id,
        onHand: -5,
        reserved: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await expect(
      caller.products.update({
        id: product.id,
        version: product.version,
        tracksLots: true,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_LOT_TRACKING_REQUIRES_ZERO_STOCK' },
    });
  });

  it('converts a zero-stock product into sellable child variants atomically', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const parent = await caller.products.create({
      name: 'Classic Shirt',
      sku: `SHIRT-${nanoid(6)}`,
      stock: 0,
      price: 80,
      unitAssignments: [
        { unitId: baseUnitId, equivalence: 1, price: 80, isBase: true, barcode: 'PARENT-PACK' },
      ],
      providerAssignments: [{ providerId }],
    });
    // Simulate a product written by a legacy sync peer after migration. New
    // variants must still materialize a normalized child definition.
    await getDatabase()
      .delete(productTaxComponents)
      .where(eq(productTaxComponents.productId, parent.id));

    const cashierContext = createTestContext();
    cashierContext.user.role = 'cashier';
    cashierContext.req.user.role = 'cashier';
    await expect(
      appRouter.createCaller(cashierContext).products.createVariantMatrix({
        parentProductId: parent.id,
        axes: [{ name: 'Size', values: ['S'] }],
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const created = await caller.products.createVariantMatrix({
      parentProductId: parent.id,
      axes: [
        { name: 'Size', values: ['S', 'M'] },
        { name: 'Color', values: ['Blue', 'Red'] },
      ],
    });

    expect(created.variants).toHaveLength(4);
    expect(new Set(created.variants.map(variant => variant.sku)).size).toBe(4);
    expect(created.variants.map(variant => variant.values)).toEqual(
      expect.arrayContaining([
        { Size: 'S', Color: 'Blue' },
        { Size: 'M', Color: 'Red' },
      ])
    );

    const matrix = await caller.products.getVariantMatrix({ parentProductId: parent.id });
    expect(matrix.parent.catalogType).toBe('variant_parent');
    expect(matrix.parent.isActive).toBe(false);
    expect(matrix.axes).toEqual([
      { name: 'Size', values: ['S', 'M'] },
      { name: 'Color', values: ['Blue', 'Red'] },
    ]);
    expect(matrix.variants).toHaveLength(4);
    expect(matrix.variants.map(variant => variant.variantValues)).toEqual([
      { Size: 'S', Color: 'Blue' },
      { Size: 'S', Color: 'Red' },
      { Size: 'M', Color: 'Blue' },
      { Size: 'M', Color: 'Red' },
    ]);
    expect(matrix.variants.every(variant => variant.catalogType === 'variant')).toBe(true);
    expect(matrix.variants.every(variant => variant.variantParentId === parent.id)).toBe(true);

    const foreignContext = createTestContext();
    foreignContext.tenantId = `foreign-${nanoid()}`;
    foreignContext.user.tenantId = foreignContext.tenantId;
    foreignContext.req.user.tenantId = foreignContext.tenantId;
    await expect(
      appRouter
        .createCaller(foreignContext)
        .products.getVariantMatrix({ parentProductId: parent.id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const child = await caller.products.getById({ id: created.variants[0]!.id });
    expect(child.unitAssignments).toHaveLength(1);
    expect(child.providerAssignments?.map(assignment => assignment.providerId)).toEqual([
      providerId,
    ]);
    expect(child.taxComponents).toEqual([
      expect.objectContaining({ taxKind: 'iva', taxRate: 0, position: 0 }),
    ]);
    const copiedUnit = await getDatabase()
      .select({ barcode: unitXProduct.barcode })
      .from(unitXProduct)
      .where(eq(unitXProduct.productId, child.id))
      .get();
    expect(copiedUnit?.barcode).toBeNull();

    const childSync = await getDatabase()
      .select({ payload: syncOutbox.payload })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          eq(syncOutbox.entityType, 'products'),
          eq(syncOutbox.entityId, child.id),
          eq(syncOutbox.operation, 'create')
        )
      )
      .get();
    expect(childSync?.payload).toMatchObject({
      id: child.id,
      tenantId,
      variantParentId: parent.id,
      name: child.name,
      sku: child.sku,
      catalogType: 'variant',
      price: 80,
      currencyCode: 'COP',
      isActive: true,
      stock: 0,
      unitAssignments: [
        {
          unitId: baseUnitId,
          equivalence: 1,
          price: 80,
          isBase: true,
          barcode: null,
        },
      ],
      providerAssignments: [{ providerId }],
    });
    expect(childSync?.payload).not.toHaveProperty('parentProductId');

    const operationalList = await caller.products.list({
      page: 1,
      perPage: 20,
      search: 'Classic Shirt',
    });
    expect(operationalList.items.some(item => item.id === parent.id)).toBe(false);
    expect(operationalList.items.filter(item => item.variantParentId === parent.id)).toHaveLength(
      4
    );

    const catalogList = await caller.products.list({
      page: 1,
      perPage: 20,
      search: 'Classic Shirt',
      includeVariantParents: true,
    });
    expect(catalogList.items.some(item => item.id === parent.id)).toBe(true);

    const search = await caller.products.search({ q: parent.sku, isActive: true });
    expect(search.items.some(item => item.id === parent.id)).toBe(false);

    await expect(
      caller.products.update({ id: parent.id, version: matrix.parent.version, isActive: true })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_VARIANT_PARENT_NOT_SELLABLE' },
    });
    const criticalCaller = appRouter.createCaller(createCriticalTestContext());
    await expect(
      criticalCaller.inventory.createMovement({
        productId: parent.id,
        type: 'adjustment',
        quantity: 1,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_VARIANT_PARENT_NOT_SELLABLE' },
    });

    const primarySite = await getDatabase()
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    expect(primarySite).toBeDefined();
    await expect(
      caller.inventoryLots.receive({
        siteId: primarySite!.id,
        productId: parent.id,
        lotNumber: 'PARENT-LOT',
        quantity: 1,
        unitCost: 10,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_VARIANT_PARENT_NOT_SELLABLE' },
    });

    let centralMutationError: unknown;
    try {
      getDatabase().transaction(tx => {
        applyInventoryBalanceDelta(tx, {
          tenantId,
          siteId: primarySite!.id,
          productId: parent.id,
          delta: 1,
        });
      });
    } catch (error) {
      centralMutationError = error;
    }
    expect(centralMutationError).toMatchObject({
      cause: { errorCode: 'PRODUCT_VARIANT_PARENT_NOT_SELLABLE' },
    });

    await expect(
      caller.products.createVariantMatrix({
        parentProductId: parent.id,
        axes: [{ name: 'Size', values: ['L'] }],
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_VARIANT_MATRIX_EXISTS' },
    });
  });

  it('rolls back the entire variant conversion when a child sync row cannot enqueue', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const db = getDatabase();
    const parent = await caller.products.create({
      name: 'Atomic matrix parent',
      sku: `ATOMIC-MATRIX-${nanoid(6)}`,
      stock: 0,
      price: 25,
    });

    await db.run(
      sql.raw(`
      CREATE TRIGGER fail_variant_child_sync
      BEFORE INSERT ON sync_outbox
      WHEN NEW.entity_type = 'products'
        AND NEW.operation = 'create'
        AND json_extract(NEW.payload, '$.catalogType') = 'variant'
      BEGIN
        SELECT RAISE(ABORT, 'forced variant child sync failure');
      END
    `)
    );
    try {
      await expect(
        __withExpectedTestLogs(
          [
            {
              level: 'error',
              module: 'trpc-tracing',
              message: 'trpc procedure error',
            },
            {
              level: 'error',
              module: 'observability',
              message: 'captured exception',
            },
          ],
          () =>
            caller.products.createVariantMatrix({
              parentProductId: parent.id,
              axes: [{ name: 'Size', values: ['S', 'M'] }],
            })
        )
      ).rejects.toThrow(/forced variant child sync failure/);
    } finally {
      await db.run(sql.raw('DROP TRIGGER IF EXISTS fail_variant_child_sync'));
    }

    const persistedParent = await db
      .select({ catalogType: products.catalogType, isActive: products.isActive })
      .from(products)
      .where(and(eq(products.id, parent.id), eq(products.tenantId, tenantId)))
      .get();
    expect(persistedParent).toEqual({ catalogType: 'standard', isActive: true });
    expect(
      await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.tenantId, tenantId), eq(products.variantParentId, parent.id)))
        .all()
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: syncOutbox.id })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, tenantId),
            eq(syncOutbox.entityType, 'products'),
            eq(syncOutbox.entityId, parent.id),
            eq(syncOutbox.operation, 'update')
          )
        )
        .all()
    ).toHaveLength(0);
  });

  it('rejects variant conversion with stock and disambiguates generated SKU tokens', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const stocked = await caller.products.create({
      name: 'Stocked matrix parent',
      sku: `VAR-STOCK-${nanoid(6)}`,
      stock: 1,
    });
    await expect(
      caller.products.createVariantMatrix({
        parentProductId: stocked.id,
        axes: [{ name: 'Style', values: ['Rojo!', 'Rojo'] }],
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_VARIANT_PARENT_REQUIRES_ZERO_STOCK' },
    });

    const zero = await caller.products.create({
      name: 'Token matrix parent',
      sku: `VAR-TOKEN-${nanoid(6)}`,
      stock: 0,
    });
    const created = await caller.products.createVariantMatrix({
      parentProductId: zero.id,
      axes: [{ name: 'Style', values: ['Rojo!', 'Rojo'] }],
    });
    const normalizedParentSku = zero.sku.replace(/-+$/g, '');
    expect(created.variants.map(variant => variant.sku)).toEqual([
      `${normalizedParentSku}-ROJO-1`,
      `${normalizedParentSku}-ROJO-2`,
    ]);
  });

  it('keeps adversarial suffix collisions and Unicode SKU cuts deterministic', () => {
    const sameAxis = buildProductVariantPreview({ name: 'Collision', sku: 'COLLISION' }, [
      { name: 'Style', values: ['A', 'A!', 'A-1'] },
    ]);
    expect(sameAxis.map(variant => variant.sku)).toEqual([
      'COLLISION-A-1',
      'COLLISION-A-2',
      'COLLISION-A-1-2',
    ]);

    const crossAxis = buildProductVariantPreview({ name: 'Cross axis', sku: 'CROSS' }, [
      { name: 'Left', values: ['A', 'A-B'] },
      { name: 'Right', values: ['B-C', 'C'] },
    ]);
    expect(crossAxis.map(variant => variant.sku)).toEqual([
      'CROSS-A-B-C',
      'CROSS-A-C',
      'CROSS-A-B-B-C',
      'CROSS-A-B-C-2',
    ]);
    expect(new Set(crossAxis.map(variant => variant.sku)).size).toBe(crossAxis.length);

    const unicodeParentSku = `${'A'.repeat(97)}😀B`;
    expect(unicodeParentSku).toHaveLength(100);
    const unicode = buildProductVariantPreview({ name: 'Unicode SKU', sku: unicodeParentSku }, [
      { name: 'Size', values: ['S'] },
    ]);
    expect(unicode[0]?.sku).toBe(`${'A'.repeat(97)}-S`);
    expect(unicode[0]?.sku).not.toMatch(/[\uD800-\uDFFF]/u);
  });

  it('preserves distinguishing option labels within the product name limit', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const parent = await caller.products.create({
      name: 'P'.repeat(255),
      sku: `VAR-NAME-${nanoid(6)}`,
      stock: 0,
    });

    const created = await caller.products.createVariantMatrix({
      parentProductId: parent.id,
      axes: [{ name: 'Color', values: ['Ocean Blue', 'Sunset Red'] }],
    });

    expect(created.variants.map(variant => variant.name)).toEqual([
      expect.stringMatching(/ · Ocean Blue$/),
      expect.stringMatching(/ · Sunset Red$/),
    ]);
    expect(created.variants.every(variant => variant.name.length <= 255)).toBe(true);
    expect(new Set(created.variants.map(variant => variant.name)).size).toBe(2);

    const unicodeParentName = `${'A'.repeat(241)}😀${'B'.repeat(12)}`;
    expect(unicodeParentName).toHaveLength(255);
    const unicodeParent = await caller.products.create({
      name: unicodeParentName,
      sku: `VAR-UNICODE-${nanoid(6)}`,
      stock: 0,
    });
    const unicodeCreated = await caller.products.createVariantMatrix({
      parentProductId: unicodeParent.id,
      axes: [{ name: 'Color', values: ['Ocean Blue'] }],
    });
    expect(unicodeCreated.variants[0]?.name).toBe(`${'A'.repeat(241)} · Ocean Blue`);
  });

  it('uses specific errors for missing parents and products with operational history', async () => {
    const caller = appRouter.createCaller(createTestContext());

    await expect(
      caller.products.createVariantMatrix({
        parentProductId: nanoid(),
        axes: [{ name: 'Size', values: ['S'] }],
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_VARIANT_PARENT_NOT_FOUND' },
    });

    const referenced = await caller.products.create({
      name: 'Ordered matrix parent',
      sku: `VAR-ORDER-${nanoid(6)}`,
      stock: 0,
      providerId,
      unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 10, isBase: true }],
    });
    await caller.orders.create({
      providerId,
      items: [
        {
          productId: referenced.id,
          unitId: baseUnitId,
          quantity: 1,
          costPerUnit: 4,
        },
      ],
      notes: 'Deferred receipt guard',
    });

    await expect(
      caller.products.createVariantMatrix({
        parentProductId: referenced.id,
        axes: [{ name: 'Size', values: ['S'] }],
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_VARIANT_PARENT_HAS_HISTORY' },
    });
  });
});
