import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  categories,
  companies,
  inventoryBalances,
  providers,
  sites,
  tenants,
  units,
  users,
  vatRates,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let categoryId: string;
let providerId: string;
let vatRateId: string;
let baseUnitId: string;
let boxUnitId: string;

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

describe('Inventory tRPC Router', () => {
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

    const seededUnits = await db
      .select()
      .from(units)
      .where(eq(units.tenantId, seededUser.tenantId))
      .all();
    const baseUnit = seededUnits.find(unit => unit.abbreviation === 'UND');
    const boxUnit = seededUnits.find(unit => unit.abbreviation === 'CJ');
    if (!baseUnit || !boxUnit) {
      throw new Error('Expected seeded units');
    }

    tenantId = seededUser.tenantId;
    userId = seededUser.id;
    vatRateId = seededVatRate.id;
    baseUnitId = baseUnit.id;
    boxUnitId = boxUnit.id;
    categoryId = nanoid();
    providerId = nanoid();

    await db.insert(categories).values({
      id: categoryId,
      tenantId,
      name: 'Inventory Tests',
      description: null,
      parentId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Inventory Supplier',
      taxId: null,
      phone: null,
      email: null,
      address: null,
      cityId: null,
      contactName: null,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('lists current stock with valuation and low-stock filters', async () => {
    const caller = appRouter.createCaller(createTestContext());

    await caller.products.create({
      name: 'Low Stock Soda',
      sku: 'INV-LOW',
      description: null,
      categoryId,
      providerId,
      vatRateId,
      locationId: null,
      barcode: '10001',
      imageUrl: null,
      cost: 10,
      initialCost: 8,
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
      stock: 4,
      minStock: 5,
      isActive: true,
      unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 12, isBase: true }],
    });

    await caller.products.create({
      name: 'Healthy Stock Juice',
      sku: 'INV-OK',
      description: null,
      categoryId,
      providerId,
      vatRateId,
      locationId: null,
      barcode: '10002',
      imageUrl: null,
      cost: 10,
      initialCost: 9,
      price: 15,
      price2: 16,
      price3: 17,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      stock: 10,
      minStock: 3,
      isActive: true,
      unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 15, isBase: true }],
    });

    const result = await caller.inventory.listStock({
      page: 1,
      perPage: 20,
      search: 'Stock',
    });

    expect(result.items).toHaveLength(2);
    expect(result.summary.lowStockCount).toBe(1);
    expect(result.summary.totalUnits).toBe(14);
    expect(result.summary.totalValue).toBe(122);
    expect(result.items.find(item => item.sku === 'INV-LOW')?.isLowStock).toBe(true);

    const lowStockOnly = await caller.inventory.listStock({
      page: 1,
      perPage: 20,
      categoryId,
      lowStockOnly: true,
    });

    expect(lowStockOnly.items).toHaveLength(1);
    expect(lowStockOnly.items[0]?.sku).toBe('INV-LOW');
  });

  it('adjusts stock and returns movement rows with product context', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.products.create({
      name: 'Adjustment Water',
      sku: 'INV-ADJ',
      description: null,
      categoryId,
      providerId,
      vatRateId,
      locationId: null,
      barcode: '10003',
      imageUrl: null,
      cost: 20,
      initialCost: 15,
      price: 25,
      price2: 27,
      price3: 29,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      stock: 3,
      minStock: 2,
      isActive: true,
      unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 25, isBase: true }],
    });

    const adjusted = await caller.inventory.adjustStock({
      productId: created.id,
      newStock: 9,
      notes: 'Cycle count',
    });

    expect(adjusted.product.stock).toBe(9);

    const movements = await caller.inventory.listMovements({
      page: 1,
      perPage: 20,
      productId: created.id,
    });

    expect(movements.items).toHaveLength(1);
    expect(movements.items[0]?.productName).toBe('Adjustment Water');
    expect(movements.items[0]?.productSku).toBe('INV-ADJ');
    expect(movements.items[0]?.categoryName).toBe('Inventory Tests');
    expect(movements.items[0]?.previousStock).toBe(3);
    expect(movements.items[0]?.newStock).toBe(9);

    const stock = await caller.inventory.productStock({ productId: created.id });
    expect(stock.stock).toBe(9);
    expect(stock.isLowStock).toBe(false);
  });

  // Phase 1 DB-050: adjusting a product's stock to a fractional target must
  // round-trip through the inventory_movements ledger without rounding. This
  // is the end-to-end contract that unblocks ferreterías (2.5 m cable) and
  // supermarkets (0.75 kg produce).
  it('adjusts stock to a fractional target and preserves precision in the movement ledger', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.products.create({
      name: 'Cable by the meter',
      sku: 'INV-CABLE',
      description: 'Sold by fraction',
      categoryId,
      providerId,
      vatRateId,
      locationId: null,
      barcode: '20001',
      imageUrl: null,
      cost: 1000,
      initialCost: 1000,
      price: 1500,
      price2: 1500,
      price3: 1500,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      stock: 5,
      minStock: 0.5,
      isActive: true,
      unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 1500, isBase: true }],
    });

    const adjusted = await caller.inventory.adjustStock({
      productId: created.id,
      newStock: 2.5,
      notes: 'Cut 2.5m piece for customer',
    });

    expect(adjusted.product.stock).toBe(2.5);

    const movements = await caller.inventory.listMovements({
      page: 1,
      perPage: 20,
      productId: created.id,
    });

    expect(movements.items).toHaveLength(1);
    expect(movements.items[0]?.previousStock).toBe(5);
    expect(movements.items[0]?.newStock).toBe(2.5);
    // The movement's quantity is the magnitude of the change (2.5 m were
    // removed), stored as a real value — no rounding.
    expect(movements.items[0]?.quantity).toBe(2.5);

    const stock = await caller.inventory.productStock({ productId: created.id });
    expect(stock.stock).toBe(2.5);
    expect(stock.isLowStock).toBe(false);
  });

  it('records initial and physical inventory entries with normalized quantities', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.products.create({
      name: 'Counted Crackers',
      sku: 'INV-ENTRY',
      description: null,
      categoryId,
      providerId,
      vatRateId,
      locationId: null,
      barcode: '10004',
      imageUrl: null,
      cost: 5,
      initialCost: 5,
      price: 9,
      price2: 10,
      price3: 11,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      stock: 2,
      minStock: 1,
      isActive: true,
      unitAssignments: [
        { unitId: baseUnitId, equivalence: 1, price: 9, isBase: true },
        { unitId: boxUnitId, equivalence: 6, price: 48, isBase: false },
      ],
    });

    const initialEntry = await caller.inventory.recordEntry({
      productId: created.id,
      unitId: boxUnitId,
      mode: 'initial',
      quantity: 2,
      cost: 7,
      notes: 'Opening stock',
    });

    expect(initialEntry.normalizedQuantity).toBe(12);
    expect(initialEntry.previousStock).toBe(2);
    expect(initialEntry.newStock).toBe(14);
    expect(initialEntry.unitAbbreviation).toBe('CJ');

    const physicalEntry = await caller.inventory.recordEntry({
      productId: created.id,
      unitId: baseUnitId,
      mode: 'physical',
      quantity: 5,
      cost: 6,
      notes: 'Cycle count reset',
    });

    expect(physicalEntry.previousStock).toBe(14);
    expect(physicalEntry.newStock).toBe(5);

    const entries = await caller.inventory.listEntries({
      page: 1,
      perPage: 20,
      productId: created.id,
    });

    expect(entries.items).toHaveLength(2);
    expect(entries.items.map(entry => entry.mode).sort()).toEqual(['initial', 'physical']);

    const stock = await caller.inventory.productStock({ productId: created.id });
    expect(stock.stock).toBe(5);

    const movements = await caller.inventory.listMovements({
      page: 1,
      perPage: 20,
      productId: created.id,
    });

    expect(movements.items).toHaveLength(2);
    expect(
      movements.items.map(movement => movement.newStock).sort((left, right) => left - right)
    ).toEqual([5, 14]);
  });

  it('records fractional initial inventory entries without rounding normalized stock', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.products.create({
      name: 'Produce by weight',
      sku: 'INV-FRACTIONAL-ENTRY',
      description: null,
      categoryId,
      providerId,
      vatRateId,
      locationId: null,
      barcode: '10005',
      imageUrl: null,
      cost: 6,
      initialCost: 6,
      price: 9,
      price2: 10,
      price3: 11,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      stock: 1.25,
      minStock: 0.5,
      isActive: true,
      unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 9, isBase: true }],
    });

    const entry = await caller.inventory.recordEntry({
      productId: created.id,
      unitId: baseUnitId,
      mode: 'initial',
      quantity: 0.75,
      cost: 6,
      notes: 'Top-up produce weight',
    });

    expect(entry.quantity).toBe(0.75);
    expect(entry.normalizedQuantity).toBe(0.75);
    expect(entry.previousStock).toBe(1.25);
    expect(entry.newStock).toBe(2);

    const stock = await caller.inventory.productStock({ productId: created.id });
    expect(stock.stock).toBe(2);
  });

  // --------------------------------------------------------------------------
  // Phase 2 DB-101 / API-101 — inventory balances by site
  // --------------------------------------------------------------------------
  describe('listBalancesBySite', () => {
    let primarySiteId: string;
    let secondarySiteId: string;

    function buildProductInput(overrides: {
      name: string;
      sku: string;
      barcode: string;
      stock: number;
      minStock?: number;
    }) {
      return {
        name: overrides.name,
        sku: overrides.sku,
        description: null,
        categoryId,
        providerId,
        vatRateId,
        locationId: null,
        barcode: overrides.barcode,
        imageUrl: null,
        cost: 5,
        initialCost: 4,
        price: 8,
        price2: 9,
        price3: 10,
        marginPercent1: 0,
        marginPercent2: 0,
        marginPercent3: 0,
        marginAmount1: 0,
        marginAmount2: 0,
        marginAmount3: 0,
        taxRate: 0,
        stock: overrides.stock,
        minStock: overrides.minStock ?? 0,
        isActive: true,
        unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 8, isBase: true }],
      };
    }

    beforeAll(async () => {
      const db = getDatabase();
      // The seeded tenant exposes a single "Main Site" — reuse it as primary and
      // create one secondary site to prove non-primary sites start at zero.
      const mainSite = await db
        .select()
        .from(sites)
        .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
        .get();

      if (!mainSite) {
        throw new Error('Expected seeded main site');
      }

      primarySiteId = mainSite.id;
      secondarySiteId = nanoid();

      await db.insert(sites).values({
        id: secondarySiteId,
        tenantId,
        companyId: mainSite.companyId,
        name: 'Balances Secondary Site',
        address: null,
        phone: null,
        isActive: true,
        // Later created_at — guarantees the seeded Main Site stays primary.
        createdAt: new Date(Date.now() + 60_000).toISOString(),
        updatedAt: new Date(Date.now() + 60_000).toISOString(),
      });
    });

    it('seeds primary site with current product stock on first read and leaves secondary at zero', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const cable = await caller.products.create(
        buildProductInput({
          name: 'Balances Cable 2.5m',
          sku: 'BAL-CABLE',
          barcode: '90001',
          stock: 12.5,
          minStock: 2,
        })
      );

      const primary = await caller.inventory.listBalancesBySite({ siteId: primarySiteId });
      const cablePrimary = primary.items.find(item => item.productId === cable.id);
      expect(cablePrimary).toBeDefined();
      expect(cablePrimary?.onHand).toBe(12.5);
      expect(cablePrimary?.available).toBe(12.5);
      expect(cablePrimary?.isLowStock).toBe(false);
      // Summary aggregates all products in the tenant — make sure the cable
      // contributes without asserting the full total (earlier tests seed
      // additional products).
      expect(primary.summary.totalOnHand).toBeGreaterThanOrEqual(12.5);

      const secondary = await caller.inventory.listBalancesBySite({ siteId: secondarySiteId });
      const cableSecondary = secondary.items.find(item => item.productId === cable.id);
      expect(cableSecondary).toBeDefined();
      expect(cableSecondary?.onHand).toBe(0);
      expect(cableSecondary?.available).toBe(0);
      expect(secondary.summary.totalOnHand).toBe(0);
    });

    it('is idempotent across reads — no duplicate rows after repeated calls', async () => {
      const caller = appRouter.createCaller(createTestContext());

      const first = await caller.inventory.listBalancesBySite({ siteId: primarySiteId });
      await caller.inventory.listBalancesBySite({ siteId: primarySiteId });
      const third = await caller.inventory.listBalancesBySite({ siteId: primarySiteId });

      expect(third.items.length).toBe(first.items.length);

      const db = getDatabase();
      const rows = await db
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, primarySiteId)
          )
        )
        .all();

      expect(rows.length).toBe(first.items.length);
    });

    // Phase 2 step 1 made `inventory_balances` authoritative. Once a row is
    // seeded, later `products.stock` adjustments do NOT clobber it — direct
    // balance writes (transfers, future balance-aware adjustStock) are the
    // only source of truth. This test pins that contract so a regression to
    // "mirror mode" would fail loudly.
    it('does not clobber a seeded balance when products.stock changes later', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const created = await caller.products.create(
        buildProductInput({
          name: 'Balances Seed-Only Pipe',
          sku: 'BAL-SEEDONLY',
          barcode: '90004',
          stock: 4,
        })
      );

      const initial = await caller.inventory.listBalancesBySite({ siteId: primarySiteId });
      expect(initial.items.find(item => item.productId === created.id)?.onHand).toBe(4);

      await caller.inventory.adjustStock({
        productId: created.id,
        newStock: 9.5,
        notes: 'Legacy products.stock correction',
      });

      const refreshed = await caller.inventory.listBalancesBySite({ siteId: primarySiteId });
      expect(refreshed.items.find(item => item.productId === created.id)?.onHand).toBe(4);
    });

    it('marks low stock when on-hand is less than or equal to min stock', async () => {
      const caller = appRouter.createCaller(createTestContext());
      await caller.products.create(
        buildProductInput({
          name: 'Balances Low Bolt',
          sku: 'BAL-BOLT',
          barcode: '90002',
          stock: 1,
          minStock: 1,
        })
      );

      const result = await caller.inventory.listBalancesBySite({ siteId: primarySiteId });
      const bolt = result.items.find(item => item.productSku === 'BAL-BOLT');
      expect(bolt?.isLowStock).toBe(true);
      expect(result.summary.lowStockCount).toBeGreaterThanOrEqual(1);
    });

    it('ensures rows for products created after the initial seed (zero on non-primary sites)', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const before = await caller.inventory.listBalancesBySite({ siteId: secondarySiteId });

      await caller.products.create(
        buildProductInput({
          name: 'Balances Late Product',
          sku: 'BAL-LATE',
          barcode: '90003',
          stock: 7,
        })
      );

      const after = await caller.inventory.listBalancesBySite({ siteId: secondarySiteId });
      expect(after.items.length).toBe(before.items.length + 1);
      expect(after.items.find(item => item.productSku === 'BAL-LATE')?.onHand).toBe(0);
    });

    it('rejects sites that do not belong to the current tenant', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const db = getDatabase();
      const foreignTenantId = nanoid();
      const foreignCompanyId = nanoid();
      const foreignSiteId = nanoid();
      const now = new Date().toISOString();

      await db.insert(tenants).values({
        id: foreignTenantId,
        name: 'Foreign Tenant',
        slug: `foreign-tenant-${foreignTenantId}`,
        settings: {},
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(companies).values({
        id: foreignCompanyId,
        tenantId: foreignTenantId,
        name: 'Foreign Company',
        taxId: null,
        address: null,
        phone: null,
        email: null,
        logoId: null,
        logoUrl: null,
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(sites).values({
        id: foreignSiteId,
        tenantId: foreignTenantId,
        companyId: foreignCompanyId,
        name: 'Foreign Site',
        address: null,
        phone: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      await expect(
        caller.inventory.listBalancesBySite({ siteId: foreignSiteId })
      ).rejects.toMatchObject<Partial<TRPCError>>({
        code: 'NOT_FOUND',
        message: 'Site not found',
      });
    });
  });
});
