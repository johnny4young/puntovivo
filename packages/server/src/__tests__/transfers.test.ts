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

  // ─── Phase 2 API-102 step 3 — deferred receive lifecycle ─────────────────

  describe('receive / in_transit lifecycle', () => {
    it('defers destination credit and later receives to complete the transfer', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const cable = await createProduct({
        name: 'Receive Cable',
        sku: 'TR-RX-CABLE',
        barcode: 'TR-30001',
        stock: 10,
      });

      const created = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: cable.id, quantity: 3 }],
        defer: true,
        notes: 'Shipping to branch',
      });

      expect(created.status).toBe('in_transit');

      // Origin debited immediately.
      const primaryAfterCreate = await caller.inventory.listBalancesBySite({
        siteId: primarySiteId,
      });
      expect(
        primaryAfterCreate.items.find(item => item.productId === cable.id)?.onHand
      ).toBe(7);

      // Destination NOT credited until receive.
      const secondaryAfterCreate = await caller.inventory.listBalancesBySite({
        siteId: secondarySiteId,
      });
      expect(
        secondaryAfterCreate.items.find(item => item.productId === cable.id)?.onHand ?? 0
      ).toBe(0);

      const received = await caller.transfers.receive({ transferId: created.id });
      expect(received.status).toBe('completed');
      expect(received.receivedItems).toEqual([{ productId: cable.id, quantity: 3 }]);

      const secondaryAfterReceive = await caller.inventory.listBalancesBySite({
        siteId: secondarySiteId,
      });
      expect(
        secondaryAfterReceive.items.find(item => item.productId === cable.id)?.onHand
      ).toBe(3);

      const list = await caller.transfers.list();
      const entry = list.items.find(item => item.id === created.id);
      expect(entry?.status).toBe('completed');
      expect(entry?.receivedAt).toBeTruthy();
      expect(entry?.receivedBy).toBeTruthy();
    });

    it('rejects receive on a transfer that is already completed', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const bolt = await createProduct({
        name: 'Receive Bolt',
        sku: 'TR-RX-BOLT',
        barcode: 'TR-30002',
        stock: 5,
      });

      const created = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: bolt.id, quantity: 1 }],
      });
      expect(created.status).toBe('completed');

      try {
        await caller.transfers.receive({ transferId: created.id });
        throw new Error('Expected receive to fail');
      } catch (error) {
        expectErrorCode(error, 'TRANSFER_NOT_IN_TRANSIT');
      }
    });

    it('rejects receive on a non-existent transfer', async () => {
      const caller = appRouter.createCaller(createTestContext());
      try {
        await caller.transfers.receive({ transferId: 'does-not-exist' });
        throw new Error('Expected receive to fail');
      } catch (error) {
        expectErrorCode(error, 'TRANSFER_NOT_FOUND');
      }
    });

    it('void on an in_transit transfer credits origin back without touching destination', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const widget = await createProduct({
        name: 'In Transit Widget',
        sku: 'TR-IT-WIDGET',
        barcode: 'TR-30003',
        stock: 20,
      });

      const created = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: widget.id, quantity: 8 }],
        defer: true,
      });

      // Primary went from 20 → 12 at create.
      const primaryAfterCreate = await caller.inventory.listBalancesBySite({
        siteId: primarySiteId,
      });
      expect(
        primaryAfterCreate.items.find(item => item.productId === widget.id)?.onHand
      ).toBe(12);

      await caller.transfers.void({
        transferId: created.id,
        reason: 'Shipment cancelled',
      });

      // Origin restored.
      const primaryAfterVoid = await caller.inventory.listBalancesBySite({
        siteId: primarySiteId,
      });
      expect(
        primaryAfterVoid.items.find(item => item.productId === widget.id)?.onHand
      ).toBe(20);

      // Destination never had a row (no credit yet), remains zero.
      const secondaryAfterVoid = await caller.inventory.listBalancesBySite({
        siteId: secondarySiteId,
      });
      expect(
        secondaryAfterVoid.items.find(item => item.productId === widget.id)?.onHand ?? 0
      ).toBe(0);

      const list = await caller.transfers.list();
      expect(list.items.find(item => item.id === created.id)?.status).toBe('void');
    });

    it('keeps products.stock in lockstep with Σ(balances) across deferred create → receive', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const db = getDatabase();
      const { products } = await import('../db/schema.js');
      const screw = await createProduct({
        name: 'Receive Lockstep Screw',
        sku: 'TR-RX-SCREW',
        barcode: 'TR-30004',
        stock: 15,
      });

      const created = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: screw.id, quantity: 4 }],
        defer: true,
      });

      // In-transit: primary 11, secondary 0 → Σ = 11, products.stock = 11.
      const inTransitStock = await db
        .select({ stock: products.stock })
        .from(products)
        .where(eq(products.id, screw.id))
        .get();
      expect(inTransitStock?.stock).toBe(11);

      // Receive: primary still 11, secondary 4 → Σ = 15, products.stock = 15.
      await caller.transfers.receive({ transferId: created.id });

      const finalStock = await db
        .select({ stock: products.stock })
        .from(products)
        .where(eq(products.id, screw.id))
        .get();
      expect(finalStock?.stock).toBe(15);
    });
  });

  // ─── Phase 2 — transfers.getById (detail drawer) ─────────────────────────

  describe('getById', () => {
    it('returns the transfer with joined product names and site names', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const cable = await createProduct({
        name: 'Detail Cable',
        sku: 'TR-DET-CABLE',
        barcode: 'TR-40001',
        stock: 10,
      });
      const bolt = await createProduct({
        name: 'Detail Bolt',
        sku: 'TR-DET-BOLT',
        barcode: 'TR-40002',
        stock: 20,
      });

      const created = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [
          { productId: cable.id, quantity: 2 },
          { productId: bolt.id, quantity: 5 },
        ],
        notes: 'Branch restock',
      });

      const detail = await caller.transfers.getById({ id: created.id });

      expect(detail.id).toBe(created.id);
      expect(detail.status).toBe('completed');
      expect(detail.fromSiteId).toBe(primarySiteId);
      expect(detail.toSiteId).toBe(secondarySiteId);
      expect(detail.fromSiteName).toBeTruthy();
      expect(detail.toSiteName).toBeTruthy();
      expect(detail.notes).toBe('Branch restock');
      expect(detail.items).toHaveLength(2);

      const cableLine = detail.items.find(item => item.productId === cable.id);
      const boltLine = detail.items.find(item => item.productId === bolt.id);
      expect(cableLine?.productName).toBe('Detail Cable');
      expect(cableLine?.productSku).toBe('TR-DET-CABLE');
      expect(cableLine?.quantity).toBe(2);
      expect(boltLine?.productName).toBe('Detail Bolt');
      expect(boltLine?.quantity).toBe(5);
    });

    it('surfaces receivedAt / receivedBy after a deferred receive', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const widget = await createProduct({
        name: 'Detail Widget',
        sku: 'TR-DET-WIDGET',
        barcode: 'TR-40003',
        stock: 8,
      });

      const created = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: widget.id, quantity: 3 }],
        defer: true,
      });

      const inTransitDetail = await caller.transfers.getById({ id: created.id });
      expect(inTransitDetail.status).toBe('in_transit');
      expect(inTransitDetail.receivedAt).toBeNull();
      expect(inTransitDetail.receivedBy).toBeNull();

      await caller.transfers.receive({ transferId: created.id });

      const completedDetail = await caller.transfers.getById({ id: created.id });
      expect(completedDetail.status).toBe('completed');
      expect(completedDetail.receivedAt).toBeTruthy();
      expect(completedDetail.receivedBy).toBe(userId);
    });

    it('rejects a transfer ID that does not exist for the tenant', async () => {
      const caller = appRouter.createCaller(createTestContext());
      try {
        await caller.transfers.getById({ id: 'does-not-exist' });
        throw new Error('Expected getById to throw');
      } catch (error) {
        expectErrorCode(error, 'TRANSFER_NOT_FOUND');
      }
    });
  });

  // ─── Phase 2 UI-103 — per-line received quantities + discrepancy notes ──

  describe('receive variance', () => {
    it('treats a receive call with no lines as accepting shipped quantities', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const db = getDatabase();
      const cable = await createProduct({
        name: 'Variance Legacy Cable',
        sku: 'TR-VAR-LEGACY',
        barcode: 'TR-50001',
        stock: 10,
      });

      const created = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: cable.id, quantity: 4 }],
        defer: true,
      });

      const received = await caller.transfers.receive({ transferId: created.id });
      expect(received.status).toBe('completed');
      expect(received.hasDiscrepancy).toBe(false);
      expect(received.discrepancyNotes).toBeNull();
      expect(received.receivedItems).toEqual([{ productId: cable.id, quantity: 4 }]);

      // Every line must carry received_quantity = shipped, not null.
      const persisted = await db
        .select({
          quantity: transferOrderItems.quantity,
          receivedQuantity: transferOrderItems.receivedQuantity,
        })
        .from(transferOrderItems)
        .where(eq(transferOrderItems.transferOrderId, created.id))
        .all();
      expect(persisted).toHaveLength(1);
      expect(persisted[0]?.quantity).toBe(4);
      expect(persisted[0]?.receivedQuantity).toBe(4);

      const list = await caller.transfers.list();
      expect(list.items.find(entry => entry.id === created.id)?.hasDiscrepancy).toBe(false);
    });

    it('treats an empty lines array the same as omitting it', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const bolt = await createProduct({
        name: 'Variance Empty Bolt',
        sku: 'TR-VAR-EMPTY',
        barcode: 'TR-50002',
        stock: 6,
      });

      const created = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: bolt.id, quantity: 2 }],
        defer: true,
      });

      const received = await caller.transfers.receive({
        transferId: created.id,
        lines: [],
      });
      expect(received.hasDiscrepancy).toBe(false);
      expect(received.receivedItems).toEqual([{ productId: bolt.id, quantity: 2 }]);
    });

    it('ignores discrepancy notes when all received quantities match shipped', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const washer = await createProduct({
        name: 'Variance Note Washer',
        sku: 'TR-VAR-NOTE',
        barcode: 'TR-500021',
        stock: 4,
      });

      const created = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: washer.id, quantity: 2 }],
        defer: true,
      });

      const received = await caller.transfers.receive({
        transferId: created.id,
        discrepancyNotes: 'typed by mistake before restoring the shipped quantity',
      });
      expect(received.hasDiscrepancy).toBe(false);
      expect(received.discrepancyNotes).toBeNull();

      const detail = await caller.transfers.getById({ id: created.id });
      expect(detail.hasDiscrepancy).toBe(false);
      expect(detail.discrepancyNotes).toBeNull();
    });

    it('records a shortage: destination credited only the received quantity, shrinkage reflected in Σ(balances)', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const db = getDatabase();
      const { products } = await import('../db/schema.js');
      const widget = await createProduct({
        name: 'Variance Shortage Widget',
        sku: 'TR-VAR-SHORT',
        barcode: 'TR-50003',
        stock: 10,
      });

      const created = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: widget.id, quantity: 10 }],
        defer: true,
      });

      const detail = await caller.transfers.getById({ id: created.id });
      const lineId = detail.items[0]!.id;

      const received = await caller.transfers.receive({
        transferId: created.id,
        lines: [{ itemId: lineId, receivedQuantity: 7 }],
        discrepancyNotes: '3 units missing on arrival',
      });

      expect(received.hasDiscrepancy).toBe(true);
      expect(received.discrepancyNotes).toBe('3 units missing on arrival');
      expect(received.receivedItems).toEqual([{ productId: widget.id, quantity: 7 }]);

      // Origin stays at 0 (was debited 10), destination credited 7.
      const primary = await caller.inventory.listBalancesBySite({ siteId: primarySiteId });
      expect(primary.items.find(item => item.productId === widget.id)?.onHand).toBe(0);

      const secondary = await caller.inventory.listBalancesBySite({
        siteId: secondarySiteId,
      });
      expect(secondary.items.find(item => item.productId === widget.id)?.onHand).toBe(7);

      // products.stock matches Σ(balances) = 7 → the 3-unit shrinkage shows up
      // in the tenant-wide cache, matching the invariant enforced elsewhere.
      const stockRow = await db
        .select({ stock: products.stock })
        .from(products)
        .where(eq(products.id, widget.id))
        .get();
      expect(stockRow?.stock).toBe(7);

      const listEntry = (await caller.transfers.list()).items.find(
        entry => entry.id === created.id
      );
      expect(listEntry?.hasDiscrepancy).toBe(true);
      expect(listEntry?.discrepancyNotes).toBe('3 units missing on arrival');

      const detailAfter = await caller.transfers.getById({ id: created.id });
      expect(detailAfter.hasDiscrepancy).toBe(true);
      expect(detailAfter.discrepancyNotes).toBe('3 units missing on arrival');
      expect(detailAfter.items[0]?.receivedQuantity).toBe(7);
    });

    it('rejects received quantities greater than the shipped quantity', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const screw = await createProduct({
        name: 'Variance Overflow Screw',
        sku: 'TR-VAR-OVER',
        barcode: 'TR-50004',
        stock: 5,
      });

      const created = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: screw.id, quantity: 2 }],
        defer: true,
      });
      const detail = await caller.transfers.getById({ id: created.id });
      const lineId = detail.items[0]!.id;

      try {
        await caller.transfers.receive({
          transferId: created.id,
          lines: [{ itemId: lineId, receivedQuantity: 5 }],
        });
        throw new Error('Expected receive to fail');
      } catch (error) {
        expectErrorCode(error, 'TRANSFER_RECEIVED_EXCEEDS_SHIPPED');
      }

      // Transfer must stay in transit with no destination credit.
      const refreshed = await caller.transfers.getById({ id: created.id });
      expect(refreshed.status).toBe('in_transit');
      expect(refreshed.items[0]?.receivedQuantity).toBeNull();
      const secondary = await caller.inventory.listBalancesBySite({
        siteId: secondarySiteId,
      });
      expect(secondary.items.find(item => item.productId === screw.id)?.onHand ?? 0).toBe(0);
    });

    it('rejects receive payloads that reference an unknown line id', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const hinge = await createProduct({
        name: 'Variance Unknown Hinge',
        sku: 'TR-VAR-UNKNOWN',
        barcode: 'TR-50005',
        stock: 3,
      });

      const created = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: hinge.id, quantity: 1 }],
        defer: true,
      });

      try {
        await caller.transfers.receive({
          transferId: created.id,
          lines: [{ itemId: 'line-that-does-not-exist', receivedQuantity: 1 }],
        });
        throw new Error('Expected receive to fail');
      } catch (error) {
        expectErrorCode(error, 'TRANSFER_RECEIVE_LINE_MISMATCH');
      }
    });

    it('rejects receive payloads with duplicate line ids', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const nut = await createProduct({
        name: 'Variance Duplicate Nut',
        sku: 'TR-VAR-DUP',
        barcode: 'TR-50006',
        stock: 3,
      });

      const created = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: nut.id, quantity: 2 }],
        defer: true,
      });
      const detail = await caller.transfers.getById({ id: created.id });
      const lineId = detail.items[0]!.id;

      try {
        await caller.transfers.receive({
          transferId: created.id,
          lines: [
            { itemId: lineId, receivedQuantity: 1 },
            { itemId: lineId, receivedQuantity: 1 },
          ],
        });
        throw new Error('Expected receive to fail');
      } catch (error) {
        expectErrorCode(error, 'TRANSFER_RECEIVE_LINE_MISMATCH');
      }
    });

    it('void after a partial receipt debits destination by received, credits origin by shipped', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const db = getDatabase();
      const { products } = await import('../db/schema.js');
      const pipe = await createProduct({
        name: 'Variance Partial Pipe',
        sku: 'TR-VAR-PART',
        barcode: 'TR-50007',
        stock: 10,
      });

      const created = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: pipe.id, quantity: 10 }],
        defer: true,
      });
      const detail = await caller.transfers.getById({ id: created.id });
      const lineId = detail.items[0]!.id;

      await caller.transfers.receive({
        transferId: created.id,
        lines: [{ itemId: lineId, receivedQuantity: 6 }],
      });

      // Confirm pre-void state: origin 0, destination 6, products.stock 6.
      const primaryAfter = await caller.inventory.listBalancesBySite({
        siteId: primarySiteId,
      });
      expect(primaryAfter.items.find(item => item.productId === pipe.id)?.onHand).toBe(0);
      const secondaryAfter = await caller.inventory.listBalancesBySite({
        siteId: secondarySiteId,
      });
      expect(secondaryAfter.items.find(item => item.productId === pipe.id)?.onHand).toBe(6);

      await caller.transfers.void({ transferId: created.id, reason: 'Mistake' });

      // After void: destination debited the received 6 (not shipped 10),
      // origin credited the shipped 10. Net tenant stock returns to 10.
      const primaryVoid = await caller.inventory.listBalancesBySite({
        siteId: primarySiteId,
      });
      expect(primaryVoid.items.find(item => item.productId === pipe.id)?.onHand).toBe(10);
      const secondaryVoid = await caller.inventory.listBalancesBySite({
        siteId: secondarySiteId,
      });
      expect(secondaryVoid.items.find(item => item.productId === pipe.id)?.onHand).toBe(0);

      const stockRow = await db
        .select({ stock: products.stock })
        .from(products)
        .where(eq(products.id, pipe.id))
        .get();
      expect(stockRow?.stock).toBe(10);
    });
  });
});
