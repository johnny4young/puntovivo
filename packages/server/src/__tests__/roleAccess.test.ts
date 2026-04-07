import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { createServer, type OpenYojobServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { users } from '../db/schema.js';

let server: OpenYojobServer;
let tenantId: string;
let adminUserId: string;

function createTestContext(
  role: 'admin' | 'manager' | 'cashier'
): Context {
  const db = getDatabase();
  const userId = role === 'admin' ? adminUserId : `${role}-test-user`;
  const email = `${role}@localhost`;
  const mockReq = {
    server: server.app,
    headers: {},
    user: {
      userId,
      email,
      role,
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
      email,
      role,
      tenantId,
    },
    tenantId,
    siteId: null,
  };
}

describe('Role access middleware', () => {
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

    tenantId = seededUser.tenantId;
    adminUserId = seededUser.id;
  });

  afterAll(async () => {
    await server.close();
  });

  it('restricts admin-only routes and allows manager product workflows', async () => {
    const adminCaller = appRouter.createCaller(createTestContext('admin'));
    const managerCaller = appRouter.createCaller(createTestContext('manager'));
    const cashierCaller = appRouter.createCaller(createTestContext('cashier'));

    await expect(
      cashierCaller.categories.create({
        name: 'Cashier Category',
      })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const product = await managerCaller.products.create({
      name: 'Manager Product',
      sku: 'ROLE-MANAGER-001',
      price: 15,
      stock: 4,
    });

    expect(product.name).toBe('Manager Product');

    await expect(
      cashierCaller.products.create({
        name: 'Cashier Product',
        sku: 'ROLE-CASHIER-001',
        price: 10,
        stock: 2,
      })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    await expect(
      cashierCaller.providers.create({
        name: 'Cashier Provider',
        isActive: true,
      })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const customer = await managerCaller.customers.create({
      name: 'Manager Customer',
    });

    expect(customer.name).toBe('Manager Customer');

    const stockResult = await managerCaller.inventory.listStock({
      page: 1,
      perPage: 10,
    });

    expect(Array.isArray(stockResult.items)).toBe(true);

    await expect(
      cashierCaller.inventory.listStock({
        page: 1,
        perPage: 10,
      })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    await expect(
      cashierCaller.users.list({
        page: 1,
        perPage: 10,
      })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const company = await adminCaller.companies.getCurrent();
    expect(company).not.toBeUndefined();
  });
});
