import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashMovements,
  idempotencyKeys,
  inventoryBalances,
  inventoryLots,
  products,
  saleItems,
  saleItemLots,
  saleReturns,
  sales,
  sites,
  syncOutbox,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { __withExpectedTestLogs } from '../logging/logger.js';
import { freshCriticalContext } from './utils/criticalCommandFixture.js';
import type { CommandEnvelope } from '../trpc/schemas/envelope.js';
import {
  createSaleCompletionCommandResultRef,
  createSaleResourceCommandResultRef,
  createSaleSplitCommandResultRef,
  resolveCommandResultRef,
} from '../services/idempotency/commandResultRef.js';
import { receiveInventoryLot } from '../services/inventory-lots/index.js';

describe('sales transactional command result references', () => {
  let server: PuntovivoServer;
  let tenantId: string;
  let userId: string;
  let siteId: string;
  let deviceId: string;
  let unitId: string;
  let productId: string;

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const user = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!user) throw new Error('Expected seeded administrator');
    tenantId = user.tenantId;
    userId = user.id;

    const site = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!site) throw new Error('Expected seeded site');
    siteId = site.id;

    const unit = await db
      .select()
      .from(units)
      .where(and(eq(units.tenantId, tenantId), eq(units.abbreviation, 'UND')))
      .get();
    if (!unit) throw new Error('Expected seeded base unit');
    unitId = unit.id;

    deviceId = (
      await registerDevice(db, {
        tenantId,
        userId,
        kind: 'web',
        name: 'sales-command-result-ref.test',
      })
    ).deviceId;

    const caller = appRouter.createCaller(context());
    await caller.cashSessions.open({
      registerName: 'Transactional replay register',
      openingFloat: 100,
      denominations: [{ value: 100, count: 1 }],
    });
    const product = await caller.products.create({
      name: 'Transactional replay service',
      sku: `SALE-REPLAY-${randomUUID()}`,
      price: 25,
      tracksStock: false,
      taxRate: 0,
    });
    productId = product.id;
  });

  afterAll(async () => {
    await server.close();
  });

  function context(envelope?: CommandEnvelope, sessionVersion?: number) {
    return freshCriticalContext({
      db: getDatabase(),
      serverApp: server.app,
      tenantId,
      userId,
      email: 'admin@localhost',
      role: 'admin',
      siteId,
      deviceId,
      envelope,
      ...(sessionVersion !== undefined ? { sessionVersion } : {}),
    });
  }

  function envelope(): CommandEnvelope {
    return {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    };
  }

  function installSalesSyncFailure(operation: 'create' | 'update'): () => void {
    const sqlite = (getDatabase() as unknown as { $client: { exec(sql: string): void } }).$client;
    sqlite.exec(`
      CREATE TEMP TRIGGER fail_sale_transactional_sync
      BEFORE INSERT ON sync_outbox
      WHEN NEW.entity_type = 'sales' AND NEW.operation = '${operation}'
      BEGIN
        SELECT RAISE(ABORT, 'forced sale transactional sync failure');
      END;
    `);
    return () => sqlite.exec('DROP TRIGGER fail_sale_transactional_sync');
  }

  function installSaleReturnSyncFailure(): () => void {
    const sqlite = (getDatabase() as unknown as { $client: { exec(sql: string): void } }).$client;
    sqlite.exec(`
      CREATE TEMP TRIGGER fail_sale_return_transactional_sync
      BEFORE INSERT ON sync_outbox
      WHEN NEW.entity_type = 'sale_returns' AND NEW.operation = 'create'
      BEGIN
        SELECT RAISE(ABORT, 'forced sale return transactional sync failure');
      END;
    `);
    return () => sqlite.exec('DROP TRIGGER fail_sale_return_transactional_sync');
  }

  function installInventoryLotSyncFailure(): () => void {
    const sqlite = (getDatabase() as unknown as { $client: { exec(sql: string): void } }).$client;
    sqlite.exec(`
      CREATE TEMP TRIGGER fail_inventory_lot_transactional_sync
      BEFORE INSERT ON sync_outbox
      WHEN NEW.entity_type = 'inventory_lots' AND NEW.operation = 'update'
      BEGIN
        SELECT RAISE(ABORT, 'forced inventory lot transactional sync failure');
      END;
    `);
    return () => sqlite.exec('DROP TRIGGER fail_inventory_lot_transactional_sync');
  }

  async function seedLotTrackedProduct(): Promise<{ productId: string; lotId: string }> {
    const db = getDatabase();
    const createdAt = new Date().toISOString();
    const trackedProductId = randomUUID();
    await db.insert(products).values({
      id: trackedProductId,
      tenantId,
      name: 'Transactional lot replay product',
      sku: `SALE-LOT-REPLAY-${randomUUID()}`,
      price: 25,
      price2: 25,
      price3: 25,
      cost: 10,
      initialCost: 10,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      minStock: 0,
      tracksStock: true,
      tracksLots: true,
      isActive: true,
      createdAt,
      updatedAt: createdAt,
    });
    await db.insert(unitXProduct).values({
      id: randomUUID(),
      productId: trackedProductId,
      unitId,
      equivalence: 1,
      price: 25,
      isBase: true,
      createdAt,
      updatedAt: createdAt,
    });
    await db.insert(inventoryBalances).values({
      id: randomUUID(),
      tenantId,
      siteId,
      productId: trackedProductId,
      onHand: 1,
      reserved: 0,
      createdAt,
      updatedAt: createdAt,
    });
    const lot = receiveInventoryLot(db, {
      tenantId,
      siteId,
      productId: trackedProductId,
      lotNumber: `LOT-REPLAY-${randomUUID()}`,
      expiresAt: null,
      quantity: 1,
      unitCost: 10,
      now: createdAt,
    });
    return { productId: trackedProductId, lotId: lot.lotId };
  }

  it('completes and replays legacy cash commands with a real JWT generation exactly once', async () => {
    const key = envelope();
    const sessionVersion = getDatabase().select().from(users).where(eq(users.id, userId)).get()!
      .sessionVersion;
    const input = { type: 'paid_in' as const, amount: 7, note: 'Legacy JWT regression' };
    const first = await appRouter
      .createCaller(context(key, sessionVersion))
      .cashSessions.recordMovement(input);
    expect(
      await appRouter.createCaller(context(key, sessionVersion)).cashSessions.recordMovement(input)
    ).toEqual(first);
    expect(
      getDatabase().select().from(cashMovements).where(eq(cashMovements.note, input.note)).all()
    ).toHaveLength(1);
  });

  it('refines an ordinary sale to the exact public result and scopes fallback hydration', async () => {
    const commandEnvelope = envelope();
    const input = {
      items: [{ productId, unitId, quantity: 1, unitPrice: 25, discount: 0 }],
      paymentMethod: 'cash' as const,
      paymentStatus: 'paid' as const,
      status: 'completed' as const,
      amountReceived: 30,
    };
    const first = await appRouter.createCaller(context(commandEnvelope)).sales.create(input);
    expect(first.change).toBe(5);
    const storedRef = await getDatabase()
      .select({ resultRef: idempotencyKeys.resultRef })
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.idempotencyKey, commandEnvelope.idempotencyKey))
      .get();
    expect(storedRef?.resultRef).toEqual(first);
    expect(await appRouter.createCaller(context(commandEnvelope)).sales.create(input)).toEqual(
      first
    );

    await expect(
      resolveCommandResultRef(
        getDatabase(),
        randomUUID(),
        createSaleCompletionCommandResultRef({
          saleId: first.id,
          responseShape: 'fresh',
          change: first.change,
          loyaltyPointsEarned: first.loyaltyPointsEarned,
        })
      )
    ).rejects.toMatchObject({ cause: { errorCode: 'SALE_NOT_FOUND' } });
  });

  it('hydrates committed draft lifecycle and split references from tenant-scoped sales', async () => {
    const createDraft = () =>
      appRouter.createCaller(context(envelope())).sales.create({
        items: [{ productId, unitId, quantity: 1, unitPrice: 25, discount: 0 }],
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'draft',
      });
    const source = await createDraft();
    const created = await createDraft();

    await expect(
      resolveCommandResultRef(
        getDatabase(),
        tenantId,
        createSaleResourceCommandResultRef(source.id)
      )
    ).resolves.toMatchObject({ id: source.id, status: 'draft' });
    await expect(
      resolveCommandResultRef(
        getDatabase(),
        tenantId,
        createSaleSplitCommandResultRef(source.id, created.id)
      )
    ).resolves.toMatchObject({
      source: { id: source.id, status: 'draft' },
      created: { id: created.id, status: 'draft' },
    });
    await expect(
      resolveCommandResultRef(
        getDatabase(),
        randomUUID(),
        createSaleSplitCommandResultRef(source.id, created.id)
      )
    ).rejects.toMatchObject({ cause: { errorCode: 'SALE_NOT_FOUND' } });
  });

  it('rolls back draft suspension when its sync intent cannot commit', async () => {
    const draft = await appRouter.createCaller(context(envelope())).sales.create({
      items: [{ productId, unitId, quantity: 1, unitPrice: 25, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
    });
    const commandEnvelope = envelope();
    const removeTrigger = installSalesSyncFailure('update');
    try {
      await expect(
        __withExpectedTestLogs(
          [
            { level: 'error', module: 'trpc-tracing', message: 'trpc procedure error' },
            { level: 'error', module: 'observability', message: 'captured exception' },
          ],
          () =>
            appRouter
              .createCaller(context(commandEnvelope))
              .sales.suspend({ saleId: draft.id, label: 'Atomic draft' })
        )
      ).rejects.toThrow(/forced sale transactional sync failure/);
    } finally {
      removeTrigger();
    }

    expect(
      await getDatabase().select().from(sales).where(eq(sales.id, draft.id)).get()
    ).toMatchObject({ status: 'draft', suspendedAt: null, suspendedBy: null });

    const first = await appRouter
      .createCaller(context(commandEnvelope))
      .sales.suspend({ saleId: draft.id, label: 'Atomic draft' });
    const replay = await appRouter
      .createCaller(context(commandEnvelope))
      .sales.suspend({ saleId: draft.id, label: 'Atomic draft' });
    expect(replay).toEqual(first);
    expect(first).toMatchObject({ suspendedLabel: 'Atomic draft' });
    expect(
      await getDatabase()
        .select({ id: syncOutbox.id })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.entityId, draft.id),
            eq(syncOutbox.idempotencyKey, commandEnvelope.idempotencyKey)
          )
        )
        .all()
    ).toHaveLength(1);
  });

  it('rolls back a draft split with its child, line moves and sequential before replaying once', async () => {
    const source = await appRouter.createCaller(context(envelope())).sales.create({
      items: [
        { productId, unitId, quantity: 1, unitPrice: 25, discount: 0 },
        { productId, unitId, quantity: 1, unitPrice: 25, discount: 0 },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
    });
    await appRouter
      .createCaller(context(envelope()))
      .sales.suspend({ saleId: source.id, label: 'Split replay source' });
    const db = getDatabase();
    const sourceItems = await db
      .select({ id: saleItems.id })
      .from(saleItems)
      .where(eq(saleItems.saleId, source.id))
      .all();
    expect(sourceItems).toHaveLength(2);
    const saleIdsBefore = await db.select({ id: sales.id }).from(sales).all();
    const commandEnvelope = envelope();
    const input = {
      sourceSaleId: source.id,
      saleItemIds: [sourceItems[0]!.id],
      tableId: null,
      label: 'Split replay child',
    };
    const removeTrigger = installSalesSyncFailure('update');
    try {
      await expect(
        __withExpectedTestLogs(
          [
            { level: 'error', module: 'trpc-tracing', message: 'trpc procedure error' },
            { level: 'error', module: 'observability', message: 'captured exception' },
          ],
          () => appRouter.createCaller(context(commandEnvelope)).sales.splitDraft(input)
        )
      ).rejects.toThrow(/forced sale transactional sync failure/);
    } finally {
      removeTrigger();
    }

    expect(await db.select({ id: sales.id }).from(sales).all()).toHaveLength(saleIdsBefore.length);
    expect(
      await db
        .select({ id: saleItems.id })
        .from(saleItems)
        .where(eq(saleItems.saleId, source.id))
        .all()
    ).toHaveLength(2);

    const first = await appRouter.createCaller(context(commandEnvelope)).sales.splitDraft(input);
    const replay = await appRouter.createCaller(context(commandEnvelope)).sales.splitDraft(input);
    expect(replay).toEqual(first);
    expect(first.source.items).toHaveLength(1);
    expect(first.created.items).toHaveLength(1);
    expect(
      await db
        .select({ id: syncOutbox.id })
        .from(syncOutbox)
        .where(eq(syncOutbox.idempotencyKey, commandEnvelope.idempotencyKey))
        .all()
    ).toHaveLength(2);
  });

  it('rolls back draft cancellation and lot restoration before replaying once', async () => {
    const tracked = await seedLotTrackedProduct();
    const source = await appRouter.createCaller(context(envelope())).sales.create({
      items: [{ productId: tracked.productId, unitId, quantity: 1, unitPrice: 25, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
    });
    await appRouter
      .createCaller(context(envelope()))
      .sales.suspend({ saleId: source.id, label: 'Discard replay source' });
    const db = getDatabase();
    expect(
      await db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(eq(inventoryBalances.productId, tracked.productId))
        .get()
    ).toMatchObject({ onHand: 0 });
    expect(
      await db
        .select({ onHand: inventoryLots.onHand })
        .from(inventoryLots)
        .where(eq(inventoryLots.id, tracked.lotId))
        .get()
    ).toMatchObject({ onHand: 0 });

    const commandEnvelope = envelope();
    const removeTrigger = installSalesSyncFailure('update');
    try {
      await expect(
        __withExpectedTestLogs(
          [
            { level: 'error', module: 'trpc-tracing', message: 'trpc procedure error' },
            { level: 'error', module: 'observability', message: 'captured exception' },
          ],
          () =>
            appRouter
              .createCaller(context(commandEnvelope))
              .sales.discardDraft({ saleId: source.id })
        )
      ).rejects.toThrow(/forced sale transactional sync failure/);
    } finally {
      removeTrigger();
    }

    expect(await db.select().from(sales).where(eq(sales.id, source.id)).get()).toMatchObject({
      status: 'draft',
      suspendedLabel: 'Discard replay source',
    });
    expect(
      await db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(eq(inventoryBalances.productId, tracked.productId))
        .get()
    ).toMatchObject({ onHand: 0 });
    expect(
      await db
        .select({ onHand: inventoryLots.onHand })
        .from(inventoryLots)
        .where(eq(inventoryLots.id, tracked.lotId))
        .get()
    ).toMatchObject({ onHand: 0 });

    const first = await appRouter
      .createCaller(context(commandEnvelope))
      .sales.discardDraft({ saleId: source.id });
    const replay = await appRouter
      .createCaller(context(commandEnvelope))
      .sales.discardDraft({ saleId: source.id });
    expect(replay).toEqual(first);
    expect(first).toEqual({ id: source.id, status: 'cancelled' });
    expect(
      await db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(eq(inventoryBalances.productId, tracked.productId))
        .get()
    ).toMatchObject({ onHand: 1 });
    expect(
      await db
        .select({ onHand: inventoryLots.onHand })
        .from(inventoryLots)
        .where(eq(inventoryLots.id, tracked.lotId))
        .get()
    ).toMatchObject({ onHand: 1 });
  });

  it('rolls back a fresh sale when its replication intent cannot commit', async () => {
    const commandEnvelope = envelope();
    const input = {
      items: [{ productId, unitId, quantity: 1, unitPrice: 25, discount: 0 }],
      paymentMethod: 'cash' as const,
      paymentStatus: 'paid' as const,
      status: 'completed' as const,
      amountReceived: 25,
    };
    const db = getDatabase();
    const beforeSales = await db.select({ id: sales.id }).from(sales).all();
    const beforeCash = await db.select({ id: cashMovements.id }).from(cashMovements).all();
    const beforeSync = await db
      .select({ id: syncOutbox.id })
      .from(syncOutbox)
      .where(and(eq(syncOutbox.entityType, 'sales'), eq(syncOutbox.operation, 'create')))
      .all();
    const removeTrigger = installSalesSyncFailure('create');
    try {
      await expect(
        __withExpectedTestLogs(
          [
            { level: 'error', module: 'trpc-tracing', message: 'trpc procedure error' },
            { level: 'error', module: 'observability', message: 'captured exception' },
          ],
          () => appRouter.createCaller(context(commandEnvelope)).sales.create(input)
        )
      ).rejects.toThrow(/forced sale transactional sync failure/);
    } finally {
      removeTrigger();
    }
    expect(await db.select({ id: sales.id }).from(sales).all()).toHaveLength(beforeSales.length);
    expect(await db.select({ id: cashMovements.id }).from(cashMovements).all()).toHaveLength(
      beforeCash.length
    );
    expect(
      await db
        .select({ id: syncOutbox.id })
        .from(syncOutbox)
        .where(and(eq(syncOutbox.entityType, 'sales'), eq(syncOutbox.operation, 'create')))
        .all()
    ).toHaveLength(beforeSync.length);

    const first = await appRouter.createCaller(context(commandEnvelope)).sales.create(input);
    const replay = await appRouter.createCaller(context(commandEnvelope)).sales.create(input);
    expect(replay).toEqual(first);
    expect(first.change).toBe(0);
    expect(
      await db
        .select({ id: sales.id })
        .from(sales)
        .where(and(eq(sales.tenantId, tenantId), eq(sales.id, first.id)))
        .all()
    ).toHaveLength(1);
    expect(
      await db
        .select({ id: cashMovements.id })
        .from(cashMovements)
        .where(eq(cashMovements.referenceId, first.id))
        .all()
    ).toHaveLength(1);
    expect(
      await db
        .select({ id: syncOutbox.id })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, tenantId),
            eq(syncOutbox.entityType, 'sales'),
            eq(syncOutbox.entityId, first.id),
            eq(syncOutbox.operation, 'create')
          )
        )
        .all()
    ).toHaveLength(1);
  });

  it('rolls back stock, lot provenance and sale sync when lot replication cannot commit', async () => {
    const db = getDatabase();
    const tracked = await seedLotTrackedProduct();
    const commandEnvelope = envelope();
    const input = {
      items: [
        {
          productId: tracked.productId,
          unitId,
          quantity: 1,
          unitPrice: 25,
          discount: 0,
        },
      ],
      paymentMethod: 'cash' as const,
      paymentStatus: 'paid' as const,
      status: 'completed' as const,
      amountReceived: 25,
    };
    const removeTrigger = installInventoryLotSyncFailure();
    try {
      await expect(
        __withExpectedTestLogs(
          [
            { level: 'error', module: 'trpc-tracing', message: 'trpc procedure error' },
            { level: 'error', module: 'observability', message: 'captured exception' },
          ],
          () => appRouter.createCaller(context(commandEnvelope)).sales.create(input)
        )
      ).rejects.toThrow(/forced inventory lot transactional sync failure/);
    } finally {
      removeTrigger();
    }

    expect(
      await db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, siteId),
            eq(inventoryBalances.productId, tracked.productId)
          )
        )
        .get()
    ).toEqual({ onHand: 1 });
    expect(
      await db
        .select({ onHand: inventoryLots.onHand, status: inventoryLots.status })
        .from(inventoryLots)
        .where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.id, tracked.lotId)))
        .get()
    ).toEqual({ onHand: 1, status: 'active' });
    expect(
      await db
        .select({ id: saleItemLots.id })
        .from(saleItemLots)
        .where(eq(saleItemLots.tenantId, tenantId))
        .all()
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: syncOutbox.id })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, tenantId),
            eq(syncOutbox.entityType, 'sales'),
            eq(syncOutbox.idempotencyKey, commandEnvelope.idempotencyKey)
          )
        )
        .all()
    ).toHaveLength(0);

    const first = await appRouter.createCaller(context(commandEnvelope)).sales.create(input);
    const replay = await appRouter.createCaller(context(commandEnvelope)).sales.create(input);
    expect(replay).toEqual(first);
    expect(
      await db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, siteId),
            eq(inventoryBalances.productId, tracked.productId)
          )
        )
        .get()
    ).toEqual({ onHand: 0 });
    expect(
      await db
        .select({ onHand: inventoryLots.onHand, status: inventoryLots.status })
        .from(inventoryLots)
        .where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.id, tracked.lotId)))
        .get()
    ).toEqual({ onHand: 0, status: 'depleted' });
    expect(
      await db
        .select({ entityType: syncOutbox.entityType })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, tenantId),
            eq(syncOutbox.idempotencyKey, commandEnvelope.idempotencyKey)
          )
        )
        .orderBy(syncOutbox.entityType)
        .all()
    ).toEqual([{ entityType: 'inventory_lots' }, { entityType: 'sales' }]);
  });

  it('rolls back draft completion with its sync row and charges a successful retry once', async () => {
    const draft = await appRouter.createCaller(context()).sales.create({
      items: [{ productId, unitId, quantity: 1, unitPrice: 25, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
    });
    const commandEnvelope = envelope();
    const input = {
      saleId: draft.id,
      paymentMethod: 'cash' as const,
      paymentStatus: 'paid' as const,
      amountReceived: 30,
    };
    const removeTrigger = installSalesSyncFailure('update');
    try {
      await expect(
        __withExpectedTestLogs(
          [
            { level: 'error', module: 'trpc-tracing', message: 'trpc procedure error' },
            { level: 'error', module: 'observability', message: 'captured exception' },
          ],
          () => appRouter.createCaller(context(commandEnvelope)).sales.completeDraft(input)
        )
      ).rejects.toThrow(/forced sale transactional sync failure/);
    } finally {
      removeTrigger();
    }
    expect(
      await getDatabase()
        .select({ status: sales.status, paymentStatus: sales.paymentStatus })
        .from(sales)
        .where(and(eq(sales.tenantId, tenantId), eq(sales.id, draft.id)))
        .get()
    ).toEqual({ status: 'draft', paymentStatus: 'pending' });
    expect(
      await getDatabase()
        .select({ id: cashMovements.id })
        .from(cashMovements)
        .where(eq(cashMovements.referenceId, draft.id))
        .all()
    ).toHaveLength(0);
    expect(
      await getDatabase()
        .select({ id: syncOutbox.id })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, tenantId),
            eq(syncOutbox.entityType, 'sales'),
            eq(syncOutbox.entityId, draft.id),
            eq(syncOutbox.operation, 'update')
          )
        )
        .all()
    ).toHaveLength(0);

    const first = await appRouter.createCaller(context(commandEnvelope)).sales.completeDraft(input);
    const replay = await appRouter
      .createCaller(context(commandEnvelope))
      .sales.completeDraft(input);
    expect(replay).toEqual(first);
    expect(replay.change).toBe(5);
    expect(replay.status).toBe('completed');
    expect(
      await getDatabase()
        .select({ id: cashMovements.id })
        .from(cashMovements)
        .where(eq(cashMovements.referenceId, draft.id))
        .all()
    ).toHaveLength(1);
    expect(
      await getDatabase()
        .select({ id: syncOutbox.id })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, tenantId),
            eq(syncOutbox.entityType, 'sales'),
            eq(syncOutbox.entityId, draft.id),
            eq(syncOutbox.operation, 'update')
          )
        )
        .all()
    ).toHaveLength(1);
  });

  it('rolls back a void when replication cannot commit and replays the reversal exactly once', async () => {
    const original = await appRouter.createCaller(context(envelope())).sales.create({
      items: [{ productId, unitId, quantity: 1, unitPrice: 25, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 25,
    });
    const commandEnvelope = envelope();
    const input = { id: original.id, reason: 'Transactional void' };
    const removeTrigger = installSalesSyncFailure('update');
    try {
      await expect(
        __withExpectedTestLogs(
          [
            { level: 'error', module: 'trpc-tracing', message: 'trpc procedure error' },
            { level: 'error', module: 'observability', message: 'captured exception' },
          ],
          () => appRouter.createCaller(context(commandEnvelope)).sales.void(input)
        )
      ).rejects.toThrow(/forced sale transactional sync failure/);
    } finally {
      removeTrigger();
    }

    expect(
      await getDatabase()
        .select({ status: sales.status })
        .from(sales)
        .where(and(eq(sales.tenantId, tenantId), eq(sales.id, original.id)))
        .get()
    ).toEqual({ status: 'completed' });
    expect(
      await getDatabase()
        .select({ id: cashMovements.id })
        .from(cashMovements)
        .where(and(eq(cashMovements.referenceId, original.id), eq(cashMovements.type, 'refund')))
        .all()
    ).toHaveLength(0);

    const first = await appRouter.createCaller(context(commandEnvelope)).sales.void(input);
    const replay = await appRouter.createCaller(context(commandEnvelope)).sales.void(input);
    expect(replay).toEqual(first);
    expect(first.status).toBe('voided');
    expect(
      await getDatabase()
        .select({ id: cashMovements.id })
        .from(cashMovements)
        .where(and(eq(cashMovements.referenceId, original.id), eq(cashMovements.type, 'refund')))
        .all()
    ).toHaveLength(1);
    expect(
      await getDatabase()
        .select({ id: syncOutbox.id })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, tenantId),
            eq(syncOutbox.entityType, 'sales'),
            eq(syncOutbox.entityId, original.id),
            eq(syncOutbox.operation, 'update'),
            eq(syncOutbox.idempotencyKey, commandEnvelope.idempotencyKey)
          )
        )
        .all()
    ).toHaveLength(1);
  });

  it('rolls back a return when replication intent fails and retries the same envelope once', async () => {
    const original = await appRouter.createCaller(context(envelope())).sales.create({
      items: [{ productId, unitId, quantity: 1, unitPrice: 25, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 25,
    });
    const commandEnvelope = envelope();
    const input = { id: original.id, reason: 'Customer changed their mind' };
    const removeTrigger = installSaleReturnSyncFailure();
    try {
      await expect(
        __withExpectedTestLogs(
          [
            {
              level: 'error',
              module: 'trpc-tracing',
              message: 'trpc procedure error',
            },
            { level: 'error', module: 'observability', message: 'captured exception' },
          ],
          () => appRouter.createCaller(context(commandEnvelope)).sales.returnSale(input)
        )
      ).rejects.toThrow(/forced sale return transactional sync failure/);
    } finally {
      removeTrigger();
    }
    expect(
      await getDatabase()
        .select({ id: saleReturns.id })
        .from(saleReturns)
        .where(and(eq(saleReturns.tenantId, tenantId), eq(saleReturns.saleId, original.id)))
        .all()
    ).toHaveLength(0);
    expect(
      await getDatabase()
        .select({ id: cashMovements.id })
        .from(cashMovements)
        .where(and(eq(cashMovements.referenceId, original.id), eq(cashMovements.type, 'refund')))
        .all()
    ).toHaveLength(0);

    const first = await appRouter.createCaller(context(commandEnvelope)).sales.returnSale(input);

    const persisted = await getDatabase()
      .select({ status: idempotencyKeys.status, resultRef: idempotencyKeys.resultRef })
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.idempotencyKey, commandEnvelope.idempotencyKey))
      .get();
    expect(persisted).toEqual({ status: 'succeeded', resultRef: first });
    expect(first.paymentStatus).toBe('refunded');
    expect(first.returnedAmount).toBe(25);

    const replay = await appRouter.createCaller(context(commandEnvelope)).sales.returnSale(input);
    expect(replay).toEqual(first);
    expect(
      await getDatabase()
        .select({ id: saleReturns.id })
        .from(saleReturns)
        .where(and(eq(saleReturns.tenantId, tenantId), eq(saleReturns.saleId, original.id)))
        .all()
    ).toHaveLength(1);
    expect(
      await getDatabase()
        .select({ id: cashMovements.id })
        .from(cashMovements)
        .where(and(eq(cashMovements.referenceId, original.id), eq(cashMovements.type, 'refund')))
        .all()
    ).toHaveLength(1);
  });
});
