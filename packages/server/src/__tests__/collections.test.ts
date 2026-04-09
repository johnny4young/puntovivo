/**
 * Collections tRPC Router Tests
 *
 * Tests categories, products, customers, sales, and inventory procedures
 * via appRouter.createCaller() for type-safe testing.
 *
 * @module __tests__/collections.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createServer, type OpenYojobServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  categories,
  clientTypes,
  companies,
  identificationTypes,
  personTypes,
  regimeTypes,
  sequentials,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: OpenYojobServer;
let testTenantId: string;
let adminUserId: string;
let cashierUserId: string;
let seededCategoryId: string;
let defaultSiteId: string;
const testDbPath = ':memory:';

const CUSTOMER_CATALOG_SEED = {
  identificationTypes: [{ code: 'CC', name: 'Cedula de Ciudadania' }, { code: 'NIT', name: 'NIT' }],
  personTypes: [{ code: 'natural', name: 'Natural Person' }],
  regimeTypes: [
    { code: 'simplified', name: 'Simplified Regime' },
    { code: 'common', name: 'Common Regime' },
  ],
  clientTypes: [
    { code: 'retail', name: 'Retail Customer' },
    { code: 'wholesale', name: 'Wholesale Customer' },
  ],
} as const;

/**
 * Build a tRPC context for use with createCaller.
 * For protected tenant procedures, pass user payload.
 */
function createTestContext(userPayload?: {
  id: string;
  email: string;
  role: string;
  tenantId: string;
}): Context {
  const db = getDatabase();

  const mockReq = {
    server: server.app,
    headers: {},
    user: userPayload
      ? {
          userId: userPayload.id,
          email: userPayload.email,
          role: userPayload.role,
          tenantId: userPayload.tenantId,
        }
      : null,
    jwtVerify: async () => {
      if (!userPayload) throw new Error('No token');
    },
  } as unknown as Context['req'];

  const mockRes = {} as unknown as Context['res'];

  return {
    req: mockReq,
    res: mockRes,
    db,
    user: userPayload
      ? {
          id: userPayload.id,
          email: userPayload.email,
          role: userPayload.role,
          tenantId: userPayload.tenantId,
        }
      : null,
    tenantId: userPayload?.tenantId ?? null,
    siteId: null,
  };
}

describe('Collections tRPC Routers', () => {
  beforeAll(async () => {
    server = await createServer({
      dbPath: testDbPath,
      verbose: false,
    });

    const db = getDatabase();

    // Create test tenant
    testTenantId = nanoid();
    await db.insert(tenants).values({
      id: testTenantId,
      name: 'Collections Test Tenant',
      slug: `collections-test-${nanoid(6)}`,
      settings: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const companyId = nanoid();
    defaultSiteId = nanoid();

    await db.insert(companies).values({
      id: companyId,
      tenantId: testTenantId,
      name: 'Collections Test Company',
      taxId: '900000001-0',
      address: 'Test address',
      phone: '1111111111',
      email: 'company@collections-test.com',
      logoUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.insert(sites).values({
      id: defaultSiteId,
      tenantId: testTenantId,
      companyId,
      name: 'Main Site',
      address: 'Main site address',
      phone: '1111111111',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.insert(sequentials).values({
      id: nanoid(),
      tenantId: testTenantId,
      siteId: defaultSiteId,
      documentType: 'sale',
      prefix: 'VTA-',
      currentValue: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Create admin user
    adminUserId = nanoid();
    const adminHash = await hash('AdminPass123!');
    await db.insert(users).values({
      id: adminUserId,
      tenantId: testTenantId,
      email: 'admin@collections-test.com',
      passwordHash: adminHash,
      name: 'Admin User',
      role: 'admin',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Create cashier user
    cashierUserId = nanoid();
    const cashierHash = await hash('CashierPass123!');
    await db.insert(users).values({
      id: cashierUserId,
      tenantId: testTenantId,
      email: 'cashier@collections-test.com',
      passwordHash: cashierHash,
      name: 'Cashier User',
      role: 'cashier',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Pre-seed one category for list/getById tests
    seededCategoryId = nanoid();
    await db.insert(categories).values({
      id: seededCategoryId,
      tenantId: testTenantId,
      name: 'Seeded Category',
      description: 'Pre-seeded for tests',
      parentId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    for (const item of CUSTOMER_CATALOG_SEED.identificationTypes) {
      await db.insert(identificationTypes).values({
        id: nanoid(),
        tenantId: testTenantId,
        code: item.code,
        name: item.name,
        description: null,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    for (const item of CUSTOMER_CATALOG_SEED.personTypes) {
      await db.insert(personTypes).values({
        id: nanoid(),
        tenantId: testTenantId,
        code: item.code,
        name: item.name,
        description: null,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    for (const item of CUSTOMER_CATALOG_SEED.regimeTypes) {
      await db.insert(regimeTypes).values({
        id: nanoid(),
        tenantId: testTenantId,
        code: item.code,
        name: item.name,
        description: null,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    for (const item of CUSTOMER_CATALOG_SEED.clientTypes) {
      await db.insert(clientTypes).values({
        id: nanoid(),
        tenantId: testTenantId,
        code: item.code,
        name: item.name,
        description: null,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

  // ============================================================================
  // CATEGORIES
  // ============================================================================

  describe('categories', () => {
    const adminCtx = () =>
      createTestContext({
        id: adminUserId,
        email: 'admin@collections-test.com',
        role: 'admin',
        tenantId: testTenantId,
      });
    const cashierCtx = () =>
      createTestContext({
        id: cashierUserId,
        email: 'cashier@collections-test.com',
        role: 'cashier',
        tenantId: testTenantId,
      });

    describe('categories.list', () => {
      it('returns a paginated list that includes the pre-seeded category', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const result = await caller.categories.list({ page: 1, perPage: 50 });

        expect(result.items).toBeDefined();
        expect(Array.isArray(result.items)).toBe(true);
        expect(result.page).toBe(1);
        expect(result.perPage).toBe(50);
        expect(result.totalItems).toBeGreaterThanOrEqual(1);

        const seeded = result.items.find(c => c.id === seededCategoryId);
        expect(seeded).toBeDefined();
        expect(seeded!.name).toBe('Seeded Category');
      });
    });

    describe('categories.getById', () => {
      it('returns the seeded category by ID', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const result = await caller.categories.getById({ id: seededCategoryId });

        expect(result.id).toBe(seededCategoryId);
        expect(result.name).toBe('Seeded Category');
        expect(result.tenantId).toBe(testTenantId);
      });

      it('throws NOT_FOUND for an unknown ID', async () => {
        const caller = appRouter.createCaller(adminCtx());

        try {
          await caller.categories.getById({ id: 'nonexistent-cat-id' });
          expect.unreachable('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(TRPCError);
          expect((err as TRPCError).code).toBe('NOT_FOUND');
        }
      });
    });

    describe('categories.create', () => {
      it('creates a category and returns correct fields with tenantId', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const result = await caller.categories.create({
          name: 'Created Category',
          description: 'Created in test',
        });

        expect(result.id).toBeDefined();
        expect(result.name).toBe('Created Category');
        expect(result.description).toBe('Created in test');
        expect(result.tenantId).toBe(testTenantId);
        expect(result.parentId).toBeNull();
      });

      it('rejects unknown parent categories', async () => {
        const caller = appRouter.createCaller(adminCtx());

        await expect(
          caller.categories.create({
            name: 'Child',
            parentId: 'missing-parent-id',
          })
        ).rejects.toMatchObject({
          code: 'NOT_FOUND',
        });
      });
    });

    describe('categories.update', () => {
      it('updates the name of an existing category', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const created = await caller.categories.create({ name: 'Before Update' });
        const updated = await caller.categories.update({
          id: created.id,
          name: 'After Update',
        });

        expect(updated.id).toBe(created.id);
        expect(updated.name).toBe('After Update');
      });

      it('rejects self-referential category parents', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const created = await caller.categories.create({ name: 'Self Parent' });

        await expect(
          caller.categories.update({
            id: created.id,
            parentId: created.id,
          })
        ).rejects.toMatchObject({
          code: 'BAD_REQUEST',
        });
      });

      it('rejects cyclic hierarchies', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const root = await caller.categories.create({ name: 'Root Category' });
        const child = await caller.categories.create({
          name: 'Child Category',
          parentId: root.id,
        });

        await expect(
          caller.categories.update({
            id: root.id,
            parentId: child.id,
          })
        ).rejects.toMatchObject({
          code: 'BAD_REQUEST',
        });
      });

      it('throws NOT_FOUND when updating a missing category', async () => {
        const caller = appRouter.createCaller(adminCtx());

        try {
          await caller.categories.update({ id: 'nonexistent-id', name: 'X' });
          expect.unreachable('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(TRPCError);
          expect((err as TRPCError).code).toBe('NOT_FOUND');
        }
      });
    });

    describe('categories.delete', () => {
      it('admin can delete a category', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const created = await caller.categories.create({ name: 'To Delete' });
        const result = await caller.categories.delete({ id: created.id });

        expect(result.success).toBe(true);
        expect(result.id).toBe(created.id);
      });

      it('rejects deleting a category with child categories', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const parent = await caller.categories.create({ name: 'Parent Category' });
        await caller.categories.create({
          name: 'Nested Category',
          parentId: parent.id,
        });

        await expect(
          caller.categories.delete({ id: parent.id })
        ).rejects.toMatchObject({
          code: 'BAD_REQUEST',
        });
      });

      it('cashier gets FORBIDDEN when attempting to delete', async () => {
        const adminCaller = appRouter.createCaller(adminCtx());
        const cashierCaller = appRouter.createCaller(cashierCtx());
        const created = await adminCaller.categories.create({ name: 'Cashier Cannot Delete' });

        try {
          await cashierCaller.categories.delete({ id: created.id });
          expect.unreachable('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(TRPCError);
          expect((err as TRPCError).code).toBe('FORBIDDEN');
        }
      });
    });

    describe('categories.tree', () => {
      it('returns a flat list of all categories for the tenant', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const result = await caller.categories.tree();

        expect(result.items).toBeDefined();
        expect(Array.isArray(result.items)).toBe(true);
        expect(result.items.length).toBeGreaterThanOrEqual(1);

        const seeded = result.items.find(c => c.id === seededCategoryId);
        expect(seeded).toBeDefined();
      });
    });
  });

  // ============================================================================
  // PRODUCTS
  // ============================================================================

  describe('products', () => {
    const adminCtx = () =>
      createTestContext({
        id: adminUserId,
        email: 'admin@collections-test.com',
        role: 'admin',
        tenantId: testTenantId,
      });
    const cashierCtx = () =>
      createTestContext({
        id: cashierUserId,
        email: 'cashier@collections-test.com',
        role: 'cashier',
        tenantId: testTenantId,
      });

    describe('products.list', () => {
      it('returns a paginated list', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const result = await caller.products.list({ page: 1, perPage: 10 });

        expect(result.items).toBeDefined();
        expect(Array.isArray(result.items)).toBe(true);
        expect(result.page).toBe(1);
        expect(result.perPage).toBe(10);
        expect(result.totalItems).toBeGreaterThanOrEqual(0);
      });

      it('supports a search filter that narrows results', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const sku = `SEARCH-SKU-${nanoid(6)}`;
        await caller.products.create({
          name: 'Unique Searchable Widget',
          sku,
          price: 9.99,
          stock: 5,
        });

        const found = await caller.products.list({
          page: 1,
          perPage: 50,
          search: 'Unique Searchable Widget',
        });
        expect(found.items.length).toBeGreaterThanOrEqual(1);
        expect(found.items.some(p => p.sku === sku)).toBe(true);

        const notFound = await caller.products.list({
          page: 1,
          perPage: 50,
          search: 'zxqwerty999nosuchproduct',
        });
        expect(notFound.items).toHaveLength(0);
      });
    });

    describe('products.getById', () => {
      it('returns a product by ID', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const created = await caller.products.create({
          name: 'Fetchable Product',
          sku: `FETCH-${nanoid(6)}`,
          price: 19.99,
          stock: 10,
        });

        const result = await caller.products.getById({ id: created.id });
        expect(result.id).toBe(created.id);
        expect(result.name).toBe('Fetchable Product');
      });

      it('throws NOT_FOUND for a missing product', async () => {
        const caller = appRouter.createCaller(adminCtx());

        try {
          await caller.products.getById({ id: 'nonexistent-prod-id' });
          expect.unreachable('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(TRPCError);
          expect((err as TRPCError).code).toBe('NOT_FOUND');
        }
      });
    });

    describe('products.create', () => {
      it('creates a product with SKU, price, stock, and correct tenantId', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const sku = `CREATE-SKU-${nanoid(6)}`;
        const result = await caller.products.create({
          name: 'Brand New Product',
          sku,
          price: 49.99,
          cost: 25.0,
          stock: 100,
          minStock: 10,
        });

        expect(result.id).toBeDefined();
        expect(result.name).toBe('Brand New Product');
        expect(result.sku).toBe(sku);
        expect(result.price).toBe(49.99);
        expect(result.stock).toBe(100);
        expect(result.tenantId).toBe(testTenantId);
      });
    });

    describe('products.update', () => {
      it('updates the price of an existing product', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const created = await caller.products.create({
          name: 'Price Update Product',
          sku: `PRICE-SKU-${nanoid(6)}`,
          price: 10.0,
          stock: 5,
        });

        const updated = await caller.products.update({ id: created.id, price: 29.99 });
        expect(updated.id).toBe(created.id);
        expect(updated.price).toBe(29.99);
      });

      it('throws NOT_FOUND when updating a missing product', async () => {
        const caller = appRouter.createCaller(adminCtx());

        try {
          await caller.products.update({ id: 'nonexistent-id', price: 1.0 });
          expect.unreachable('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(TRPCError);
          expect((err as TRPCError).code).toBe('NOT_FOUND');
        }
      });
    });

    describe('products.delete', () => {
      it('admin can delete a product', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const created = await caller.products.create({
          name: 'Deletable Product',
          sku: `DEL-SKU-${nanoid(6)}`,
          price: 5.0,
          stock: 1,
        });

        const result = await caller.products.delete({ id: created.id });
        expect(result.success).toBe(true);
        expect(result.id).toBe(created.id);
      });

      it('cashier gets FORBIDDEN when attempting to delete', async () => {
        const adminCaller = appRouter.createCaller(adminCtx());
        const cashierCaller = appRouter.createCaller(cashierCtx());
        const created = await adminCaller.products.create({
          name: 'Cashier Cannot Delete Product',
          sku: `CASHIER-DEL-${nanoid(6)}`,
          price: 5.0,
          stock: 1,
        });

        try {
          await cashierCaller.products.delete({ id: created.id });
          expect.unreachable('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(TRPCError);
          expect((err as TRPCError).code).toBe('FORBIDDEN');
        }
      });
    });

    describe('products.search', () => {
      it('finds a product by partial name', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const uniqueName = `Zephyr Widget ${nanoid(6)}`;
        const sku = `SRCH-${nanoid(6)}`;
        await caller.products.create({ name: uniqueName, sku, price: 1.0, stock: 1 });

        const result = await caller.products.search({ q: 'Zephyr Widget' });
        expect(result.items.length).toBeGreaterThanOrEqual(1);
        expect(result.items.some(p => p.sku === sku)).toBe(true);
      });
    });
  });

  // ============================================================================
  // CUSTOMERS
  // ============================================================================

  describe('customers', () => {
    const adminCtx = () =>
      createTestContext({
        id: adminUserId,
        email: 'admin@collections-test.com',
        role: 'admin',
        tenantId: testTenantId,
      });
    const cashierCtx = () =>
      createTestContext({
        id: cashierUserId,
        email: 'cashier@collections-test.com',
        role: 'cashier',
        tenantId: testTenantId,
      });

    describe('customers.list', () => {
      it('returns a paginated list', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const result = await caller.customers.list({ page: 1, perPage: 10 });

        expect(result.items).toBeDefined();
        expect(Array.isArray(result.items)).toBe(true);
        expect(result.page).toBe(1);
        expect(result.perPage).toBe(10);
        expect(result.totalItems).toBeGreaterThanOrEqual(0);
      });
    });

    describe('customers.getById', () => {
      it('returns a customer by ID', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const created = await caller.customers.create({ name: 'Fetchable Customer' });

        const result = await caller.customers.getById({ id: created.id });
        expect(result.id).toBe(created.id);
        expect(result.name).toBe('Fetchable Customer');
        expect(result.tenantId).toBe(testTenantId);
      });

      it('throws NOT_FOUND for a missing customer', async () => {
        const caller = appRouter.createCaller(adminCtx());

        try {
          await caller.customers.getById({ id: 'nonexistent-cust-id' });
          expect.unreachable('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(TRPCError);
          expect((err as TRPCError).code).toBe('NOT_FOUND');
        }
      });
    });

    describe('customers.create', () => {
      it('creates a customer and returns correct fields', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const result = await caller.customers.create({
          name: 'Jane Smith',
          email: 'jane@example.com',
          phone: '555-0100',
          identificationTypeId: 'CC',
          personTypeId: 'natural',
          regimeTypeId: 'simplified',
          clientTypeId: 'retail',
        });

        expect(result.id).toBeDefined();
        expect(result.name).toBe('Jane Smith');
        expect(result.email).toBe('jane@example.com');
        expect(result.phone).toBe('555-0100');
        expect(result.identificationTypeId).toBe('CC');
        expect(result.personTypeId).toBe('natural');
        expect(result.regimeTypeId).toBe('simplified');
        expect(result.clientTypeId).toBe('retail');
        expect(result.tenantId).toBe(testTenantId);
      });
    });

    describe('customers.update', () => {
      it('updates the name and enhancement fields of an existing customer', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const created = await caller.customers.create({ name: 'Old Name' });
        const updated = await caller.customers.update({
          id: created.id,
          name: 'New Name',
          identificationTypeId: 'NIT',
          clientTypeId: 'wholesale',
        });

        expect(updated.id).toBe(created.id);
        expect(updated.name).toBe('New Name');
        expect(updated.identificationTypeId).toBe('NIT');
        expect(updated.clientTypeId).toBe('wholesale');
      });
    });

    describe('customers.delete', () => {
      it('admin can delete a customer', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const created = await caller.customers.create({ name: 'To Be Deleted Customer' });
        const result = await caller.customers.delete({ id: created.id });

        expect(result.success).toBe(true);
        expect(result.id).toBe(created.id);
      });

      it('cashier gets FORBIDDEN when attempting to delete', async () => {
        const adminCaller = appRouter.createCaller(adminCtx());
        const cashierCaller = appRouter.createCaller(cashierCtx());
        const created = await adminCaller.customers.create({
          name: 'Cashier Cannot Delete Customer',
        });

        try {
          await cashierCaller.customers.delete({ id: created.id });
          expect.unreachable('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(TRPCError);
          expect((err as TRPCError).code).toBe('FORBIDDEN');
        }
      });
    });

    describe('customers.search', () => {
      it('finds a customer by partial name', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const uniqueName = `Quincy Larson ${nanoid(6)}`;
        await caller.customers.create({ name: uniqueName });

        const result = await caller.customers.search({ q: 'Quincy Larson' });
        expect(result.items.length).toBeGreaterThanOrEqual(1);
        expect(result.items.some(c => c.name === uniqueName)).toBe(true);
      });
    });
  });

  // ============================================================================
  // SALES
  // ============================================================================

  describe('sales', () => {
    const adminCtx = () =>
      createTestContext({
        id: adminUserId,
        email: 'admin@collections-test.com',
        role: 'admin',
        tenantId: testTenantId,
      });
    const cashierCtx = () =>
      createTestContext({
        id: cashierUserId,
        email: 'cashier@collections-test.com',
        role: 'cashier',
        tenantId: testTenantId,
      });

    let saleProductId: string;
    let saleUnitId: string;
    let createdSaleId: string;

    beforeAll(async () => {
      // Create a product to use in sale tests
      const caller = appRouter.createCaller(adminCtx());
      const product = await caller.products.create({
        name: 'Sale Test Product',
        sku: `SALE-PROD-${nanoid(6)}`,
        price: 100.0,
        cost: 50.0,
        stock: 50,
        minStock: 5,
      });
      saleProductId = product.id;
      saleUnitId =
        product.unitAssignments?.find(assignment => assignment.isBase)?.unitId ??
        product.unitAssignments?.[0]?.unitId ??
        '';
      if (!saleUnitId) {
        throw new Error('Expected sale product to have a base unit assignment');
      }
    });

    describe('sales.create', () => {
      it('creates a sale with 1 item, verifies total calculation and stock decrement', async () => {
        const caller = appRouter.createCaller(adminCtx());

        // Capture stock before sale
        const stockBefore = await caller.inventory.productStock({ productId: saleProductId });

        const result = await caller.sales.create({
          items: [
            {
              productId: saleProductId,
              unitId: saleUnitId,
              quantity: 2,
              unitPrice: 100.0,
              discount: 0,
              taxRate: 10,
            },
          ],
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          status: 'completed',
        });

        createdSaleId = result.id;

        // Prices are VAT-inclusive, so subtotal is the extracted base value.
        expect(result.subtotal).toBeCloseTo(181.8181818181818);
        expect(result.taxAmount).toBeCloseTo(18.181818181818187);
        expect(result.total).toBe(200);
        expect(result.items).toHaveLength(1);
        expect(result.items[0].productId).toBe(saleProductId);
        expect(result.items[0].quantity).toBe(2);
        expect(result.tenantId).toBe(testTenantId);

        // Verify stock was decremented
        const stockAfter = await caller.inventory.productStock({ productId: saleProductId });
        expect(stockAfter.stock).toBe(stockBefore.stock - 2);
      });
    });

    describe('sales.list', () => {
      it('returns a paginated list that includes the created sale', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const result = await caller.sales.list({ page: 1, perPage: 50 });

        expect(Array.isArray(result.items)).toBe(true);
        expect(result.totalItems).toBeGreaterThanOrEqual(1);

        const found = result.items.find(s => s.id === createdSaleId);
        expect(found).toBeDefined();
      });
    });

    describe('sales.getById', () => {
      it('returns the sale with items array', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const result = await caller.sales.getById({ id: createdSaleId });

        expect(result.id).toBe(createdSaleId);
        expect(Array.isArray(result.items)).toBe(true);
        expect(result.items.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('sales.void', () => {
      it('admin can void a sale', async () => {
        const caller = appRouter.createCaller(adminCtx());

        // Create a fresh sale to void
        const product = await caller.products.create({
          name: `Void Test Product ${nanoid(4)}`,
          sku: `VOID-PROD-${nanoid(6)}`,
          price: 10.0,
          stock: 10,
        });
        const unitId =
          product.unitAssignments?.find(assignment => assignment.isBase)?.unitId ??
          product.unitAssignments?.[0]?.unitId ??
          '';
        if (!unitId) {
          throw new Error('Expected void test product to have a base unit assignment');
        }
        const sale = await caller.sales.create({
          items: [
            { productId: product.id, unitId, quantity: 1, unitPrice: 10.0, discount: 0, taxRate: 0 },
          ],
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          status: 'completed',
        });

        const voided = await caller.sales.void({ id: sale.id, reason: 'Test void' });
        expect(voided.status).toBe('voided');
        expect(voided.id).toBe(sale.id);
      });

      it('cashier gets FORBIDDEN when attempting to void a sale', async () => {
        const adminCaller = appRouter.createCaller(adminCtx());
        const cashierCaller = appRouter.createCaller(cashierCtx());

        const product = await adminCaller.products.create({
          name: `Cashier Void Test ${nanoid(4)}`,
          sku: `CASHIER-VOID-${nanoid(6)}`,
          price: 10.0,
          stock: 10,
        });
        const unitId =
          product.unitAssignments?.find(assignment => assignment.isBase)?.unitId ??
          product.unitAssignments?.[0]?.unitId ??
          '';
        if (!unitId) {
          throw new Error('Expected cashier void product to have a base unit assignment');
        }
        const sale = await adminCaller.sales.create({
          items: [
            { productId: product.id, unitId, quantity: 1, unitPrice: 10.0, discount: 0, taxRate: 0 },
          ],
          paymentMethod: 'cash',
          paymentStatus: 'pending',
          status: 'completed',
        });

        try {
          await cashierCaller.sales.void({ id: sale.id });
          expect.unreachable('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(TRPCError);
          expect((err as TRPCError).code).toBe('FORBIDDEN');
        }
      });

      it('throws BAD_REQUEST when voiding an already-voided sale', async () => {
        const caller = appRouter.createCaller(adminCtx());

        const product = await caller.products.create({
          name: `Double Void Product ${nanoid(4)}`,
          sku: `DVOID-${nanoid(6)}`,
          price: 10.0,
          stock: 10,
        });
        const unitId =
          product.unitAssignments?.find(assignment => assignment.isBase)?.unitId ??
          product.unitAssignments?.[0]?.unitId ??
          '';
        if (!unitId) {
          throw new Error('Expected double void product to have a base unit assignment');
        }
        const sale = await caller.sales.create({
          items: [
            { productId: product.id, unitId, quantity: 1, unitPrice: 10.0, discount: 0, taxRate: 0 },
          ],
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          status: 'completed',
        });

        // First void succeeds
        await caller.sales.void({ id: sale.id });

        // Second void should fail
        try {
          await caller.sales.void({ id: sale.id });
          expect.unreachable('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(TRPCError);
          expect((err as TRPCError).code).toBe('BAD_REQUEST');
        }
      });
    });
  });

  // ============================================================================
  // INVENTORY
  // ============================================================================

  describe('inventory', () => {
    const adminCtx = () =>
      createTestContext({
        id: adminUserId,
        email: 'admin@collections-test.com',
        role: 'admin',
        tenantId: testTenantId,
      });
    const cashierCtx = () =>
      createTestContext({
        id: cashierUserId,
        email: 'cashier@collections-test.com',
        role: 'cashier',
        tenantId: testTenantId,
      });

    let invProductId: string;
    let movementId: string;

    beforeAll(async () => {
      const caller = appRouter.createCaller(adminCtx());
      const product = await caller.products.create({
        name: `Inventory Test Product ${nanoid(4)}`,
        sku: `INV-PROD-${nanoid(6)}`,
        price: 20.0,
        stock: 0,
        minStock: 5,
      });
      invProductId = product.id;
    });

    describe('inventory.createMovement', () => {
      it('purchase type increases product stock', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const stockBefore = await caller.inventory.productStock({ productId: invProductId });

        const movement = await caller.inventory.createMovement({
          productId: invProductId,
          type: 'purchase',
          quantity: 30,
          notes: 'Initial stock purchase',
        });

        movementId = movement.id;

        expect(movement.id).toBeDefined();
        expect(movement.type).toBe('purchase');
        expect(movement.quantity).toBe(30);
        expect(movement.newStock).toBe(stockBefore.stock + 30);
        expect(movement.tenantId).toBe(testTenantId);

        const stockAfter = await caller.inventory.productStock({ productId: invProductId });
        expect(stockAfter.stock).toBe(stockBefore.stock + 30);
      });
    });

    describe('inventory.listMovements', () => {
      it('returns movements including the one just created', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const result = await caller.inventory.listMovements({
          page: 1,
          perPage: 50,
          productId: invProductId,
        });

        expect(Array.isArray(result.items)).toBe(true);
        expect(result.totalItems).toBeGreaterThanOrEqual(1);

        const found = result.items.find(m => m.id === movementId);
        expect(found).toBeDefined();
        expect(found!.type).toBe('purchase');
      });
    });

    describe('inventory.adjustStock', () => {
      it('admin sets absolute stock level', async () => {
        const caller = appRouter.createCaller(adminCtx());
        const result = await caller.inventory.adjustStock({
          productId: invProductId,
          newStock: 42,
          notes: 'Manual count correction',
        });

        expect(result.product.stock).toBe(42);
        expect(result.movementId).toBeDefined();
      });

      it('cashier gets FORBIDDEN when attempting to adjust stock', async () => {
        const cashierCaller = appRouter.createCaller(cashierCtx());

        try {
          await cashierCaller.inventory.adjustStock({
            productId: invProductId,
            newStock: 100,
          });
          expect.unreachable('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(TRPCError);
          expect((err as TRPCError).code).toBe('FORBIDDEN');
        }
      });
    });

    describe('inventory.productStock', () => {
      it('returns current stock and isLowStock flag', async () => {
        const caller = appRouter.createCaller(adminCtx());
        // Stock was set to 42, minStock is 5, so isLowStock should be false
        const result = await caller.inventory.productStock({ productId: invProductId });

        expect(result.productId).toBe(invProductId);
        expect(result.stock).toBe(42);
        expect(result.minStock).toBe(5);
        expect(result.isLowStock).toBe(false);

        // Adjust to below minStock and verify isLowStock becomes true
        await caller.inventory.adjustStock({ productId: invProductId, newStock: 3 });
        const lowResult = await caller.inventory.productStock({ productId: invProductId });
        expect(lowResult.isLowStock).toBe(true);
      });
    });
  });
});
