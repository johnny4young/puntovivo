import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  products,
  saleItems,
  sales,
  sites,
  tenants,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let foreignSiteId: string;

function caller() {
  const context = {
    req: {
      server: server.app,
      headers: {},
      user: { userId, email: 'admin@localhost', role: 'cashier', tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db: getDatabase(),
    user: { id: userId, email: 'admin@localhost', role: 'cashier', tenantId },
    tenantId,
    siteId,
  } as Context;
  return appRouter.createCaller(context);
}

describe('products.topSelling', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const user = db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!user) throw new Error('Expected seeded admin user');
    tenantId = user.tenantId;
    userId = user.id;
    const site = db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
    if (!site) throw new Error('Expected seeded site');
    siteId = site.id;
    const now = new Date().toISOString();
    const foreignTenantId = nanoid();
    db.insert(tenants)
      .values({
        id: foreignTenantId,
        name: 'Foreign',
        slug: foreignTenantId.toLowerCase(),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    foreignSiteId = nanoid();
    db.insert(sites)
      .values({
        id: foreignSiteId,
        tenantId: foreignTenantId,
        companyId: site.companyId,
        name: 'Foreign site',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns nothing for a site without sales', async () => {
    await expect(caller().products.topSelling({ siteId })).resolves.toEqual([]);
  });

  it('ranks what sold recently at this site, ignoring other sites, drafts and old sales', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const unit = db.select().from(units).where(eq(units.tenantId, tenantId)).get();
    if (!unit) throw new Error('Expected seeded unit');
    const secondSiteId = nanoid();
    const site = db.select().from(sites).where(eq(sites.id, siteId)).get();
    db.insert(sites)
      .values({
        id: secondSiteId,
        tenantId,
        companyId: site!.companyId,
        name: 'Second',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const session = (forSite: string) => {
      const id = nanoid();
      db.insert(cashSessions)
        .values({
          id,
          tenantId,
          siteId: forSite,
          cashierId: userId,
          registerName: `R-${id.slice(0, 4)}`,
          status: 'closed',
          openingBalance: 0,
          openingCountDenominations: [],
          openedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      return id;
    };
    const product = (name: string) => {
      const id = nanoid();
      db.insert(products)
        .values({
          id,
          tenantId,
          name,
          sku: `T-${id.slice(0, 6)}`,
          price: 10,
          cost: 5,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      return id;
    };
    const sell = (
      productId: string,
      quantity: number,
      cashSessionId: string,
      overrides: { status?: 'completed' | 'draft'; createdAt?: string } = {}
    ) => {
      const saleId = nanoid();
      db.insert(sales)
        .values({
          id: saleId,
          tenantId,
          saleNumber: `S-${saleId.slice(0, 8)}`,
          cashSessionId,
          status: overrides.status ?? 'completed',
          subtotal: 10,
          total: 10,
          createdBy: userId,
          createdAt: overrides.createdAt ?? now,
          updatedAt: now,
        })
        .run();
      db.insert(saleItems)
        .values({
          id: nanoid(),
          saleId,
          productId,
          productName: 'x',
          quantity,
          unitPrice: 10,
          subtotal: 10,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    };
    const here = session(siteId);
    const elsewhere = session(secondSiteId);
    const best = product('Best seller');
    const second = product('Second seller');
    const hidden = product('Elsewhere only');
    const old = product('Old sales only');
    const draft = product('Draft only');
    sell(second, 3, here);
    sell(best, 5, here);
    sell(best, 4, here);
    sell(hidden, 99, elsewhere);
    sell(old, 99, here, { createdAt: longAgo });
    sell(draft, 99, here, { status: 'draft' });

    const result = await caller().products.topSelling({ siteId });

    expect(result.map(row => [row.name, row.quantity])).toEqual([
      ['Best seller', 9],
      ['Second seller', 3],
    ]);
  });

  it('rejects a site from another tenant', async () => {
    await expect(caller().products.topSelling({ siteId: foreignSiteId })).rejects.toThrow();
  });
});
