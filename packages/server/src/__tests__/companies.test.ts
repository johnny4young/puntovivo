import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { companies, users } from '../db/schema.js';
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

    const logo = await caller.logos.create({
      name: 'Primary Brand',
      imageUrl: 'https://example.com/brand-logo.png',
      isActive: true,
    });

    const updated = await caller.companies.upsert({
      name: 'Updated Puntovivo LLC',
      taxId: '900123456',
      email: 'finance@example.com',
      phone: '555-0199',
      address: '123 Business Ave',
      logoId: logo.id,
    });

    expect(updated.name).toBe('Updated Puntovivo LLC');
    expect(updated.taxId).toBe('900123456');
    expect(updated.logoId).toBe(logo.id);
    expect(updated.logoUrl).toBe('https://example.com/brand-logo.png');

    const stored = await getDatabase()
      .select()
      .from(companies)
      .where(eq(companies.id, updated.id))
      .get();

    expect(stored?.email).toBe('finance@example.com');
    expect(stored?.logoId).toBe(logo.id);
  });

  it('allows selecting and clearing the active company logo', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const logo = await caller.logos.create({
      name: 'Receipt Logo',
      imageUrl: 'https://example.com/receipt-logo.png',
      isActive: true,
    });

    const selected = await caller.companies.setLogo({ logoId: logo.id });
    expect(selected.logoId).toBe(logo.id);
    expect(selected.logoUrl).toBe('https://example.com/receipt-logo.png');

    const cleared = await caller.companies.setLogo({ logoId: null });
    expect(cleared.logoId).toBeNull();
    expect(cleared.logoUrl).toBeNull();
  });
});
