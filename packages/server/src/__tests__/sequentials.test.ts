import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { sequentials, sites, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;

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

describe('Sequentials tRPC Router', () => {
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

    tenantId = seededUser.tenantId;
    userId = seededUser.id;

    const site = await db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
    if (!site) {
      throw new Error('Expected seeded site');
    }
    siteId = site.id;
  });

  afterAll(async () => {
    await server.close();
  });

  it('lists and updates seeded sequentials, creates a new one for another type, and deletes it', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const initial = await caller.sequentials.list({ siteId });
    expect(initial.items.some(item => item.documentType === 'sale')).toBe(true);
    expect(initial.items.some(item => item.documentType === 'quotation')).toBe(true);

    const quotationOnly = await caller.sequentials.list({
      siteId,
      documentType: 'quotation',
    });
    expect(quotationOnly.items).toHaveLength(1);
    expect(quotationOnly.items[0]?.prefix).toBe('COT-');

    const updated = await caller.sequentials.upsert({
      siteId,
      documentType: 'sale',
      prefix: 'FAC-',
      currentValue: 25,
    });

    expect(updated.prefix).toBe('FAC-');
    expect(updated.currentValue).toBe(25);

    const db = getDatabase();
    await db.run(
      sql.raw(`
      CREATE TEMP TRIGGER sequential_counter_race
      BEFORE UPDATE OF prefix ON sequentials
      WHEN OLD.document_type = 'sale'
      BEGIN
        UPDATE sequentials
        SET current_value = OLD.current_value + 1
        WHERE id = OLD.id;
      END
    `)
    );

    const prefixOnlyUpdate = await (async () => {
      try {
        return await caller.sequentials.upsert({
          siteId,
          documentType: 'sale',
          prefix: 'POS-',
        });
      } finally {
        await db.run(sql.raw('DROP TRIGGER IF EXISTS sequential_counter_race'));
      }
    })();

    expect(prefixOnlyUpdate.prefix).toBe('POS-');
    expect(prefixOnlyUpdate.currentValue).toBe(26);

    const updatedQuotation = await caller.sequentials.upsert({
      siteId,
      documentType: 'quotation',
      prefix: 'COT-',
      currentValue: 12,
    });
    expect(updatedQuotation.documentType).toBe('quotation');
    expect(updatedQuotation.currentValue).toBe(12);

    await getDatabase()
      .delete(sequentials)
      .where(
        and(
          eq(sequentials.tenantId, tenantId),
          eq(sequentials.siteId, siteId),
          eq(sequentials.documentType, 'order')
        )
      );

    const created = await caller.sequentials.upsert({
      siteId,
      documentType: 'order',
      prefix: 'ORD-',
      currentValue: 7,
    });

    expect(created.documentType).toBe('order');

    await getDatabase()
      .delete(sequentials)
      .where(
        and(
          eq(sequentials.tenantId, tenantId),
          eq(sequentials.siteId, siteId),
          eq(sequentials.documentType, 'order')
        )
      );

    const createdAtDefault = await caller.sequentials.upsert({
      siteId,
      documentType: 'order',
      prefix: 'PED-',
    });

    expect(createdAtDefault.currentValue).toBe(0);

    const listed = await caller.sequentials.list({ siteId, documentType: 'order' });
    expect(listed.items[0]?.id).toBe(createdAtDefault.id);
    expect(listed.items[0]?.siteName).toBeDefined();

    const removed = await caller.sequentials.delete({ id: createdAtDefault.id });
    expect(removed.success).toBe(true);
  });
});
