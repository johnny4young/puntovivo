import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  MAX_SITE_QUICK_KEYS,
  products,
  siteQuickKeys,
  sites,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let adminId: string;
let siteId: string;
let otherSiteId: string;
const productIds: string[] = [];
const unitId = nanoid();
const kiloUnitId = nanoid();

function ctxFor(role: 'admin' | 'manager' | 'cashier', overrides: Partial<Context> = {}): Context {
  const user = { id: adminId, email: 'admin@localhost', role, tenantId };
  return {
    req: { server: server.app, headers: {}, user: { userId: adminId, ...user } } as never,
    res: {} as Context['res'],
    db: getDatabase(),
    user,
    tenantId,
    siteId,
    ...overrides,
  } as Context;
}

const manager = () => appRouter.createCaller(ctxFor('manager'));
const cashier = () => appRouter.createCaller(ctxFor('cashier'));

describe('site quick keys', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const admin = db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin user');
    tenantId = admin.tenantId;
    adminId = admin.id;
    const mainSite = db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
    if (!mainSite) throw new Error('Expected a seeded site');
    siteId = mainSite.id;
    otherSiteId = nanoid();
    db.insert(sites)
      .values({ id: otherSiteId, tenantId, companyId: mainSite.companyId, name: 'Sede Sur' })
      .run();
    db.insert(units)
      .values([
        { id: unitId, tenantId, name: 'Unidad', abbreviation: 'und' },
        { id: kiloUnitId, tenantId, name: 'Kilogramo', abbreviation: 'kg' },
      ])
      .run();
    for (let index = 0; index < MAX_SITE_QUICK_KEYS + 2; index += 1) {
      const id = nanoid();
      productIds.push(id);
      db.insert(products)
        .values({ id, tenantId, name: `Producto ${index}`, sku: `QK-${index}`, price: 500 })
        .run();
      db.insert(unitXProduct)
        .values({ id: nanoid(), productId: id, unitId, price: 500, isBase: true })
        .run();
    }
    db.insert(unitXProduct)
      .values({ id: nanoid(), productId: productIds[0]!, unitId: kiloUnitId, price: 24000 })
      .run();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    getDatabase().delete(siteQuickKeys).run();
  });

  it('appends keys in order with a distinct default swatch each', async () => {
    const first = (await manager().quickKeys.set({ siteId, productId: productIds[0]! }))[0]!;
    const second = (
      await manager().quickKeys.set({
        siteId,
        productId: productIds[1]!,
        label: '  Pan francés  ',
      })
    )[1]!;

    expect(first).toMatchObject({ position: 0, kind: 'product', colour: 'orange' });
    expect(second).toMatchObject({ position: 1, label: 'Pan francés', colour: 'yellow' });
    const list = await cashier().quickKeys.list({ siteId });
    expect(list.map(key => key.productId)).toEqual([productIds[0], productIds[1]]);
    expect(list[0]).toMatchObject({ productName: 'Producto 0', sellable: true, catalogPrice: 500 });
    expect(await cashier().quickKeys.list({ siteId: otherSiteId })).toEqual([]);
  });

  it('prices a key by its unit and keeps the swatch on update unless given', async () => {
    const key = (
      await manager().quickKeys.set({
        siteId,
        productId: productIds[0]!,
        unitId: kiloUnitId,
        colour: 'lime',
      })
    )[0]!;
    expect(key).toMatchObject({ unitAbbreviation: 'kg', catalogPrice: 24000, colour: 'lime' });

    const updated = (
      await manager().quickKeys.set({
        siteId,
        id: key.id,
        productId: productIds[0]!,
        unitId: kiloUnitId,
        label: 'Limón × kg',
      })
    )[0]!;
    expect(updated).toMatchObject({ colour: 'lime', label: 'Limón × kg' });
  });

  it('keeps an open-value key apart from the product key of the same product', async () => {
    await manager().quickKeys.set({ siteId, productId: productIds[2]! });
    const keys = await manager().quickKeys.set({
      siteId,
      kind: 'open_value',
      productId: productIds[2]!,
      label: 'Recarga celular',
    });
    expect(keys.map(key => [key.kind, key.label])).toEqual([
      ['product', null],
      ['open_value', 'Recarga celular'],
    ]);
  });

  it('rejects duplicates, foreign units and a ninth key', async () => {
    await manager().quickKeys.set({ siteId, productId: productIds[0]! });
    await expect(
      manager().quickKeys.set({ siteId, productId: productIds[0]! })
    ).rejects.toMatchObject({ code: 'CONFLICT', cause: { errorCode: 'QUICK_KEY_DUPLICATE' } });
    await expect(
      manager().quickKeys.set({ siteId, productId: productIds[1]!, unitId: kiloUnitId })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    for (const productId of productIds.slice(1, MAX_SITE_QUICK_KEYS)) {
      await manager().quickKeys.set({ siteId, productId });
    }
    await expect(
      manager().quickKeys.set({ siteId, productId: productIds[MAX_SITE_QUICK_KEYS]! })
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      cause: { errorCode: 'QUICK_KEY_LIMIT_REACHED', details: { max: MAX_SITE_QUICK_KEYS } },
    });
  });

  it('reorders only with the full set and compacts positions on remove', async () => {
    const ids = [];
    for (const productId of productIds.slice(0, 3)) {
      ids.push((await manager().quickKeys.set({ siteId, productId })).at(-1)!.id);
    }
    await expect(
      manager().quickKeys.reorder({ siteId, ids: [ids[0]!, ids[1]!] })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const reordered = await manager().quickKeys.reorder({
      siteId,
      ids: [ids[2]!, ids[0]!, ids[1]!],
    });
    expect(reordered.map(key => key.id)).toEqual([ids[2], ids[0], ids[1]]);

    const remaining = await manager().quickKeys.remove({ siteId, id: ids[2]! });
    expect(remaining.map(key => [key.id, key.position])).toEqual([
      [ids[0], 0],
      [ids[1], 1],
    ]);
    await expect(manager().quickKeys.remove({ siteId, id: ids[2]! })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('lets cashiers read but not edit the strip', async () => {
    await expect(
      cashier().quickKeys.set({ siteId, productId: productIds[0]! })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const key = (await manager().quickKeys.set({ siteId, productId: productIds[0]! }))[0]!;
    await expect(cashier().quickKeys.remove({ siteId, id: key.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(cashier().quickKeys.reorder({ siteId, ids: [key.id] })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('imports local favourites once, only into an empty site', async () => {
    const unknown = nanoid();
    const first = await cashier().quickKeys.importLocal({
      siteId,
      productIds: [productIds[1]!, unknown, productIds[0]!, productIds[1]!],
    });
    expect(first.map(key => key.productId)).toEqual([productIds[1], productIds[0]]);
    expect(await cashier().quickKeys.list({ siteId })).toEqual(first);

    const again = await cashier().quickKeys.importLocal({ siteId, productIds: [productIds[2]!] });
    expect(again).toEqual(first);
  });

  it('hides keys of inactive products from sale and drops keys of deleted products', async () => {
    const db = getDatabase();
    const doomed = nanoid();
    db.insert(products)
      .values({ id: doomed, tenantId, name: 'Temporal', sku: `QK-${nanoid(4)}`, price: 100 })
      .run();
    await manager().quickKeys.set({ siteId, productId: productIds[4]! });
    await manager().quickKeys.set({ siteId, productId: doomed });

    db.update(products).set({ isActive: false }).where(eq(products.id, productIds[4]!)).run();
    await expect(
      manager().quickKeys.set({ siteId, productId: productIds[4]!, label: 'x' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    db.delete(products).where(eq(products.id, doomed)).run();

    const list = await cashier().quickKeys.list({ siteId });
    expect(list.map(key => [key.productId, key.sellable])).toEqual([[productIds[4], false]]);
    db.update(products).set({ isActive: true }).where(eq(products.id, productIds[4]!)).run();
  });

  it('never reads or writes another tenant site or product', async () => {
    const db = getDatabase();
    const foreignTenant = nanoid();
    db.insert(tenants).values({ id: foreignTenant, slug: nanoid(), name: 'Other' }).run();
    const foreign = appRouter.createCaller(
      ctxFor('manager', { tenantId: foreignTenant, siteId: null })
    );
    await manager().quickKeys.set({ siteId, productId: productIds[0]! });

    await expect(foreign.quickKeys.list({ siteId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      foreign.quickKeys.set({ siteId, productId: productIds[0]! })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      foreign.quickKeys.importLocal({ siteId, productIds: [productIds[1]!] })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const foreignProduct = nanoid();
    db.insert(products)
      .values({ id: foreignProduct, tenantId: foreignTenant, name: 'Ajeno', sku: 'X-1', price: 1 })
      .run();
    await expect(
      manager().quickKeys.set({ siteId, productId: foreignProduct })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await manager().quickKeys.importLocal({ siteId: otherSiteId, productIds: [foreignProduct] })
    ).toEqual([]);
  });
});
