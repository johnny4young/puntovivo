import { __withExpectedTestLogs } from '../logging/logger.js';
import { productInventoryValueSql } from '../services/inventory-balances/derive.js';
import * as productMutationHelpers from '../services/products/mutation-helpers.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  initialInventory,
  syncOutbox,
  auditLogs,
  providers,
  purchaseItems,
  purchaseItemLots,
  purchaseReturnItems,
  purchaseReturnItemLots,
  inventoryBalances,
  inventoryLots,
  inventoryMovements,
  products,
  productSerials,
  saleItemLots,
  saleItemSerials,
  saleReturnItemSerials,
  saleItems,
  saleReturnItems,
  saleReturnItemLots,
  sites,
  units,
  unitXProduct,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { consumeExactInventoryLots } from '../services/inventory-lots/exact.js';
import { computeProfitMarginReport } from '../services/reports/profit-margin.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

/** Real command/SQLite custody: transformation → draft → checkout → returns → resale. */
describe('fractional carrying value across sale lifecycle', () => {
  let server: PuntovivoServer;
  let tenantId: string;
  let siteId: string;
  let unitId: string;
  let fresh: ReturnType<typeof makeFreshContextFactory>;
  const caller = () => appRouter.createCaller(fresh());

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const user = db.select().from(users).where(eq(users.email, 'admin@localhost')).get()!;
    tenantId = user.tenantId;
    siteId = db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get()!.id;
    unitId = db
      .select()
      .from(units)
      .where(and(eq(units.tenantId, tenantId), eq(units.abbreviation, 'UND')))
      .get()!.id;
    const device = await registerDevice(db, {
      tenantId,
      userId: user.id,
      kind: 'web',
      name: 'carrying-value-sales',
    });
    fresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId: user.id,
      email: user.email,
      siteId,
      deviceId: device.deviceId,
      defaultRole: 'admin',
    });
    await caller().cashSessions.open({
      registerName: 'Exact value register',
      openingFloat: 500,
      denominations: [{ value: 100, count: 5 }],
    });
  });
  afterAll(async () => server.close());

  async function product(name: string, quantity: number, cost: number, tracksLots: boolean) {
    const db = getDatabase();
    const id = nanoid();
    db.insert(products)
      .values({
        id,
        tenantId,
        name,
        sku: nanoid(),
        price: 100,
        cost,
        initialCost: cost,
        tracksLots,
        sellByFraction: true,
        fractionStep: 0.001,
        fractionMinimum: 0.001,
      })
      .run();
    db.insert(unitXProduct)
      .values({ id: nanoid(), productId: id, unitId, equivalence: 1, price: 100, isBase: true })
      .run();
    db.insert(inventoryBalances)
      .values({ id: nanoid(), tenantId, siteId, productId: id, onHand: quantity })
      .run();
    const lotId = quantity > 0 && tracksLots ? nanoid() : null;
    if (lotId)
      db.insert(inventoryLots)
        .values({
          id: lotId,
          tenantId,
          siteId,
          productId: id,
          lotNumber: nanoid(),
          onHand: quantity,
          unitCost: cost,
          status: 'active',
          receivedAt: new Date().toISOString(),
        })
        .run();
    return { id, lotId };
  }

  async function transformed(
    tracksLots: boolean,
    outputQuantity = 3.001,
    existingOutput?: { id: string; lotNumber: string }
  ) {
    const raw = await product('One currency unit raw', 1, 1, tracksLots);
    const output =
      existingOutput ?? (await product(`Fractional retail output ${nanoid()}`, 0, 0, tracksLots));
    const recipe = await caller().inventoryTransformations.createRecipe({
      siteId,
      name: nanoid(),
      kind: 'cut',
      inputs: [{ productId: raw.id, baseQuantity: 1 }],
      outputs: [
        {
          productId: output.id,
          expectedBaseQuantity: outputQuantity,
          allocationWeight: 1,
          role: 'primary',
        },
      ],
    });
    const result = await caller().inventoryTransformations.execute({
      recipeId: recipe.id,
      siteId,
      inputs: [
        {
          recipeInputId: recipe.inputs[0]!.id,
          baseQuantity: 1,
          ...(raw.lotId ? { lotAllocations: [{ lotId: raw.lotId, baseQuantity: 1 }] } : {}),
        },
      ],
      outputs: [
        {
          recipeOutputId: recipe.outputs[0]!.id,
          baseQuantity: outputQuantity,
          ...(tracksLots ? { lot: { lotNumber: existingOutput?.lotNumber ?? nanoid() } } : {}),
        },
      ],
      waste: [],
    });
    expect(result.totalInputCost).toBe(1);
    return { productId: output.id, lotId: result.outputs[0]!.lotId };
  }

  function carrying(productId: string, lotId: string | null) {
    const db = getDatabase();
    const quantity = db
      .select()
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, siteId),
          eq(inventoryBalances.productId, productId)
        )
      )
      .get()!.onHand;
    if (lotId) {
      const lot = db
        .select()
        .from(inventoryLots)
        .where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.id, lotId)))
        .get()!;
      expect(lot.valuationQuantity).toBe(quantity);
      expect(lot.onHand).toBe(quantity);
      return { quantity, inventory: lot.carryingValueCents, cogs: lot.carryingValueCents };
    }
    const row = db
      .select()
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
      .get()!;
    expect(row.valuationQuantity).toBe(quantity);
    return { quantity, inventory: row.inventoryValueCents, cogs: row.cogsValueCents };
  }
  async function sell(
    productId: string,
    quantity: number,
    status: 'draft' | 'completed' = 'completed',
    serialIds?: string[]
  ) {
    return caller().sales.create({
      items: [
        {
          productId,
          unitId,
          quantity,
          unitPrice: 100,
          discount: 0,
          ...(serialIds ? { serialIds } : {}),
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: status === 'draft' ? 'pending' : 'paid',
      status,
      amountReceived: status === 'draft' ? 0 : Math.round(quantity * 10000) / 100,
      discountAmount: 0,
    });
  }
  function line(saleId: string) {
    return getDatabase().select().from(saleItems).where(eq(saleItems.saleId, saleId)).get()!;
  }

  function movement(id: string) {
    return getDatabase()
      .select()
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.tenantId, tenantId), eq(inventoryMovements.id, id)))
      .get()!;
  }
  function expectMovementValue(id: string, inventory: number, cogs = inventory) {
    expect(movement(id)).toMatchObject({
      inventoryValueDeltaCents: inventory,
      cogsValueDeltaCents: cogs,
    });
    const outbox = getDatabase()
      .select()
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          eq(syncOutbox.entityType, 'inventory_movements'),
          eq(syncOutbox.entityId, id)
        )
      )
      .get()!;
    expect(outbox?.payload).toMatchObject({
      inventoryValueDeltaCents: inventory,
      cogsValueDeltaCents: cogs,
    });
  }

  it('freezes exact manual adjustment debits, known-zero no-ops and final residuals', async () => {
    const { productId } = await transformed(false);
    const first = await caller().inventory.adjustStock({ productId, newStock: 2 });
    expectMovementValue(first.movementId, -33);
    const noOp = await caller().inventory.adjustStock({ productId, newStock: 2 });
    expectMovementValue(noOp.movementId, 0);
    const last = await caller().inventory.adjustStock({ productId, newStock: 0 });
    expectMovementValue(last.movementId, -67);
    expect(carrying(productId, null)).toEqual({ quantity: 0, inventory: 0, cogs: 0 });
  });

  it('freezes a compatibility adjustment credit without erasing the fractional residual', async () => {
    const { productId } = await transformed(false);
    const row = await caller().inventory.createMovement({
      productId,
      type: 'adjustment',
      quantity: 1.001,
    });
    expectMovementValue(row.id, 33);
    expect(carrying(productId, null)).toEqual({ quantity: 4.002, inventory: 133, cogs: 133 });
  });

  it.each(['initial', 'physical'] as const)(
    'preserves same-cost residual on %s inventory entry',
    async mode => {
      const { productId } = await transformed(false);
      const row = await caller().inventory.recordEntry({
        productId,
        unitId,
        mode,
        quantity: mode === 'initial' ? 1.001 : 2,
        cost: 0.33,
      });
      const m = getDatabase()
        .select()
        .from(inventoryMovements)
        .where(
          and(eq(inventoryMovements.tenantId, tenantId), eq(inventoryMovements.reference, row.id))
        )
        .get()!;
      expectMovementValue(m.id, mode === 'initial' ? 33 : -33);
      expect(carrying(productId, null)).toEqual(
        mode === 'initial'
          ? { quantity: 4.002, inventory: 133, cogs: 133 }
          : { quantity: 2, inventory: 67, cogs: 67 }
      );
    }
  );

  it('records an explicit entry revaluation separately without repricing COGS', async () => {
    const { productId } = await transformed(false);
    const row = await caller().inventory.recordEntry({
      productId,
      unitId,
      mode: 'initial',
      quantity: 1.001,
      cost: 0.5,
    });
    expect(carrying(productId, null)).toEqual({ quantity: 4.002, inventory: 200, cogs: 133 });
    const m = getDatabase()
      .select()
      .from(inventoryMovements)
      .where(
        and(eq(inventoryMovements.tenantId, tenantId), eq(inventoryMovements.reference, row.id))
      )
      .get()!;
    expectMovementValue(m.id, 50, 33);
    const audit = getDatabase()
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceId, productId),
          eq(auditLogs.action, 'inventory.revalue')
        )
      )
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({
      source: 'inventory_entry',
      inventoryDeltaCents: 50,
      cogsDeltaCents: 0,
    });
  });

  it('freezes exact catalog stock edit debits without reconstructing rounded cost', async () => {
    const { productId } = await transformed(false);
    const current = getDatabase().select().from(products).where(eq(products.id, productId)).get()!;
    await caller().products.update({ id: productId, version: current.version, stock: 0 });
    const m = getDatabase()
      .select()
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.tenantId, tenantId),
          eq(inventoryMovements.productId, productId),
          eq(inventoryMovements.reference, 'product-update')
        )
      )
      .get()!;
    expectMovementValue(m.id, -100);
  });

  it('freezes standalone lot receipt deltas rather than the blended layer total', async () => {
    const p = await product('Lot manual receipt', 0, 0, true);
    const lotNumber = nanoid();
    await caller().inventoryLots.receive({
      productId: p.id,
      siteId,
      lotNumber,
      quantity: 0.005,
      unitCost: 1,
    });
    await caller().inventoryLots.receive({
      productId: p.id,
      siteId,
      lotNumber,
      quantity: 0.005,
      unitCost: 0,
    });
    const rows = getDatabase()
      .select()
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.tenantId, tenantId), eq(inventoryMovements.productId, p.id)))
      .all();
    expect(rows).toHaveLength(2);
    expectMovementValue(rows[0]!.id, 1);
    expectMovementValue(rows[1]!.id, 0);
    const lot = getDatabase()
      .select()
      .from(inventoryLots)
      .where(eq(inventoryLots.productId, p.id))
      .get()!;
    expect(carrying(p.id, lot.id)).toEqual({ quantity: 0.01, inventory: 1, cogs: 1 });
  });

  it('freezes standalone serial receipt identity values', async () => {
    const p = await product('Manual serial receipt', 0, 0, false);
    getDatabase()
      .update(products)
      .set({ tracksSerials: true, sellByFraction: false })
      .where(eq(products.id, p.id))
      .run();
    await caller().productSerials.receive({
      productId: p.id,
      siteId,
      serialNumbers: [nanoid(), nanoid()],
      unitCost: 0.34,
    });
    const m = getDatabase()
      .select()
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.tenantId, tenantId), eq(inventoryMovements.productId, p.id)))
      .get()!;
    expectMovementValue(m.id, 68);
  });

  it('freezes independent inventory and COGS opening values from product creation', async () => {
    const p = await caller().products.create({
      name: 'Explicit opening value',
      sku: nanoid(),
      price: 2,
      cost: 0.5,
      initialCost: 0.33,
      stock: 3.001,
      sellByFraction: true,
      fractionStep: 0.001,
      fractionMinimum: 0.001,
    });
    const m = getDatabase()
      .select()
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.tenantId, tenantId), eq(inventoryMovements.productId, p.id)))
      .get()!;
    expectMovementValue(m.id, 99, 150);
    expect(carrying(p.id, null)).toEqual({ quantity: 3.001, inventory: 99, cogs: 150 });
  });

  function stockSnapshot(productId: string) {
    const db = getDatabase();
    return {
      product: db.select().from(products).where(eq(products.id, productId)).get(),
      balances: db
        .select()
        .from(inventoryBalances)
        .where(eq(inventoryBalances.productId, productId))
        .all(),
      lots: db.select().from(inventoryLots).where(eq(inventoryLots.productId, productId)).all(),
      serials: db
        .select()
        .from(productSerials)
        .where(eq(productSerials.productId, productId))
        .all(),
      entries: db
        .select()
        .from(initialInventory)
        .where(eq(initialInventory.productId, productId))
        .all(),
      movements: db
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.productId, productId))
        .all(),
      audits: db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceId, productId)))
        .all(),
      outbox: db.select().from(syncOutbox).where(eq(syncOutbox.tenantId, tenantId)).all(),
    };
  }

  it.each(['adjust', 'movement', 'entry', 'catalog', 'lot', 'serial'] as const)(
    'rolls back %s quantity, value, provenance and audit after an outbox failure',
    async kind => {
      const db = getDatabase();
      const p = await product(
        'Atomic manual writer',
        kind === 'lot' || kind === 'serial' ? 0 : 3.001,
        0.33,
        kind === 'lot'
      );
      if (kind === 'serial')
        db.update(products)
          .set({ tracksSerials: true, sellByFraction: false })
          .where(eq(products.id, p.id))
          .run();
      const before = stockSnapshot(p.id);
      const sqlite = (db as unknown as { $client: { exec: (statement: string) => void } }).$client;
      sqlite.exec(`CREATE TEMP TRIGGER fail_manual_value_sync BEFORE INSERT ON sync_outbox
        WHEN NEW.entity_type = '${kind === 'entry' || kind === 'catalog' ? 'products' : 'inventory_movements'}'
        AND json_extract(NEW.payload, '$.${kind === 'entry' || kind === 'catalog' ? 'id' : 'productId'}') = '${p.id}'
        BEGIN SELECT RAISE(ABORT, 'forced manual value sync failure'); END;`);
      try {
        await expect(
          __withExpectedTestLogs(
            [
              { level: 'error', module: 'trpc-tracing', message: 'trpc procedure error' },
              { level: 'error', module: 'observability', message: 'captured exception' },
            ],
            async () => {
              if (kind === 'adjust')
                return caller().inventory.adjustStock({ productId: p.id, newStock: 2 });
              if (kind === 'movement')
                return caller().inventory.createMovement({
                  productId: p.id,
                  type: 'adjustment',
                  quantity: 1.001,
                });
              if (kind === 'entry')
                return caller().inventory.recordEntry({
                  productId: p.id,
                  unitId,
                  mode: 'initial',
                  quantity: 1.001,
                  cost: 0.5,
                });
              if (kind === 'catalog')
                return caller().products.update({
                  id: p.id,
                  version: before.product!.version,
                  stock: 2,
                  initialCost: 0.5,
                });
              if (kind === 'lot')
                return caller().inventoryLots.receive({
                  productId: p.id,
                  siteId,
                  lotNumber: nanoid(),
                  quantity: 0.005,
                  unitCost: 1,
                });
              return caller().productSerials.receive({
                productId: p.id,
                siteId,
                serialNumbers: [nanoid()],
                unitCost: 0.34,
              });
            }
          )
        ).rejects.toThrow(/forced manual value sync failure/);
      } finally {
        sqlite.exec('DROP TRIGGER fail_manual_value_sync');
      }
      expect(stockSnapshot(p.id)).toEqual(before);
    }
  );

  it.each([false, true])(
    'retains every cent through draft discard, partial returns, resale and void (lots=%s)',
    async tracksLots => {
      const { productId, lotId } = await transformed(tracksLots);
      const db = getDatabase();
      expect(carrying(productId, lotId)).toEqual({ quantity: 3.001, inventory: 100, cogs: 100 });
      const draft = await sell(productId, 1.001, 'draft');
      expect(line(draft.id)).toMatchObject({ inventoryCostCents: 33, cogsCostCents: 33 });
      expect(carrying(productId, lotId)).toEqual({ quantity: 2, inventory: 67, cogs: 67 });
      await caller().sales.discardDraft({ saleId: draft.id });
      expect(carrying(productId, lotId)).toEqual({ quantity: 3.001, inventory: 100, cogs: 100 });

      const whole = await sell(productId, 3.001);
      const wholeLine = line(whole.id);
      expect(wholeLine).toMatchObject({ inventoryCostCents: 100, cogsCostCents: 100 });
      expect(carrying(productId, lotId)).toEqual({ quantity: 0, inventory: 0, cogs: 0 });
      await caller().sales.returnSale({
        id: whole.id,
        items: [{ saleItemId: wholeLine.id, quantity: 1.001 }],
        reason: 'First fractional return',
      });
      expect(carrying(productId, lotId)).toEqual({ quantity: 1.001, inventory: 33, cogs: 33 });
      const report = () =>
        computeProfitMarginReport(db, {
          tenantId,
          fromDate: '2000-01-01',
          toDate: '2100-01-01',
          limit: 100,
        }).products.find(row => row.productId === productId);
      expect(report()?.cogs).toBe(0.67);
      await caller().sales.returnSale({
        id: whole.id,
        items: [{ saleItemId: wholeLine.id, quantity: 2 }],
        reason: 'Final fractional return',
      });
      expect(carrying(productId, lotId)).toEqual({ quantity: 3.001, inventory: 100, cogs: 100 });
      const returned = db
        .select()
        .from(saleReturnItems)
        .where(eq(saleReturnItems.saleItemId, wholeLine.id))
        .all();
      expect(returned.map(row => row.inventoryCostCents).sort()).toEqual([33, 67]);
      expect(Math.round(returned.reduce((sum, row) => sum + row.costAmount, 0) * 100)).toBe(100);
      if (lotId) {
        const provenance = db
          .select()
          .from(saleItemLots)
          .where(eq(saleItemLots.saleItemId, wholeLine.id))
          .get()!;
        expect(provenance.totalCostCents).toBe(100);
        expect(
          db
            .select()
            .from(saleReturnItemLots)
            .where(eq(saleReturnItemLots.saleItemLotId, provenance.id))
            .all()
            .map(row => row.totalCostCents)
            .sort()
        ).toEqual([33, 67]);
      }
      const first = await sell(productId, 1.001);
      const last = await sell(productId, 2);
      expect([line(first.id).cogsCostCents, line(last.id).cogsCostCents]).toEqual([33, 67]);
      expect(report()?.cogs).toBe(1);
      expect(carrying(productId, lotId)).toEqual({ quantity: 0, inventory: 0, cogs: 0 });
      await caller().sales.void({ id: last.id, reason: 'Void exact final residual' });
      expect(carrying(productId, lotId)).toEqual({ quantity: 2, inventory: 67, cogs: 67 });
      const retry = await sell(productId, 2);
      expect(line(retry.id).cogsCostCents).toBe(67);
      expect(report()?.cogs).toBe(1);
      const movement = db
        .select()
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.tenantId, tenantId),
            eq(inventoryMovements.reference, retry.id),
            eq(inventoryMovements.type, 'sale')
          )
        )
        .get()!;
      expect(movement).toMatchObject({ inventoryValueDeltaCents: -67, cogsValueDeltaCents: -67 });
    }
  );
  it('separates cost repricing from inventory basis and retains exact frozen reversals', async () => {
    const { productId, lotId } = await transformed(false, 6);
    const db = getDatabase();
    const current = db.select().from(products).where(eq(products.id, productId)).get()!;
    expect(current.cost).toBe(0.17);
    // Saving the same display cost must not revalue 1.00 into 1.02.
    const renamed = await caller().products.update({
      id: productId,
      version: current.version,
      name: 'Same cost new label',
      cost: current.cost,
    });
    expect(carrying(productId, lotId)).toEqual({ quantity: 6, inventory: 100, cogs: 100 });
    const changed = await caller().products.update({
      id: productId,
      version: renamed.version,
      cost: 0,
    });
    expect(changed.cost).toBe(0);
    expect(carrying(productId, lotId)).toEqual({ quantity: 6, inventory: 100, cogs: 0 });
    const audit = db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceId, productId),
          eq(auditLogs.action, 'inventory.revalue')
        )
      )
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({
      inventoryDeltaCents: 0,
      cogsDeltaCents: -100,
      source: 'product_update',
    });
    const ticket = await sell(productId, 6);
    expect(line(ticket.id)).toMatchObject({ inventoryCostCents: 100, cogsCostCents: 0 });
    expect(carrying(productId, lotId)).toEqual({ quantity: 0, inventory: 0, cogs: 0 });
    await caller().sales.returnSale({
      id: ticket.id,
      items: [{ saleItemId: line(ticket.id).id, quantity: 2 }],
      reason: 'Separate cost bases',
    });
    expect(carrying(productId, lotId)).toEqual({ quantity: 2, inventory: 33, cogs: 0 });
    await caller().sales.returnSale({ id: ticket.id, reason: 'Remaining separate cost bases' });
    expect(carrying(productId, lotId)).toEqual({ quantity: 6, inventory: 100, cogs: 0 });
  });

  it('audits deliberate purchase revaluation before adding received stock', async () => {
    const { productId, lotId } = await transformed(false);
    const db = getDatabase();
    const providerId = nanoid();
    db.insert(providers).values({ id: providerId, tenantId, name: 'Value supplier' }).run();
    const receipt = await caller().purchases.create({
      providerId,
      items: [{ productId, unitId, quantity: 1, costPerUnit: 0.5 }],
    });
    expect(carrying(productId, lotId)).toEqual({ quantity: 4.001, inventory: 200, cogs: 200 });
    const audit = db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceId, productId),
          eq(auditLogs.action, 'inventory.revalue')
        )
      )
      .get()!;
    expect(audit.metadata).toMatchObject({
      source: 'purchase',
      referenceId: receipt.id,
      inventoryDeltaCents: 50,
      cogsDeltaCents: 50,
    });
    const first = await sell(productId, 3.001);
    const last = await sell(productId, 1);
    expect([line(first.id).cogsCostCents, line(last.id).cogsCostCents]).toEqual([150, 50]);
    expect(carrying(productId, lotId)).toEqual({ quantity: 0, inventory: 0, cogs: 0 });
  });

  it('takes the entire lot value when the physical epsilon depletes the last units', async () => {
    const source = await product('High value microscopic remainder', 1, 100_000_000, true);
    const db = getDatabase();
    const result = db.transaction(tx =>
      consumeExactInventoryLots(tx, {
        tenantId,
        siteId,
        productId: source.id,
        allocations: [{ lotId: source.lotId!, quantity: 0.9999999995 }],
        now: new Date().toISOString(),
      })
    );
    expect(result[0]!.totalCost).toBe(100_000_000);
    const lot = db.select().from(inventoryLots).where(eq(inventoryLots.id, source.lotId!)).get()!;
    expect(lot).toMatchObject({
      onHand: 0,
      carryingValueCents: 0,
      valuationQuantity: 0,
      status: 'depleted',
    });
  });
  it('rejects a stale physical/value basis before committing a sale', async () => {
    const { productId } = await transformed(false);
    const db = getDatabase();
    db.update(inventoryBalances)
      .set({ onHand: 4 })
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, siteId),
          eq(inventoryBalances.productId, productId)
        )
      )
      .run();
    await expect(sell(productId, 1)).rejects.toMatchObject({
      code: 'CONFLICT',
      cause: { errorCode: 'INVENTORY_VALUE_CHANGED' },
    });
    expect(
      db.select().from(saleItems).where(eq(saleItems.productId, productId)).all()
    ).toHaveLength(0);
    expect(
      db
        .select()
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.tenantId, tenantId),
            eq(inventoryMovements.productId, productId),
            eq(inventoryMovements.type, 'sale')
          )
        )
        .all()
    ).toHaveLength(0);
    expect(
      db
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, siteId),
            eq(inventoryBalances.productId, productId)
          )
        )
        .get()?.onHand
    ).toBe(4);
  });
  it('does not overwrite a purchase repricing while an unrelated catalog edit is awaiting reads', async () => {
    const { productId, lotId } = await transformed(false);
    const db = getDatabase();
    const current = db.select().from(products).where(eq(products.id, productId)).get()!;
    const providerId = nanoid();
    db.insert(providers).values({ id: providerId, tenantId, name: 'Concurrent supplier' }).run();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const original = productMutationHelpers.getExistingUnitAssignments;
    const readBarrier = vi
      .spyOn(productMutationHelpers, 'getExistingUnitAssignments')
      .mockImplementationOnce(async (...args) => {
        entered.resolve();
        await release.promise;
        return original(...args);
      });
    try {
      const edit = caller().products.update({
        id: productId,
        version: current.version,
        name: 'Unrelated pending name',
      });
      const outcome = edit.then(
        value => ({ value, error: null }),
        error => ({ value: null, error })
      );
      await entered.promise;
      await caller().purchases.create({
        providerId,
        items: [{ productId, unitId, quantity: 1, costPerUnit: 0.5 }],
      });
      release.resolve();
      expect((await outcome).error).toMatchObject({
        code: 'CONFLICT',
        cause: { errorCode: 'INVENTORY_VALUE_CHANGED' },
      });
      const after = db.select().from(products).where(eq(products.id, productId)).get()!;
      expect(after).toMatchObject({
        cost: 0.5,
        initialCost: 0.5,
        name: current.name,
        version: current.version + 1,
      });
      expect(carrying(productId, lotId)).toEqual({ quantity: 4.001, inventory: 200, cogs: 200 });
      const events = db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.resourceId, productId),
            eq(auditLogs.action, 'inventory.revalue')
          )
        )
        .all();
      expect(events).toHaveLength(1);
      expect(events[0]!.metadata).toMatchObject({ source: 'purchase' });
      await expect(
        caller().products.update({
          id: productId,
          version: current.version,
          name: 'Stale client form',
          cost: current.cost,
        })
      ).rejects.toMatchObject({ cause: { errorCode: 'STALE_VERSION' } });
      expect(carrying(productId, lotId)).toEqual({ quantity: 4.001, inventory: 200, cogs: 200 });
    } finally {
      release.resolve();
      readBarrier.mockRestore();
    }
  });

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    'preserves supplier receipt value through base-unit conversion (lots=%s, order=%s)',
    async (tracksLots, fromOrder) => {
      const db = getDatabase();
      const target = await product('Case of three', 0, 0, tracksLots);
      const providerId = nanoid();
      db.insert(providers)
        .values({ id: providerId, tenantId, name: `Exact supplier ${nanoid()}` })
        .run();
      const caseUnitId = nanoid();
      db.insert(units)
        .values({ id: caseUnitId, tenantId, name: `Case ${nanoid()}`, abbreviation: nanoid() })
        .run();
      db.insert(unitXProduct)
        .values({
          id: nanoid(),
          productId: target.id,
          unitId: caseUnitId,
          equivalence: 3,
          price: 300,
          isBase: false,
        })
        .run();
      const lotReceipts = tracksLots ? [{ lotNumber: nanoid(), baseQuantity: 3 }] : undefined;
      const order = fromOrder
        ? await caller().orders.create({
            providerId,
            items: [{ productId: target.id, unitId: caseUnitId, quantity: 1, costPerUnit: 1 }],
          })
        : null;
      const receipt = order
        ? await caller().purchases.createFromOrder({
            orderId: order.id,
            items: [
              {
                orderItemId: order.items[0]!.id,
                quantity: 1,
                ...(lotReceipts ? { lotReceipts } : {}),
              },
            ],
          })
        : await caller().purchases.create({
            providerId,
            items: [
              {
                productId: target.id,
                unitId: caseUnitId,
                quantity: 1,
                costPerUnit: 1,
                ...(lotReceipts ? { lotReceipts } : {}),
              },
            ],
          });
      const lotId = tracksLots
        ? db.select().from(inventoryLots).where(eq(inventoryLots.productId, target.id)).get()!.id
        : null;
      expect(receipt.total).toBe(1);
      expect(carrying(target.id, lotId)).toEqual({ quantity: 3, inventory: 100, cogs: 100 });
      const movement = db
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.reference, receipt.id))
        .get()!;
      expect(movement).toMatchObject({ inventoryValueDeltaCents: 100, cogsValueDeltaCents: 100 });
    }
  );

  it('allocates one receipt cent across two fractional lots without creating another cent', async () => {
    const db = getDatabase();
    const target = await product('Tiny receipts', 0, 0, true);
    const providerId = nanoid();
    db.insert(providers).values({ id: providerId, tenantId, name: 'Tiny supplier' }).run();
    const receipt = await caller().purchases.create({
      providerId,
      items: [
        {
          productId: target.id,
          unitId,
          quantity: 0.01,
          costPerUnit: 1,
          lotReceipts: [
            { lotNumber: nanoid(), baseQuantity: 0.005 },
            { lotNumber: nanoid(), baseQuantity: 0.005 },
          ],
        },
      ],
    });
    expect(receipt.total).toBe(0.01);
    const lots = db
      .select()
      .from(inventoryLots)
      .where(eq(inventoryLots.productId, target.id))
      .all();
    expect(lots.map(lot => lot.carryingValueCents).sort()).toEqual([0, 1]);
  });

  it('freezes actual supplier return/void debits after fractional transformation', async () => {
    const tracksLots = false;
    for (const operation of ['return', 'void'] as const) {
      const db = getDatabase();
      const target = await product('Return transformed stock', 0, 0, tracksLots);
      const providerId = nanoid();
      const lotNumber = nanoid();
      db.insert(providers)
        .values({ id: providerId, tenantId, name: `Return supplier ${nanoid()}` })
        .run();
      const receipt = await caller().purchases.create({
        providerId,
        items: [
          {
            productId: target.id,
            unitId,
            quantity: 3.001,
            costPerUnit: 0.33,
            ...(tracksLots ? { lotReceipts: [{ lotNumber, baseQuantity: 3.001 }] } : {}),
          },
        ],
      });
      const purchaseItem = db
        .select()
        .from(purchaseItems)
        .where(eq(purchaseItems.purchaseId, receipt.id))
        .get()!;
      const receiptLot = db
        .select()
        .from(purchaseItemLots)
        .where(eq(purchaseItemLots.purchaseItemId, purchaseItem.id))
        .get();
      const { lotId } = await transformed(tracksLots, 3.001, { id: target.id, lotNumber });
      expect(carrying(target.id, lotId)).toEqual({ quantity: 6.002, inventory: 199, cogs: 199 });
      if (operation === 'return') {
        await caller().purchases.returnPurchase({
          id: receipt.id,
          items: [
            {
              purchaseItemId: purchaseItem.id,
              quantity: 3.001,
              ...(receiptLot
                ? { lotAllocations: [{ purchaseItemLotId: receiptLot.id, baseQuantity: 3.001 }] }
                : {}),
            },
          ],
        });
        // Supplier settlement stays the original invoice amount, independent of current carrying value.
        const returned = db
          .select()
          .from(purchaseReturnItems)
          .where(eq(purchaseReturnItems.purchaseItemId, purchaseItem.id))
          .get()!;
        expect(returned).toMatchObject({
          total: 0.99,
          inventoryValueCents: 100,
          cogsValueCents: 100,
        });
      } else await caller().purchases.void({ id: receipt.id });
      expect(carrying(target.id, lotId)).toEqual({ quantity: 3.001, inventory: 99, cogs: 99 });
      const movement = db
        .select()
        .from(inventoryMovements)
        .where(
          and(eq(inventoryMovements.productId, target.id), eq(inventoryMovements.type, 'return'))
        )
        .get()!;
      expect(movement).toMatchObject({ inventoryValueDeltaCents: -100, cogsValueDeltaCents: -100 });
    }
  });

  it.each(['return', 'void'] as const)(
    'freezes the last carrying cent of a lot purchase %s',
    async operation => {
      const db = getDatabase();
      const target = await product('Lot case of fractions', 0, 0, true);
      const providerId = nanoid();
      db.insert(providers).values({ id: providerId, tenantId, name: nanoid() }).run();
      const caseUnitId = nanoid();
      db.insert(units)
        .values({ id: caseUnitId, tenantId, name: nanoid(), abbreviation: nanoid() })
        .run();
      db.insert(unitXProduct)
        .values({
          id: nanoid(),
          productId: target.id,
          unitId: caseUnitId,
          equivalence: 3.001,
          price: 300,
          isBase: false,
        })
        .run();
      const receipt = await caller().purchases.create({
        providerId,
        items: [
          {
            productId: target.id,
            unitId: caseUnitId,
            quantity: 1,
            costPerUnit: 1,
            lotReceipts: [{ lotNumber: nanoid(), baseQuantity: 3.001 }],
          },
        ],
      });
      const item = db
        .select()
        .from(purchaseItems)
        .where(eq(purchaseItems.purchaseId, receipt.id))
        .get()!;
      const receiptLot = db
        .select()
        .from(purchaseItemLots)
        .where(eq(purchaseItemLots.purchaseItemId, item.id))
        .get()!;
      expect(receiptLot.totalCostCents).toBe(100);
      if (operation === 'return') {
        await caller().purchases.returnPurchase({
          id: receipt.id,
          items: [
            {
              purchaseItemId: item.id,
              quantity: 1,
              lotAllocations: [{ purchaseItemLotId: receiptLot.id, baseQuantity: 3.001 }],
            },
          ],
        });
        expect(
          db
            .select()
            .from(purchaseReturnItems)
            .where(eq(purchaseReturnItems.purchaseItemId, item.id))
            .get()
        ).toMatchObject({ inventoryValueCents: 100, cogsValueCents: 100, total: 1 });
        expect(
          db
            .select()
            .from(purchaseReturnItemLots)
            .where(eq(purchaseReturnItemLots.purchaseItemLotId, receiptLot.id))
            .get()!.totalCostCents
        ).toBe(100);
      } else await caller().purchases.void({ id: receipt.id });
      expect(carrying(target.id, receiptLot.inventoryLotId)).toEqual({
        quantity: 0,
        inventory: 0,
        cogs: 0,
      });
      expect(
        db
          .select()
          .from(inventoryMovements)
          .where(
            and(eq(inventoryMovements.productId, target.id), eq(inventoryMovements.type, 'return'))
          )
          .get()
      ).toMatchObject({ inventoryValueDeltaCents: -100, cogsValueDeltaCents: -100 });
    }
  );

  it.each([false, true])(
    'retains the received cent on exact serial returns (order=%s)',
    async fromOrder => {
      const db = getDatabase();
      const target = await product('Serialized case', 0, 0, false);
      db.update(products)
        .set({ tracksSerials: true, sellByFraction: false })
        .where(eq(products.id, target.id))
        .run();
      const providerId = nanoid();
      db.insert(providers).values({ id: providerId, tenantId, name: nanoid() }).run();
      const caseUnitId = nanoid();
      db.insert(units)
        .values({ id: caseUnitId, tenantId, name: nanoid(), abbreviation: nanoid() })
        .run();
      db.insert(unitXProduct)
        .values({
          id: nanoid(),
          productId: target.id,
          unitId: caseUnitId,
          equivalence: 3,
          price: 300,
          isBase: false,
        })
        .run();
      const serialNumbers = [nanoid(), nanoid(), nanoid()];
      const order = fromOrder
        ? await caller().orders.create({
            providerId,
            items: [{ productId: target.id, unitId: caseUnitId, quantity: 1, costPerUnit: 1 }],
          })
        : null;
      const receipt = order
        ? await caller().purchases.createFromOrder({
            orderId: order.id,
            items: [{ orderItemId: order.items[0]!.id, quantity: 1, serialNumbers }],
          })
        : await caller().purchases.create({
            providerId,
            items: [
              {
                productId: target.id,
                unitId: caseUnitId,
                quantity: 1,
                costPerUnit: 1,
                serialNumbers,
              },
            ],
          });
      const item = db
        .select()
        .from(purchaseItems)
        .where(eq(purchaseItems.purchaseId, receipt.id))
        .get()!;
      expect(item).toMatchObject({ inventoryValueCents: 100, cogsValueCents: 100 });
      const serials = db
        .select()
        .from(productSerials)
        .where(eq(productSerials.productId, target.id))
        .all();
      expect(serials.map(serial => serial.unitCost).sort()).toEqual([0.33, 0.33, 0.34]);
      const inventoryValue = () =>
        db
          .select({ value: productInventoryValueSql })
          .from(products)
          .where(and(eq(products.tenantId, tenantId), eq(products.id, target.id)))
          .get()!.value;
      const serialState = () => ({
        serials: db
          .select()
          .from(productSerials)
          .where(eq(productSerials.productId, target.id))
          .all(),
        balances: db
          .select()
          .from(inventoryBalances)
          .where(eq(inventoryBalances.productId, target.id))
          .all(),
        movements: db
          .select()
          .from(inventoryMovements)
          .where(eq(inventoryMovements.productId, target.id))
          .all(),
        returns: db
          .select()
          .from(saleReturnItems)
          .where(eq(saleReturnItems.productId, target.id))
          .all(),
      });
      expect(inventoryValue()).toBe(1);
      const ids = serials.map(row => row.id);
      const draft = await sell(target.id, 3, 'draft', ids);
      expect(line(draft.id)).toMatchObject({ inventoryCostCents: 100, cogsCostCents: 100 });
      expect(inventoryValue()).toBe(0);
      // Registry corruption is rejected atomically, never used to reconstruct sale cost.
      db.update(productSerials).set({ unitCost: 0.44 }).where(eq(productSerials.id, ids[0]!)).run();
      const changedDraft = serialState();
      await expect(caller().sales.discardDraft({ saleId: draft.id })).rejects.toMatchObject({
        cause: { errorCode: 'INVENTORY_VALUE_CHANGED' },
      });
      expect(serialState()).toEqual(changedDraft);
      db.update(productSerials)
        .set({ unitCost: serials[0]!.unitCost })
        .where(eq(productSerials.id, ids[0]!))
        .run();
      await caller().sales.discardDraft({ saleId: draft.id });
      expect(inventoryValue()).toBe(1);
      const sale = await sell(target.id, 3, 'completed', ids);
      expect(line(sale.id)).toMatchObject({ inventoryCostCents: 100, cogsCostCents: 100 });
      expect(inventoryValue()).toBe(0);
      expect(
        db
          .select()
          .from(saleItemSerials)
          .where(eq(saleItemSerials.saleItemId, line(sale.id).id))
          .all()
          .map(row => row.costCents)
          .sort()
      ).toEqual([33, 33, 34]);
      expect(
        computeProfitMarginReport(db, {
          tenantId,
          fromDate: '2000-01-01',
          toDate: '2100-01-01',
          limit: 100,
        }).products.find(row => row.productId === target.id)?.cogs
      ).toBe(1);
      const expensive = serials.find(row => row.unitCost === 0.34)!;
      db.update(productSerials)
        .set({ unitCost: 0.44 })
        .where(eq(productSerials.id, expensive.id))
        .run();
      const changedSale = serialState();
      await expect(
        caller().sales.returnSale({
          id: sale.id,
          items: [{ saleItemId: line(sale.id).id, quantity: 1, serialIds: [expensive.id] }],
          reason: 'Do not reprice a returned serial',
        })
      ).rejects.toMatchObject({ cause: { errorCode: 'INVENTORY_VALUE_CHANGED' } });
      expect(serialState()).toEqual(changedSale);
      db.update(productSerials)
        .set({ unitCost: 0.34 })
        .where(eq(productSerials.id, expensive.id))
        .run();

      await caller().sales.returnSale({
        id: sale.id,
        items: [{ saleItemId: line(sale.id).id, quantity: 1, serialIds: [expensive.id] }],
        reason: 'Return the serial with the residual cent',
      });
      expect(
        db
          .select()
          .from(saleReturnItems)
          .where(eq(saleReturnItems.saleItemId, line(sale.id).id))
          .get()
      ).toMatchObject({ inventoryCostCents: 34, costAmount: 0.34 });
      expect(inventoryValue()).toBe(0.34);
      expect(
        db
          .select()
          .from(saleReturnItemSerials)
          .where(eq(saleReturnItemSerials.productSerialId, expensive.id))
          .get()!.costCents
      ).toBe(34);
      expect(
        computeProfitMarginReport(db, {
          tenantId,
          fromDate: '2000-01-01',
          toDate: '2100-01-01',
          limit: 100,
        }).products.find(row => row.productId === target.id)?.cogs
      ).toBe(0.66);
      await caller().sales.returnSale({
        id: sale.id,
        items: [
          {
            saleItemId: line(sale.id).id,
            quantity: 2,
            serialIds: ids.filter(id => id !== expensive.id),
          },
        ],
        reason: 'Return remaining serialized units',
      });
      expect(inventoryValue()).toBe(1);
      const resale = await sell(target.id, 3, 'completed', ids);
      await caller().sales.void({ id: resale.id, reason: 'Exact serial value void' });
      expect(inventoryValue()).toBe(1);
      const input = {
        id: receipt.id,
        items: [{ purchaseItemId: item.id, quantity: 1, serialIds: serials.map(row => row.id) }],
      };
      await caller().purchases.returnPurchase(input);
      expect(inventoryValue()).toBe(0);
      const snapshot = db
        .select()
        .from(purchaseReturnItems)
        .where(eq(purchaseReturnItems.purchaseItemId, item.id))
        .get()!;
      expect(snapshot).toMatchObject({ inventoryValueCents: 100, cogsValueCents: 100, total: 1 });
      expect(
        db
          .select()
          .from(inventoryMovements)
          .where(
            and(
              eq(inventoryMovements.productId, target.id),
              eq(inventoryMovements.reference, snapshot.purchaseReturnId)
            )
          )
          .get()
      ).toMatchObject({ inventoryValueDeltaCents: -100, cogsValueDeltaCents: -100 });
      await expect(caller().purchases.returnPurchase(input)).rejects.toThrow();
      expect(
        db
          .select()
          .from(purchaseReturnItems)
          .where(eq(purchaseReturnItems.purchaseItemId, item.id))
          .all()
      ).toEqual([snapshot]);
      expect(
        db
          .select()
          .from(productSerials)
          .where(eq(productSerials.productId, target.id))
          .all()
          .every(row => row.status === 'returned_to_supplier')
      ).toBe(true);
    }
  );
  it.each([
    { operation: 'return', cost: 0.33 },
    { operation: 'void', cost: 0.33 },
    { operation: 'return', cost: 0.4 },
    { operation: 'void', cost: 0.4 },
  ])(
    'allows $operation after lot receipts change the rounded average (cost=$cost)',
    async ({ operation, cost }) => {
      const poolCents = 34 + Math.round(cost * 100);
      const debitedCents = Math.round(poolCents / 2);
      const db = getDatabase();
      const target = await product('Residual merged lot', 0, 0, true);
      const providerId = nanoid();
      db.insert(providers).values({ id: providerId, tenantId, name: nanoid() }).run();
      const caseUnitId = nanoid();
      db.insert(units)
        .values({ id: caseUnitId, tenantId, name: nanoid(), abbreviation: nanoid() })
        .run();
      db.insert(unitXProduct)
        .values({
          id: nanoid(),
          productId: target.id,
          unitId: caseUnitId,
          equivalence: 3,
          price: 300,
          isBase: false,
        })
        .run();
      const numbers = [nanoid(), nanoid(), nanoid()];
      await caller().purchases.create({
        providerId,
        items: [
          {
            productId: target.id,
            unitId: caseUnitId,
            quantity: 1,
            costPerUnit: 1,
            lotReceipts: numbers.map(lotNumber => ({ lotNumber, baseQuantity: 1 })),
          },
        ],
      });
      const second = await caller().purchases.create({
        providerId,
        items: [
          {
            productId: target.id,
            unitId,
            quantity: 1,
            costPerUnit: cost,
            lotReceipts: [{ lotNumber: numbers[1]!, baseQuantity: 1 }],
          },
        ],
      });
      const item = db
        .select()
        .from(purchaseItems)
        .where(eq(purchaseItems.purchaseId, second.id))
        .get()!;
      const receiptLot = db
        .select()
        .from(purchaseItemLots)
        .where(eq(purchaseItemLots.purchaseItemId, item.id))
        .get()!;
      expect(
        db.select().from(inventoryLots).where(eq(inventoryLots.id, receiptLot.inventoryLotId)).get()
      ).toMatchObject({ onHand: 2, unitCost: debitedCents / 100, carryingValueCents: poolCents });
      const loaded = await caller().purchases.getById({ id: second.id });
      expect(loaded.items[0]!.returnableQuantity).toBe(1);
      if (operation === 'return') {
        await caller().purchases.returnPurchase({
          id: second.id,
          items: [
            {
              purchaseItemId: item.id,
              quantity: 1,
              lotAllocations: [{ purchaseItemLotId: receiptLot.id, baseQuantity: 1 }],
            },
          ],
        });
        expect(
          db
            .select()
            .from(purchaseReturnItems)
            .where(eq(purchaseReturnItems.purchaseItemId, item.id))
            .get()
        ).toMatchObject({
          total: cost,
          inventoryValueCents: debitedCents,
          cogsValueCents: debitedCents,
        });
      } else await caller().purchases.void({ id: second.id });
      expect(
        db.select().from(inventoryLots).where(eq(inventoryLots.id, receiptLot.inventoryLotId)).get()
      ).toMatchObject({ onHand: 1, carryingValueCents: poolCents - debitedCents });
      expect(
        db
          .select()
          .from(inventoryMovements)
          .where(
            and(eq(inventoryMovements.productId, target.id), eq(inventoryMovements.type, 'return'))
          )
          .get()
      ).toMatchObject({
        inventoryValueDeltaCents: -debitedCents,
        cogsValueDeltaCents: -debitedCents,
      });
    }
  );

  it.each([
    {
      label: 'aggregate to lots',
      previousLots: false,
      tracksLots: true,
      tracksSerials: false,
      tracksStock: true,
    },
    {
      label: 'aggregate to serials',
      previousLots: false,
      tracksLots: false,
      tracksSerials: true,
      tracksStock: true,
    },
    {
      label: 'aggregate to service',
      previousLots: false,
      tracksLots: false,
      tracksSerials: false,
      tracksStock: false,
    },
    {
      label: 'lots to aggregate',
      previousLots: true,
      tracksLots: false,
      tracksSerials: false,
      tracksStock: true,
    },
  ])(
    'preserves a whole cent owned by sub-epsilon stock when changing $label',
    async ({ previousLots, tracksLots, tracksSerials, tracksStock }) => {
      const target = await product('Tiny stock still owns value', 1e-10, 1, previousLots);
      const db = getDatabase();
      if (target.lotId) {
        db.update(inventoryLots)
          .set({ carryingValueCents: 1, valuationQuantity: 1e-10 })
          .where(eq(inventoryLots.id, target.lotId))
          .run();
      } else {
        db.update(products)
          .set({ inventoryValueCents: 1, cogsValueCents: 1, valuationQuantity: 1e-10 })
          .where(eq(products.id, target.id))
          .run();
      }
      await expect(
        caller().products.update({
          id: target.id,
          version: 0,
          tracksLots,
          tracksSerials,
          tracksStock,
          sellByFraction: false,
        })
      ).rejects.toMatchObject({
        cause: { errorCode: 'PRODUCT_TRACKING_REQUIRES_EMPTY_INVENTORY' },
      });
      expect(db.select().from(products).where(eq(products.id, target.id)).get()).toMatchObject({
        tracksStock: true,
        tracksLots: previousLots,
        tracksSerials: false,
        version: 0,
      });
      expect(
        db
          .select({ value: productInventoryValueSql })
          .from(products)
          .where(eq(products.id, target.id))
          .get()
      ).toEqual({ value: 0.01 });
    }
  );
  it.each(['lots', 'serials', 'service'] as const)(
    'allows empty inventory to become %s without adopting another product value',
    async mode => {
      const db = getDatabase();
      const other = await product('Unrelated valued stock', 1, 1, false);
      db.update(products)
        .set({ inventoryValueCents: 100, cogsValueCents: 100, valuationQuantity: 1 })
        .where(eq(products.id, other.id))
        .run();
      const empty = await product('Empty inventory changes mode', 0, 1, false);
      const changed = await caller().products.update({
        id: empty.id,
        version: 0,
        tracksStock: mode !== 'service',
        tracksLots: mode === 'lots',
        tracksSerials: mode === 'serials',
        sellByFraction: false,
      });
      expect(changed).toMatchObject({
        tracksStock: mode !== 'service',
        tracksLots: mode === 'lots',
        tracksSerials: mode === 'serials',
      });
      expect(
        db
          .select({ value: productInventoryValueSql })
          .from(products)
          .where(eq(products.id, other.id))
          .get()
      ).toEqual({ value: 1 });
    }
  );
  it('allows an empty service to become ordinary stock with an explicit receipt', async () => {
    const db = getDatabase();
    const empty = await product('Service becomes ordinary stock', 0, 1, false);
    db.update(products).set({ tracksStock: false }).where(eq(products.id, empty.id)).run();
    const changed = await caller().products.update({
      id: empty.id,
      version: 0,
      tracksStock: true,
      stock: 2,
    });
    expect(changed).toMatchObject({ tracksStock: true, tracksLots: false, tracksSerials: false });
    expect(
      db.select().from(inventoryBalances).where(eq(inventoryBalances.productId, empty.id)).get()
    ).toMatchObject({ onHand: 2 });
    expect(
      db
        .select({ value: productInventoryValueSql })
        .from(products)
        .where(eq(products.id, empty.id))
        .get()
    ).toEqual({ value: 2 });
  });
  it('rounds adopted stock summaries in money units without changing exact pools', async () => {
    const db = getDatabase();
    const prefix = `Exact read ${nanoid()}`;
    for (const cents of [10, 20]) {
      const target = await product(`${prefix} ${cents}`, 1, cents / 100, false);
      db.update(products)
        .set({ inventoryValueCents: cents, cogsValueCents: cents, valuationQuantity: 1 })
        .where(eq(products.id, target.id))
        .run();
    }
    const read = await caller().inventory.listStock({ search: prefix });
    expect(read.items.map(item => item.inventoryValue).sort()).toEqual([0.1, 0.2]);
    expect(read.summary.totalValue).toBe(0.3);
  });
  it.each([0.5, -0.5])('sums rounded legacy rows across pages with stock %s', async quantity => {
    const prefix = `Legacy half-cent ${nanoid()}`;
    for (const suffix of ['a', 'b']) await product(`${prefix} ${suffix}`, quantity, 0.01, false);
    const read = await caller().inventory.listStock({ search: prefix, perPage: 1 });
    expect(read.totalItems).toBe(2);
    expect(read.items).toHaveLength(1);
    expect(read.items[0]!.inventoryValue).toBe(Math.sign(quantity) * 0.01);
    expect(read.summary.totalValue).toBe(Math.sign(quantity) * 0.02);
  });
  it.each(['lots', 'serials', 'service'] as const)(
    'rejects simultaneous anonymous tiny stock when entering %s',
    async mode => {
      const db = getDatabase();
      const empty = await product('Empty expensive inventory', 0, 100000000, false);
      await expect(
        caller().products.update({
          id: empty.id,
          version: 0,
          tracksStock: mode !== 'service',
          tracksLots: mode === 'lots',
          tracksSerials: mode === 'serials',
          sellByFraction: false,
          stock: 1e-10,
        })
      ).rejects.toMatchObject({
        cause: { errorCode: 'PRODUCT_TRACKING_REQUIRES_EMPTY_INVENTORY' },
      });
      expect(db.select().from(products).where(eq(products.id, empty.id)).get()).toMatchObject({
        tracksStock: true,
        tracksLots: false,
        tracksSerials: false,
        version: 0,
      });
      expect(
        db.select().from(inventoryBalances).where(eq(inventoryBalances.productId, empty.id)).get()
      ).toMatchObject({ onHand: 0 });
    }
  );
});
