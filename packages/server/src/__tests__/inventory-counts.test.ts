import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import { __withExpectedTestLogs } from '../logging/logger.js';
import {
  auditLogs,
  companies,
  idempotencyKeys,
  initialInventory,
  inventoryBalances,
  inventoryCountLines,
  inventoryCountSessions,
  inventoryMovements,
  products,
  providers,
  sites,
  syncOutbox,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { applyInventoryBalanceDelta } from '../services/inventory-balances.js';
import { appRouter } from '../trpc/router.js';
import { freshCriticalContext, makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let db: DatabaseInstance;
let tenantId: string;
let userId: string;
let siteId: string;
let secondSiteId: string;
let unitId: string;
let deviceId: string;
let secondDeviceId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;
let skuSequence = 0;

interface SeedProductOptions {
  name?: string;
  onHand?: number;
  reserved?: number;
  minStock?: number;
  targetSiteId?: string;
  tracksStock?: boolean;
  tracksLots?: boolean;
  tracksSerials?: boolean;
  catalogType?: 'standard' | 'variant_parent' | 'variant';
  variantParentId?: string | null;
}

async function seedProduct(options: SeedProductOptions = {}) {
  skuSequence += 1;
  const id = nanoid();
  const now = new Date().toISOString();
  const sku = `COUNT-${String(skuSequence).padStart(3, '0')}`;
  await db.insert(products).values({
    id,
    tenantId,
    name: options.name ?? `Count product ${skuSequence}`,
    sku,
    price: 12,
    price2: 12,
    price3: 12,
    cost: 4,
    initialCost: 4,
    minStock: options.minStock ?? 0,
    taxRate: 0,
    tracksStock: options.tracksStock ?? true,
    tracksLots: options.tracksLots ?? false,
    tracksSerials: options.tracksSerials ?? false,
    catalogType: options.catalogType ?? 'standard',
    variantParentId: options.variantParentId ?? null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(unitXProduct).values({
    id: nanoid(),
    productId: id,
    unitId,
    equivalence: 1,
    price: 12,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  if (options.onHand !== undefined) {
    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId: options.targetSiteId ?? siteId,
      productId: id,
      onHand: options.onHand,
      reserved: options.reserved ?? 0,
      syncStatus: 'synced',
      syncVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { id, sku };
}

function caller() {
  return appRouter.createCaller(fresh());
}

describe('blind inventory counts and retail replenishment', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    db = getDatabase();
    const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin user');
    tenantId = admin.tenantId;
    userId = admin.id;

    const primarySite = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    const company = await db.select().from(companies).where(eq(companies.tenantId, tenantId)).get();
    const baseUnit = (await db.select().from(units).where(eq(units.tenantId, tenantId)).all()).find(
      row => row.abbreviation === 'UND'
    );
    if (!primarySite || !company || !baseUnit) {
      throw new Error('Expected seeded site, company, and base unit');
    }
    siteId = primarySite.id;
    unitId = baseUnit.id;
    secondSiteId = nanoid();
    const now = new Date().toISOString();
    await db.insert(sites).values({
      id: secondSiteId,
      tenantId,
      companyId: company.id,
      name: 'Count test branch',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    deviceId = (
      await registerDeviceService(db, {
        tenantId,
        userId,
        kind: 'web',
        name: 'inventory-counts.test.primary',
      })
    ).deviceId;
    secondDeviceId = (
      await registerDeviceService(db, {
        tenantId,
        userId,
        kind: 'web',
        name: 'inventory-counts.test.secondary',
      })
    ).deviceId;
    fresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId,
      email: admin.email,
      defaultRole: 'manager',
      siteId,
      deviceId,
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('keeps the snapshot blind, supports partial progress, and approves exactly once', async () => {
    const first = await seedProduct({ name: 'Blind apples', onHand: 10 });
    const second = await seedProduct({ name: 'Blind tea', onHand: 5 });

    const created = await caller().inventory.createCountSession({
      siteId,
      productIds: [first.id, second.id],
      notes: 'Morning blind count',
    });
    expect(created).toMatchObject({ status: 'counting', isBlind: true, version: 0 });
    expect(created.lines).toHaveLength(2);
    expect(created.lines.every(line => line.expectedQuantity === null)).toBe(true);
    expect(created.lines.every(line => line.discrepancy === null)).toBe(true);
    expect(created.lines.every(line => line.unitCostSnapshot === null)).toBe(true);

    // The picker that feeds the count dialog must not carry stock either. It
    // used to reuse listBalancesBySite, so onHand and reserved landed in the
    // counter's tRPC cache — readable in devtools — while the UI told them the
    // expected quantity was server-redacted.
    const picker = await caller().inventory.listCountableProducts({ siteId });
    expect(picker.items.length).toBeGreaterThan(0);
    for (const item of picker.items) {
      expect(item).toHaveProperty('productName');
      expect(item).not.toHaveProperty('onHand');
      expect(item).not.toHaveProperty('reserved');
      expect(item).not.toHaveProperty('minStock');
    }

    // The read model redacts the blind figure, but the sync outbox is a
    // SECOND way to read it: sync.listQueue is manager-accessible and returns
    // each row's payload verbatim. A blind count whose answer sits in a
    // manager-readable queue is not blind.
    const queuedAtCreate = await getDatabase()
      .select({ payload: syncOutbox.payload })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          eq(syncOutbox.entityType, 'inventory_count_lines'),
          eq(syncOutbox.operation, 'create')
        )
      )
      .all();
    expect(queuedAtCreate.length).toBeGreaterThan(0);
    for (const row of queuedAtCreate) {
      expect(JSON.stringify(row.payload)).not.toMatch(/expectedQuantity/);
    }

    const firstLine = created.lines.find(line => line.productId === first.id)!;
    const secondLine = created.lines.find(line => line.productId === second.id)!;
    const partiallySaved = await caller().inventory.saveCountSession({
      id: created.id,
      version: created.version,
      lines: [{ lineId: firstLine.id, countedQuantity: 8, version: firstLine.version }],
    });
    expect(partiallySaved).toMatchObject({ status: 'counting', version: 1, countedLineCount: 1 });
    expect(partiallySaved.lines.find(line => line.id === firstLine.id)?.countedQuantity).toBe(8);
    expect(
      partiallySaved.lines.find(line => line.id === firstLine.id)?.expectedQuantity
    ).toBeNull();

    await expect(
      caller().inventory.submitCountSession({
        id: partiallySaved.id,
        version: partiallySaved.version,
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'INVENTORY_COUNT_INCOMPLETE' } });
    const afterIncomplete = await caller().inventory.getCountSession({ id: created.id });
    expect(afterIncomplete).toMatchObject({ status: 'counting', version: 1 });

    const completed = await caller().inventory.saveCountSession({
      id: created.id,
      version: afterIncomplete.version,
      lines: [{ lineId: secondLine.id, countedQuantity: 5, version: secondLine.version }],
    });
    const submitted = await caller().inventory.submitCountSession({
      id: created.id,
      version: completed.version,
    });
    expect(submitted).toMatchObject({ status: 'submitted', version: 3, discrepancyLineCount: 1 });
    expect(submitted.lines.find(line => line.productId === first.id)).toMatchObject({
      expectedQuantity: 10,
      countedQuantity: 8,
      discrepancy: -2,
      unitCostSnapshot: 4,
    });
    expect(submitted.lines.find(line => line.productId === second.id)).toMatchObject({
      expectedQuantity: 5,
      countedQuantity: 5,
      discrepancy: 0,
    });

    const approveEnvelope = {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    };
    const approveContext = () => fresh({ envelope: approveEnvelope });
    const approved = await appRouter.createCaller(approveContext()).inventory.approveCountSession({
      id: created.id,
      version: submitted.version,
    });
    const replayed = await appRouter.createCaller(approveContext()).inventory.approveCountSession({
      id: created.id,
      version: submitted.version,
    });
    expect(replayed).toEqual(approved);
    expect(approved).toMatchObject({ status: 'approved', version: 4 });

    const balances = await db
      .select({ productId: inventoryBalances.productId, onHand: inventoryBalances.onHand })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, siteId),
          inArray(inventoryBalances.productId, [first.id, second.id])
        )
      )
      .all();
    expect(new Map(balances.map(row => [row.productId, row.onHand]))).toEqual(
      new Map([
        [first.id, 8],
        [second.id, 5],
      ])
    );

    const countEntries = await db
      .select()
      .from(initialInventory)
      .where(
        and(
          eq(initialInventory.tenantId, tenantId),
          eq(initialInventory.siteId, siteId),
          inArray(initialInventory.productId, [first.id, second.id]),
          eq(initialInventory.mode, 'physical')
        )
      )
      .all();
    expect(countEntries).toHaveLength(2);
    expect(countEntries.find(row => row.productId === first.id)).toMatchObject({
      previousStock: 10,
      newStock: 8,
      normalizedQuantity: 8,
    });
    expect(
      await db
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.reference, `inventory-count:${created.id}`))
        .all()
    ).toEqual([
      expect.objectContaining({
        tenantId,
        siteId,
        productId: first.id,
        type: 'adjustment',
        quantity: 2,
        previousStock: 10,
        newStock: 8,
      }),
    ]);

    const actions = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceType, 'inventory_count_session'),
          eq(auditLogs.resourceId, created.id)
        )
      )
      .all();
    expect(actions.map(row => row.action)).toEqual(
      expect.arrayContaining([
        'inventory.count.create',
        'inventory.count.save',
        'inventory.count.submit',
        'inventory.count.approve',
      ])
    );
    expect(actions.filter(row => row.action === 'inventory.count.approve')).toHaveLength(1);
    expect(
      await db
        .select({ status: idempotencyKeys.status })
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.idempotencyKey, approveEnvelope.idempotencyKey))
        .get()
    ).toEqual({ status: 'succeeded' });

    const storedLines = await db
      .select({ syncVersion: inventoryCountLines.syncVersion })
      .from(inventoryCountLines)
      .where(eq(inventoryCountLines.sessionId, created.id))
      .all();
    expect(storedLines.every(line => line.syncVersion === 3)).toBe(true);
    expect(
      await db
        .select()
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, tenantId),
            eq(syncOutbox.entityType, 'inventory_count_sessions'),
            eq(syncOutbox.entityId, created.id)
          )
        )
        .all()
    ).toHaveLength(5);
  });

  it('reconciles a negative book balance to a non-negative physical count', async () => {
    const product = await seedProduct({ name: 'Historical stock shortfall', onHand: -2 });
    const created = await caller().inventory.createCountSession({
      siteId,
      productIds: [product.id],
    });
    expect(created.lines[0]?.expectedQuantity).toBeNull();

    const saved = await caller().inventory.saveCountSession({
      id: created.id,
      version: created.version,
      lines: [
        {
          lineId: created.lines[0]!.id,
          countedQuantity: 3,
          version: created.lines[0]!.version,
        },
      ],
    });
    const submitted = await caller().inventory.submitCountSession({
      id: saved.id,
      version: saved.version,
    });
    expect(submitted.lines[0]).toMatchObject({
      expectedQuantity: -2,
      countedQuantity: 3,
      discrepancy: 5,
    });

    const approved = await caller().inventory.approveCountSession({
      id: submitted.id,
      version: submitted.version,
    });
    expect(approved.status).toBe('approved');
    expect(
      await db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, siteId),
            eq(inventoryBalances.productId, product.id)
          )
        )
        .get()
    ).toEqual({ onHand: 3 });
  });

  it('removes finer-than-count precision without leaving a stock residual', async () => {
    const product = await seedProduct({ name: 'Imported precision residual', onHand: 1.2344 });
    const created = await caller().inventory.createCountSession({
      siteId,
      productIds: [product.id],
    });
    const saved = await caller().inventory.saveCountSession({
      id: created.id,
      version: created.version,
      lines: [
        {
          lineId: created.lines[0]!.id,
          countedQuantity: 1,
          version: created.lines[0]!.version,
        },
      ],
    });
    const submitted = await caller().inventory.submitCountSession({
      id: saved.id,
      version: saved.version,
    });
    expect(submitted.lines[0]).toMatchObject({
      expectedQuantity: 1.2344,
      countedQuantity: 1,
      discrepancy: expect.closeTo(-0.2344),
    });

    await caller().inventory.approveCountSession({
      id: submitted.id,
      version: submitted.version,
    });
    expect(
      await db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, siteId),
            eq(inventoryBalances.productId, product.id)
          )
        )
        .get()
    ).toEqual({ onHand: 1 });
  });

  it('rejects approval when site stock changed and leaves the count unapplied', async () => {
    const product = await seedProduct({ name: 'Concurrent stock', onHand: 4 });
    const created = await caller().inventory.createCountSession({
      siteId,
      productIds: [product.id],
    });
    const saved = await caller().inventory.saveCountSession({
      id: created.id,
      version: created.version,
      lines: [{ lineId: created.lines[0]!.id, countedQuantity: 3, version: 0 }],
    });
    const submitted = await caller().inventory.submitCountSession({
      id: created.id,
      version: saved.version,
    });

    await db
      .update(inventoryBalances)
      .set({ onHand: 5, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, siteId),
          eq(inventoryBalances.productId, product.id)
        )
      );

    await expect(
      caller().inventory.approveCountSession({ id: created.id, version: submitted.version })
    ).rejects.toMatchObject({ cause: { errorCode: 'INVENTORY_COUNT_BALANCE_CHANGED' } });
    expect(await caller().inventory.getCountSession({ id: created.id })).toMatchObject({
      status: 'submitted',
      version: submitted.version,
    });
    expect(
      await db
        .select()
        .from(initialInventory)
        .where(
          and(eq(initialInventory.productId, product.id), eq(initialInventory.mode, 'physical'))
        )
        .all()
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.reference, `inventory-count:${created.id}`))
        .all()
    ).toHaveLength(0);
  });

  it('rejects net-zero stock activity that occurred while counting', async () => {
    const product = await seedProduct({ name: 'Net-zero activity item', onHand: 5 });
    const created = await caller().inventory.createCountSession({
      siteId,
      productIds: [product.id],
    });
    const saved = await caller().inventory.saveCountSession({
      id: created.id,
      version: created.version,
      lines: [
        {
          lineId: created.lines[0]!.id,
          countedQuantity: 5,
          version: created.lines[0]!.version,
        },
      ],
    });
    const submitted = await caller().inventory.submitCountSession({
      id: saved.id,
      version: saved.version,
    });

    applyInventoryBalanceDelta(db, {
      tenantId,
      siteId,
      productId: product.id,
      delta: -1,
    });
    applyInventoryBalanceDelta(db, {
      tenantId,
      siteId,
      productId: product.id,
      delta: 1,
    });

    expect(
      await db
        .select({ onHand: inventoryBalances.onHand, version: inventoryBalances.version })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, siteId),
            eq(inventoryBalances.productId, product.id)
          )
        )
        .get()
    ).toEqual({ onHand: 5, version: 2 });
    await expect(
      caller().inventory.approveCountSession({
        id: submitted.id,
        version: submitted.version,
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'INVENTORY_COUNT_BALANCE_CHANGED' } });
  });

  it('rejects approval when the counted base-unit identity changed', async () => {
    const product = await seedProduct({ name: 'Unit drift item', onHand: 4 });
    const created = await caller().inventory.createCountSession({
      siteId,
      productIds: [product.id],
    });
    const saved = await caller().inventory.saveCountSession({
      id: created.id,
      version: created.version,
      lines: [
        {
          lineId: created.lines[0]!.id,
          countedQuantity: 3,
          version: created.lines[0]!.version,
        },
      ],
    });
    const submitted = await caller().inventory.submitCountSession({
      id: saved.id,
      version: saved.version,
    });

    await db
      .update(unitXProduct)
      .set({ isBase: false, updatedAt: new Date().toISOString() })
      .where(eq(unitXProduct.productId, product.id));

    await expect(
      caller().inventory.approveCountSession({
        id: submitted.id,
        version: submitted.version,
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'INVENTORY_COUNT_CATALOG_CHANGED' } });
    expect(
      await db
        .select({ status: inventoryCountSessions.status })
        .from(inventoryCountSessions)
        .where(eq(inventoryCountSessions.id, submitted.id))
        .get()
    ).toEqual({ status: 'submitted' });
    expect(
      await db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, siteId),
            eq(inventoryBalances.productId, product.id)
          )
        )
        .get()
    ).toEqual({ onHand: 4 });
  });

  it('rejects starting a count when a product has ambiguous base units', async () => {
    const product = await seedProduct({ name: 'Ambiguous base unit item', onHand: 4 });
    const competingUnitId = nanoid();
    const now = new Date().toISOString();
    await db.insert(units).values({
      id: competingUnitId,
      tenantId,
      name: 'Competing count unit',
      abbreviation: `CCU-${skuSequence}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId: product.id,
      unitId: competingUnitId,
      equivalence: 1,
      price: 12,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      caller().inventory.createCountSession({ siteId, productIds: [product.id] })
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Every counted product must have exactly one active base unit',
    });
    expect(
      await db
        .select()
        .from(inventoryCountSessions)
        .innerJoin(
          inventoryCountLines,
          eq(inventoryCountLines.sessionId, inventoryCountSessions.id)
        )
        .where(
          and(
            eq(inventoryCountSessions.tenantId, tenantId),
            eq(inventoryCountLines.productId, product.id)
          )
        )
        .all()
    ).toHaveLength(0);
  });

  it('rolls back stock and evidence when count replication intent cannot commit', async () => {
    const product = await seedProduct({ name: 'Atomic count item', onHand: 9 });
    const created = await caller().inventory.createCountSession({
      siteId,
      productIds: [product.id],
    });
    const saved = await caller().inventory.saveCountSession({
      id: created.id,
      version: created.version,
      lines: [{ lineId: created.lines[0]!.id, countedQuantity: 6, version: 0 }],
    });
    const submitted = await caller().inventory.submitCountSession({
      id: created.id,
      version: saved.version,
    });
    const envelope = {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    };
    const approveContext = () => fresh({ envelope });
    const sqlite = (db as unknown as { $client: { exec: (statement: string) => void } }).$client;
    sqlite.exec(`
      CREATE TEMP TRIGGER fail_inventory_count_movement_sync
      BEFORE INSERT ON sync_outbox
      WHEN NEW.entity_type = 'inventory_movements'
        AND json_extract(NEW.payload, '$.countSessionId') = '${created.id}'
      BEGIN
        SELECT RAISE(ABORT, 'forced inventory count sync failure');
      END;
    `);
    try {
      await expect(
        __withExpectedTestLogs(
          [
            { level: 'error', module: 'trpc-tracing', message: 'trpc procedure error' },
            { level: 'error', module: 'observability', message: 'captured exception' },
          ],
          () =>
            appRouter
              .createCaller(approveContext())
              .inventory.approveCountSession({ id: created.id, version: submitted.version })
        )
      ).rejects.toThrow(/forced inventory count sync failure/);
    } finally {
      sqlite.exec('DROP TRIGGER fail_inventory_count_movement_sync');
    }

    expect(
      await db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, siteId),
            eq(inventoryBalances.productId, product.id)
          )
        )
        .get()
    ).toEqual({ onHand: 9 });
    expect(await caller().inventory.getCountSession({ id: created.id })).toMatchObject({
      status: 'submitted',
      version: submitted.version,
    });
    expect(
      await db
        .select()
        .from(initialInventory)
        .where(
          and(eq(initialInventory.productId, product.id), eq(initialInventory.mode, 'physical'))
        )
        .all()
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.reference, `inventory-count:${created.id}`))
        .all()
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.resourceId, created.id),
            eq(auditLogs.action, 'inventory.count.approve')
          )
        )
        .all()
    ).toHaveLength(0);

    const approved = await appRouter
      .createCaller(approveContext())
      .inventory.approveCountSession({ id: created.id, version: submitted.version });
    const replayed = await appRouter
      .createCaller(approveContext())
      .inventory.approveCountSession({ id: created.id, version: submitted.version });
    expect(approved).toMatchObject({ status: 'approved' });
    expect(replayed).toEqual(approved);
    expect(
      await db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, siteId),
            eq(inventoryBalances.productId, product.id)
          )
        )
        .get()
    ).toEqual({ onHand: 6 });
  });

  it('rejects stale devices, overlapping counts, and identity-unsafe products', async () => {
    const product = await seedProduct({ name: 'Two device item', onHand: 7 });
    const created = await caller().inventory.createCountSession({
      siteId,
      productIds: [product.id],
    });
    const secondDeviceContext = () =>
      freshCriticalContext({
        db,
        serverApp: server.app,
        tenantId,
        userId,
        email: 'admin@localhost',
        role: 'manager',
        siteId,
        deviceId: secondDeviceId,
      });
    const fromFirstDevice = await caller().inventory.saveCountSession({
      id: created.id,
      version: 0,
      lines: [{ lineId: created.lines[0]!.id, countedQuantity: 7, version: 0 }],
    });
    await expect(
      appRouter.createCaller(secondDeviceContext()).inventory.saveCountSession({
        id: created.id,
        version: 0,
        lines: [{ lineId: created.lines[0]!.id, countedQuantity: 6, version: 0 }],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'INVENTORY_COUNT_STALE_VERSION' } });
    await expect(
      appRouter.createCaller(secondDeviceContext()).inventory.createCountSession({
        siteId,
        productIds: [product.id],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'INVENTORY_COUNT_ALREADY_OPEN' } });
    expect(fromFirstDevice.lines[0]?.countedQuantity).toBe(7);

    const lot = await seedProduct({ name: 'Lot item', onHand: 2, tracksLots: true });
    const serial = await seedProduct({ name: 'Serial item', onHand: 2, tracksSerials: true });
    const parent = await seedProduct({
      name: 'Matrix parent',
      onHand: 2,
      catalogType: 'variant_parent',
    });
    for (const tracked of [lot, serial, parent]) {
      await expect(
        caller().inventory.createCountSession({ siteId, productIds: [tracked.id] })
      ).rejects.toMatchObject({
        cause: { errorCode: 'INVENTORY_COUNT_IDENTITY_TRACKING_REQUIRED' },
      });
    }
  });

  it('allows real variant SKUs and rejection never mutates stock', async () => {
    const parent = await seedProduct({ name: 'Shirt matrix', catalogType: 'variant_parent' });
    const variant = await seedProduct({
      name: 'Shirt blue M',
      onHand: 6,
      catalogType: 'variant',
      variantParentId: parent.id,
    });
    const created = await caller().inventory.createCountSession({
      siteId,
      productIds: [variant.id],
    });
    const saved = await caller().inventory.saveCountSession({
      id: created.id,
      version: 0,
      lines: [{ lineId: created.lines[0]!.id, countedQuantity: 4, version: 0 }],
    });
    const submitted = await caller().inventory.submitCountSession({
      id: created.id,
      version: saved.version,
    });
    const rejected = await caller().inventory.rejectCountSession({
      id: created.id,
      version: submitted.version,
      reason: 'Recount required',
    });
    expect(rejected).toMatchObject({ status: 'rejected', rejectionReason: 'Recount required' });
    expect(
      await db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, siteId),
            eq(inventoryBalances.productId, variant.id)
          )
        )
        .get()
    ).toEqual({ onHand: 6 });
    expect(
      await db
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.reference, `inventory-count:${created.id}`))
        .all()
    ).toHaveLength(0);
  });

  it('scopes sessions by site and hides another tenant count', async () => {
    const product = await seedProduct({ name: 'Site scoped count', onHand: 1 });
    const created = await caller().inventory.createCountSession({
      siteId,
      productIds: [product.id],
    });
    const otherSiteList = await caller().inventory.listCountSessions({
      page: 1,
      perPage: 20,
      siteId: secondSiteId,
    });
    expect(otherSiteList.items.some(item => item.id === created.id)).toBe(false);

    const foreignTenantId = nanoid();
    const foreignCompanyId = nanoid();
    const foreignSiteId = nanoid();
    const foreignUserId = nanoid();
    const foreignCountId = nanoid();
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign Count Tenant',
      slug: `foreign-count-${foreignTenantId}`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: foreignCompanyId,
      tenantId: foreignTenantId,
      name: 'Foreign Company',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: foreignSiteId,
      tenantId: foreignTenantId,
      companyId: foreignCompanyId,
      name: 'Foreign Site',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: foreignUserId,
      tenantId: foreignTenantId,
      email: `foreign-count-${foreignTenantId}@example.test`,
      name: 'Foreign Manager',
      passwordHash: 'not-used-by-this-test',
      role: 'manager',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(inventoryCountSessions).values({
      id: foreignCountId,
      tenantId: foreignTenantId,
      siteId: foreignSiteId,
      status: 'counting',
      isBlind: true,
      createdBy: foreignUserId,
      version: 0,
      createdAt: now,
      updatedAt: now,
    });

    await expect(caller().inventory.getCountSession({ id: foreignCountId })).rejects.toThrow(
      /not found/i
    );
    await expect(
      caller().inventory.createCountSession({ siteId: foreignSiteId, productIds: [product.id] })
    ).rejects.toThrow(/not found|inactive/i);
  });

  it('derives site-specific replenishment from available and open order quantity', async () => {
    const standard = await seedProduct({
      name: 'Reorder rice',
      onHand: 4,
      reserved: 1,
      minStock: 10,
    });
    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId: secondSiteId,
      productId: standard.id,
      onHand: 9,
      reserved: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const lot = await seedProduct({
      name: 'Reorder lot item',
      onHand: 1,
      minStock: 5,
      tracksLots: true,
    });
    const serial = await seedProduct({
      name: 'Reorder serial item',
      onHand: 1,
      minStock: 5,
      tracksSerials: true,
    });
    const parent = await seedProduct({
      name: 'Reorder matrix parent',
      onHand: 1,
      minStock: 5,
      catalogType: 'variant_parent',
    });
    const variant = await seedProduct({
      name: 'Reorder shirt variant',
      onHand: 1,
      minStock: 5,
      catalogType: 'variant',
      variantParentId: parent.id,
    });

    const suggestions = await caller().inventory.listReplenishmentSuggestions({
      page: 1,
      perPage: 100,
      siteId,
    });
    expect(suggestions.items.find(item => item.productId === standard.id)).toMatchObject({
      onHand: 4,
      reserved: 1,
      available: 3,
      onOrder: 0,
      projectedAvailable: 3,
      suggestedQuantity: 7,
      canDraft: true,
      blockedReason: null,
    });
    expect(suggestions.items.find(item => item.productId === lot.id)).toMatchObject({
      canDraft: true,
      blockedReason: null,
    });
    expect(suggestions.items.find(item => item.productId === serial.id)).toMatchObject({
      canDraft: true,
      blockedReason: null,
    });
    expect(suggestions.items.find(item => item.productId === parent.id)).toMatchObject({
      canDraft: false,
      blockedReason: 'catalog_parent',
    });
    expect(suggestions.items.find(item => item.productId === variant.id)).toMatchObject({
      canDraft: true,
      blockedReason: null,
    });

    const otherSite = await caller().inventory.listReplenishmentSuggestions({
      page: 1,
      perPage: 100,
      siteId: secondSiteId,
      search: standard.sku,
    });
    expect(otherSite.items).toEqual([
      expect.objectContaining({
        productId: standard.id,
        available: 9,
        projectedAvailable: 9,
        suggestedQuantity: 1,
      }),
    ]);

    const providerId = nanoid();
    const now = new Date().toISOString();
    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Replenishment Test Provider',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const draft = await caller().orders.create({
      providerId,
      status: 'draft',
      items: [{ productId: standard.id, unitId, quantity: 7, costPerUnit: 4 }],
    });
    expect(draft.status).toBe('draft');
    expect(
      await db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, siteId),
            eq(inventoryBalances.productId, standard.id)
          )
        )
        .get()
    ).toEqual({ onHand: 4 });
    expect(
      (
        await caller().inventory.listReplenishmentSuggestions({
          page: 1,
          perPage: 20,
          siteId,
          search: standard.sku,
        })
      ).items
    ).toHaveLength(0);
    await caller().orders.submitDraft({ id: draft.id });
    expect(
      (
        await caller().inventory.listReplenishmentSuggestions({
          page: 1,
          perPage: 20,
          siteId,
          search: standard.sku,
        })
      ).items
    ).toHaveLength(0);

    const partial = await seedProduct({
      name: 'Partial order projection',
      onHand: 4,
      reserved: 1,
      minStock: 10,
    });
    const partialOrder = await caller().orders.create({
      providerId,
      items: [{ productId: partial.id, unitId, quantity: 5, costPerUnit: 4 }],
    });
    const beforeReceipt = await caller().inventory.listReplenishmentSuggestions({
      page: 1,
      perPage: 20,
      siteId,
      search: partial.sku,
    });
    expect(beforeReceipt.items).toEqual([
      expect.objectContaining({
        productId: partial.id,
        available: 3,
        onOrder: 5,
        projectedAvailable: 8,
        suggestedQuantity: 2,
      }),
    ]);
    await caller().purchases.createFromOrder({
      orderId: partialOrder.id,
      items: [{ orderItemId: partialOrder.items[0]!.id, quantity: 2 }],
    });
    const afterPartialReceipt = await caller().inventory.listReplenishmentSuggestions({
      page: 1,
      perPage: 20,
      siteId,
      search: partial.sku,
    });
    expect(afterPartialReceipt.items).toEqual([
      expect.objectContaining({
        productId: partial.id,
        available: 5,
        onOrder: 3,
        projectedAvailable: 8,
        suggestedQuantity: 2,
      }),
    ]);
  });
});
