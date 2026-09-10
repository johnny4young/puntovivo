import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  inventoryBalances,
  inventoryLots,
  inventoryMovements,
  transferOrderItems,
  transferOrderItemLots,
  transferOrders,
  products,
  sites,
  units,
  unitXProduct,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

/** A transfer moves value as well as stock; the fixture gets its residual from a real transformation. */
describe('fractional carrying value through transfers', () => {
  let server: PuntovivoServer;
  let tenantId: string;
  let fromSiteId: string;
  let toSiteId: string;
  let unitId: string;
  let fresh: ReturnType<typeof makeFreshContextFactory>;
  const caller = () => appRouter.createCaller(fresh());
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const user = db.select().from(users).where(eq(users.email, 'admin@localhost')).get()!;
    tenantId = user.tenantId;
    const site = db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get()!;
    fromSiteId = site.id;
    toSiteId = nanoid();
    db.insert(sites)
      .values({
        id: toSiteId,
        tenantId,
        companyId: site.companyId,
        name: 'Exact value destination',
        createdAt: new Date(Date.now() + 60_000).toISOString(),
      })
      .run();
    unitId = db
      .select()
      .from(units)
      .where(and(eq(units.tenantId, tenantId), eq(units.abbreviation, 'UND')))
      .get()!.id;
    const device = await registerDevice(db, {
      tenantId,
      userId: user.id,
      kind: 'web',
      name: 'value-transfers',
    });
    fresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId: user.id,
      email: user.email,
      siteId: fromSiteId,
      deviceId: device.deviceId,
      defaultRole: 'admin',
    });
  });
  afterAll(async () => server.close());

  async function transformed(tracksLots: boolean) {
    const db = getDatabase();
    const rawId = nanoid(),
      productId = nanoid(),
      rawLotId = tracksLots ? nanoid() : null;
    for (const [id, quantity, cost] of [
      [rawId, 1, 1],
      [productId, 0, 0],
    ] as const) {
      db.insert(products)
        .values({
          id,
          tenantId,
          name: id,
          sku: id,
          cost,
          initialCost: cost,
          tracksLots,
          sellByFraction: true,
          fractionStep: 0.001,
          fractionMinimum: 0.001,
        })
        .run();
      db.insert(unitXProduct)
        .values({ id: nanoid(), productId: id, unitId, equivalence: 1, isBase: true })
        .run();
      db.insert(inventoryBalances)
        .values({ id: nanoid(), tenantId, siteId: fromSiteId, productId: id, onHand: quantity })
        .run();
    }
    if (rawLotId)
      db.insert(inventoryLots)
        .values({
          id: rawLotId,
          tenantId,
          siteId: fromSiteId,
          productId: rawId,
          lotNumber: nanoid(),
          onHand: 1,
          unitCost: 1,
          receivedAt: new Date().toISOString(),
        })
        .run();
    const recipe = await caller().inventoryTransformations.createRecipe({
      siteId: fromSiteId,
      name: nanoid(),
      kind: 'cut',
      inputs: [{ productId: rawId, baseQuantity: 1 }],
      outputs: [{ productId, expectedBaseQuantity: 3.001, allocationWeight: 1, role: 'primary' }],
    });
    const result = await caller().inventoryTransformations.execute({
      siteId: fromSiteId,
      recipeId: recipe.id,
      inputs: [
        {
          recipeInputId: recipe.inputs[0]!.id,
          baseQuantity: 1,
          ...(rawLotId ? { lotAllocations: [{ lotId: rawLotId, baseQuantity: 1 }] } : {}),
        },
      ],
      outputs: [
        {
          recipeOutputId: recipe.outputs[0]!.id,
          baseQuantity: 3.001,
          ...(tracksLots ? { lot: { lotNumber: nanoid() } } : {}),
        },
      ],
      waste: [],
    });
    expect(result.totalInputCost).toBe(1);
    return { productId, lotId: result.outputs[0]!.lotId };
  }

  function value(productId: string, tracksLots: boolean) {
    const db = getDatabase();
    if (tracksLots) {
      const lots = db
        .select()
        .from(inventoryLots)
        .where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.productId, productId)))
        .all();
      for (const lot of lots) expect(lot.valuationQuantity).toBe(lot.onHand);
      return lots.reduce((sum, lot) => sum + (lot.carryingValueCents ?? 0), 0);
    }
    const product = db
      .select()
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
      .get()!;
    const quantity = db
      .select()
      .from(inventoryBalances)
      .where(
        and(eq(inventoryBalances.tenantId, tenantId), eq(inventoryBalances.productId, productId))
      )
      .all()
      .reduce((sum, row) => sum + row.onHand, 0);
    expect(product.valuationQuantity).toBeCloseTo(quantity, 12);
    expect(product.cogsValueCents).toBe(product.inventoryValueCents);
    return product.inventoryValueCents;
  }

  it.each([false, true])(
    'moves all fractional value immediately and restores it on void (lots=%s)',
    async tracksLots => {
      const { productId, lotId } = await transformed(tracksLots);
      const transfer = await caller().transfers.create({
        fromSiteId,
        toSiteId,
        items: [
          {
            productId,
            quantity: 3.001,
            ...(lotId ? { lotAllocations: [{ lotId, quantity: 3.001 }] } : {}),
          },
        ],
      });
      expect(value(productId, tracksLots)).toBe(100);
      await caller().transfers.void({
        transferId: transfer.id,
        reason: 'Exact immediate reversal',
      });
      expect(value(productId, tracksLots)).toBe(100);
    }
  );

  it.each([false, true])(
    'freezes fractional value in transit, receipts and shortage reversal (lots=%s)',
    async tracksLots => {
      const { productId, lotId } = await transformed(tracksLots);
      const transfer = await caller().transfers.create({
        fromSiteId,
        toSiteId,
        defer: true,
        items: [
          {
            productId,
            quantity: 3.001,
            ...(lotId ? { lotAllocations: [{ lotId, quantity: 3.001 }] } : {}),
          },
        ],
      });
      expect(value(productId, tracksLots)).toBe(0);
      await caller().transfers.receive({
        transferId: transfer.id,
        discrepancyNotes: 'Two units received; exact shortage retained',
        lines: [
          {
            itemId: transfer.items[0]!.id,
            receivedQuantity: 2,
            ...(tracksLots
              ? {
                  lotAllocations: [
                    { transferItemLotId: transfer.items[0]!.lots[0]!.id, receivedQuantity: 2 },
                  ],
                }
              : {}),
          },
        ],
      });
      expect(value(productId, tracksLots)).toBe(67);
      await caller().transfers.void({
        transferId: transfer.id,
        reason: 'Return only physically received stock',
      });
      expect(value(productId, tracksLots)).toBe(67);
    }
  );
  it.each(['receive', 'void'] as const)(
    'retains both shipment bases when catalog reprices stock still on hand (%s)',
    async action => {
      const { productId } = await transformed(false);
      const db = getDatabase();
      const transfer = await caller().transfers.create({
        fromSiteId,
        toSiteId,
        defer: true,
        items: [{ productId, quantity: 1.001 }],
      });
      expect(value(productId, false)).toBe(67);
      const current = db.select().from(products).where(eq(products.id, productId)).get()!;
      await caller().products.update({
        id: productId,
        version: current.version,
        initialCost: 1,
        cost: 2,
      });
      expect(db.select().from(products).where(eq(products.id, productId)).get()).toMatchObject({
        valuationQuantity: 2,
        inventoryValueCents: 200,
        cogsValueCents: 400,
      });
      if (action === 'receive') await caller().transfers.receive({ transferId: transfer.id });
      else await caller().transfers.void({ transferId: transfer.id });
      expect(db.select().from(products).where(eq(products.id, productId)).get()).toMatchObject({
        valuationQuantity: 3.001,
        inventoryValueCents: 233,
        cogsValueCents: 433,
      });
      const line = db
        .select()
        .from(transferOrderItems)
        .where(eq(transferOrderItems.id, transfer.items[0]!.id))
        .get()!;
      expect(line).toMatchObject({ shippedInventoryValueCents: 33, shippedCogsValueCents: 33 });
      const movements = db
        .select()
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.tenantId, tenantId),
            eq(inventoryMovements.reference, transfer.id)
          )
        )
        .all();
      expect(movements.map(row => row.inventoryValueDeltaCents).sort((a, b) => a! - b!)).toEqual([
        -33, 33,
      ]);
      expect(movements.map(row => row.cogsValueDeltaCents).sort((a, b) => a! - b!)).toEqual([
        -33, 33,
      ]);
    }
  );

  it('rejects a completed non-lot undo after cost revaluation without moving stock', async () => {
    const { productId } = await transformed(false);
    const db = getDatabase();
    const transfer = await caller().transfers.create({
      fromSiteId,
      toSiteId,
      items: [{ productId, quantity: 3.001 }],
    });
    const current = db.select().from(products).where(eq(products.id, productId)).get()!;
    await caller().products.update({ id: productId, version: current.version, cost: 1 });
    const before = db
      .select()
      .from(inventoryBalances)
      .where(eq(inventoryBalances.productId, productId))
      .all();
    await expect(caller().transfers.void({ transferId: transfer.id })).rejects.toMatchObject({
      cause: { errorCode: 'INVENTORY_VALUE_CHANGED' },
    });
    expect(
      db.select().from(inventoryBalances).where(eq(inventoryBalances.productId, productId)).all()
    ).toEqual(before);
    expect(
      db.select().from(transferOrders).where(eq(transferOrders.id, transfer.id)).get()?.status
    ).toBe('completed');
  });

  it('rejects value-only lot ABA even after cents, rounded cost and quantity match again', async () => {
    const { productId, lotId } = await transformed(true);
    const db = getDatabase();
    const transfer = await caller().transfers.create({
      fromSiteId,
      toSiteId,
      items: [{ productId, quantity: 3.001, lotAllocations: [{ lotId: lotId!, quantity: 3.001 }] }],
    });
    const destinationId = transfer.items[0]!.lots[0]!.destinationLotId!;
    const before = db
      .select()
      .from(inventoryLots)
      .where(eq(inventoryLots.id, destinationId))
      .get()!;
    for (const cents of [101, 100])
      db.update(inventoryLots)
        .set({ carryingValueCents: cents })
        .where(eq(inventoryLots.id, destinationId))
        .run();
    const after = db.select().from(inventoryLots).where(eq(inventoryLots.id, destinationId)).get()!;
    expect(after).toMatchObject({
      onHand: before.onHand,
      unitCost: before.unitCost,
      carryingValueCents: before.carryingValueCents,
      valuationVersion: before.valuationVersion + 2,
      custodyVersion: before.custodyVersion + 2,
    });
    await expect(caller().transfers.void({ transferId: transfer.id })).rejects.toMatchObject({
      cause: { errorCode: 'TRANSFER_VOID_INSUFFICIENT_STOCK' },
    });
    expect(
      db.select().from(inventoryLots).where(eq(inventoryLots.id, destinationId)).get()
    ).toEqual(after);
    expect(value(productId, true)).toBe(100);
  });

  it('allows sync acknowledgement and quarantine without losing cents or releasing a restricted lot', async () => {
    const { productId, lotId } = await transformed(true);
    const db = getDatabase();
    const transfer = await caller().transfers.create({
      fromSiteId,
      toSiteId,
      items: [{ productId, quantity: 3.001, lotAllocations: [{ lotId: lotId!, quantity: 3.001 }] }],
    });
    const destinationId = transfer.items[0]!.lots[0]!.destinationLotId!;
    const before = db
      .select()
      .from(inventoryLots)
      .where(eq(inventoryLots.id, destinationId))
      .get()!;
    db.update(inventoryLots)
      .set({ syncStatus: 'synced', syncVersion: (before.syncVersion ?? 0) + 1 })
      .where(eq(inventoryLots.id, destinationId))
      .run();
    expect(
      db.select().from(inventoryLots).where(eq(inventoryLots.id, destinationId)).get()
    ).toMatchObject({
      custodyVersion: before.custodyVersion,
      valuationVersion: before.valuationVersion,
    });
    db.update(inventoryLots)
      .set({ status: 'quarantined' })
      .where(eq(inventoryLots.id, destinationId))
      .run();
    expect(
      db.select().from(inventoryLots).where(eq(inventoryLots.id, destinationId)).get()
        ?.valuationVersion
    ).toBe(before.valuationVersion);
    await caller().transfers.void({ transferId: transfer.id });
    expect(value(productId, true)).toBe(100);
    expect(db.select().from(inventoryLots).where(eq(inventoryLots.id, lotId!)).get()).toMatchObject(
      { status: 'quarantined', carryingValueCents: 100, onHand: 3.001 }
    );
  });

  it.each([false, true])(
    'does not recreate a fully lost shipment on receipt, void or duplicate calls (lots=%s)',
    async tracksLots => {
      const { productId, lotId } = await transformed(tracksLots);
      const transfer = await caller().transfers.create({
        fromSiteId,
        toSiteId,
        defer: true,
        items: [
          {
            productId,
            quantity: 3.001,
            ...(lotId ? { lotAllocations: [{ lotId, quantity: 3.001 }] } : {}),
          },
        ],
      });
      const receive = {
        transferId: transfer.id,
        discrepancyNotes: 'All stock confirmed lost',
        lines: [
          {
            itemId: transfer.items[0]!.id,
            receivedQuantity: 0,
            ...(tracksLots
              ? {
                  lotAllocations: [
                    { transferItemLotId: transfer.items[0]!.lots[0]!.id, receivedQuantity: 0 },
                  ],
                }
              : {}),
          },
        ],
      };
      await caller().transfers.receive(receive);
      await expect(caller().transfers.receive(receive)).rejects.toMatchObject({
        cause: { errorCode: 'TRANSFER_NOT_IN_TRANSIT' },
      });
      expect(value(productId, tracksLots)).toBe(0);
      await caller().transfers.void({ transferId: transfer.id });
      await expect(caller().transfers.void({ transferId: transfer.id })).rejects.toMatchObject({
        cause: { errorCode: 'TRANSFER_ALREADY_VOID' },
      });
      expect(value(productId, tracksLots)).toBe(0);
      const db = getDatabase();
      expect(
        db
          .select()
          .from(transferOrderItems)
          .where(eq(transferOrderItems.id, transfer.items[0]!.id))
          .get()
      ).toMatchObject({ shippedInventoryValueCents: 100, receivedInventoryValueCents: 0 });
      expect(
        db
          .select()
          .from(inventoryMovements)
          .where(
            and(
              eq(inventoryMovements.tenantId, tenantId),
              eq(inventoryMovements.reference, transfer.id)
            )
          )
          .all()
      ).toHaveLength(1);
    }
  );

  it('rejects a partial monetary snapshot before receipt and rolls back the whole command', async () => {
    const { productId } = await transformed(false);
    const db = getDatabase();
    const transfer = await caller().transfers.create({
      fromSiteId,
      toSiteId,
      defer: true,
      items: [{ productId, quantity: 3.001 }],
    });
    const corrupt = () =>
      db
        .update(transferOrderItems)
        .set({ shippedCogsValueCents: null })
        .where(eq(transferOrderItems.id, transfer.items[0]!.id))
        .run();
    expect(corrupt).toThrowError(/chk_transfer_order_items_valuation_basis/);
    // Deliberate externally-corrupted fixture: retain independent application
    // defence coverage after proving the normal storage write is now rejected.
    db.$client.pragma('ignore_check_constraints = ON');
    try {
      corrupt();
    } finally {
      db.$client.pragma('ignore_check_constraints = OFF');
    }
    await expect(caller().transfers.receive({ transferId: transfer.id })).rejects.toMatchObject({
      cause: { errorCode: 'INVENTORY_VALUE_INVALID' },
    });
    expect(value(productId, false)).toBe(0);
    expect(
      db.select().from(transferOrders).where(eq(transferOrders.id, transfer.id)).get()?.status
    ).toBe('in_transit');
    expect(
      db
        .select()
        .from(transferOrderItemLots)
        .where(eq(transferOrderItemLots.transferOrderItemId, transfer.items[0]!.id))
        .all()
    ).toEqual([]);
  });

  it.each([false, true])(
    'returns a positive sub-epsilon quantity that owns a whole cent (deferred=%s)',
    async deferred => {
      const db = getDatabase();
      const productId = nanoid();
      db.insert(products)
        .values({
          id: productId,
          tenantId,
          name: productId,
          sku: productId,
          cost: 100_000_000,
          initialCost: 100_000_000,
          sellByFraction: true,
          inventoryValueCents: 1,
          cogsValueCents: 1,
          valuationQuantity: 1e-10,
        })
        .run();
      db.insert(inventoryBalances)
        .values({ id: nanoid(), tenantId, siteId: fromSiteId, productId, onHand: 1e-10 })
        .run();
      const transfer = await caller().transfers.create({
        fromSiteId,
        toSiteId,
        defer: deferred,
        items: [{ productId, quantity: 1e-10 }],
      });
      expect(value(productId, false)).toBe(deferred ? 0 : 1);
      await caller().transfers.void({ transferId: transfer.id });
      expect(value(productId, false)).toBe(1);
      expect(
        db
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.productId, productId),
              eq(inventoryBalances.siteId, fromSiteId)
            )
          )
          .get()?.onHand
      ).toBe(1e-10);
    }
  );
  it.each(['missing receipt', 'altered previous value'] as const)(
    'rejects corrupted frozen lot value on undo (%s)',
    async corruption => {
      const { productId, lotId } = await transformed(true);
      const db = getDatabase();
      const transfer = await caller().transfers.create({
        fromSiteId,
        toSiteId,
        items: [
          { productId, quantity: 3.001, lotAllocations: [{ lotId: lotId!, quantity: 3.001 }] },
        ],
      });
      const lotRowId = transfer.items[0]!.lots[0]!.id;
      db.update(transferOrderItemLots)
        .set(
          corruption === 'missing receipt'
            ? { receivedValueCents: null }
            : {
                destinationPreviousValueCents: 1,
                destinationPreviousValuationQuantity: 0,
              }
        )
        .where(eq(transferOrderItemLots.id, lotRowId))
        .run();
      const before = db
        .select()
        .from(inventoryLots)
        .where(eq(inventoryLots.productId, productId))
        .all();
      await expect(caller().transfers.void({ transferId: transfer.id })).rejects.toMatchObject({
        cause: { errorCode: 'LOT_COST_INVALID' },
      });
      expect(
        db.select().from(inventoryLots).where(eq(inventoryLots.productId, productId)).all()
      ).toEqual(before);
      expect(value(productId, true)).toBe(100);
    }
  );
});
