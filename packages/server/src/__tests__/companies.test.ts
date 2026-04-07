import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServer, type OpenYojobServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { companies, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: OpenYojobServer;
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

describe('Companies tRPC Router', () => {
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

  it('returns the seeded company and updates it through upsert', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const existing = await caller.companies.getCurrent();
    expect(existing).not.toBeNull();

    const updated = await caller.companies.upsert({
      name: 'Updated Open Yojob LLC',
      taxId: '900123456',
      email: 'finance@example.com',
      phone: '555-0199',
      address: '123 Business Ave',
      logoUrl: 'https://example.com/logo.png',
    });

    expect(updated.name).toBe('Updated Open Yojob LLC');
    expect(updated.taxId).toBe('900123456');

    const stored = await getDatabase()
      .select()
      .from(companies)
      .where(eq(companies.id, updated.id))
      .get();

    expect(stored?.email).toBe('finance@example.com');
  });
});
