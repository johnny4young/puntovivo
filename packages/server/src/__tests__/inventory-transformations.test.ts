import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  inventoryBalances,
  inventoryLots,
  inventoryMovements,
  inventoryTransformations,
  pharmacyProductProfiles,
  products,
  sites,
  syncOutbox,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;

function expectErrorCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(TRPCError);
  expect((error as TRPCError).cause).toBeInstanceOf(ServerErrorWithCode);
  expect(((error as TRPCError).cause as ServerErrorWithCode).errorCode).toBe(code);
}

async function createStockProduct(input: {
  name: string;
  cost: number;
  initialCost?: number;
  onHand: number;
  tracksLots?: boolean;
  lot?: {
    lotNumber: string;
    unitCost: number;
    expiresAt?: string | null;
    status?: 'active' | 'expired' | 'quarantined';
  };
}) {
  const db = getDatabase();
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id,
    tenantId,
    name: input.name,
    sku: `TF-${nanoid(8)}`,
    price: 0,
    price2: 0,
    price3: 0,
    cost: input.cost,
    initialCost: input.initialCost ?? input.cost,
    tracksLots: input.tracksLots ?? false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(unitXProduct).values({
    id: nanoid(),
    productId: id,
    unitId: baseUnitId,
    equivalence: 1,
    price: 0,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(inventoryBalances).values({
    id: nanoid(),
    tenantId,
    siteId,
    productId: id,
    onHand: input.onHand,
    reserved: 0,
    version: 0,
    createdAt: now,
    updatedAt: now,
  });
  let lotId: string | null = null;
  if (input.lot) {
    lotId = nanoid();
    await db.insert(inventoryLots).values({
      id: lotId,
      tenantId,
      siteId,
      productId: id,
      lotNumber: input.lot.lotNumber,
      expiresAt: input.lot.expiresAt ?? null,
      onHand: input.onHand,
      unitCost: input.lot.unitCost,
      status: input.lot.status ?? 'active',
      receivedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { id, lotId };
}

function makeForeignContext(): Context {
  const context = fresh();
  const foreignTenantId = nanoid();
  context.tenantId = foreignTenantId;
  context.user = { ...context.user!, tenantId: foreignTenantId };
  context.req.user = { ...context.req.user!, tenantId: foreignTenantId };
  return context;
}

describe('inventory transformations', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const user = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!user) throw new Error('Expected seeded admin');
    tenantId = user.tenantId;
    userId = user.id;
    const site = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!site) throw new Error('Expected seeded site');
    siteId = site.id;
    const baseUnit = (await db.select().from(units).where(eq(units.tenantId, tenantId)).all()).find(
      unit => unit.abbreviation === 'UND'
    );
    if (!baseUnit) throw new Error('Expected seeded base unit');
    baseUnitId = baseUnit.id;
    const device = await registerDeviceService(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'inventory-transformations.test',
    });
    fresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId,
      email: user.email,
      siteId,
      deviceId: device.deviceId,
      defaultRole: 'admin',
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('carries inventory valuation through non-lot output and restores both cost bases', async () => {
    const db = getDatabase();
    const raw = await createStockProduct({
      name: 'Valued raw input',
      cost: 99,
      initialCost: 4,
      onHand: 10,
    });
    const outputName = `Valued transformed output ${nanoid(5)}`;
    const output = await createStockProduct({
      name: outputName,
      cost: 8,
      initialCost: 2,
      onHand: 2,
    });
    const recipe = await appRouter.createCaller(fresh()).inventoryTransformations.createRecipe({
      siteId,
      name: `Valuation recipe ${nanoid(5)}`,
      kind: 'assembly',
      inputs: [{ productId: raw.id, baseQuantity: 2 }],
      outputs: [
        { productId: output.id, expectedBaseQuantity: 2, allocationWeight: 1, role: 'primary' },
      ],
    });

    const executed = await appRouter.createCaller(fresh()).inventoryTransformations.execute({
      recipeId: recipe.id,
      siteId,
      inputs: [{ recipeInputId: recipe.inputs[0]!.id, baseQuantity: 2 }],
      outputs: [{ recipeOutputId: recipe.outputs[0]!.id, baseQuantity: 2 }],
      waste: [],
    });

    expect(executed).toMatchObject({ totalInputCost: 8, totalOutputCost: 8 });
    expect(executed.outputs[0]).toMatchObject({
      unitCost: 4,
      previousProductCost: 8,
      previousProductInitialCost: 2,
      resultingProductCost: 6,
      resultingProductInitialCost: 3,
    });
    const valuedProduct = await db
      .select({ cost: products.cost, initialCost: products.initialCost })
      .from(products)
      .where(eq(products.id, output.id))
      .get();
    expect(valuedProduct).toEqual({ cost: 6, initialCost: 3 });
    const stock = await appRouter.createCaller(fresh()).inventory.listStock({
      page: 1,
      perPage: 20,
      search: outputName,
    });
    expect(stock).toMatchObject({
      summary: { totalUnits: 4, totalValue: 12 },
      items: [{ id: output.id, initialCost: 3, inventoryValue: 12 }],
    });
    expect(
      (
        await db
          .select({ payload: syncOutbox.payload })
          .from(syncOutbox)
          .where(
            and(
              eq(syncOutbox.tenantId, tenantId),
              eq(syncOutbox.entityType, 'products'),
              eq(syncOutbox.entityId, output.id),
              eq(syncOutbox.operation, 'update')
            )
          )
          .all()
      ).map(row => row.payload)
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: output.id, cost: 6, initialCost: 3 })])
    );

    await db.update(products).set({ initialCost: 3.01 }).where(eq(products.id, output.id));
    try {
      await appRouter.createCaller(fresh()).inventoryTransformations.void({
        id: executed.id,
        reason: 'Reject changed valuation basis',
      });
      throw new Error('Expected changed inventory valuation to block reversal');
    } catch (error) {
      expectErrorCode(error, 'TRANSFORMATION_COST_CHANGED');
    }
    expect(
      await db
        .select({ status: inventoryTransformations.status })
        .from(inventoryTransformations)
        .where(eq(inventoryTransformations.id, executed.id))
        .get()
    ).toEqual({ status: 'completed' });
    await db.update(products).set({ initialCost: 3 }).where(eq(products.id, output.id));

    await appRouter.createCaller(fresh()).inventoryTransformations.void({
      id: executed.id,
      reason: 'Reverse valuation proof',
    });
    const restoredProduct = await db
      .select({ cost: products.cost, initialCost: products.initialCost })
      .from(products)
      .where(eq(products.id, output.id))
      .get();
    expect(restoredProduct).toEqual({ cost: 8, initialCost: 2 });
    const restoredStock = await appRouter.createCaller(fresh()).inventory.listStock({
      page: 1,
      perPage: 20,
      search: outputName,
    });
    expect(restoredStock.summary).toMatchObject({ totalUnits: 2, totalValue: 4 });
    expect(
      (
        await db
          .select({ payload: syncOutbox.payload })
          .from(syncOutbox)
          .where(
            and(
              eq(syncOutbox.tenantId, tenantId),
              eq(syncOutbox.entityType, 'products'),
              eq(syncOutbox.entityId, output.id),
              eq(syncOutbox.operation, 'update')
            )
          )
          .all()
      ).map(row => row.payload)
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: output.id,
          cost: 8,
          initialCost: 2,
          reversal: true,
        }),
      ])
    );
  });

  it('weights existing output stock from allocated value before unit-cost quantization', async () => {
    const raw = await createStockProduct({
      name: 'One-cent raw input',
      cost: 50,
      initialCost: 0.01,
      onHand: 1,
    });
    const outputName = `Quantized transformed output ${nanoid(5)}`;
    const output = await createStockProduct({
      name: outputName,
      cost: 0.01,
      initialCost: 0.01,
      onHand: 1,
    });
    const recipe = await appRouter.createCaller(fresh()).inventoryTransformations.createRecipe({
      siteId,
      name: `Quantization recipe ${nanoid(5)}`,
      kind: 'assembly',
      inputs: [{ productId: raw.id, baseQuantity: 1 }],
      outputs: [
        { productId: output.id, expectedBaseQuantity: 3, allocationWeight: 1, role: 'primary' },
      ],
    });

    const executed = await appRouter.createCaller(fresh()).inventoryTransformations.execute({
      recipeId: recipe.id,
      siteId,
      inputs: [{ recipeInputId: recipe.inputs[0]!.id, baseQuantity: 1 }],
      outputs: [{ recipeOutputId: recipe.outputs[0]!.id, baseQuantity: 3 }],
      waste: [],
    });

    expect(executed).toMatchObject({ totalInputCost: 0.01, totalOutputCost: 0.01 });
    expect(executed.outputs[0]).toMatchObject({
      allocatedCost: 0.01,
      unitCost: 0,
      resultingProductCost: 0.01,
      resultingProductInitialCost: 0.01,
    });
    const stock = await appRouter.createCaller(fresh()).inventory.listStock({
      page: 1,
      perPage: 20,
      search: outputName,
    });
    expect(stock).toMatchObject({
      summary: { totalUnits: 4, totalValue: 0.04 },
      items: [{ id: output.id, initialCost: 0.01, inventoryValue: 0.04 }],
    });
  });

  it('distributes frozen cost, records signed movements, and reverses an untouched execution', async () => {
    const raw = await createStockProduct({ name: 'Raw carcass', cost: 4, onHand: 10 });
    const primary = await createStockProduct({ name: 'Primary cut', cost: 2, onHand: 0 });
    const byproduct = await createStockProduct({ name: 'Secondary cut', cost: 1, onHand: 0 });
    const recipe = await appRouter.createCaller(fresh()).inventoryTransformations.createRecipe({
      siteId,
      name: `Butchery yield ${nanoid(5)}`,
      kind: 'disassembly',
      inputs: [{ productId: raw.id, baseQuantity: 10 }],
      outputs: [
        { productId: primary.id, expectedBaseQuantity: 6, allocationWeight: 3, role: 'primary' },
        {
          productId: byproduct.id,
          expectedBaseQuantity: 2,
          allocationWeight: 1,
          role: 'byproduct',
        },
      ],
    });

    const executed = await appRouter.createCaller(fresh()).inventoryTransformations.execute({
      recipeId: recipe.id,
      siteId,
      inputs: [{ recipeInputId: recipe.inputs[0]!.id, baseQuantity: 10 }],
      outputs: [
        { recipeOutputId: recipe.outputs[0]!.id, baseQuantity: 6 },
        { recipeOutputId: recipe.outputs[1]!.id, baseQuantity: 2 },
      ],
      waste: [{ recipeInputId: recipe.inputs[0]!.id, baseQuantity: 2, reason: 'Trim loss' }],
    });

    expect(executed).toMatchObject({
      status: 'completed',
      totalInputCost: 40,
      totalOutputCost: 40,
      recipeNameSnapshot: recipe.name,
    });
    expect(executed.outputs.map(output => output.allocatedCost).sort((a, b) => a - b)).toEqual([
      10, 30,
    ]);
    expect(executed.outputs.every(output => output.unitCost === 5)).toBe(true);

    const db = getDatabase();
    const balances = await db
      .select({ productId: inventoryBalances.productId, onHand: inventoryBalances.onHand })
      .from(inventoryBalances)
      .where(and(eq(inventoryBalances.tenantId, tenantId), eq(inventoryBalances.siteId, siteId)))
      .all();
    const onHand = new Map(balances.map(row => [row.productId, row.onHand]));
    expect(onHand.get(raw.id)).toBe(0);
    expect(onHand.get(primary.id)).toBe(6);
    expect(onHand.get(byproduct.id)).toBe(2);
    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.tenantId, tenantId),
          eq(inventoryMovements.reference, executed.id),
          eq(inventoryMovements.type, 'transformation')
        )
      )
      .all();
    expect(movements.map(movement => movement.quantity).sort((a, b) => a - b)).toEqual([-10, 2, 6]);

    const voided = await appRouter.createCaller(fresh()).inventoryTransformations.void({
      id: executed.id,
      reason: 'Yield entry was duplicated',
    });
    expect(voided.status).toBe('voided');
    const voidOutbox = await db
      .select({ payload: syncOutbox.payload })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          eq(syncOutbox.entityType, 'inventory_transformations'),
          eq(syncOutbox.entityId, executed.id),
          eq(syncOutbox.operation, 'update')
        )
      )
      .get();
    expect(voidOutbox?.payload).toMatchObject({
      aggregateVersion: 1,
      id: executed.id,
      status: 'voided',
      voidReason: 'Yield entry was duplicated',
      inputs: [{ id: executed.inputs[0]!.id }],
      outputs: expect.arrayContaining(
        executed.outputs.map(output => expect.objectContaining({ id: output.id }))
      ),
      waste: [{ id: executed.waste[0]!.id }],
    });
    const afterVoid = await db
      .select({ productId: inventoryBalances.productId, onHand: inventoryBalances.onHand })
      .from(inventoryBalances)
      .where(and(eq(inventoryBalances.tenantId, tenantId), eq(inventoryBalances.siteId, siteId)))
      .all();
    const voidedOnHand = new Map(afterVoid.map(row => [row.productId, row.onHand]));
    expect(voidedOnHand.get(raw.id)).toBe(10);
    expect(voidedOnHand.get(primary.id)).toBe(0);
    expect(voidedOnHand.get(byproduct.id)).toBe(0);
    const restoredProducts = await db
      .select({ id: products.id, cost: products.cost, initialCost: products.initialCost })
      .from(products)
      .where(
        and(
          eq(products.tenantId, tenantId),
          sql`${products.id} in (${primary.id}, ${byproduct.id})`
        )
      )
      .all();
    expect(new Map(restoredProducts.map(row => [row.id, [row.cost, row.initialCost]]))).toEqual(
      new Map([
        [primary.id, [2, 2]],
        [byproduct.id, [1, 1]],
      ])
    );
  });

  it('conserves tiny costs across many outputs and rejects an ABA product-cost change', async () => {
    const raw = await createStockProduct({ name: 'Tiny-cost input', cost: 0.02, onHand: 1 });
    const outputProducts = [];
    for (let index = 0; index < 4; index += 1) {
      outputProducts.push(
        await createStockProduct({ name: `Tiny-cost output ${index + 1}`, cost: 0, onHand: 0 })
      );
    }
    const recipe = await appRouter.createCaller(fresh()).inventoryTransformations.createRecipe({
      name: `Tiny-cost split ${nanoid(5)}`,
      kind: 'disassembly',
      inputs: [{ productId: raw.id, baseQuantity: 1 }],
      outputs: outputProducts.map(product => ({
        productId: product.id,
        expectedBaseQuantity: 1,
        allocationWeight: 1,
        role: 'primary' as const,
      })),
    });
    const execution = await appRouter.createCaller(fresh()).inventoryTransformations.execute({
      recipeId: recipe.id,
      siteId,
      inputs: [{ recipeInputId: recipe.inputs[0]!.id, baseQuantity: 1 }],
      outputs: recipe.outputs.map(output => ({
        recipeOutputId: output.id,
        baseQuantity: 1,
      })),
      waste: [],
    });

    expect(execution.outputs.map(output => output.allocatedCost).sort((a, b) => a - b)).toEqual([
      0, 0, 0.01, 0.01,
    ]);
    expect(execution.outputs.reduce((sum, output) => sum + output.allocatedCost, 0)).toBeCloseTo(
      0.02,
      10
    );

    const changedOutput = execution.outputs[0]!;
    const db = getDatabase();
    await db
      .update(products)
      .set({
        cost: changedOutput.resultingProductCost + 1,
        syncVersion: sql`${products.syncVersion} + 1`,
      })
      .where(eq(products.id, changedOutput.productId));
    await db
      .update(products)
      .set({
        cost: changedOutput.resultingProductCost,
        syncVersion: sql`${products.syncVersion} + 1`,
      })
      .where(eq(products.id, changedOutput.productId));

    try {
      await appRouter.createCaller(fresh()).inventoryTransformations.void({
        id: execution.id,
        reason: 'Attempt after cost ABA change',
      });
      throw new Error('Expected an ABA product cost change to block reversal');
    } catch (error) {
      expectErrorCode(error, 'TRANSFORMATION_COST_CHANGED');
    }
    expect(
      await db
        .select({ status: inventoryTransformations.status })
        .from(inventoryTransformations)
        .where(eq(inventoryTransformations.id, execution.id))
        .get()
    ).toEqual({ status: 'completed' });
  });

  it('rejects a transformation whose exact-cent allocation would overflow', async () => {
    const raw = await createStockProduct({
      name: 'Oversized-cost input',
      cost: 90_000_000_000_000,
      onHand: 2,
    });
    const output = await createStockProduct({ name: 'Protected output', cost: 0, onHand: 0 });
    const recipe = await appRouter.createCaller(fresh()).inventoryTransformations.createRecipe({
      name: `Oversized cost ${nanoid(5)}`,
      kind: 'assembly',
      inputs: [{ productId: raw.id, baseQuantity: 2 }],
      outputs: [
        { productId: output.id, expectedBaseQuantity: 1, allocationWeight: 1, role: 'primary' },
      ],
    });
    const beforeCount = await getDatabase()
      .select({ count: sql<number>`count(*)` })
      .from(inventoryTransformations)
      .get();

    try {
      await appRouter.createCaller(fresh()).inventoryTransformations.execute({
        recipeId: recipe.id,
        siteId,
        inputs: [{ recipeInputId: recipe.inputs[0]!.id, baseQuantity: 2 }],
        outputs: [{ recipeOutputId: recipe.outputs[0]!.id, baseQuantity: 1 }],
        waste: [],
      });
      throw new Error('Expected out-of-range transformation cost rejection');
    } catch (error) {
      expectErrorCode(error, 'TRANSFORMATION_COST_OUT_OF_RANGE');
    }

    const balances = await getDatabase()
      .select({ productId: inventoryBalances.productId, onHand: inventoryBalances.onHand })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, siteId),
          sql`${inventoryBalances.productId} in (${raw.id}, ${output.id})`
        )
      )
      .all();
    expect(new Map(balances.map(row => [row.productId, row.onHand]))).toEqual(
      new Map([
        [raw.id, 2],
        [output.id, 0],
      ])
    );
    expect(
      await getDatabase()
        .select({ count: sql<number>`count(*)` })
        .from(inventoryTransformations)
        .get()
    ).toEqual(beforeCount);
  });

  it('never treats stock held at another site as available at a missing primary-site balance', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const primarySite = await db
      .select({ companyId: sites.companyId })
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.id, siteId)))
      .get();
    if (!primarySite) throw new Error('Expected primary site company');
    const remoteSiteId = nanoid();
    await db.insert(sites).values({
      id: remoteSiteId,
      tenantId,
      companyId: primarySite.companyId,
      name: `Remote transformation stock ${nanoid(5)}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const remoteOnlyInput = await createStockProduct({
      name: 'Remote-only transformation input',
      cost: 5,
      onHand: 5,
    });
    await db
      .update(inventoryBalances)
      .set({ siteId: remoteSiteId })
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, siteId),
          eq(inventoryBalances.productId, remoteOnlyInput.id)
        )
      );
    const localOutput = await createStockProduct({
      name: 'Local protected transformation output',
      cost: 0,
      onHand: 0,
    });
    const recipe = await appRouter.createCaller(fresh()).inventoryTransformations.createRecipe({
      siteId,
      name: `Site stock isolation ${nanoid(5)}`,
      kind: 'assembly',
      inputs: [{ productId: remoteOnlyInput.id, baseQuantity: 1 }],
      outputs: [
        {
          productId: localOutput.id,
          expectedBaseQuantity: 1,
          allocationWeight: 1,
          role: 'primary',
        },
      ],
    });
    const beforeCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(inventoryTransformations)
      .get();

    try {
      await appRouter.createCaller(fresh()).inventoryTransformations.execute({
        recipeId: recipe.id,
        siteId,
        inputs: [{ recipeInputId: recipe.inputs[0]!.id, baseQuantity: 1 }],
        outputs: [{ recipeOutputId: recipe.outputs[0]!.id, baseQuantity: 1 }],
        waste: [],
      });
      throw new Error('Expected remote-only stock to be unavailable at the primary site');
    } catch (error) {
      expectErrorCode(error, 'TRANSFORMATION_INSUFFICIENT_STOCK');
    }

    expect(
      await db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, siteId),
            eq(inventoryBalances.productId, remoteOnlyInput.id)
          )
        )
        .get()
    ).toBeUndefined();
    expect(
      await db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, remoteSiteId),
            eq(inventoryBalances.productId, remoteOnlyInput.id)
          )
        )
        .get()
    ).toEqual({ onHand: 5 });
    expect(
      await db
        .select({ count: sql<number>`count(*)` })
        .from(inventoryTransformations)
        .get()
    ).toEqual(beforeCount);
  });

  it('keeps pharmacy products outside ordinary transformation recipes and executions', async () => {
    const db = getDatabase();
    const medicine = await createStockProduct({
      name: 'Regulated transformation input',
      cost: 15,
      onHand: 5,
      tracksLots: true,
      lot: { lotNumber: `MED-${nanoid(5)}`, unitCost: 15 },
    });
    const output = await createStockProduct({
      name: 'Ordinary transformation output',
      cost: 0,
      onHand: 0,
    });
    const recipe = await appRouter.createCaller(fresh()).inventoryTransformations.createRecipe({
      name: `Pre-profile recipe ${nanoid(5)}`,
      kind: 'recipe',
      inputs: [{ productId: medicine.id, baseQuantity: 1 }],
      outputs: [
        { productId: output.id, expectedBaseQuantity: 1, allocationWeight: 1, role: 'primary' },
      ],
    });

    const now = new Date().toISOString();
    await db.insert(pharmacyProductProfiles).values({
      productId: medicine.id,
      tenantId,
      classification: 'otc',
      requiresColdChain: false,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await appRouter.createCaller(fresh()).inventoryTransformations.createRecipe({
        name: `Blocked medicine recipe ${nanoid(5)}`,
        kind: 'recipe',
        inputs: [{ productId: medicine.id, baseQuantity: 1 }],
        outputs: [
          { productId: output.id, expectedBaseQuantity: 1, allocationWeight: 1, role: 'primary' },
        ],
      });
      throw new Error('Expected medicine recipe creation to fail closed');
    } catch (error) {
      expectErrorCode(error, 'TRANSFORMATION_PHARMACY_UNSUPPORTED');
    }

    const transformationCountBefore = await db
      .select({ count: sql<number>`count(*)` })
      .from(inventoryTransformations)
      .get();
    const movementCountBefore = await db
      .select({ count: sql<number>`count(*)` })
      .from(inventoryMovements)
      .get();

    try {
      await appRouter.createCaller(fresh()).inventoryTransformations.execute({
        recipeId: recipe.id,
        siteId,
        inputs: [
          {
            recipeInputId: recipe.inputs[0]!.id,
            baseQuantity: 1,
            lotAllocations: [{ lotId: medicine.lotId!, baseQuantity: 1 }],
          },
        ],
        outputs: [{ recipeOutputId: recipe.outputs[0]!.id, baseQuantity: 1 }],
        waste: [],
      });
      throw new Error('Expected a newly regulated recipe execution to fail closed');
    } catch (error) {
      expectErrorCode(error, 'TRANSFORMATION_PHARMACY_UNSUPPORTED');
    }

    expect(
      await db
        .select({ count: sql<number>`count(*)` })
        .from(inventoryTransformations)
        .get()
    ).toEqual(transformationCountBefore);
    expect(
      await db
        .select({ count: sql<number>`count(*)` })
        .from(inventoryMovements)
        .get()
    ).toEqual(movementCountBefore);
    expect(
      await db
        .select({ onHand: inventoryLots.onHand })
        .from(inventoryLots)
        .where(eq(inventoryLots.id, medicine.lotId!))
        .get()
    ).toEqual({ onHand: 5 });
    expect(
      await db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, siteId),
            eq(inventoryBalances.productId, output.id)
          )
        )
        .get()
    ).toEqual({ onHand: 0 });
  });

  it('freezes exact input/output lots, is idempotent, and rejects non-vendable input', async () => {
    const raw = await createStockProduct({
      name: 'Tracked raw material',
      cost: 12,
      onHand: 10,
      tracksLots: true,
      lot: { lotNumber: `RAW-${nanoid(5)}`, unitCost: 12 },
    });
    const output = await createStockProduct({
      name: 'Tracked prepared batch',
      cost: 0,
      onHand: 0,
      tracksLots: true,
    });
    const recipe = await appRouter.createCaller(fresh()).inventoryTransformations.createRecipe({
      name: `Tracked recipe ${nanoid(5)}`,
      kind: 'recipe',
      inputs: [{ productId: raw.id, baseQuantity: 4 }],
      outputs: [
        { productId: output.id, expectedBaseQuantity: 3, allocationWeight: 1, role: 'primary' },
      ],
    });
    const envelope = {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    };
    const payload = {
      recipeId: recipe.id,
      siteId,
      inputs: [
        {
          recipeInputId: recipe.inputs[0]!.id,
          baseQuantity: 4,
          lotAllocations: [{ lotId: raw.lotId!, baseQuantity: 4 }],
        },
      ],
      outputs: [
        {
          recipeOutputId: recipe.outputs[0]!.id,
          baseQuantity: 3,
          lot: { lotNumber: `OUT-${nanoid(5)}`, expiresAt: null },
        },
      ],
      waste: [
        {
          recipeInputId: recipe.inputs[0]!.id,
          lotId: raw.lotId!,
          baseQuantity: 1,
          reason: 'Preparation loss',
        },
      ],
    };
    const first = await appRouter
      .createCaller(fresh({ envelope }))
      .inventoryTransformations.execute(payload);
    const replay = await appRouter
      .createCaller(fresh({ envelope }))
      .inventoryTransformations.execute(payload);
    expect(replay.id).toBe(first.id);
    expect(first.outputs[0]).toMatchObject({ baseQuantity: 3, allocatedCost: 48, unitCost: 16 });

    const db = getDatabase();
    const transformationOutbox = await db
      .select({ payload: syncOutbox.payload })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          eq(syncOutbox.entityType, 'inventory_transformations'),
          eq(syncOutbox.entityId, first.id),
          eq(syncOutbox.operation, 'create')
        )
      )
      .get();
    const transformationSnapshot = transformationOutbox?.payload as
      | {
          aggregateVersion: number;
          status: string;
          inputs: Array<Record<string, unknown>>;
          outputs: Array<Record<string, unknown>>;
          waste: Array<Record<string, unknown>>;
        }
      | undefined;
    expect(transformationSnapshot).toMatchObject({
      aggregateVersion: 1,
      status: 'completed',
      inputs: [
        {
          id: expect.any(String),
          lotId: raw.lotId,
          lotNumberSnapshot: expect.stringMatching(/^RAW-/),
          expiresAtSnapshot: null,
          sourceStatusSnapshot: 'active',
          baseQuantity: 4,
          unitCost: 12,
          totalCost: 48,
        },
      ],
      outputs: [
        {
          id: expect.any(String),
          lotId: first.outputs[0]!.lotId,
          baseQuantity: 3,
          allocatedCost: 48,
          unitCost: 16,
          previousProductCost: 0,
          previousProductInitialCost: 0,
          resultingProductCost: 16,
          resultingProductInitialCost: 16,
          resultingProductSyncVersion: expect.any(Number),
          resultingBalanceVersion: expect.any(Number),
        },
      ],
      waste: [{ id: expect.any(String), baseQuantity: 1, reason: 'Preparation loss' }],
    });
    expect(transformationSnapshot?.waste[0]?.transformationInputId).toBe(
      transformationSnapshot?.inputs[0]?.id
    );
    const rawLot = await db
      .select()
      .from(inventoryLots)
      .where(eq(inventoryLots.id, raw.lotId!))
      .get();
    const outputLot = await db
      .select()
      .from(inventoryLots)
      .where(eq(inventoryLots.id, first.outputs[0]!.lotId!))
      .get();
    expect(rawLot?.onHand).toBe(6);
    expect(outputLot).toMatchObject({ onHand: 3, unitCost: 16, status: 'active' });
    expect(first.inputs[0]).toMatchObject({
      lotId: raw.lotId,
      lotNumber: rawLot?.lotNumber,
      expiresAt: null,
      sourceStatus: 'active',
    });
    const executions = await db
      .select({ id: inventoryTransformations.id })
      .from(inventoryTransformations)
      .where(eq(inventoryTransformations.id, first.id))
      .all();
    expect(executions).toHaveLength(1);

    await db
      .update(inventoryLots)
      .set({ expiresAt: '2035-01-01' })
      .where(eq(inventoryLots.id, raw.lotId!));
    try {
      await appRouter.createCaller(fresh()).inventoryTransformations.void({
        id: first.id,
        reason: 'Attempt after input identity change',
      });
      throw new Error('Expected changed input lot identity to block reversal');
    } catch (error) {
      expectErrorCode(error, 'TRANSFORMATION_INPUT_CHANGED');
    }
    expect(
      await db
        .select({ onHand: inventoryLots.onHand })
        .from(inventoryLots)
        .where(eq(inventoryLots.id, first.outputs[0]!.lotId!))
        .get()
    ).toEqual({ onHand: 3 });
    await db.update(inventoryLots).set({ expiresAt: null }).where(eq(inventoryLots.id, raw.lotId!));

    await db
      .update(inventoryLots)
      .set({ status: 'quarantined' })
      .where(eq(inventoryLots.id, first.outputs[0]!.lotId!));
    try {
      await appRouter.createCaller(fresh()).inventoryTransformations.void({
        id: first.id,
        reason: 'Attempt after output quarantine',
      });
      throw new Error('Expected quarantined output lot to block reversal');
    } catch (error) {
      expectErrorCode(error, 'TRANSFORMATION_OUTPUT_CONSUMED');
    }
    const quarantinedOutput = await db
      .select({ onHand: inventoryLots.onHand, status: inventoryLots.status })
      .from(inventoryLots)
      .where(eq(inventoryLots.id, first.outputs[0]!.lotId!))
      .get();
    expect(quarantinedOutput).toEqual({ onHand: 3, status: 'quarantined' });
    expect(
      await db
        .select({ status: inventoryTransformations.status })
        .from(inventoryTransformations)
        .where(eq(inventoryTransformations.id, first.id))
        .get()
    ).toEqual({ status: 'completed' });

    await db
      .update(inventoryLots)
      .set({ status: 'quarantined' })
      .where(eq(inventoryLots.id, raw.lotId!));
    try {
      await appRouter.createCaller(fresh()).inventoryTransformations.execute({
        ...payload,
        outputs: [
          {
            ...payload.outputs[0]!,
            lot: { lotNumber: `OUT-${nanoid(5)}`, expiresAt: null },
          },
        ],
      });
      throw new Error('Expected quarantined lot rejection');
    } catch (error) {
      expectErrorCode(error, 'TRANSFORMATION_LOT_NOT_VENDABLE');
    }
    const unchangedRawLot = await db
      .select()
      .from(inventoryLots)
      .where(eq(inventoryLots.id, raw.lotId!))
      .get();
    expect(unchangedRawLot).toMatchObject({ onHand: 6, status: 'quarantined' });
  });

  it('fails closed when later output activity invalidates reversal provenance', async () => {
    const raw = await createStockProduct({ name: 'Roll stock', cost: 8, onHand: 5 });
    const cut = await createStockProduct({ name: 'Cut length', cost: 0, onHand: 0 });
    const recipe = await appRouter.createCaller(fresh()).inventoryTransformations.createRecipe({
      name: `Cut recipe ${nanoid(5)}`,
      kind: 'cut',
      inputs: [{ productId: raw.id, baseQuantity: 2 }],
      outputs: [
        { productId: cut.id, expectedBaseQuantity: 2, allocationWeight: 1, role: 'primary' },
      ],
    });
    const execution = await appRouter.createCaller(fresh()).inventoryTransformations.execute({
      recipeId: recipe.id,
      siteId,
      inputs: [{ recipeInputId: recipe.inputs[0]!.id, baseQuantity: 2 }],
      outputs: [{ recipeOutputId: recipe.outputs[0]!.id, baseQuantity: 2 }],
      waste: [],
    });
    await getDatabase()
      .update(inventoryBalances)
      .set({
        onHand: sql`${inventoryBalances.onHand} + 1`,
        version: sql`${inventoryBalances.version} + 1`,
      })
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, siteId),
          eq(inventoryBalances.productId, cut.id)
        )
      );
    try {
      await appRouter.createCaller(fresh()).inventoryTransformations.void({
        id: execution.id,
        reason: 'Attempt after later receipt',
      });
      throw new Error('Expected reversal to fail closed');
    } catch (error) {
      expectErrorCode(error, 'TRANSFORMATION_OUTPUT_CONSUMED');
    }
    const persisted = await getDatabase()
      .select()
      .from(inventoryTransformations)
      .where(eq(inventoryTransformations.id, execution.id))
      .get();
    expect(persisted?.status).toBe('completed');
  });

  it('fails closed when a frozen output expires before its reversal', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2030-01-01T12:00:00.000Z'));
      const raw = await createStockProduct({ name: 'Expiring input', cost: 3, onHand: 1 });
      const output = await createStockProduct({
        name: 'Expiring output',
        cost: 0,
        onHand: 0,
        tracksLots: true,
      });
      const recipe = await appRouter.createCaller(fresh()).inventoryTransformations.createRecipe({
        name: `Expiring recipe ${nanoid(5)}`,
        kind: 'assembly',
        inputs: [{ productId: raw.id, baseQuantity: 1 }],
        outputs: [
          { productId: output.id, expectedBaseQuantity: 1, allocationWeight: 1, role: 'primary' },
        ],
      });
      const execution = await appRouter.createCaller(fresh()).inventoryTransformations.execute({
        recipeId: recipe.id,
        siteId,
        inputs: [{ recipeInputId: recipe.inputs[0]!.id, baseQuantity: 1 }],
        outputs: [
          {
            recipeOutputId: recipe.outputs[0]!.id,
            baseQuantity: 1,
            lot: { lotNumber: `EXP-${nanoid(5)}`, expiresAt: '2030-01-02' },
          },
        ],
        waste: [],
      });
      expect(
        await getDatabase()
          .select({ status: inventoryLots.status })
          .from(inventoryLots)
          .where(eq(inventoryLots.id, execution.outputs[0]!.lotId!))
          .get()
      ).toEqual({ status: 'active' });

      vi.setSystemTime(new Date('2030-01-03T12:00:00.000Z'));
      try {
        await appRouter.createCaller(fresh()).inventoryTransformations.void({
          id: execution.id,
          reason: 'Attempt after calendar expiry',
        });
        throw new Error('Expected elapsed output expiry to block reversal');
      } catch (error) {
        expectErrorCode(error, 'TRANSFORMATION_OUTPUT_CONSUMED');
      }
      expect(
        await getDatabase()
          .select({ status: inventoryTransformations.status })
          .from(inventoryTransformations)
          .where(eq(inventoryTransformations.id, execution.id))
          .get()
      ).toEqual({ status: 'completed' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('updates a used recipe without mutating execution snapshots and isolates tenant reads', async () => {
    const raw = await createStockProduct({ name: 'Recipe input', cost: 2, onHand: 4 });
    const output = await createStockProduct({ name: 'Recipe output', cost: 0, onHand: 0 });
    const originalName = `Versioned recipe ${nanoid(5)}`;
    const recipe = await appRouter.createCaller(fresh()).inventoryTransformations.createRecipe({
      name: originalName,
      kind: 'assembly',
      inputs: [{ productId: raw.id, baseQuantity: 2 }],
      outputs: [
        { productId: output.id, expectedBaseQuantity: 1, allocationWeight: 1, role: 'primary' },
      ],
    });
    const execution = await appRouter.createCaller(fresh()).inventoryTransformations.execute({
      recipeId: recipe.id,
      siteId,
      inputs: [{ recipeInputId: recipe.inputs[0]!.id, baseQuantity: 2 }],
      outputs: [{ recipeOutputId: recipe.outputs[0]!.id, baseQuantity: 1 }],
      waste: [],
    });
    const updated = await appRouter.createCaller(fresh()).inventoryTransformations.updateRecipe({
      id: recipe.id,
      version: recipe.version,
      name: `${originalName} v2`,
      kind: 'assembly',
      siteId: null,
      isActive: true,
      inputs: [{ productId: raw.id, baseQuantity: 3 }],
      outputs: [
        { productId: output.id, expectedBaseQuantity: 2, allocationWeight: 1, role: 'primary' },
      ],
    });
    expect(updated.version).toBe(1);
    const boundedRecipes = await appRouter
      .createCaller(fresh())
      .inventoryTransformations.listRecipes({ activeOnly: false, limit: 1 });
    expect(boundedRecipes.items).toHaveLength(1);
    expect(boundedRecipes.hasMore).toBe(true);
    const searchedRecipes = await appRouter
      .createCaller(fresh())
      .inventoryTransformations.listRecipes({
        activeOnly: false,
        limit: 1,
        q: originalName,
      });
    expect(searchedRecipes).toMatchObject({
      hasMore: false,
      items: [{ id: recipe.id, name: `${originalName} v2` }],
    });
    const historical = await appRouter
      .createCaller(fresh())
      .inventoryTransformations.getById({ id: execution.id });
    expect(historical.recipeNameSnapshot).toBe(originalName);
    expect(historical.inputs.every(line => line.recipeInputId === null)).toBe(true);
    expect(historical.outputs.every(line => line.recipeOutputId === null)).toBe(true);

    await expect(
      appRouter
        .createCaller(makeForeignContext())
        .inventoryTransformations.getRecipe({ id: recipe.id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const outbox = await getDatabase()
      .select()
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          eq(syncOutbox.entityType, 'inventory_transformation_recipes'),
          eq(syncOutbox.entityId, recipe.id)
        )
      )
      .all();
    expect(outbox.length).toBeGreaterThanOrEqual(2);
    const updateOutbox = outbox.find(row => row.operation === 'update');
    expect(updateOutbox?.payload).toMatchObject({
      aggregateVersion: 1,
      id: recipe.id,
      version: 1,
      inputs: [
        {
          id: updated.inputs[0]!.id,
          recipeId: recipe.id,
          productId: raw.id,
          baseQuantity: 3,
          position: 0,
        },
      ],
      outputs: [
        {
          id: updated.outputs[0]!.id,
          recipeId: recipe.id,
          productId: output.id,
          expectedBaseQuantity: 2,
          allocationWeight: 1,
          role: 'primary',
          position: 0,
        },
      ],
    });
  });
});
