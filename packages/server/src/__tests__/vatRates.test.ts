import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;

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

  const mockRes = {} as unknown as Context['res'];

  return {
    req: mockReq,
    res: mockRes,
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

describe('VAT Rates tRPC Router', () => {
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
    userId = seededUser.id;
  });

  afterAll(async () => {
    await server.close();
  });

  it('creates, lists, updates, searches, and deletes vat rates', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.vatRates.create({
      name: 'IVA 12%',
      rate: 12,
      isActive: true,
    });

    expect(created.name).toBe('IVA 12%');
    expect(created.rate).toBe(12);

    const listed = await caller.vatRates.list({ page: 1, perPage: 50 });
    expect(listed.items.some(vatRate => vatRate.id === created.id)).toBe(true);

    const updated = await caller.vatRates.update({
      id: created.id,
      name: 'IVA 12 Updated',
      rate: 12.5,
    });
    expect(updated.name).toBe('IVA 12 Updated');
    expect(updated.rate).toBe(12.5);

    const searched = await caller.vatRates.search({ q: 'Updated', limit: 10 });
    expect(searched.items.map(vatRate => vatRate.id)).toContain(created.id);

    const removed = await caller.vatRates.delete({ id: created.id });
    expect(removed.success).toBe(true);

    const afterDelete = await caller.vatRates.list({ page: 1, perPage: 50 });
    expect(afterDelete.items.some(vatRate => vatRate.id === created.id)).toBe(false);
  });
});
