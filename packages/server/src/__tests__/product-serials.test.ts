/** serialized-unit receipt, checkout and reversal lifecycle. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { completeSale } from '../application/sales/completeSale.js';
import { discardDraft } from '../application/sales/discardDraft.js';
import { returnSale } from '../application/sales/returnSale.js';
import type { CompleteSaleContext } from '../application/sales/types.js';
import { voidSale } from '../application/sales/voidSale.js';
import { getDatabase } from '../db/index.js';
import {
  companies,
  productSerials,
  products,
  saleItemSerials,
  sales,
  sites,
  syncOutbox,
  tenants,
  units,
  users,
} from '../db/schema.js';
import { createServer, type PuntovivoServer } from '../index.js';
import {
  applyInventoryBalanceDelta,
  getProductStockTotal,
} from '../services/inventory-balances.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { appRouter } from '../trpc/router.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let boxUnitId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;

function buildSaleContext(): CompleteSaleContext {
  return {
    db: getDatabase(),
    tenantId,
    siteId,
    user: { id: userId, role: 'admin' },
    envelope: null,
    deviceId: null,
    log: undefined,
  };
}

function caller() {
  return appRouter.createCaller(fresh());
}

async function createTrackedProduct(label: string) {
  return caller().products.create({
    name: `Serialized ${label}`,
    sku: `SER-${label}-${nanoid(6)}`,
    cost: 40,
    initialCost: 40,
    price: 100,
    price2: 100,
    price3: 100,
    tracksSerials: true,
    unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 100, isBase: true }],
  });
}

async function receiveSerials(productId: string, serialNumbers: string[], unitCost = 40) {
  return caller().productSerials.receive({
    siteId,
    productId,
    serialNumbers,
    unitCost,
    warrantyExpiresAt: '2028-12-31',
    notes: ' test receipt',
  });
}

async function createFreshSale(input: {
  productId: string;
  serialIds: string[];
  status?: 'draft' | 'completed';
}) {
  const status = input.status ?? 'completed';
  return completeSale(buildSaleContext(), {
    mode: 'fresh',
    customerId: null,
    items: [
      {
        productId: input.productId,
        unitId: baseUnitId,
        quantity: input.serialIds.length,
        unitPrice: 100,
        discount: 0,
        serialIds: input.serialIds,
      },
    ],
    paymentMethod: 'cash',
    paymentStatus: status === 'draft' ? 'pending' : 'paid',
    status,
    amountReceived: status === 'draft' ? 0 : input.serialIds.length * 100,
    discountAmount: 0,
  });
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const seededUser = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!seededUser) throw new Error('Expected seeded admin user');
  tenantId = seededUser.tenantId;
  userId = seededUser.id;

  const seededSite = await db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();
  if (!seededSite) throw new Error('Expected seeded site');
  siteId = seededSite.id;

  const seededUnits = await db.select().from(units).where(eq(units.tenantId, tenantId)).all();
  const baseUnit = seededUnits.find(unit => unit.abbreviation === 'UND');
  const boxUnit = seededUnits.find(unit => unit.abbreviation === 'CJ');
  if (!baseUnit || !boxUnit) throw new Error('Expected seeded units');
  baseUnitId = baseUnit.id;
  boxUnitId = boxUnit.id;

  const registration = await registerDeviceService(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'product-serials.test',
  });
  fresh = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId,
    userId,
    email: seededUser.email,
    siteId,
    deviceId: registration.deviceId,
    defaultRole: 'admin',
  });

  await caller().cashSessions.open({
    registerName: 'Serialized inventory register',
    openingFloat: 500,
    denominations: [{ value: 100, count: 5 }],
  });
});

afterAll(async () => {
  await server.close();
});

describe('serialized product policy', () => {
  it('requires zero stock, exclusive tracking and one-base-unit equivalences', async () => {
    await expect(
      caller().products.create({
        name: 'Serialized stocked product',
        sku: `SER-STOCK-${nanoid(6)}`,
        stock: 1,
        tracksSerials: true,
        unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 100, isBase: true }],
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_SERIAL_TRACKING_REQUIRES_ZERO_STOCK' },
    });

    await expect(
      caller().products.create({
        name: 'Serialized lot product',
        sku: `SER-LOT-${nanoid(6)}`,
        tracksLots: true,
        tracksSerials: true,
        unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 100, isBase: true }],
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_SERIAL_TRACKING_CONFLICT' },
    });

    await expect(
      caller().products.create({
        name: 'Serialized pack product',
        sku: `SER-PACK-${nanoid(6)}`,
        tracksSerials: true,
        unitAssignments: [
          { unitId: baseUnitId, equivalence: 1, price: 100, isBase: true },
          { unitId: boxUnitId, equivalence: 2, price: 200, isBase: false },
        ],
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_SERIAL_UNIT_EQUIVALENCE_REQUIRED' },
    });

    const tracked = await createTrackedProduct('matrix-parent');
    await expect(
      caller().products.createVariantMatrix({
        parentProductId: tracked.id,
        axes: [{ name: 'Color', values: ['Blue', 'Red'] }],
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_SERIAL_VARIANT_PARENT_UNSUPPORTED' },
    });
  });
});

describe('serialized inventory receipt', () => {
  it('normalizes identity, updates balance atomically and rejects aggregate writes', async () => {
    const product = await createTrackedProduct('receipt');
    const receipt = await receiveSerials(product.id, [' sn-a ', 'ＳＮ－Ｂ'], 40.005);

    expect(receipt.count).toBe(2);
    expect(receipt.items.map(item => item.serialNumber)).toEqual(['SN-A', 'SN-B']);
    expect(receipt.items.map(item => item.unitCost)).toEqual([40.01, 40.01]);
    expect(getProductStockTotal(getDatabase(), tenantId, product.id)).toBe(2);

    const serialOutboxRows = await getDatabase()
      .select({ entityId: syncOutbox.entityId })
      .from(syncOutbox)
      .where(eq(syncOutbox.entityType, 'product_serials'))
      .all();
    expect(serialOutboxRows.map(row => row.entityId)).toEqual(
      expect.arrayContaining(receipt.items.map(item => item.id))
    );

    await expect(receiveSerials(product.id, ['SN-A'])).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_SERIAL_DUPLICATE' },
    });
    expect(getProductStockTotal(getDatabase(), tenantId, product.id)).toBe(2);

    await expect(
      caller().products.update({
        id: product.id,
        version: product.version,
        tracksSerials: false,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_SERIAL_TRACKING_HAS_SERIALS' },
    });

    expect(() =>
      applyInventoryBalanceDelta(getDatabase(), {
        tenantId,
        siteId,
        productId: product.id,
        delta: 1,
      })
    ).toThrowError(
      expect.objectContaining({
        cause: expect.objectContaining({ errorCode: 'PRODUCT_SERIAL_TRACKING_STOCK_MANAGED' }),
      })
    );
  });

  it('limits serial receipts to managers and administrators', async () => {
    const product = await createTrackedProduct('role-guard');
    const cashier = appRouter.createCaller(fresh({ role: 'cashier' }));

    await expect(
      cashier.productSerials.receive({
        siteId,
        productId: product.id,
        serialNumbers: ['ROLE-GUARD-1'],
        unitCost: 40,
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(getProductStockTotal(getDatabase(), tenantId, product.id)).toBe(0);
  });

  it('uses product-scoped serial identity and rejects a serial selected from another product', async () => {
    const first = await createTrackedProduct('identity-a');
    const second = await createTrackedProduct('identity-b');
    const firstReceipt = await receiveSerials(first.id, ['SHARED-SERIAL']);
    const secondReceipt = await receiveSerials(second.id, ['SHARED-SERIAL']);

    const lookup = await caller().productSerials.lookup({ serialNumber: 'shared-serial' });
    expect(lookup.items.map(item => item.productId).sort()).toEqual([first.id, second.id].sort());

    await expect(
      createFreshSale({
        productId: first.id,
        serialIds: [secondReceipt.items[0]!.id],
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_SERIAL_UNAVAILABLE' },
    });
    expect(getProductStockTotal(getDatabase(), tenantId, first.id)).toBe(1);
    expect(firstReceipt.items[0]!.status).toBe('in_stock');
  });

  it('keeps serial lookup and site-scoped availability isolated by tenant', async () => {
    const localProduct = await createTrackedProduct('tenant-isolation');
    await receiveSerials(localProduct.id, ['TENANT-SERIAL']);

    const db = getDatabase();
    const now = new Date().toISOString();
    const foreignTenantId = nanoid();
    const foreignCompanyId = nanoid();
    const foreignSiteId = nanoid();
    const foreignProductId = nanoid();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Serialized Foreign Tenant',
      slug: `serial-foreign-${nanoid(6).toLowerCase()}`,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: foreignCompanyId,
      tenantId: foreignTenantId,
      name: 'Serialized Foreign Company',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: foreignSiteId,
      tenantId: foreignTenantId,
      companyId: foreignCompanyId,
      name: 'Serialized Foreign Site',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(products).values({
      id: foreignProductId,
      tenantId: foreignTenantId,
      name: 'Serialized Foreign Product',
      sku: 'SERIAL-FOREIGN',
      price: 100,
      cost: 40,
      tracksSerials: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(productSerials).values({
      id: nanoid(),
      tenantId: foreignTenantId,
      currentSiteId: foreignSiteId,
      productId: foreignProductId,
      serialNumber: 'TENANT-SERIAL',
      unitCost: 40,
      createdAt: now,
      updatedAt: now,
    });

    const lookup = await caller().productSerials.lookup({ serialNumber: 'tenant-serial' });
    expect(lookup.items).toHaveLength(1);
    expect(lookup.items[0]!.productId).toBe(localProduct.id);
    await expect(
      caller().productSerials.list({
        siteId: foreignSiteId,
        productId: foreignProductId,
        sellableOnly: true,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'AUTHORITY_SITE_NOT_FOUND' },
    });
  });
});

describe('serialized sale lifecycle', () => {
  it('sells, returns and resells one physical unit without losing history', async () => {
    const product = await createTrackedProduct('resale');
    const receipt = await receiveSerials(product.id, ['RESALE-A', 'RESALE-B']);
    const serialId = receipt.items[0]!.id;

    const firstSale = await createFreshSale({ productId: product.id, serialIds: [serialId] });
    const firstSaleId = (firstSale.sale as { id: string }).id;
    expect(
      (firstSale.sale as { items: Array<{ serialNumbers: string[] }> }).items[0]!.serialNumbers
    ).toEqual(['RESALE-A']);
    expect(getProductStockTotal(getDatabase(), tenantId, product.id)).toBe(1);

    await returnSale(buildSaleContext(), { id: firstSaleId, reason: 'Customer return' });
    const returned = await getDatabase()
      .select()
      .from(productSerials)
      .where(eq(productSerials.id, serialId))
      .get();
    expect(returned).toMatchObject({ status: 'returned', saleItemId: null });
    expect(getProductStockTotal(getDatabase(), tenantId, product.id)).toBe(2);

    const returnedLookup = await caller().productSerials.lookup({ serialNumber: 'resale-a' });
    expect(returnedLookup.items[0]!.history).toHaveLength(1);
    expect(returnedLookup.items[0]!.history[0]!.saleId).toBe(firstSaleId);

    const secondSale = await createFreshSale({ productId: product.id, serialIds: [serialId] });
    const secondSaleId = (secondSale.sale as { id: string }).id;
    expect(secondSaleId).not.toBe(firstSaleId);
    const history = await getDatabase()
      .select()
      .from(saleItemSerials)
      .where(eq(saleItemSerials.productSerialId, serialId))
      .all();
    expect(history).toHaveLength(2);
    const historyOutboxRows = await getDatabase()
      .select({ entityId: syncOutbox.entityId })
      .from(syncOutbox)
      .where(eq(syncOutbox.entityType, 'sale_item_serials'))
      .all();
    expect(historyOutboxRows.map(row => row.entityId)).toEqual(
      expect.arrayContaining(history.map(row => row.id))
    );
    expect(getProductStockTotal(getDatabase(), tenantId, product.id)).toBe(1);
  });

  it('moves draft reservations through completion, discard and void atomically', async () => {
    const product = await createTrackedProduct('draft');
    const receipt = await receiveSerials(product.id, ['DRAFT-A', 'DRAFT-B']);
    const [firstSerial, secondSerial] = receipt.items;

    const draft = await createFreshSale({
      productId: product.id,
      serialIds: [firstSerial!.id],
      status: 'draft',
    });
    const draftId = (draft.sale as { id: string }).id;
    expect(
      await getDatabase()
        .select({ status: productSerials.status })
        .from(productSerials)
        .where(eq(productSerials.id, firstSerial!.id))
        .get()
    ).toMatchObject({ status: 'reserved' });

    await completeSale(buildSaleContext(), {
      mode: 'fromDraft',
      saleId: draftId,
      payments: [{ method: 'cash', amount: 100, reference: null }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
    });
    expect(
      await getDatabase()
        .select({ status: productSerials.status })
        .from(productSerials)
        .where(eq(productSerials.id, firstSerial!.id))
        .get()
    ).toMatchObject({ status: 'sold' });

    const discardedDraft = await createFreshSale({
      productId: product.id,
      serialIds: [secondSerial!.id],
      status: 'draft',
    });
    const discardedDraftId = (discardedDraft.sale as { id: string }).id;
    await discardDraft(buildSaleContext(), { saleId: discardedDraftId });
    expect(
      await getDatabase()
        .select({ status: productSerials.status, saleItemId: productSerials.saleItemId })
        .from(productSerials)
        .where(eq(productSerials.id, secondSerial!.id))
        .get()
    ).toMatchObject({ status: 'in_stock', saleItemId: null });

    await voidSale(buildSaleContext(), { id: draftId, reason: 'Void completed draft' });
    const finalRows = await getDatabase()
      .select({ status: productSerials.status, saleItemId: productSerials.saleItemId })
      .from(productSerials)
      .where(eq(productSerials.productId, product.id))
      .all();
    expect(finalRows).toHaveLength(2);
    expect(finalRows.every(row => row.status === 'in_stock' && row.saleItemId === null)).toBe(true);
    expect(getProductStockTotal(getDatabase(), tenantId, product.id)).toBe(2);
  });

  it('fails closed when draft provenance no longer matches the registry state', async () => {
    const product = await createTrackedProduct('drift');
    const receipt = await receiveSerials(product.id, ['DRIFT-A']);
    const draft = await createFreshSale({
      productId: product.id,
      serialIds: [receipt.items[0]!.id],
      status: 'draft',
    });
    const draftId = (draft.sale as { id: string }).id;

    getDatabase()
      .update(productSerials)
      .set({ status: 'defective' })
      .where(eq(productSerials.id, receipt.items[0]!.id))
      .run();

    await expect(
      completeSale(buildSaleContext(), {
        mode: 'fromDraft',
        saleId: draftId,
        payments: [{ method: 'cash', amount: 100, reference: null }],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_SERIAL_UNAVAILABLE' },
    });
    expect(
      await getDatabase()
        .select({ status: sales.status })
        .from(sales)
        .where(eq(sales.id, draftId))
        .get()
    ).toMatchObject({ status: 'draft' });

    const missingHistoryProduct = await createTrackedProduct('missing-history');
    const missingHistoryReceipt = await receiveSerials(missingHistoryProduct.id, [
      'MISSING-HISTORY-A',
    ]);
    const missingHistoryDraft = await createFreshSale({
      productId: missingHistoryProduct.id,
      serialIds: [missingHistoryReceipt.items[0]!.id],
      status: 'draft',
    });
    const missingHistoryDraftId = (missingHistoryDraft.sale as { id: string }).id;
    getDatabase()
      .delete(saleItemSerials)
      .where(eq(saleItemSerials.productSerialId, missingHistoryReceipt.items[0]!.id))
      .run();

    await expect(
      completeSale(buildSaleContext(), {
        mode: 'fromDraft',
        saleId: missingHistoryDraftId,
        payments: [{ method: 'cash', amount: 100, reference: null }],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_SERIAL_UNAVAILABLE' },
    });
    expect(
      await getDatabase()
        .select({ status: sales.status })
        .from(sales)
        .where(eq(sales.id, missingHistoryDraftId))
        .get()
    ).toMatchObject({ status: 'draft' });
  });
});
