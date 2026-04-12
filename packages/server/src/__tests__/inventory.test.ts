import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { categories, providers, units, users, vatRates } from '../db/schema.js';
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
});
