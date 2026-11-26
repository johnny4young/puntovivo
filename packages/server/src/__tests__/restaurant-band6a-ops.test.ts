/**
 * PR 6A restaurant operations suite:
 * 1. `restaurantServices.addRound` — append rounds to an existing open check without fragmentation.
 * 2. Station-routed thermal comandas & void tickets in `hardware_outbox` + SSRF LAN policy.
 * 3. Non-fiscal `getPrecheck` / `printPrecheck` with editable voluntary tip (Ley 1935/2018).
 * 4. Waiter/cashier `splitEqual` (`Total / N`) and `splitSharedLine` with exact cent conservation.
 * 5. Modifier BOM ingredient deduction & reversal on discard/void/return.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import {
  cashSessions,
  hardwareOutbox,
  inventoryBalances,
  kdsOrders,
  products,
  restaurantTables,
  sales,
  sequentials,
  sitePeripherals,
  sites,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { ESCPOS_BYTES } from '../services/peripherals/escpos/byte-builder.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let db: DatabaseInstance;
let tenantId: string;
let adminId: string;
let siteId: string;
let baseUnitId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;

const manager = () => appRouter.createCaller(fresh({ role: 'manager' }));
const cashier = () => appRouter.createCaller(fresh({ role: 'cashier' }));

async function createTable(name: string): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(restaurantTables).values({
    id,
    tenantId,
    siteId,
    name,
    seatCount: 6,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function createProduct(name: string, price: number, initialStock = 100): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id,
    tenantId,
    name,
    sku: `R6A-${nanoid(8)}`,
    price,
    price2: price,
    price3: price,
    cost: price / 2,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 0,
    initialCost: price / 2,
    minStock: 0,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(unitXProduct).values({
    id: nanoid(),
    productId: id,
    unitId: baseUnitId,
    equivalence: 1,
    price,
    price2: price,
    price3: price,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(inventoryBalances).values({
    id: nanoid(),
    tenantId,
    siteId,
    productId: id,
    onHand: initialStock,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

function getSiteOnHand(productId: string): number {
  return (
    db
      .select({ onHand: inventoryBalances.onHand })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, siteId),
          eq(inventoryBalances.productId, productId)
        )
      )
      .get()?.onHand ?? 0
  );
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  db = getDatabase();
  const tenant = db.select().from(tenants).get()!;
  tenantId = tenant.id;
  const admin = db.select().from(users).where(eq(users.tenantId, tenantId)).get()!;
  adminId = admin.id;
  const site = db.select().from(sites).where(eq(sites.tenantId, tenantId)).get()!;
  siteId = site.id;
  const unit = db.select().from(units).where(eq(units.tenantId, tenantId)).get()!;
  baseUnitId = unit.id;

  const settings = (tenant.settings ?? {}) as Record<string, unknown>;
  await db
    .update(tenants)
    .set({
      settings: {
        ...settings,
        modules: {
          ...((settings.modules as Record<string, unknown> | undefined) ?? {}),
          'dine-in': true,
          kds: true,
          'tip-split': true,
        },
      },
    })
    .where(eq(tenants.id, tenantId));

  const reg = await registerDeviceService(db, {
    tenantId,
    userId: adminId,
    kind: 'web',
    name: 'Band 6A Restaurant Test',
    authorityRole: 'authority_node',
    pairedSiteId: siteId,
  });
  fresh = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId,
    userId: adminId,
    email: admin.email,
    deviceId: reg.deviceId,
    siteId,
  });

  // Open an active cash session for the test site.
  const now = new Date().toISOString();
  await db.insert(cashSessions).values({
    id: nanoid(),
    tenantId,
    siteId,
    cashierId: adminId,
    registerName: 'Caja Restaurante',
    openingFloat: 0,
    openingCountDenominations: [],
    expectedBalance: 0,
    status: 'open',
    openedAt: now,
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(async () => {
  await server.close();
});

describe('Band 6A — Restaurant operational closure', () => {
  it('6A.1 appends multiple rounds to the SAME open check without creating fragmented checks', async () => {
    const tableId = await createTable(`Mesa Rondas ${nanoid(4)}`);
    const dish1 = await createProduct('Bandeja Paisa', 32000, 50);
    const dish2 = await createProduct('Limonada Natural', 8000, 50);
    const dish3 = await createProduct('Tres Leches', 12000, 50);

    // Round 1 opens the check.
    await cashier().restaurantServices.openCheck({
      tableId,
      guestCount: 2,
      priceTier: 1,
      diners: [
        { clientId: 'seat-1', seatNumber: 1 },
        { clientId: 'seat-2', seatNumber: 2 },
      ],
      items: [
        {
          productId: dish1,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 32000,
          discount: 0,
          taxRate: 0,
          dinerClientId: 'seat-1',
          courseKey: 'main',
          modifiers: [],
        },
      ],
    });

    const state1 = await cashier().restaurantServices.getTableState({ tableId });
    expect(state1.checks).toHaveLength(1);
    const check1 = state1.checks[0]!;
    expect(check1.rounds).toHaveLength(1);
    expect(check1.total).toBe(32000);

    // Round 2 appends to check1 (NO second check created!).
    const r2 = await cashier().restaurantServices.addRound({
      tableId,
      checkId: check1.id,
      expectedCheckVersion: check1.version,
      diners: [{ clientId: 'seat-2', seatNumber: 2 }],
      items: [
        {
          productId: dish2,
          unitId: baseUnitId,
          quantity: 2,
          unitPrice: 8000,
          discount: 0,
          taxRate: 0,
          dinerClientId: 'seat-2',
          courseKey: 'drink',
          modifiers: [],
        },
      ],
    });
    expect(r2.checkId).toBe(check1.id);
    expect(r2.roundSequence).toBe(2);
    expect(r2.total).toBe(48000);

    // Stale expectedCheckVersion fails closed.
    await expect(
      cashier().restaurantServices.addRound({
        tableId,
        checkId: check1.id,
        expectedCheckVersion: check1.version,
        diners: [],
        items: [
          {
            productId: dish3,
            unitId: baseUnitId,
            quantity: 1,
            unitPrice: 12000,
            discount: 0,
            taxRate: 0,
            courseKey: 'dessert',
            modifiers: [],
          },
        ],
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // Round 3 with updated version succeeds.
    const r3 = await cashier().restaurantServices.addRound({
      tableId,
      checkId: check1.id,
      expectedCheckVersion: r2.checkVersion,
      diners: [],
      items: [
        {
          productId: dish3,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 12000,
          discount: 0,
          taxRate: 0,
          courseKey: 'dessert',
          modifiers: [],
        },
      ],
    });
    expect(r3.roundSequence).toBe(3);
    expect(r3.total).toBe(60000);

    const state3 = await cashier().restaurantServices.getTableState({ tableId });
    expect(state3.checks).toHaveLength(1);
    expect(state3.checks[0]!.rounds.map(r => r.sequence)).toEqual([1, 2, 3]);
    expect(state3.checks[0]!.lines).toHaveLength(3);
    expect(getSiteOnHand(dish1)).toBe(49);
    expect(getSiteOnHand(dish2)).toBe(48);
    expect(getSiteOnHand(dish3)).toBe(49);

    // KDS dispatched 3 separate station orders (1 per round, never duplicating earlier lines).
    const kitchenTickets = db
      .select()
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.saleId, check1.saleId)))
      .all();
    expect(kitchenTickets).toHaveLength(3);
  });

  it('6A.2 routes thermal comandas & void tickets per KDS station and blocks unsafe TCP targets', async () => {
    const grillStation = await manager().kds.saveStation({
      siteId,
      code: 'grill',
      name: 'Parrilla',
      isActive: true,
      position: 1,
      expectedVersion: 0,
      printerConfig: {
        mode: 'tcp',
        host: '192.168.1.55',
        port: 9100,
        paperWidth: '80mm',
        characterSet: 'cp858',
        copies: 1,
      },
    });
    expect(grillStation.printerConfig?.mode).toBe('tcp');

    // SSRF guard: localhost and public IPs must be rejected.
    await expect(
      manager().kds.saveStation({
        siteId,
        code: 'bad',
        name: 'Bad',
        isActive: true,
        position: 9,
        expectedVersion: 0,
        printerConfig: {
          mode: 'tcp',
          host: '127.0.0.1',
          port: 9100,
          paperWidth: '80mm',
          characterSet: 'cp858',
          copies: 1,
        },
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const steakId = await createProduct('Churrasco 300g', 45000, 20);
    await manager().kds.saveRoutingRule({
      siteId,
      targetKind: 'product',
      targetId: steakId,
      route: 'station',
      stationId: grillStation.id,
      expectedRuleId: null,
      expectedVersion: 0,
    });

    const tableId = await createTable(`Mesa Comanda ${nanoid(4)}`);
    const opened = await cashier().restaurantServices.openCheck({
      tableId,
      guestCount: 2,
      priceTier: 1,
      diners: [{ clientId: 'seat-1', seatNumber: 1 }],
      items: [
        {
          productId: steakId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 45000,
          discount: 0,
          taxRate: 0,
          dinerClientId: 'seat-1',
          courseKey: 'main',
          notes: 'Termino medio',
          modifiers: [],
        },
      ],
    });

    const outboxOrders = db
      .select()
      .from(hardwareOutbox)
      .where(
        and(eq(hardwareOutbox.tenantId, tenantId), eq(hardwareOutbox.kind, 'print-kitchen-ticket'))
      )
      .all()
      .filter(row => (row.payload as { saleId?: string }).saleId === opened.id);

    expect(outboxOrders).toHaveLength(1);
    const orderPayload = outboxOrders[0]!.payload as {
      stationCode: string;
      ticketKind: string;
      escposBytes: number[];
      stationPrinterConfig: { host: string; port: number };
    };
    expect(orderPayload.stationCode).toBe('grill');
    expect(orderPayload.ticketKind).toBe('order');
    expect(orderPayload.stationPrinterConfig.host).toBe('192.168.1.55');
    // Starts with ESC @ init and ends with GS V 0 cut.
    expect(orderPayload.escposBytes.slice(0, 2)).toEqual(Array.from(ESCPOS_BYTES.INIT));
    expect(orderPayload.escposBytes.slice(-3)).toEqual(Array.from(ESCPOS_BYTES.CUT_FULL));

    // Discarding the draft enqueues a kitchen void ticket to the same station printer.
    await manager().sales.discardDraft({ saleId: opened.id });
    const voidJobs = db
      .select()
      .from(hardwareOutbox)
      .where(
        and(eq(hardwareOutbox.tenantId, tenantId), eq(hardwareOutbox.kind, 'print-kitchen-ticket'))
      )
      .all()
      .filter(
        row =>
          (row.payload as { saleId?: string; ticketKind?: string }).saleId === opened.id &&
          (row.payload as { ticketKind?: string }).ticketKind === 'void'
      );
    expect(voidJobs).toHaveLength(1);
  });

  it('6A.3 builds and prints non-fiscal precheck with editable tip (Ley 1935/2018) without consuming sequentials', async () => {
    const tableId = await createTable(`Mesa Precuenta ${nanoid(4)}`);
    const soupId = await createProduct('Ajiaco Santafereño', 25000, 20);
    const opened = await cashier().restaurantServices.openCheck({
      tableId,
      guestCount: 2,
      priceTier: 1,
      diners: [],
      items: [
        {
          productId: soupId,
          unitId: baseUnitId,
          quantity: 2,
          unitPrice: 25000,
          discount: 0,
          taxRate: 0,
          courseKey: 'main',
          modifiers: [],
        },
      ],
    });

    const seqBefore = db
      .select({ currentValue: sequentials.currentValue })
      .from(sequentials)
      .where(and(eq(sequentials.tenantId, tenantId), eq(sequentials.documentType, 'sale')))
      .get()!.currentValue;

    const preview10 = await cashier().restaurantServices.getPrecheck({ tableId });
    expect(preview10.isFiscalDocument).toBe(false);
    expect(preview10.baseTotal).toBe(50000);
    expect(preview10.tipPercent).toBe(10);
    expect(preview10.suggestedTipAmount).toBe(5000);
    expect(preview10.totalWithTip).toBe(55000);
    expect(preview10.voluntaryTipNoticeEs).toContain('Ley 1935 de 2018');

    const preview15 = await cashier().restaurantServices.getPrecheck({ tableId, tipPercent: 15 });
    expect(preview15.suggestedTipAmount).toBe(7500);
    expect(preview15.totalWithTip).toBe(57500);

    // Register an active ESC/POS site printer so printPrecheck enqueues to hardware_outbox.
    const now = new Date().toISOString();
    await db
      .update(sitePeripherals)
      .set({ isActive: false })
      .where(
        and(
          eq(sitePeripherals.tenantId, tenantId),
          eq(sitePeripherals.siteId, siteId),
          eq(sitePeripherals.kind, 'printer')
        )
      );
    await db.insert(sitePeripherals).values({
      id: nanoid(),
      tenantId,
      siteId,
      kind: 'printer',
      driver: 'escpos',
      config: { channel: 'mock', paperWidth: '80mm', characterSet: 'cp858' },
      displayName: 'Caja térmica',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const printed = await cashier().restaurantServices.printPrecheck({
      tableId,
      tipPercent: 10,
      markBillRequested: true,
    });
    expect(printed.printedVia).toBe('hardware_outbox');
    expect(printed.outboxId).toBeTruthy();

    // Sale remains an open draft and sequential counter did NOT advance.
    const saleRow = db.select().from(sales).where(eq(sales.id, opened.id)).get()!;
    expect(saleRow.status).toBe('draft');
    const seqAfter = db
      .select({ currentValue: sequentials.currentValue })
      .from(sequentials)
      .where(and(eq(sequentials.tenantId, tenantId), eq(sequentials.documentType, 'sale')))
      .get()!.currentValue;
    expect(seqAfter).toBe(seqBefore);

    const stateAfter = await cashier().restaurantServices.getTableState({ tableId });
    expect(stateAfter.service?.billRequestedAt).not.toBeNull();
  });

  it('6A.4 lets waiters/cashiers split equally (Total / N) and split a shared dish with exact cent conservation', async () => {
    const tableId = await createTable(`Mesa Split ${nanoid(4)}`);
    const platterId = await createProduct('Picada Familiar', 10000, 30);

    await cashier().restaurantServices.openCheck({
      tableId,
      guestCount: 3,
      priceTier: 1,
      diners: [],
      items: [
        {
          productId: platterId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 10000,
          discount: 0,
          taxRate: 0,
          courseKey: 'main',
          modifiers: [],
        },
      ],
    });

    const beforeSplit = await cashier().restaurantServices.getTableState({ tableId });
    const mainCheck = beforeSplit.checks[0]!;
    const kdsBefore = db
      .select()
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.tableId, tableId)))
      .all().length;

    // Cashier (NOT manager!) splits $10.000 equally into 3 payable checks.
    const splitRes = await cashier().restaurantServices.splitEqual({
      tableId,
      checkId: mainCheck.id,
      expectedCheckVersion: mainCheck.version,
      parts: 3,
    });

    expect(splitRes.checks).toHaveLength(3);
    expect(splitRes.checks.map(c => c.total)).toEqual([3333.34, 3333.33, 3333.33]);
    const totalSum = Number(splitRes.checks.reduce((s, c) => s + c.total, 0).toFixed(2));
    expect(totalSum).toBe(10000);

    // KDS did NOT fire duplicate orders for the split shares.
    const kdsAfter = db
      .select()
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.tableId, tableId)))
      .all().length;
    expect(kdsAfter).toBe(kdsBefore);

    // Settle the first split check cleanly without any price-override false positive.
    const resumed = await cashier().sales.resume({ saleId: splitRes.checks[0]!.saleId });
    expect(resumed.id).toBe(splitRes.checks[0]!.saleId);
    const completed = await cashier().sales.completeDraft({
      saleId: splitRes.checks[0]!.saleId,
      paymentMethod: 'cash',
      amountReceived: 3400,
    });
    expect(completed.status).toBe('completed');

    // Shared-dish split on a fresh table across 2 checks by cashier.
    const table2 = await createTable(`Mesa Compartido ${nanoid(4)}`);
    const bottleId = await createProduct('Botella Vino', 60000, 10);
    await cashier().restaurantServices.openCheck({
      tableId: table2,
      guestCount: 2,
      priceTier: 1,
      diners: [],
      items: [
        {
          productId: bottleId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 60000,
          discount: 0,
          taxRate: 0,
          courseKey: 'drink',
          modifiers: [],
        },
      ],
    });
    const st2 = await cashier().restaurantServices.getTableState({ tableId: table2 });
    const bottleItemId = st2.checks[0]!.lines[0]!.saleItemId;
    const sharedRes = await cashier().restaurantServices.splitSharedLine({
      tableId: table2,
      checks: [{ checkId: st2.checks[0]!.id, version: st2.checks[0]!.version }],
      saleItemId: bottleItemId,
      targetCheckIds: [st2.checks[0]!.id, null],
    });
    expect(sharedRes.checks).toHaveLength(2);
    expect(sharedRes.checks.map(c => c.total)).toEqual([30000, 30000]);
  });

  it('6A.5 deducts modifier BOM ingredients on openCheck & addRound, skips without-removals, and reverses on discard', async () => {
    const burgerId = await createProduct('Hamburguesa Clásica', 24000, 20);
    const cheeseIngredientId = await createProduct('Queso Cheddar Insumo', 2000, 10);
    const onionIngredientId = await createProduct('Cebolla Insumo', 1000, 10);

    const extraCheese = await manager().restaurantModifiers.save({
      siteId,
      expectedVersion: 0,
      name: 'Extra Queso Cheddar',
      unitPriceDelta: 3500,
      maxQuantity: 3,
      requiresManager: false,
      isActive: true,
    });
    const noOnion = await manager().restaurantModifiers.save({
      siteId,
      expectedVersion: 0,
      name: 'Cebolla',
      unitPriceDelta: 0,
      maxQuantity: 1,
      requiresManager: false,
      isActive: true,
    });
    const withoutGroup = await manager().restaurantModifiers.saveGroup({
      siteId,
      expectedVersion: 0,
      name: 'Sin ingredientes',
      kind: 'without',
      selection: 'multiple',
      minSelections: 0,
      maxSelections: 1,
      isActive: true,
      catalogIds: [noOnion.id],
      productIds: [burgerId],
    });

    await manager().restaurantModifiers.setBomComponents({
      siteId,
      catalogId: extraCheese.id,
      components: [{ componentProductId: cheeseIngredientId, quantity: 0.25 }],
    });
    await manager().restaurantModifiers.setBomComponents({
      siteId,
      catalogId: noOnion.id,
      components: [{ componentProductId: onionIngredientId, quantity: 0.1 }],
    });

    const tableId = await createTable(`Mesa BOM ${nanoid(4)}`);
    // Round 1: 2 burgers × 2x Extra Cheese = 2 * 2 * 0.25 = 1.0 cheese deducted; "without" onion deducts 0!
    const opened = await cashier().restaurantServices.openCheck({
      tableId,
      guestCount: 2,
      priceTier: 1,
      diners: [],
      items: [
        {
          productId: burgerId,
          unitId: baseUnitId,
          quantity: 2,
          unitPrice: 24000,
          discount: 0,
          taxRate: 0,
          courseKey: 'main',
          modifierGroups: [{ id: withoutGroup.id, version: withoutGroup.version }],
          modifiers: [
            {
              catalogId: extraCheese.id,
              catalogVersion: extraCheese.version,
              name: extraCheese.name,
              quantity: 2,
              unitPriceDelta: 3500,
            },
            {
              catalogId: noOnion.id,
              catalogVersion: noOnion.version,
              groupId: withoutGroup.id,
              name: noOnion.name,
              quantity: 1,
              unitPriceDelta: 0,
            },
          ],
        },
      ],
    });

    expect(getSiteOnHand(cheeseIngredientId)).toBeCloseTo(9.0, 5);
    expect(getSiteOnHand(onionIngredientId)).toBeCloseTo(10.0, 5);

    // Round 2: 1 burger × 1x Extra Cheese = 0.25 more deducted (total 1.25 deducted).
    const st = await cashier().restaurantServices.getTableState({ tableId });
    await cashier().restaurantServices.addRound({
      tableId,
      checkId: st.checks[0]!.id,
      expectedCheckVersion: st.checks[0]!.version,
      diners: [],
      items: [
        {
          productId: burgerId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 24000,
          discount: 0,
          taxRate: 0,
          courseKey: 'main',
          modifiers: [
            {
              catalogId: extraCheese.id,
              catalogVersion: extraCheese.version,
              name: extraCheese.name,
              quantity: 1,
              unitPriceDelta: 3500,
            },
          ],
        },
      ],
    });

    expect(getSiteOnHand(cheeseIngredientId)).toBeCloseTo(8.75, 5);

    // Discarding the draft restores exact 1.25 cheese back to 10.0!
    await manager().sales.discardDraft({ saleId: opened.id });
    expect(getSiteOnHand(cheeseIngredientId)).toBeCloseTo(10.0, 5);
  });
});
