import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { companies, sequentials, sites, tenants, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { getSaleSequentialContext } from '../application/sales/item-resolution.js';
import { getPurchaseSequentialContext } from '../application/purchases/helpers.js';
import { getOrderSequentialContext } from '../trpc/routers/orders/helpers.js';
import { resolveQuotationSequential } from '../services/quotations/create.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let companyId: string;

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
    companyId = site.companyId;
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

  it('never borrows document numbering from another active site', async () => {
    const db = getDatabase();
    const unconfiguredSiteId = nanoid();
    await db.insert(sites).values({
      id: unconfiguredSiteId,
      tenantId,
      companyId,
      name: 'Branch without numbering',
      isActive: true,
    });

    try {
      await expect(
        getSaleSequentialContext(db, tenantId, unconfiguredSiteId)
      ).rejects.toMatchObject({ cause: { errorCode: 'SALE_SEQUENTIAL_MISSING' } });
      await expect(
        getPurchaseSequentialContext(db, tenantId, unconfiguredSiteId)
      ).rejects.toMatchObject({ cause: { errorCode: 'PURCHASE_SEQUENTIAL_MISSING' } });
      await expect(
        getOrderSequentialContext(db, tenantId, unconfiguredSiteId)
      ).rejects.toMatchObject({ cause: { errorCode: 'ORDER_SEQUENTIAL_MISSING' } });
      expect(() => resolveQuotationSequential(db, tenantId, unconfiguredSiteId)).toThrow();
    } finally {
      await db.delete(sites).where(eq(sites.id, unconfiguredSiteId));
    }
  });

  it('rejects a sequential whose site belongs to another tenant', async () => {
    const db = getDatabase();
    const foreignTenantId = nanoid();
    const foreignCompanyId = nanoid();
    const foreignSiteId = nanoid();
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign numbering tenant',
      slug: `foreign-numbering-${foreignTenantId}`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: foreignCompanyId,
      tenantId: foreignTenantId,
      name: 'Foreign numbering company',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: foreignSiteId,
      tenantId: foreignTenantId,
      companyId: foreignCompanyId,
      name: 'Foreign numbering site',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sequentials).values(
      (['sale', 'purchase', 'order', 'quotation'] as const).map(documentType => ({
        id: nanoid(),
        tenantId,
        siteId: foreignSiteId,
        documentType,
        prefix: `${documentType.toUpperCase()}-`,
        currentValue: 0,
        createdAt: now,
        updatedAt: now,
      }))
    );

    try {
      await expect(getSaleSequentialContext(db, tenantId, foreignSiteId)).rejects.toMatchObject({
        cause: { errorCode: 'SALE_SEQUENTIAL_MISSING' },
      });
      await expect(getPurchaseSequentialContext(db, tenantId, foreignSiteId)).rejects.toMatchObject(
        { cause: { errorCode: 'PURCHASE_SEQUENTIAL_MISSING' } }
      );
      await expect(getOrderSequentialContext(db, tenantId, foreignSiteId)).rejects.toMatchObject({
        cause: { errorCode: 'ORDER_SEQUENTIAL_MISSING' },
      });
      expect(() => resolveQuotationSequential(db, tenantId, foreignSiteId)).toThrow();
    } finally {
      await db.delete(sequentials).where(eq(sequentials.siteId, foreignSiteId));
      await db.delete(sites).where(eq(sites.id, foreignSiteId));
      await db.delete(companies).where(eq(companies.id, foreignCompanyId));
      await db.delete(tenants).where(eq(tenants.id, foreignTenantId));
    }
  });
});
