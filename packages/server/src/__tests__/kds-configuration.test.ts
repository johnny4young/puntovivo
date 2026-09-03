/** Real router/SQLite configuration authorization, CAS, routing and audit contracts. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  categories,
  companies,
  kdsOrders,
  kdsRoutingRules,
  kdsStations,
  products,
  sales,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { resolveKitchenRoutes } from '../application/kds/stations.js';
let server: PuntovivoServer;
beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});
afterAll(async () => {
  await server.close();
});
function fixture() {
  const db = getDatabase();
  const id = nanoid();
  db.insert(tenants)
    .values({ id, name: id, slug: id, settings: { modules: { kds: true } } })
    .run();
  db.insert(companies).values({ id, tenantId: id, name: id }).run();
  db.insert(sites).values({ id, tenantId: id, companyId: id, name: id }).run();
  db.insert(users)
    .values({
      id,
      tenantId: id,
      email: `${id}@kds.test`,
      name: id,
      passwordHash: 'unused',
      role: 'manager',
    })
    .run();
  const categoryId = nanoid();
  const productId = nanoid();
  db.insert(categories).values({ id: categoryId, tenantId: id, name: 'Food' }).run();
  db.insert(products)
    .values({
      id: productId,
      tenantId: id,
      categoryId,
      name: 'Soup',
      sku: `SKU-${id}`,
      price: 1,
      cost: 0,
    })
    .run();
  const caller = (role: 'manager' | 'cashier' | 'viewer' = 'manager') =>
    appRouter.createCaller({
      db,
      tenantId: id,
      siteId: id,
      user: { id, tenantId: id, role, email: `${id}@kds.test` },
      req: { server: server.app, headers: {} },
      res: {},
    } as unknown as Context);
  const scope = { db, tenantId: id, actorId: id, siteId: id };
  const station = (code = 'hot') =>
    caller().kds.saveStation({
      siteId: id,
      code,
      name: 'Hot kitchen',
      position: 0,
      isActive: true,
      expectedVersion: 0,
    });
  const target = {
    siteId: id,
    targetKind: 'product' as const,
    targetId: productId,
    expectedVersion: 0,
    expectedRuleId: null,
  };
  return { id, db, caller, scope, station, target, productId, categoryId };
}
describe('Kitchen configuration', () => {
  it('reads without side effects and saves versioned stations with atomic audit', async () => {
    const f = fixture();
    expect(await f.caller('cashier').kds.stations({ siteId: f.id })).toEqual([]);
    const first = await f.station();
    const next = await f.caller().kds.saveStation({
      siteId: f.id,
      code: first.code,
      name: 'Grill',
      position: 4,
      isActive: true,
      expectedVersion: first.version,
    });
    expect(next).toMatchObject({ id: first.id, version: 2, name: 'Grill' });
    expect(
      f.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.tenantId, f.id), eq(auditLogs.action, 'kds.station.saved')))
        .all()
    ).toHaveLength(2);
    await expect(f.station()).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('allows only managers/admins to configure and never widens foreign-site scope', async () => {
    const a = fixture(),
      b = fixture();
    for (const role of ['cashier', 'viewer'] as const) {
      await expect(
        a.caller(role).kds.saveStation({
          siteId: a.id,
          code: 'hot',
          name: 'Hot',
          isActive: true,
          position: 0,
          expectedVersion: 0,
        })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        a.caller(role).kds.routingTargets({ siteId: a.id, targetKind: 'product' })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        a.caller(role).kds.saveRoutingRule({ ...a.target, route: 'exclude', stationId: null })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(a.caller(role).kds.removeRoutingRule(a.target)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
    await expect(a.caller().kds.stations({ siteId: b.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      a.caller().kds.saveStation({
        siteId: b.id,
        code: 'hot',
        name: 'Hot',
        isActive: true,
        position: 0,
        expectedVersion: 0,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      a.caller().kds.routingTargets({ siteId: b.id, targetKind: 'category' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('rejects foreign targets, foreign/inactive stations and malformed routes', async () => {
    const a = fixture(),
      b = fixture();
    const station = await b.station();
    await expect(
      a.caller().kds.saveRoutingRule({
        ...a.target,
        targetId: b.productId,
        route: 'exclude',
        stationId: null,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      a.caller().kds.saveRoutingRule({ ...a.target, route: 'station', stationId: station.id })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const own = await a.station();
    await a.caller().kds.saveStation({
      siteId: a.id,
      code: own.code,
      name: own.name,
      position: 0,
      isActive: false,
      expectedVersion: own.version,
    });
    await expect(
      a.caller().kds.saveRoutingRule({ ...a.target, route: 'station', stationId: own.id })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      a.caller().kds.saveRoutingRule({ ...a.target, route: 'exclude', stationId: own.id })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
  it('applies product precedence, explicit exclusion and inherited routing on removal', async () => {
    const f = fixture(),
      hot = await f.station();
    await f.caller().kds.saveRoutingRule({
      ...f.target,
      targetKind: 'category',
      targetId: f.categoryId,
      route: 'station',
      stationId: hot.id,
    });
    const resolve = () =>
      f.db.transaction(
        tx =>
          resolveKitchenRoutes(tx as unknown as typeof f.db, f.scope, [
            { productId: f.productId, categoryId: f.categoryId },
          ]),
        { behavior: 'immediate' }
      );
    expect(resolve().get(f.productId)?.id).toBe(hot.id);
    const rule = await f
      .caller()
      .kds.saveRoutingRule({ ...f.target, route: 'exclude', stationId: null });
    expect(resolve().get(f.productId)).toBeNull();
    await f.caller().kds.removeRoutingRule({
      ...f.target,
      expectedVersion: rule.version,
      expectedRuleId: rule.id,
    });
    expect(resolve().get(f.productId)?.id).toBe(hot.id);
  });
  it('rejects stale concurrent saves and deletion/recreation ABA', async () => {
    const f = fixture();
    const first = await f
      .caller()
      .kds.saveRoutingRule({ ...f.target, route: 'exclude', stationId: null });
    const observed = { ...f.target, expectedVersion: first.version, expectedRuleId: first.id };
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        f.caller().kds.saveRoutingRule({ ...observed, route: 'exclude', stationId: null })
      )
    );
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    await f.caller().kds.removeRoutingRule({ ...observed, expectedVersion: 2 });
    const recreated = await f
      .caller()
      .kds.saveRoutingRule({ ...f.target, route: 'exclude', stationId: null });
    expect(recreated.version).toBe(1);
    expect(recreated.id).not.toBe(first.id);
    await expect(
      f.caller().kds.saveRoutingRule({ ...observed, route: 'exclude', stationId: null })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(f.caller().kds.removeRoutingRule(observed)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
  it('protects the fallback and stations with routing or pending tickets', async () => {
    const f = fixture();
    const main = await f.station('main');
    const deactivate = (code: string, version = 1) =>
      f.caller().kds.saveStation({
        siteId: f.id,
        code,
        name: code,
        isActive: false,
        position: 0,
        expectedVersion: version,
      });
    await expect(deactivate(main.code)).rejects.toMatchObject({ code: 'CONFLICT' });
    const hot = await f.station();
    await f.caller().kds.saveRoutingRule({ ...f.target, route: 'station', stationId: hot.id });
    await expect(deactivate(hot.code)).rejects.toMatchObject({ code: 'CONFLICT' });
    const pending = await f.station('pastry');
    // A pending legacy ticket still prevents retiring its destination.
    const saleId = nanoid();
    f.db
      .insert(sales)
      .values({
        id: saleId,
        tenantId: f.id,
        saleNumber: 'K-1',
        createdBy: f.id,
        subtotal: 1,
        total: 1,
        status: 'draft',
      })
      .run();
    f.db
      .insert(kdsOrders)
      .values({
        id: nanoid(),
        tenantId: f.id,
        siteId: f.id,
        saleId,
        saleNumber: 'K-1',
        station: pending.code,
        itemsJson: '[]',
      })
      .run();
    await expect(deactivate(pending.code)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('bounds and scopes catalog pages and treats search wildcards literally', async () => {
    const f = fixture(),
      foreign = fixture();
    f.db
      .insert(products)
      .values(
        Array.from({ length: 61 }, (_, n) => ({
          id: nanoid(),
          tenantId: f.id,
          name: n === 0 ? '100%_! soup' : `Food ${n}`,
          sku: nanoid(),
          price: 1,
          cost: 0,
        }))
      )
      .run();
    let cursor: string | undefined;
    const ids: string[] = [];
    do {
      const page = await f.caller().kds.routingTargets({
        siteId: f.id,
        targetKind: 'product',
        limit: 25,
        ...(cursor ? { cursor } : {}),
      });
      expect(page.items.length).toBeLessThanOrEqual(25);
      ids.push(...page.items.map(item => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toHaveLength(62);
    expect(new Set(ids).size).toBe(62);
    expect(ids).not.toContain(foreign.productId);
    expect(
      (await f.caller().kds.routingTargets({ siteId: f.id, targetKind: 'product', search: '%_!' }))
        .items
    ).toHaveLength(1);
    expect(
      (
        await f
          .caller()
          .kds.routingTargets({ siteId: f.id, targetKind: 'product', configuredOnly: true })
      ).items
    ).toEqual([]);
    const rule = await f
      .caller()
      .kds.saveRoutingRule({ ...f.target, route: 'exclude', stationId: null });
    expect(
      (
        await f
          .caller()
          .kds.routingTargets({ siteId: f.id, targetKind: 'product', configuredOnly: true })
      ).items[0]
    ).toMatchObject({ id: f.productId, rule: { id: rule.id, version: 1 } });
  });
  it('rolls back configuration if audit persistence fails', async () => {
    const f = fixture();
    f.db.run(
      sql`CREATE TRIGGER kds_config_audit_failure BEFORE INSERT ON audit_logs WHEN NEW.tenant_id = ${sql.raw(`'${f.id}'`)} BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`
    );
    try {
      await expect(f.station()).rejects.toThrow();
    } finally {
      f.db.run(sql`DROP TRIGGER kds_config_audit_failure`);
    }
    expect(f.db.select().from(kdsStations).where(eq(kdsStations.tenantId, f.id)).all()).toEqual([]);
  });
  it('rejects disabled modules and inactive sites without touching configuration', async () => {
    const f = fixture();
    f.db
      .update(tenants)
      .set({ settings: { modules: { kds: false } } })
      .where(eq(tenants.id, f.id))
      .run();
    await expect(f.station()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    f.db
      .update(tenants)
      .set({ settings: { modules: { kds: true } } })
      .where(eq(tenants.id, f.id))
      .run();
    f.db
      .update(sites)
      .set({ isActive: false })
      .where(and(eq(sites.id, f.id), eq(sites.tenantId, f.id)))
      .run();
    await expect(f.station()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      f.db.select().from(kdsRoutingRules).where(eq(kdsRoutingRules.tenantId, f.id)).all()
    ).toEqual([]);
  });
});
