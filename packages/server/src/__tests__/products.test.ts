import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type OpenYojobServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { categories, providers, units, users, vatRates } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: OpenYojobServer;
let tenantId: string;
let userId: string;
let categoryId: string;
let providerId: string;
let secondaryProviderId: string;
let inactiveProviderId: string;
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

describe('Products tRPC Router', () => {
  beforeAll(async () => {
    server = await createServer({
      dbPath: ':memory:',
      verbose: false,
    });

    const db = getDatabase();
    const seededUser = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
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
      locationId: 'A-01',
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
        { unitId: boxUnitId, equivalence: 6, price: 680, isBase: false },
      ],
    });

    expect(created.taxRate).toBe(19);
    expect(created.marginAmount1).toBe(20);
    expect(created.marginPercent2).toBe(40);
    expect(created.categoryName).toBe('Beverages');
    expect(created.providerName).toBe('Acme Supply');
    expect(created.vatRateName).toBe('IVA 19%');
    expect(created.unitAssignments).toHaveLength(2);
    expect(created.unitAssignments.find(item => item.isBase)?.unitId).toBe(baseUnitId);

    const listed = await caller.products.list({ page: 1, perPage: 20, search: 'Orange' });
    expect(listed.items.some(item => item.id === created.id)).toBe(true);

    const updated = await caller.products.update({
      id: created.id,
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
        { unitId: boxUnitId, equivalence: 12, price: 1320, isBase: false },
      ],
    });

    expect(updated.cost).toBe(110);
    expect(updated.price).toBe(120);
    expect(updated.marginAmount1).toBe(10);
    expect(updated.marginPercent1).toBeCloseTo(9.09, 2);
    expect(updated.unitAssignments.find(item => item.unitId === boxUnitId)?.equivalence).toBe(12);

    const removed = await caller.products.delete({ id: created.id });
    expect(removed.success).toBe(true);

    const fetched = await caller.products.getById({ id: created.id });
    expect(fetched.isActive).toBe(false);
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

  it('normalizes provider assignments and derives the primary provider from the assignment set', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.products.create({
      name: 'Provider Bundle',
      sku: 'PB-001',
      description: null,
      categoryId,
      providerId: secondaryProviderId,
      providerAssignments: [
        { providerId },
        { providerId: secondaryProviderId },
      ],
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
        providerAssignments: [
          { providerId },
          { providerId },
        ],
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
});
