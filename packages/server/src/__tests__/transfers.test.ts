import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  categories,
  inventoryBalances,
  providers,
  sites,
  transferOrderItems,
  transferOrders,
  units,
  users,
  vatRates,
} from '../db/schema.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let primarySiteId: string;
let secondarySiteId: string;
let categoryId: string;
let providerId: string;
let vatRateId: string;
let baseUnitId: string;

function createTestContext(): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
      user: {
        userId,
        email: 'admin@localhost',
        role: 'admin',
        tenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: {
      id: userId,
      email: 'admin@localhost',
      role: 'admin',
      tenantId,
    },
    tenantId,
    siteId: primarySiteId,
  };
}

function expectErrorCode(error: unknown, errorCode: string) {
  expect(error).toBeInstanceOf(TRPCError);
  const cause = (error as TRPCError).cause;
  expect(cause).toBeInstanceOf(ServerErrorWithCode);
  expect((cause as ServerErrorWithCode).errorCode).toBe(errorCode);
}

describe('Transfers tRPC Router', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();

    const seededUser = await db
      .select()
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!seededUser) throw new Error('Expected seeded admin user');
    tenantId = seededUser.tenantId;
    userId = seededUser.id;

    const mainSite = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!mainSite) throw new Error('Expected seeded main site');
    primarySiteId = mainSite.id;

    secondarySiteId = nanoid();
    await db.insert(sites).values({
      id: secondarySiteId,
      tenantId,
      companyId: mainSite.companyId,
      name: 'Transfer Secondary Site',
      address: null,
      phone: null,
      isActive: true,
      createdAt: new Date(Date.now() + 60_000).toISOString(),
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const seededVatRate = await db
      .select()
      .from(vatRates)
      .where(and(eq(vatRates.tenantId, tenantId), eq(vatRates.name, 'IVA 19%')))
      .get();
    if (!seededVatRate) throw new Error('Expected seeded VAT rate');
    vatRateId = seededVatRate.id;

    const baseUnit = (
      await db.select().from(units).where(eq(units.tenantId, tenantId)).all()
    ).find(unit => unit.abbreviation === 'UND');
    if (!baseUnit) throw new Error('Expected seeded base unit');
    baseUnitId = baseUnit.id;

    categoryId = nanoid();
    providerId = nanoid();
    const now = new Date().toISOString();
    await db.insert(categories).values({
      id: categoryId,
      tenantId,
      name: 'Transfer Tests',
      description: null,
      parentId: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Transfer Supplier',
      taxId: null,
      phone: null,
      email: null,
      address: null,
      cityId: null,
      contactName: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    await server.close();
  });

  function createProduct(overrides: {
    name: string;
    sku: string;
    barcode: string;
    stock: number;
  }) {
    const caller = appRouter.createCaller(createTestContext());
    return caller.products.create({
      name: overrides.name,
      sku: overrides.sku,
      description: null,
      categoryId,
      providerId,
      vatRateId,
      locationId: null,
      barcode: overrides.barcode,
      imageUrl: null,
      cost: 5,
      initialCost: 4,
      price: 10,
      price2: 11,
      price3: 12,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      stock: overrides.stock,
      minStock: 0,
      isActive: true,
      unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 10, isBase: true }],
    });
  }

  it('moves stock atomically between sites and records a transfer order without requiring a prior balances read', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const cable = await createProduct({
      name: 'Transfer Cable',
      sku: 'TR-CABLE',
      barcode: 'TR-10001',
      stock: 20,
    });

    const created = await caller.transfers.create({
      fromSiteId: primarySiteId,
      toSiteId: secondarySiteId,
      items: [{ productId: cable.id, quantity: 3.5 }],
      notes: 'Restock branch',
    });

    expect(created.status).toBe('completed');
    expect(created.items).toHaveLength(1);
    expect(created.items[0]?.quantity).toBe(3.5);
    expect(created.items[0]?.productSku).toBe('TR-CABLE');

    const primary = await caller.inventory.listBalancesBySite({ siteId: primarySiteId });
    const primaryCable = primary.items.find(item => item.productId === cable.id);
    expect(primaryCable?.onHand).toBeCloseTo(16.5);

    const secondary = await caller.inventory.listBalancesBySite({ siteId: secondarySiteId });
    const secondaryCable = secondary.items.find(item => item.productId === cable.id);
    expect(secondaryCable?.onHand).toBeCloseTo(3.5);

    const list = await caller.transfers.list();
    expect(list.items.some(entry => entry.id === created.id)).toBe(true);
    const historyEntry = list.items.find(entry => entry.id === created.id);
    expect(historyEntry?.itemCount).toBe(1);
    expect(historyEntry?.totalQuantity).toBeCloseTo(3.5);
    expect(historyEntry?.fromSiteName).toBeTruthy();
    expect(historyEntry?.toSiteName).toBeTruthy();
  });

  it('rejects transfers with insufficient origin stock and leaves balances untouched', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const bolt = await createProduct({
      name: 'Transfer Bolt',
      sku: 'TR-BOLT',
      barcode: 'TR-10002',
      stock: 2,
    });

    await caller.inventory.listBalancesBySite({ siteId: primarySiteId });

    try {
      await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: bolt.id, quantity: 5 }],
      });
      throw new Error('Expected transfer to fail');
    } catch (error) {
      expectErrorCode(error, 'TRANSFER_INSUFFICIENT_STOCK');
    }

    const primary = await caller.inventory.listBalancesBySite({ siteId: primarySiteId });
    const primaryBolt = primary.items.find(item => item.productId === bolt.id);
    expect(primaryBolt?.onHand).toBe(2);

    const secondary = await caller.inventory.listBalancesBySite({ siteId: secondarySiteId });
    const secondaryBolt = secondary.items.find(item => item.productId === bolt.id);
    expect(secondaryBolt?.onHand).toBe(0);
  });

  it('rejects transfers between the same site at the Zod layer', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const widget = await createProduct({
      name: 'Transfer Widget',
      sku: 'TR-WIDGET',
      barcode: 'TR-10003',
      stock: 10,
    });

    await caller.inventory.listBalancesBySite({ siteId: primarySiteId });

    try {
      await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: primarySiteId,
        items: [{ productId: widget.id, quantity: 1 }],
      });
      throw new Error('Expected transfer to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe('BAD_REQUEST');
    }
  });

  it('collapses duplicate product lines so the debit/credit math remains correct', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const screw = await createProduct({
      name: 'Transfer Screw',
      sku: 'TR-SCREW',
      barcode: 'TR-10004',
      stock: 10,
    });

    await caller.inventory.listBalancesBySite({ siteId: primarySiteId });

    const created = await caller.transfers.create({
      fromSiteId: primarySiteId,
      toSiteId: secondarySiteId,
      items: [
        { productId: screw.id, quantity: 2 },
        { productId: screw.id, quantity: 3 },
      ],
    });

    // Collapsed into a single persisted line summing to 5.
    expect(created.items).toHaveLength(1);
    expect(created.items[0]?.quantity).toBe(5);

    const primary = await caller.inventory.listBalancesBySite({ siteId: primarySiteId });
    const primaryScrew = primary.items.find(item => item.productId === screw.id);
    expect(primaryScrew?.onHand).toBe(5);

    const secondary = await caller.inventory.listBalancesBySite({ siteId: secondarySiteId });
    const secondaryScrew = secondary.items.find(item => item.productId === screw.id);
    expect(secondaryScrew?.onHand).toBe(5);
  });

  it('rejects unknown product IDs without touching balances', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const db = getDatabase();
    const countBefore = (
      await db
        .select()
        .from(transferOrders)
        .where(eq(transferOrders.tenantId, tenantId))
        .all()
    ).length;

    try {
      await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: 'does-not-exist', quantity: 1 }],
      });
      throw new Error('Expected transfer to fail');
    } catch (error) {
      expectErrorCode(error, 'TRANSFER_PRODUCT_NOT_FOUND');
    }

    const orderRows = await db
      .select()
      .from(transferOrders)
      .where(eq(transferOrders.tenantId, tenantId))
      .all();
    expect(orderRows).toHaveLength(countBefore);
  });

  it('rejects unknown site IDs', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const gadget = await createProduct({
      name: 'Transfer Gadget',
      sku: 'TR-GADGET',
      barcode: 'TR-10005',
      stock: 5,
    });

    try {
      await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: 'unknown-site',
        items: [{ productId: gadget.id, quantity: 1 }],
      });
      throw new Error('Expected transfer to fail');
    } catch (error) {
      expectErrorCode(error, 'TRANSFER_SITE_NOT_FOUND');
    }
  });

  it('persists line items linked to the transfer order id', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const gizmo = await createProduct({
      name: 'Transfer Gizmo',
      sku: 'TR-GIZMO',
      barcode: 'TR-10006',
      stock: 8,
    });

    await caller.inventory.listBalancesBySite({ siteId: primarySiteId });

    const created = await caller.transfers.create({
      fromSiteId: primarySiteId,
      toSiteId: secondarySiteId,
      items: [{ productId: gizmo.id, quantity: 2 }],
    });

    const db = getDatabase();
    const rows = await db
      .select()
      .from(transferOrderItems)
      .where(eq(transferOrderItems.transferOrderId, created.id))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.productId).toBe(gizmo.id);
    expect(rows[0]?.quantity).toBe(2);
  });

  // ─── void ─────────────────────────────────────────────────────────────────

  describe('void', () => {
    it('reverses balances and flips status to void (happy path)', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const widget = await createProduct({
        name: 'Void Widget',
        sku: 'TR-VOID-WIDGET',
        barcode: 'TR-20001',
        stock: 15,
      });

      const created = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: widget.id, quantity: 6 }],
      });

      const primaryAfterTransfer = await caller.inventory.listBalancesBySite({
        siteId: primarySiteId,
      });
      expect(
        primaryAfterTransfer.items.find(item => item.productId === widget.id)?.onHand
      ).toBe(9);

      const voided = await caller.transfers.void({
        transferId: created.id,
        reason: 'Entered by mistake',
      });

      expect(voided.status).toBe('void');
      expect(voided.reversedItems).toEqual([{ productId: widget.id, quantity: 6 }]);

      const primaryAfterVoid = await caller.inventory.listBalancesBySite({
        siteId: primarySiteId,
      });
      expect(
        primaryAfterVoid.items.find(item => item.productId === widget.id)?.onHand
      ).toBe(15);

      const secondaryAfterVoid = await caller.inventory.listBalancesBySite({
        siteId: secondarySiteId,
      });
      expect(
        secondaryAfterVoid.items.find(item => item.productId === widget.id)?.onHand
      ).toBe(0);

      const list = await caller.transfers.list();
      const entry = list.items.find(item => item.id === created.id);
      expect(entry?.status).toBe('void');
      expect(entry?.notes).toContain('[VOID] Entered by mistake');
    });

    it('rejects voiding a transfer that has already been voided', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const sprocket = await createProduct({
        name: 'Void Sprocket',
        sku: 'TR-VOID-SPROCKET',
        barcode: 'TR-20002',
        stock: 5,
      });

      const created = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: sprocket.id, quantity: 2 }],
      });
      await caller.transfers.void({ transferId: created.id });

      try {
        await caller.transfers.void({ transferId: created.id });
        throw new Error('Expected second void to fail');
      } catch (error) {
        expectErrorCode(error, 'TRANSFER_ALREADY_VOID');
      }
    });

    it('rejects voiding a non-existent transfer', async () => {
      const caller = appRouter.createCaller(createTestContext());
      try {
        await caller.transfers.void({ transferId: 'does-not-exist' });
        throw new Error('Expected void to fail');
      } catch (error) {
        expectErrorCode(error, 'TRANSFER_NOT_FOUND');
      }
    });

    it('rejects void when destination no longer has enough stock to reverse', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const bearing = await createProduct({
        name: 'Void Bearing',
        sku: 'TR-VOID-BEARING',
        barcode: 'TR-20003',
        stock: 10,
      });

      // Move 4 units from primary → secondary.
      const transfer = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: bearing.id, quantity: 4 }],
      });

      // Simulate a later outbound move by transferring 3 of those 4 away from
      // the destination. The secondary now only has 1 unit, so voiding the
      // original transfer of 4 cannot be satisfied.
      await caller.transfers.create({
        fromSiteId: secondarySiteId,
        toSiteId: primarySiteId,
        items: [{ productId: bearing.id, quantity: 3 }],
      });

      try {
        await caller.transfers.void({ transferId: transfer.id });
        throw new Error('Expected void to fail');
      } catch (error) {
        expectErrorCode(error, 'TRANSFER_VOID_INSUFFICIENT_STOCK');
      }

      // Balances must be untouched by the failed void.
      const primary = await caller.inventory.listBalancesBySite({ siteId: primarySiteId });
      expect(primary.items.find(item => item.productId === bearing.id)?.onHand).toBe(9);
      const secondary = await caller.inventory.listBalancesBySite({ siteId: secondarySiteId });
      expect(secondary.items.find(item => item.productId === bearing.id)?.onHand).toBe(1);

      // Status remains `completed`.
      const list = await caller.transfers.list();
      expect(list.items.find(item => item.id === transfer.id)?.status).toBe('completed');
    });

    it('re-seeds a missing primary-site origin row before reversing the transfer', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const reel = await createProduct({
        name: 'Void Missing Origin Reel',
        sku: 'TR-VOID-RESEED',
        barcode: 'TR-20005',
        stock: 12,
      });

      const created = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: reel.id, quantity: 5 }],
      });

      const db = getDatabase();
      await db
        .delete(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, primarySiteId),
            eq(inventoryBalances.productId, reel.id)
          )
        );

      await caller.transfers.void({ transferId: created.id });

      const primaryAfterVoid = await caller.inventory.listBalancesBySite({
        siteId: primarySiteId,
      });
      expect(
        primaryAfterVoid.items.find(item => item.productId === reel.id)?.onHand
      ).toBe(17);

      const secondaryAfterVoid = await caller.inventory.listBalancesBySite({
        siteId: secondarySiteId,
      });
      expect(
        secondaryAfterVoid.items.find(item => item.productId === reel.id)?.onHand
      ).toBe(0);
    });

    it('preserves existing notes when voiding and appends the void reason', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const part = await createProduct({
        name: 'Void Note Part',
        sku: 'TR-VOID-NOTES',
        barcode: 'TR-20004',
        stock: 5,
      });

      const created = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: part.id, quantity: 1 }],
        notes: 'Initial batch shipment',
      });

      await caller.transfers.void({
        transferId: created.id,
        reason: 'Duplicate entry',
      });

      const list = await caller.transfers.list();
      const entry = list.items.find(item => item.id === created.id);
      expect(entry?.notes).toBe('Initial batch shipment\n[VOID] Duplicate entry');
    });
  });
});
