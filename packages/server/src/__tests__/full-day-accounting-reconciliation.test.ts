/**
 * Full-day operational & accounting reconciliation integration suite.
 *
 * Exercises realistic multi-step business days end to end across purchasing,
 * promotions, freeze/park/resume/carry-over, credit & till payments,
 * idempotent replay, multi-wave partial returns, store credit, exchanges,
 * multi-site deferred transfers with shortage, restaurant service + KDS +
 * tip/service-charge, cash sale void, and comprehensive day-close sign-off —
 * finishing every scenario with the 8-invariant SQLite DB auditor.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import {
  cashSessions,
  companies,
  inventoryBalances,
  products,
  restaurantTables,
  saleItems,
  salePayments,
  saleReturns,
  sites,
  tenantLocaleSettings,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { roundMoney } from '../lib/money.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { writeRestaurantSettings } from '../services/restaurant/settings.js';
import { appRouter } from '../trpc/router.js';
import type { CommandEnvelope } from '../trpc/schemas/envelope.js';
import { freshCriticalContext } from './utils/criticalCommandFixture.js';
import { assertTenantDbConsistency } from './utils/tenantDbConsistency.js';

let server: PuntovivoServer;
let db: DatabaseInstance;

function localBusinessDate(timeZone = 'America/Bogota'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function denominationsFor(amount: number) {
  return amount > 0 ? [{ value: roundMoney(amount), count: 1 }] : [];
}

interface SeededActor {
  id: string;
  email: string;
  role: 'admin' | 'manager' | 'cashier';
  deviceId: string;
}

function makeCaller(
  tenantId: string,
  actor: SeededActor,
  siteId: string,
  overrides?: { deviceId?: string; envelope?: CommandEnvelope }
) {
  return appRouter.createCaller(
    freshCriticalContext({
      db,
      serverApp: server.app,
      tenantId,
      userId: actor.id,
      email: actor.email,
      role: actor.role,
      siteId,
      deviceId: overrides?.deviceId ?? actor.deviceId,
      envelope: overrides?.envelope,
    })
  );
}

async function seedTenantWorkspace(
  tag: string,
  options: { extraSites?: number; modules?: string[] } = {}
) {
  const now = new Date().toISOString();
  const tenantId = `recon-t-${tag}-${nanoid(6)}`;
  const companyId = `recon-co-${tag}-${nanoid(6)}`;
  const siteIds: string[] = [];

  const modulesMap: Record<string, boolean> = {};
  for (const moduleKey of options.modules ?? []) {
    modulesMap[moduleKey] = true;
  }

  await db.insert(tenants).values({
    id: tenantId,
    name: `Recon ${tag}`,
    slug: `recon-${tag}-${nanoid(6)}`.toLowerCase(),
    settings: Object.keys(modulesMap).length > 0 ? { modules: modulesMap } : {},
    defaultCurrencyCode: 'COP',
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(tenantLocaleSettings).values({ tenantId, countryCode: 'CO' });
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: `Company ${tag}`,
    createdAt: now,
    updatedAt: now,
  });

  const siteCount = 1 + (options.extraSites ?? 0);
  for (let i = 0; i < siteCount; i++) {
    const id = `recon-s${i + 1}-${tag}-${nanoid(6)}`;
    siteIds.push(id);
    await db.insert(sites).values({
      id,
      tenantId,
      companyId,
      name: `Site ${i + 1}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  const unitId = `recon-u-${tag}-${nanoid(6)}`;
  await db.insert(units).values({
    id: unitId,
    tenantId,
    name: 'Unidad',
    abbreviation: 'und',
    createdAt: now,
    updatedAt: now,
  });

  const createActor = async (
    label: string,
    role: 'admin' | 'manager' | 'cashier'
  ): Promise<SeededActor> => {
    const id = `recon-${label}-${tag}-${nanoid(6)}`;
    const email = `${id}@example.com`;
    await db.insert(users).values({
      id,
      tenantId,
      email,
      name: `${label} ${tag}`,
      passwordHash: 'test-hash',
      role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const device = await registerDevice(db, {
      tenantId,
      userId: id,
      kind: 'web',
      name: `${label}-device-1`,
    });
    return { id, email, role, deviceId: device.deviceId };
  };

  const admin = await createActor('admin', 'admin');
  const manager = await createActor('manager', 'manager');
  const cashier1 = await createActor('cashier1', 'cashier');
  const cashier2 = await createActor('cashier2', 'cashier');

  for (const [index, siteId] of siteIds.entries()) {
    const adminCaller = makeCaller(tenantId, admin, siteId);
    await adminCaller.sequentials.upsert({
      siteId,
      documentType: 'sale',
      prefix: `S${index + 1}-`,
    });
    await adminCaller.sequentials.upsert({
      siteId,
      documentType: 'purchase',
      prefix: `P${index + 1}-`,
    });
    await adminCaller.sequentials.upsert({
      siteId,
      documentType: 'order',
      prefix: `O${index + 1}-`,
    });
  }

  return { tenantId, companyId, siteIds, unitId, admin, manager, cashier1, cashier2 };
}

async function seedProduct(args: {
  tenantId: string;
  siteId: string;
  unitId: string;
  name: string;
  price: number;
  cost: number;
  stock: number;
  taxRate?: number;
}) {
  const now = new Date().toISOString();
  const productId = `recon-p-${nanoid(8)}`;
  await db.insert(products).values({
    id: productId,
    tenantId: args.tenantId,
    name: args.name,
    sku: `SKU-${nanoid(8)}`,
    price: args.price,
    price2: args.price,
    price3: args.price,
    cost: args.cost,
    initialCost: args.cost,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: args.taxRate ?? 0,
    minStock: 0,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(unitXProduct).values({
    id: nanoid(),
    productId,
    unitId: args.unitId,
    equivalence: 1,
    price: args.price,
    price2: args.price,
    price3: args.price,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(inventoryBalances).values({
    id: nanoid(),
    tenantId: args.tenantId,
    siteId: args.siteId,
    productId,
    onHand: args.stock,
    reserved: 0,
    createdAt: now,
    updatedAt: now,
  });
  return productId;
}

describe('full-day operational and accounting reconciliation', () => {
  beforeAll(async () => {
    server = await createServer({
      dbPath: ':memory:',
      verbose: false,
    });
    db = getDatabase();
  });

  afterAll(async () => {
    await server?.close();
  });

  it('reconciles a full retail day (purchasing, promos, freeze/cross-device/stale-quote, credit + abono, idempotent replay, multi-wave returns, store credit, exchange, close & sign-off)', async () => {
    const ws = await seedTenantWorkspace('retail');
    const siteId = ws.siteIds[0]!;
    const businessDate = localBusinessDate();

    const coffeeId = await seedProduct({
      tenantId: ws.tenantId,
      siteId,
      unitId: ws.unitId,
      name: 'Cafe Molido',
      price: 10_000,
      cost: 6_000,
      stock: 0,
    });
    const teaId = await seedProduct({
      tenantId: ws.tenantId,
      siteId,
      unitId: ws.unitId,
      name: 'Te Verde',
      price: 8_000,
      cost: 4_000,
      stock: 0,
    });
    const muffinId = await seedProduct({
      tenantId: ws.tenantId,
      siteId,
      unitId: ws.unitId,
      name: 'Muffin Arandanos',
      price: 5_000,
      cost: 2_500,
      stock: 0,
    });

    // 1. Purchasing: direct purchase + PO with partial then final receipt.
    const provider = await makeCaller(ws.tenantId, ws.admin, siteId).providers.create({
      name: 'Distribuidora Central',
    });
    await makeCaller(ws.tenantId, ws.admin, siteId).purchases.create({
      providerId: provider.id,
      items: [{ productId: coffeeId, unitId: ws.unitId, quantity: 10, costPerUnit: 6_000 }],
    });

    const po = await makeCaller(ws.tenantId, ws.admin, siteId).orders.create({
      providerId: provider.id,
      status: 'submitted',
      items: [
        { productId: teaId, unitId: ws.unitId, quantity: 10, costPerUnit: 4_000 },
        { productId: muffinId, unitId: ws.unitId, quantity: 10, costPerUnit: 2_500 },
      ],
    });
    const poDetail = await makeCaller(ws.tenantId, ws.admin, siteId).orders.getById({ id: po.id });
    const teaOrderItem = poDetail.items.find(item => item.productId === teaId)!;
    const muffinOrderItem = poDetail.items.find(item => item.productId === muffinId)!;

    await makeCaller(ws.tenantId, ws.admin, siteId).purchases.createFromOrder({
      orderId: po.id,
      items: [
        { orderItemId: teaOrderItem.id, quantity: 4 },
        { orderItemId: muffinOrderItem.id, quantity: 4 },
      ],
    });
    expect(
      (await makeCaller(ws.tenantId, ws.admin, siteId).orders.getById({ id: po.id })).status
    ).toBe('partial_received');

    await makeCaller(ws.tenantId, ws.admin, siteId).purchases.createFromOrder({
      orderId: po.id,
      items: [
        { orderItemId: teaOrderItem.id, quantity: 6 },
        { orderItemId: muffinOrderItem.id, quantity: 6 },
      ],
    });
    expect(
      (await makeCaller(ws.tenantId, ws.admin, siteId).orders.getById({ id: po.id })).status
    ).toBe('received');

    // 2. Promotions: 10% off coffee + 2x1 NxM on muffins.
    const coffeePromo = await makeCaller(ws.tenantId, ws.admin, siteId).promotions.create({
      name: '10% Cafe',
      ruleKind: 'percentage',
      discountPct: 10,
      productId: coffeeId,
      combinable: true,
    });
    const activeCoffeePromo = await makeCaller(ws.tenantId, ws.admin, siteId).promotions.transition(
      {
        id: coffeePromo.id,
        version: coffeePromo.version,
        status: 'active',
      }
    );

    const muffinPromo = await makeCaller(ws.tenantId, ws.admin, siteId).promotions.create({
      name: '2x1 Muffins',
      ruleKind: 'nxm',
      buyQuantity: 2,
      payQuantity: 1,
      productId: muffinId,
      combinable: true,
    });
    await makeCaller(ws.tenantId, ws.admin, siteId).promotions.transition({
      id: muffinPromo.id,
      version: muffinPromo.version,
      status: 'active',
    });

    const customer = await makeCaller(ws.tenantId, ws.admin, siteId).customers.create({
      name: 'Ana Morales',
      creditLimit: 50_000,
    });

    // 3. Open two cash sessions (cashier1 + cashier2).
    const session1 = await makeCaller(ws.tenantId, ws.cashier1, siteId).cashSessions.open({
      registerName: 'Caja 1',
      openingFloat: 50_000,
      denominations: [{ value: 50_000, count: 1 }],
    });
    await makeCaller(ws.tenantId, ws.cashier2, siteId).cashSessions.open({
      registerName: 'Caja 2',
      openingFloat: 20_000,
      denominations: [{ value: 20_000, count: 1 }],
    });

    // 4. Promotional split-tender sale (2 coffee @ 10% off = 18_000 + 2 muffin 2x1 = 5_000 => 23_000).
    const promoItems = [
      { productId: coffeeId, unitId: ws.unitId, quantity: 2, unitPrice: 10_000, discount: 0 },
      { productId: muffinId, unitId: ws.unitId, quantity: 2, unitPrice: 5_000, discount: 0 },
    ];
    const promoQuote = await makeCaller(ws.tenantId, ws.cashier1, siteId).sales.quotePromotions({
      mode: 'fresh',
      customerId: customer.id,
      items: promoItems,
      discountAmount: 0,
    });
    expect(promoQuote.total).toBe(23_000);
    expect(promoQuote.promotionDiscountAmount).toBe(7_000);

    const promoSale = await makeCaller(ws.tenantId, ws.cashier1, siteId).sales.create({
      customerId: customer.id,
      items: promoItems,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      promotionFingerprint: promoQuote.fingerprint,
      payments: [
        { method: 'cash', amount: 13_000 },
        { method: 'card', amount: 10_000, reference: 'POS-9911' },
      ],
    });
    expect(promoSale.total).toBe(23_000);

    // 5. Freeze/park remaining 8 coffee -> proves stock reservation blocks cashier2 oversell,
    // cross-device claim rejects stale device 1, and pausing the promo trips PROMOTION_QUOTE_STALE.
    const draft = await makeCaller(ws.tenantId, ws.cashier1, siteId).sales.create({
      status: 'draft',
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      items: [
        { productId: coffeeId, unitId: ws.unitId, quantity: 8, unitPrice: 10_000, discount: 0 },
      ],
    });
    await makeCaller(ws.tenantId, ws.cashier1, siteId).sales.suspend({
      saleId: draft.id,
      label: 'Cliente VIP',
    });

    // Cashier 2 must not oversell stock reserved by the suspended draft.
    await expect(
      makeCaller(ws.tenantId, ws.cashier2, siteId).sales.create({
        items: [
          { productId: coffeeId, unitId: ws.unitId, quantity: 1, unitPrice: 10_000, discount: 0 },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        amountReceived: 10_000,
      })
    ).rejects.toThrow(/stock|insufficient|disponible/i);

    const cashier1SecondDevice = (
      await registerDevice(db, {
        tenantId: ws.tenantId,
        userId: ws.cashier1.id,
        kind: 'web',
        name: 'cashier1-device-2',
      })
    ).deviceId;

    await makeCaller(ws.tenantId, ws.cashier1, siteId, {
      deviceId: cashier1SecondDevice,
    }).sales.resume({ saleId: draft.id });

    // Stale Device 1 no longer owns the active draft claim.
    await expect(
      makeCaller(ws.tenantId, ws.cashier1, siteId).sales.completeDraft({
        saleId: draft.id,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        amountReceived: 80_000,
      })
    ).rejects.toThrow();

    // Quote before pausing promo, then pause promo -> completion with stale fingerprint must fail.
    const staleDraftQuote = await makeCaller(ws.tenantId, ws.cashier1, siteId, {
      deviceId: cashier1SecondDevice,
    }).sales.quotePromotions({
      mode: 'fromDraft',
      saleId: draft.id,
    });
    expect(staleDraftQuote.total).toBe(72_000);

    await makeCaller(ws.tenantId, ws.admin, siteId).promotions.transition({
      id: activeCoffeePromo.id,
      version: activeCoffeePromo.version,
      status: 'paused',
    });

    await expect(
      makeCaller(ws.tenantId, ws.cashier1, siteId, {
        deviceId: cashier1SecondDevice,
      }).sales.completeDraft({
        saleId: draft.id,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        amountReceived: 72_000,
        promotionFingerprint: staleDraftQuote.fingerprint,
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'PROMOTION_QUOTE_STALE' }),
    });

    // Re-quote after promo pause (full 80_000) and complete cleanly on Device 2.
    const freshDraftQuote = await makeCaller(ws.tenantId, ws.cashier1, siteId, {
      deviceId: cashier1SecondDevice,
    }).sales.quotePromotions({
      mode: 'fromDraft',
      saleId: draft.id,
    });
    expect(freshDraftQuote.total).toBe(80_000);

    await makeCaller(ws.tenantId, ws.cashier1, siteId, {
      deviceId: cashier1SecondDevice,
    }).sales.completeDraft({
      saleId: draft.id,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 80_000,
      promotionFingerprint: freshDraftQuote.fingerprint,
    });

    // 6. Credit sale (cashier requires manager approval; manager completes directly) + partial till abono.
    await expect(
      makeCaller(ws.tenantId, ws.cashier1, siteId).sales.create({
        customerId: customer.id,
        paymentMethod: 'credit',
        paymentStatus: 'pending',
        items: [
          { productId: teaId, unitId: ws.unitId, quantity: 2, unitPrice: 8_000, discount: 0 },
        ],
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_REQUIRED' }),
    });
    await makeCaller(ws.tenantId, ws.manager, siteId).cashSessions.open({
      registerName: 'Caja Gerencia',
      openingFloat: 0,
      denominations: [],
    });
    await makeCaller(ws.tenantId, ws.manager, siteId).sales.create({
      customerId: customer.id,
      paymentMethod: 'credit',
      paymentStatus: 'pending',
      items: [{ productId: teaId, unitId: ws.unitId, quantity: 2, unitPrice: 8_000, discount: 0 }],
    });
    await makeCaller(ws.tenantId, ws.manager, siteId).cashSessions.close({
      actualCount: 0,
      denominations: [],
    });
    await makeCaller(ws.tenantId, ws.cashier1, siteId).customerLedger.addTillPayment({
      customerId: customer.id,
      amount: 6_000,
      note: 'Abono en efectivo',
    });

    // 7. Idempotent replay with fixed CommandEnvelope must create only one sale.
    const replayEnvelope: CommandEnvelope = {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    };
    const firstTeaSale = await makeCaller(ws.tenantId, ws.cashier1, siteId, {
      envelope: replayEnvelope,
    }).sales.create({
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 8_000,
      items: [{ productId: teaId, unitId: ws.unitId, quantity: 1, unitPrice: 8_000, discount: 0 }],
    });
    const replayedTeaSale = await makeCaller(ws.tenantId, ws.cashier1, siteId, {
      envelope: replayEnvelope,
    }).sales.create({
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 8_000,
      items: [{ productId: teaId, unitId: ws.unitId, quantity: 1, unitPrice: 8_000, discount: 0 }],
    });
    expect(replayedTeaSale.id).toBe(firstTeaSale.id);

    // 8. Multi-wave partial returns on the promotional split sale + void guard + store credit spend + exchange.
    const promoSaleLines = db
      .select()
      .from(saleItems)
      .where(eq(saleItems.saleId, promoSale.id))
      .all();
    const coffeeLine = promoSaleLines.find(line => line.productId === coffeeId)!;
    const muffinLine = promoSaleLines.find(line => line.productId === muffinId)!;

    const promoCardPayment = db
      .select()
      .from(salePayments)
      .where(and(eq(salePayments.saleId, promoSale.id), eq(salePayments.method, 'card')))
      .get()!;

    // Wave 1: split-tender return allocates card before cash and requires an external refund reference.
    await expect(
      makeCaller(ws.tenantId, ws.manager, siteId).sales.returnSale({
        id: promoSale.id,
        items: [{ saleItemId: coffeeLine.id, quantity: 1 }],
        destination: 'original',
        reason: 'Empaque abierto',
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SALE_RETURN_EXTERNAL_REFERENCE_REQUIRED' }),
    });

    await makeCaller(ws.tenantId, ws.manager, siteId).sales.returnSale({
      id: promoSale.id,
      items: [{ saleItemId: coffeeLine.id, quantity: 1 }],
      destination: 'original',
      externalReferences: [{ salePaymentId: promoCardPayment.id, reference: 'CARD-REFUND-001' }],
      reason: 'Empaque abierto',
    });
    const wave1ReturnRow = db
      .select()
      .from(saleReturns)
      .where(and(eq(saleReturns.tenantId, ws.tenantId), eq(saleReturns.saleId, promoSale.id)))
      .get()!;

    // Mid-day audit proves `partially_refunded` returnState reconciles cleanly before Wave 2.
    await assertTenantDbConsistency(db, ws.tenantId);

    // Voiding a partially returned sale must be blocked.
    await expect(
      makeCaller(ws.tenantId, ws.admin, siteId).sales.void({
        id: promoSale.id,
        reason: 'Intento invalido',
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SALE_VOID_REFUNDED_FORBIDDEN' }),
    });

    // Wave 2: return remaining 1 coffee + 2 muffins to store credit.
    const wave2Return = await makeCaller(ws.tenantId, ws.manager, siteId).sales.returnSale({
      id: promoSale.id,
      items: [
        { saleItemId: coffeeLine.id, quantity: 1 },
        { saleItemId: muffinLine.id, quantity: 2 },
      ],
      destination: 'store_credit',
      reason: 'Cliente solicita saldo a favor',
    });
    expect(wave2Return.refundAmount).toBeGreaterThanOrEqual(5_000);

    // Wave 3: over-return must be rejected.
    await expect(
      makeCaller(ws.tenantId, ws.manager, siteId).sales.returnSale({
        id: promoSale.id,
        items: [{ saleItemId: coffeeLine.id, quantity: 1 }],
        destination: 'original',
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SALE_RETURN_ALREADY_REFUNDED' }),
    });

    // Spend store credit on 1 muffin (5_000).
    await makeCaller(ws.tenantId, ws.cashier1, siteId).sales.create({
      customerId: customer.id,
      paymentMethod: 'store_credit',
      paymentStatus: 'paid',
      payments: [{ method: 'store_credit', amount: 5_000 }],
      items: [
        { productId: muffinId, unitId: ws.unitId, quantity: 1, unitPrice: 5_000, discount: 0 },
      ],
    });

    // Exchange sale linked to Wave 1 return (1 tea @ 8_000 paid cash).
    await makeCaller(ws.tenantId, ws.cashier1, siteId).sales.create({
      customerId: customer.id,
      sourceReturnId: wave1ReturnRow.id,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 8_000,
      items: [{ productId: teaId, unitId: ws.unitId, quantity: 1, unitPrice: 8_000, discount: 0 }],
    });

    // 9. Manual cash movements + close both registers (session1 with controlled -1_000 difference).
    await makeCaller(ws.tenantId, ws.cashier1, siteId).cashSessions.recordMovement({
      type: 'paid_in',
      amount: 10_000,
      note: 'Sencillo adicional',
    });
    await makeCaller(ws.tenantId, ws.cashier1, siteId).cashSessions.recordMovement({
      type: 'skim',
      amount: 20_000,
      note: 'Retiro parcial a caja fuerte',
    });

    await makeCaller(ws.tenantId, ws.cashier2, siteId).cashSessions.close({
      actualCount: 20_000,
      denominations: [{ value: 20_000, count: 1 }],
    });

    // Blind cash close hides expectedBalance from cashiers; read the authoritative ledger value from SQLite.
    const activeSession1 = await makeCaller(
      ws.tenantId,
      ws.cashier1,
      siteId
    ).cashSessions.getActive();
    expect(activeSession1?.expectedBalance).toBeNull();
    const session1Row = db
      .select({ expectedBalance: cashSessions.expectedBalance })
      .from(cashSessions)
      .where(eq(cashSessions.id, session1.id))
      .get()!;
    const countedWithShortage = roundMoney(session1Row.expectedBalance - 1_000);
    await makeCaller(ws.tenantId, ws.cashier1, siteId).cashSessions.close({
      actualCount: countedWithShortage,
      denominations: denominationsFor(countedWithShortage),
    });

    // Day close preview must block until the -1_000 difference is explained.
    const previewBeforeExplain = await makeCaller(
      ws.tenantId,
      ws.manager,
      siteId
    ).reports.dayClose.preview({
      date: businessDate,
    });
    expect(previewBeforeExplain.readiness.blockers).toContain('unexplained_differences');

    await makeCaller(ws.tenantId, ws.manager, siteId).cashSessions.explainDifference({
      sessionId: session1.id,
      reason: 'wrong_change',
      note: 'Verificado en arqueo de cierre',
    });

    const previewReady = await makeCaller(ws.tenantId, ws.manager, siteId).reports.dayClose.preview(
      {
        date: businessDate,
      }
    );
    expect(previewReady.readiness.readyToSign).toBe(true);

    const signoff = await makeCaller(ws.tenantId, ws.manager, siteId).reports.dayClose.signOff({
      date: businessDate,
      attestationAccepted: true,
      signature: { method: 'drawn', path: 'M10 10L60 30L90 15' },
    });
    expect(signoff.date).toBe(businessDate);
    expect(signoff.signatureMethod).toBe('drawn');

    // 10. Full 8-invariant SQLite DB consolidation audit.
    // Stock math:
    // coffee: +10 (purchase) -2 (promoSale) -8 (draft) +1 (wave1) +1 (wave2) = 2
    // tea:    +4 +6 (PO) -2 (credit) -1 (replay) -1 (exchange) = 6
    // muffin: +4 +6 (PO) -2 (promoSale) +2 (wave2) -1 (store_credit) = 9
    const report = await assertTenantDbConsistency(db, ws.tenantId, {
      businessDate,
      expectedStockByProductId: {
        [coffeeId]: 2,
        [teaId]: 6,
        [muffinId]: 9,
      },
      expectedCustomerBalanceById: {
        [customer.id]: 10_000,
      },
    });
    expect(report.auditChainValid).toBe(true);
    expect(report.dayCloseReconciled).toBe(true);
    expect(report.salesChecked).toBe(6);
    expect(report.returnsChecked).toBe(2);
    expect(report.cashSessionsChecked).toBe(3);
  });

  it('reconciles freeze carry-over across shifts and multi-site deferred transfer with transit shortage', async () => {
    const ws = await seedTenantWorkspace('multisite', { extraSites: 1 });
    const siteA = ws.siteIds[0]!;
    const siteB = ws.siteIds[1]!;
    const businessDate = localBusinessDate();

    const boltId = await seedProduct({
      tenantId: ws.tenantId,
      siteId: siteA,
      unitId: ws.unitId,
      name: 'Tornillo Acero M8',
      price: 2_000,
      cost: 900,
      stock: 20,
    });

    // Shift 1: open register, park a draft, mark carry-over so shift & day close are unblocked.
    await makeCaller(ws.tenantId, ws.cashier1, siteA).cashSessions.open({
      registerName: 'Caja A1',
      openingFloat: 50_000,
      denominations: [{ value: 50_000, count: 1 }],
    });

    const carriedDraft = await makeCaller(ws.tenantId, ws.cashier1, siteA).sales.create({
      status: 'draft',
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      items: [{ productId: boltId, unitId: ws.unitId, quantity: 3, unitPrice: 2_000, discount: 0 }],
    });
    await makeCaller(ws.tenantId, ws.cashier1, siteA).sales.suspend({
      saleId: carriedDraft.id,
      label: 'Pedido tarde',
    });

    const checklistBefore = await makeCaller(
      ws.tenantId,
      ws.manager,
      siteA
    ).reports.dayClose.checklist({
      date: businessDate,
    });
    expect(checklistBefore.drafts.find(d => d.id === carriedDraft.id)?.carriedOver).toBe(false);

    await makeCaller(ws.tenantId, ws.manager, siteA).sales.carryOver({
      saleId: carriedDraft.id,
    });

    const checklistAfter = await makeCaller(
      ws.tenantId,
      ws.manager,
      siteA
    ).reports.dayClose.checklist({
      date: businessDate,
    });
    expect(checklistAfter.drafts.find(d => d.id === carriedDraft.id)?.carriedOver).toBe(true);

    // Close Shift 1 cleanly and open Shift 2 to resume and complete the carried-over draft.
    await makeCaller(ws.tenantId, ws.cashier1, siteA).cashSessions.close({
      actualCount: 50_000,
      denominations: [{ value: 50_000, count: 1 }],
    });

    await makeCaller(ws.tenantId, ws.cashier2, siteA).cashSessions.open({
      registerName: 'Caja A2',
      openingFloat: 30_000,
      denominations: [{ value: 10_000, count: 3 }],
    });
    // Manager resumes carried-over draft (cross-cashier override), then cashier/manager completes it.
    await makeCaller(ws.tenantId, ws.manager, siteA).sales.resume({ saleId: carriedDraft.id });
    await makeCaller(ws.tenantId, ws.manager, siteA).cashSessions.open({
      registerName: 'Caja Gerencia',
      openingFloat: 0,
      denominations: [],
    });
    await makeCaller(ws.tenantId, ws.manager, siteA).sales.completeDraft({
      saleId: carriedDraft.id,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 6_000,
    });

    // Deferred inter-site transfer: ship 10 from Site A -> Site B, receive only 8 (2 damaged in transit).
    const transfer = await makeCaller(ws.tenantId, ws.admin, siteA).transfers.create({
      fromSiteId: siteA,
      toSiteId: siteB,
      defer: true,
      notes: 'Reposicion semanal',
      items: [{ productId: boltId, quantity: 10 }],
    });
    const transferDetail = await makeCaller(ws.tenantId, ws.admin, siteB).transfers.getById({
      id: transfer.id,
    });
    const transferLine = transferDetail.items[0]!;

    await makeCaller(ws.tenantId, ws.admin, siteB).transfers.receive({
      transferId: transfer.id,
      lines: [{ itemId: transferLine.id, receivedQuantity: 8 }],
      discrepancyNotes: '2 unidades danadas en transporte',
    });

    // Verify per-site balances: Site A = 20 - 3 - 10 = 7; Site B = 8; aggregate = 15.
    const siteABalance = db
      .select({ onHand: inventoryBalances.onHand })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, ws.tenantId),
          eq(inventoryBalances.siteId, siteA),
          eq(inventoryBalances.productId, boltId)
        )
      )
      .get();
    const siteBBalance = db
      .select({ onHand: inventoryBalances.onHand })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, ws.tenantId),
          eq(inventoryBalances.siteId, siteB),
          eq(inventoryBalances.productId, boltId)
        )
      )
      .get();
    expect(siteABalance?.onHand).toBe(7);
    expect(siteBBalance?.onHand).toBe(8);

    await makeCaller(ws.tenantId, ws.cashier2, siteA).cashSessions.close({
      actualCount: 30_000,
      denominations: [{ value: 10_000, count: 3 }],
    });
    await makeCaller(ws.tenantId, ws.manager, siteA).cashSessions.close({
      actualCount: 6_000,
      denominations: denominationsFor(6_000),
    });

    const report = await assertTenantDbConsistency(db, ws.tenantId, {
      businessDate,
      expectedStockByProductId: { [boltId]: 15 },
    });
    expect(report.auditChainValid).toBe(true);
    expect(report.dayCloseReconciled).toBe(true);
  });

  it('reconciles restaurant check with KDS, voluntary tip + service charge, and a voided walk-in cash sale', async () => {
    const ws = await seedTenantWorkspace('restaurant', { modules: ['dine-in', 'kds'] });
    const siteId = ws.siteIds[0]!;
    const businessDate = localBusinessDate();

    await writeRestaurantSettings(db, ws.tenantId, { serviceChargeRate: 10 });

    const pastaId = await seedProduct({
      tenantId: ws.tenantId,
      siteId,
      unitId: ws.unitId,
      name: 'Pasta Alfredo',
      price: 20_000,
      cost: 8_000,
      stock: 20,
    });
    const sodaId = await seedProduct({
      tenantId: ws.tenantId,
      siteId,
      unitId: ws.unitId,
      name: 'Limonada Natural',
      price: 5_000,
      cost: 1_500,
      stock: 20,
    });

    const tableId = `recon-tbl-${nanoid(6)}`;
    const now = new Date().toISOString();
    await db.insert(restaurantTables).values({
      id: tableId,
      tenantId: ws.tenantId,
      siteId,
      name: 'Mesa 1',
      seatCount: 4,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const restaurantSession = await makeCaller(ws.tenantId, ws.cashier1, siteId).cashSessions.open({
      registerName: 'Caja Salon',
      openingFloat: 40_000,
      denominations: [{ value: 20_000, count: 2 }],
    });

    // Open table check (1 pasta + 2 sodas = 30_000) and verify KDS ticket is queued.
    const openedCheck = await makeCaller(
      ws.tenantId,
      ws.cashier1,
      siteId
    ).restaurantServices.openCheck({
      tableId,
      guestCount: 2,
      priceTier: 1,
      diners: [],
      items: [
        {
          productId: pastaId,
          unitId: ws.unitId,
          quantity: 1,
          unitPrice: 20_000,
          discount: 0,
          courseKey: 'main',
          modifiers: [],
        },
        {
          productId: sodaId,
          unitId: ws.unitId,
          quantity: 2,
          unitPrice: 5_000,
          discount: 0,
          courseKey: 'drink',
          modifiers: [],
        },
      ],
    });
    const kdsTickets = await makeCaller(ws.tenantId, ws.cashier1, siteId).kds.list({});
    expect(kdsTickets.items.length).toBeGreaterThanOrEqual(1);

    // Resume and pay table check with voluntary tip (3_000) + 10% service charge (3_000) => 36_000.
    await makeCaller(ws.tenantId, ws.cashier1, siteId).sales.resume({
      saleId: openedCheck.id,
    });
    const completedCheck = await makeCaller(ws.tenantId, ws.cashier1, siteId).sales.completeDraft({
      saleId: openedCheck.id,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 36_000,
      tipAmount: 3_000,
      tipMethod: 'fixed',
      serviceChargeAmount: 3_000,
      serviceChargeRate: 10,
    });
    expect(completedCheck.total).toBe(36_000);

    // Separate walk-in cash sale (respecting live 10% service charge) -> voided cleanly so stock & netRevenue reconcile.
    const walkInSale = await makeCaller(ws.tenantId, ws.cashier1, siteId).sales.create({
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 5_500,
      serviceChargeAmount: 500,
      serviceChargeRate: 10,
      items: [{ productId: sodaId, unitId: ws.unitId, quantity: 1, unitPrice: 5_000, discount: 0 }],
    });
    await makeCaller(ws.tenantId, ws.admin, siteId).sales.void({
      id: walkInSale.id,
      reason: 'Cliente cancelo pedido',
    });

    const restaurantSessionRow = db
      .select({ expectedBalance: cashSessions.expectedBalance })
      .from(cashSessions)
      .where(eq(cashSessions.id, restaurantSession.id))
      .get()!;
    await makeCaller(ws.tenantId, ws.cashier1, siteId).cashSessions.close({
      actualCount: restaurantSessionRow.expectedBalance,
      denominations: denominationsFor(restaurantSessionRow.expectedBalance),
    });

    const report = await assertTenantDbConsistency(db, ws.tenantId, {
      businessDate,
      expectedStockByProductId: {
        [pastaId]: 19,
        [sodaId]: 18,
      },
    });
    expect(report.auditChainValid).toBe(true);
    expect(report.dayCloseReconciled).toBe(true);
  });
});
