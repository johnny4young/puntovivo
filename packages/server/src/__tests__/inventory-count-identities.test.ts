import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import {
  products,
  productSerials,
  inventoryLots,
  inventoryBalances,
  inventoryCountIdentities,
  inventoryMovements,
  inventoryCountSessions,
  inventoryLotEvents,
  users,
  sites,
  units,
  unitXProduct,
  companies,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import {
  createCriticalCommandFixture,
  freshCriticalContext,
} from './utils/criticalCommandFixture.js';
import { __withExpectedTestLogs } from '../logging/logger.js';
import { markEntityAsSynced, syncEntityConfig } from '../trpc/routers/sync/helpers.js';

let server: PuntovivoServer;
let db: DatabaseInstance;
let tenantId: string, siteId: string, branchId: string, unitId: string, deviceId: string;
let context: Awaited<ReturnType<typeof createCriticalCommandFixture>>['context'];
function caller() {
  return appRouter.createCaller(
    freshCriticalContext({
      ...context,
      role: context.user!.role,
      userId: context.user!.id,
      email: context.user!.email,
      serverApp: server.app,
      deviceId,
      siteId,
    })
  );
}

async function product(mode: 'lots' | 'serials', onHand: number) {
  const id = nanoid();
  await db.insert(products).values({
    id,
    tenantId,
    name: `Identity count ${id}`,
    sku: id,
    price: 10,
    price2: 10,
    price3: 10,
    cost: 4,
    initialCost: 4,
    tracksStock: true,
    tracksLots: mode === 'lots',
    tracksSerials: mode === 'serials',
  });
  await db
    .insert(unitXProduct)
    .values({ id: nanoid(), productId: id, unitId, isBase: true, equivalence: 1, price: 10 });
  await db
    .insert(inventoryBalances)
    .values({ id: nanoid(), tenantId, siteId, productId: id, onHand });
  return id;
}
function balance(productId: string) {
  return db
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
}
async function lot(
  productId: string,
  onHand: number,
  status: 'active' | 'quarantined' | 'recalled' | 'expired' | 'depleted' = 'active'
) {
  const row = {
    id: nanoid(),
    tenantId,
    productId,
    siteId,
    lotNumber: nanoid(),
    onHand,
    status,
    unitCost: 4,
    expiresAt: '2025-01-01',
  };
  await db.insert(inventoryLots).values(row);
  return row;
}
async function serial(
  productId: string,
  status:
    | 'in_stock'
    | 'returned'
    | 'reserved'
    | 'sold'
    | 'in_transit'
    | 'returned_to_supplier' = 'in_stock',
  targetSiteId = siteId
) {
  const row = {
    id: nanoid(),
    tenantId,
    productId,
    currentSiteId: targetSiteId,
    serialNumber: nanoid().toUpperCase(),
    status,
    unitCost: 4,
    warrantyExpiresAt: '2030-01-01',
  };
  await db.insert(productSerials).values(row);
  return row;
}
async function submit(productId: string, observations: Array<{ code: string; quantity: number }>) {
  const created = await caller().inventory.createCountSession({ siteId, productIds: [productId] });
  const saved = await caller().inventory.saveCountSession({
    id: created.id,
    version: created.version,
    lines: [
      {
        lineId: created.lines[0]!.id,
        version: 0,
        countedQuantity: observations.reduce((sum, row) => sum + row.quantity, 0),
        identities: observations,
      },
    ],
  });
  return caller().inventory.submitCountSession({ id: saved.id, version: saved.version });
}

describe('exact identity physical counts', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    db = getDatabase();
    const admin = db.select().from(users).where(eq(users.email, 'admin@localhost')).get()!;
    tenantId = admin.tenantId;
    siteId = db.select().from(sites).where(eq(sites.tenantId, tenantId)).get()!.id;
    unitId = db
      .select()
      .from(units)
      .where(and(eq(units.tenantId, tenantId), eq(units.abbreviation, 'UND')))
      .get()!.id;
    branchId = nanoid();
    await db.insert(sites).values({
      id: branchId,
      tenantId,
      companyId: db.select().from(companies).where(eq(companies.tenantId, tenantId)).get()!.id,
      name: 'Identity branch',
    });
    const fixture = await createCriticalCommandFixture({
      db,
      tenantId,
      siteId,
      userId: admin.id,
      email: admin.email,
      role: 'manager',
      serverApp: server.app,
    });
    context = fixture.context;
    deviceId = fixture.deviceId;
  });
  afterAll(async () => {
    await server.close();
  });

  it('freezes and redacts exact lot quantities, then reconciles opposite variances without releasing custody', async () => {
    const id = await product('lots', 5);
    const a = await lot(id, 2, 'recalled');
    const b = await lot(id, 3, 'quarantined');
    const created = await caller().inventory.createCountSession({ siteId, productIds: [id] });
    expect(created.lines[0]).toMatchObject({
      trackingMode: 'lots',
      expectedQuantity: null,
      unitCostSnapshot: null,
    });
    expect(created.lines[0]!.identities).toHaveLength(2);
    expect(
      created.lines[0]!.identities.every(
        row => row.expectedQuantity === null && row.status === null
      )
    ).toBe(true);
    await expect(
      caller().inventory.saveCountSession({
        id: created.id,
        version: 0,
        lines: [{ lineId: created.lines[0]!.id, version: 0, countedQuantity: 5 }],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'INVENTORY_COUNT_IDENTITY_INVALID' } });
    const saved = await caller().inventory.saveCountSession({
      id: created.id,
      version: 0,
      lines: [
        {
          lineId: created.lines[0]!.id,
          version: 0,
          countedQuantity: 5,
          identities: [
            { code: a.lotNumber, quantity: 4 },
            { code: b.lotNumber, quantity: 1 },
          ],
        },
      ],
    });
    const submitted = await caller().inventory.submitCountSession({
      id: saved.id,
      version: saved.version,
    });
    expect(submitted.lines[0]!.discrepancy).toBe(0);
    expect(submitted.discrepancyLineCount).toBe(1);
    const listed = await caller().inventory.listCountSessions({ siteId });
    expect(listed.items.find(row => row.id === submitted.id)?.discrepancyLineCount).toBe(1);
    await caller().inventory.approveCountSession({ id: submitted.id, version: submitted.version });
    expect(balance(id)).toBe(5);
    expect(db.select().from(inventoryLots).where(eq(inventoryLots.id, a.id)).get()).toMatchObject({
      onHand: 4,
      status: 'recalled',
      unitCost: 4,
      custodyVersion: 1,
    });
    expect(db.select().from(inventoryLots).where(eq(inventoryLots.id, b.id)).get()).toMatchObject({
      onHand: 1,
      status: 'quarantined',
    });
  });

  it('retains exact fractional lot value when a physical count removes only part of a batch', async () => {
    const id = await product('lots', 3.001);
    const a = await lot(id, 3.001, 'quarantined');
    db.update(inventoryLots)
      .set({ unitCost: 0.33, carryingValueCents: 100, valuationQuantity: 3.001 })
      .where(eq(inventoryLots.id, a.id))
      .run();
    const submitted = await submit(id, [{ code: a.lotNumber, quantity: 2 }]);
    await caller().inventory.approveCountSession({ id: submitted.id, version: submitted.version });
    expect(
      db
        .select()
        .from(inventoryCountIdentities)
        .where(eq(inventoryCountIdentities.lineId, submitted.lines[0]!.id))
        .get()
    ).toMatchObject({
      expectedValueCents: 100,
      appliedValueBeforeCents: 100,
      appliedValueDeltaCents: -33,
    });
    expect(balance(id)).toBe(2);
    expect(db.select().from(inventoryLots).where(eq(inventoryLots.id, a.id)).get()).toMatchObject({
      onHand: 2,
      valuationQuantity: 2,
      carryingValueCents: 67,
      status: 'quarantined',
    });
    expect(
      db
        .select()
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.tenantId, tenantId),
            eq(inventoryMovements.reference, `inventory-count:${submitted.id}`)
          )
        )
        .get()
    ).toMatchObject({
      inventoryValueDeltaCents: -33,
      cogsValueDeltaCents: -33,
    });
  });

  it('records monetary variance when opposite batch counts keep the same total quantity', async () => {
    const id = await product('lots', 6.002);
    const a = await lot(id, 3.001, 'recalled');
    const b = await lot(id, 3.001, 'quarantined');
    db.update(inventoryLots)
      .set({ unitCost: 0.33, carryingValueCents: 100, valuationQuantity: 3.001 })
      .where(eq(inventoryLots.id, a.id))
      .run();
    db.update(inventoryLots)
      .set({ unitCost: 0.67, carryingValueCents: 200, valuationQuantity: 3.001 })
      .where(eq(inventoryLots.id, b.id))
      .run();
    const submitted = await submit(id, [
      { code: a.lotNumber, quantity: 2 },
      { code: b.lotNumber, quantity: 4.002 },
    ]);
    await caller().inventory.approveCountSession({ id: submitted.id, version: submitted.version });
    expect(balance(id)).toBe(6.002);
    expect(db.select().from(inventoryLots).where(eq(inventoryLots.id, a.id)).get()).toMatchObject({
      carryingValueCents: 67,
      valuationQuantity: 2,
      status: 'recalled',
    });
    expect(db.select().from(inventoryLots).where(eq(inventoryLots.id, b.id)).get()).toMatchObject({
      carryingValueCents: 267,
      valuationQuantity: 4.002,
      status: 'quarantined',
    });
    expect(
      db
        .select()
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.tenantId, tenantId),
            eq(inventoryMovements.reference, `inventory-count:${submitted.id}`)
          )
        )
        .get()
    ).toMatchObject({
      previousStock: 6.002,
      newStock: 6.002,
      inventoryValueDeltaCents: 34,
      cogsValueDeltaCents: 34,
    });
  });

  it('freezes exact count evidence and rejects value-only custody ABA before approval', async () => {
    const id = await product('lots', 3.001);
    const a = await lot(id, 3.001, 'quarantined');
    db.update(inventoryLots)
      .set({ unitCost: 0.33, carryingValueCents: 100, valuationQuantity: 3.001 })
      .where(eq(inventoryLots.id, a.id))
      .run();
    const submitted = await submit(id, [{ code: a.lotNumber, quantity: 2 }]);
    const snapshot = db
      .select()
      .from(inventoryCountIdentities)
      .where(eq(inventoryCountIdentities.lineId, submitted.lines[0]!.id))
      .get()!;
    expect(snapshot).toMatchObject({
      expectedValueCents: 100,
      appliedValueBeforeCents: null,
      appliedValueDeltaCents: null,
    });
    for (const cents of [101, 100])
      db.update(inventoryLots)
        .set({ carryingValueCents: cents })
        .where(eq(inventoryLots.id, a.id))
        .run();
    await expect(
      caller().inventory.approveCountSession({ id: submitted.id, version: submitted.version })
    ).rejects.toMatchObject({ cause: { errorCode: 'INVENTORY_COUNT_IDENTITY_CHANGED' } });
    expect(balance(id)).toBe(3.001);
    expect(
      db
        .select()
        .from(inventoryCountIdentities)
        .where(eq(inventoryCountIdentities.id, snapshot.id))
        .get()
    ).toEqual(snapshot);
    expect(
      db
        .select()
        .from(inventoryCountSessions)
        .where(eq(inventoryCountSessions.id, submitted.id))
        .get()?.status
    ).toBe('submitted');
  });

  it('keeps serial counts blind and preserves exact returned provenance through missing and found', async () => {
    const id = await product('serials', 2);
    const a = await serial(id);
    const b = await serial(id, 'returned');
    const created = await caller().inventory.createCountSession({ siteId, productIds: [id] });
    expect(created.lines[0]!.identities).toEqual([]);
    expect(JSON.stringify(created)).not.toContain(a.serialNumber);
    expect(JSON.stringify(created)).not.toContain(b.serialNumber);
    const saved = await caller().inventory.saveCountSession({
      id: created.id,
      version: 0,
      lines: [
        {
          lineId: created.lines[0]!.id,
          version: 0,
          countedQuantity: 1,
          identities: [{ code: a.serialNumber.toLowerCase(), quantity: 1 }],
        },
      ],
    });
    expect(saved.lines[0]!.identities.map(row => row.code)).toEqual([a.serialNumber]);
    const submitted = await caller().inventory.submitCountSession({
      id: saved.id,
      version: saved.version,
    });
    await caller().inventory.approveCountSession({ id: submitted.id, version: submitted.version });
    expect(balance(id)).toBe(1);
    expect(db.select().from(productSerials).where(eq(productSerials.id, b.id)).get()).toMatchObject(
      {
        status: 'missing',
        stockStatusBeforeMissing: 'returned',
        unitCost: 4,
        warrantyExpiresAt: '2030-01-01',
      }
    );
    const found = await submit(id, [
      { code: a.serialNumber, quantity: 1 },
      { code: b.serialNumber, quantity: 1 },
    ]);
    await caller().inventory.approveCountSession({ id: found.id, version: found.version });
    expect(balance(id)).toBe(2);
    expect(db.select().from(productSerials).where(eq(productSerials.id, b.id)).get()).toMatchObject(
      {
        status: 'returned',
        stockStatusBeforeMissing: null,
        unitCost: 4,
        warrantyExpiresAt: '2030-01-01',
      }
    );
  });

  it.each(['reserved', 'sold', 'in_transit', 'returned_to_supplier'] as const)(
    'cannot count or revive a %s serial',
    async status => {
      const id = await product('serials', 1);
      await serial(id);
      const excluded = await serial(id, status);
      const created = await caller().inventory.createCountSession({ siteId, productIds: [id] });
      await expect(
        caller().inventory.saveCountSession({
          id: created.id,
          version: 0,
          lines: [
            {
              lineId: created.lines[0]!.id,
              version: 0,
              countedQuantity: 1,
              identities: [{ code: excluded.serialNumber, quantity: 1 }],
            },
          ],
        })
      ).rejects.toMatchObject({ cause: { errorCode: 'INVENTORY_COUNT_IDENTITY_INVALID' } });
      expect(balance(id)).toBe(1);
      expect(
        db.select().from(productSerials).where(eq(productSerials.id, excluded.id)).get()!.status
      ).toBe(status);
    }
  );

  it('rejects unknown, foreign-site, foreign-product and normalized duplicate serial observations', async () => {
    const id = await product('serials', 1);
    const a = await serial(id);
    const elsewhere = await serial(id, 'in_stock', branchId);
    const otherProduct = await product('serials', 1);
    const other = await serial(otherProduct);
    const created = await caller().inventory.createCountSession({ siteId, productIds: [id] });
    for (const codes of [
      ['UNKNOWN'],
      [elsewhere.serialNumber],
      [other.serialNumber],
      [a.serialNumber, a.serialNumber.toLowerCase()],
    ]) {
      await expect(
        caller().inventory.saveCountSession({
          id: created.id,
          version: 0,
          lines: [
            {
              lineId: created.lines[0]!.id,
              version: 0,
              countedQuantity: codes.length,
              identities: codes.map(code => ({ code, quantity: 1 })),
            },
          ],
        })
      ).rejects.toMatchObject({ cause: { errorCode: 'INVENTORY_COUNT_IDENTITY_INVALID' } });
    }
    expect(balance(id)).toBe(1);
  });

  it('rejects a same-quantity ABA custody transition but accepts a sync acknowledgement', async () => {
    const id = await product('lots', 3);
    const a = await lot(id, 3);
    const submitted = await submit(id, [{ code: a.lotNumber, quantity: 2 }]);
    db.update(inventoryLots).set({ status: 'quarantined' }).where(eq(inventoryLots.id, a.id)).run();
    db.update(inventoryLots).set({ status: 'active' }).where(eq(inventoryLots.id, a.id)).run();
    await expect(
      caller().inventory.approveCountSession({ id: submitted.id, version: submitted.version })
    ).rejects.toMatchObject({ cause: { errorCode: 'INVENTORY_COUNT_IDENTITY_CHANGED' } });
    expect(balance(id)).toBe(3);
    const id2 = await product('lots', 3);
    const b = await lot(id2, 3);
    const submitted2 = await submit(id2, [{ code: b.lotNumber, quantity: 2 }]);
    markEntityAsSynced(
      db,
      syncEntityConfig.inventory_lots,
      tenantId,
      b.id,
      new Date().toISOString()
    );
    expect(
      db.select().from(inventoryLots).where(eq(inventoryLots.id, b.id)).get()!.syncStatus
    ).toBe('synced');
    expect(
      db.select().from(inventoryLots).where(eq(inventoryLots.id, b.id)).get()!.custodyVersion
    ).toBe(0);
    await caller().inventory.approveCountSession({
      id: submitted2.id,
      version: submitted2.version,
    });
    expect(balance(id2)).toBe(2);
  });

  it('quarantines rediscovered depleted lots and keeps expired stock blocked at zero', async () => {
    const id = await product('lots', 2);
    const a = await lot(id, 0, 'depleted');
    const b = await lot(id, 2, 'expired');
    const submitted = await submit(id, [
      { code: a.lotNumber, quantity: 3 },
      { code: b.lotNumber, quantity: 0 },
    ]);
    await caller().inventory.approveCountSession({ id: submitted.id, version: submitted.version });
    expect(balance(id)).toBe(3);
    expect(db.select().from(inventoryLots).where(eq(inventoryLots.id, a.id)).get()!.status).toBe(
      'quarantined'
    );
    expect(db.select().from(inventoryLots).where(eq(inventoryLots.id, b.id)).get()!.status).toBe(
      'expired'
    );
    expect(
      db.select().from(inventoryLotEvents).where(eq(inventoryLotEvents.lotId, a.id)).all()
    ).toHaveLength(1);
  });

  it('depletes an active lot counted to zero and quarantines later rediscovery', async () => {
    const id = await product('lots', 2);
    const a = await lot(id, 2);
    for (const quantity of [0, 2]) {
      const submitted = await submit(id, [{ code: a.lotNumber, quantity }]);
      await caller().inventory.approveCountSession({
        id: submitted.id,
        version: submitted.version,
      });
      expect(balance(id)).toBe(quantity);
      expect(db.select().from(inventoryLots).where(eq(inventoryLots.id, a.id)).get()!.status).toBe(
        quantity === 0 ? 'depleted' : 'quarantined'
      );
      const events = db
        .select()
        .from(inventoryLotEvents)
        .where(eq(inventoryLotEvents.lotId, a.id))
        .all();
      expect(events).toHaveLength(quantity === 0 ? 0 : 1);
      if (quantity > 0)
        expect(events[0]).toMatchObject({
          eventType: 'quarantine',
          previousStatus: 'depleted',
          nextStatus: 'quarantined',
        });
    }
  });

  it('rolls identity, stock and approval back when the transactional outbox fails', async () => {
    const id = await product('serials', 1);
    const a = await serial(id);
    const submitted = await submit(id, []);
    db.$client.exec(
      "CREATE TRIGGER count_outbox_failure BEFORE INSERT ON sync_outbox WHEN NEW.entity_type = 'inventory_movements' BEGIN SELECT RAISE(ABORT, 'injected count outbox failure'); END"
    );
    try {
      await __withExpectedTestLogs(
        [
          { level: 'error', module: 'trpc-tracing', message: 'trpc procedure error' },
          { level: 'error', module: 'observability', message: 'captured exception' },
        ],
        () =>
          expect(
            caller().inventory.approveCountSession({ id: submitted.id, version: submitted.version })
          ).rejects.toThrow('injected count outbox failure')
      );
    } finally {
      db.$client.exec('DROP TRIGGER count_outbox_failure');
    }
    expect(balance(id)).toBe(1);
    expect(db.select().from(productSerials).where(eq(productSerials.id, a.id)).get()!.status).toBe(
      'in_stock'
    );
    expect(
      db
        .select()
        .from(inventoryCountSessions)
        .where(eq(inventoryCountSessions.id, submitted.id))
        .get()!.status
    ).toBe('submitted');
    expect(
      db.select().from(inventoryMovements).where(eq(inventoryMovements.productId, id)).all()
    ).toHaveLength(0);
    await caller().inventory.approveCountSession({ id: submitted.id, version: submitted.version });
    expect(balance(id)).toBe(0);
    expect(
      db
        .select()
        .from(inventoryCountIdentities)
        .where(eq(inventoryCountIdentities.lineId, submitted.lines[0]!.id))
        .get()!.countedQuantity
    ).toBe(0);
  });
});
