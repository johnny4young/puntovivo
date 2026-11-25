import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  products,
  providers,
  providerPayableInvoices,
  providerPayableInvoicePurchases,
  purchaseItems,
  purchases,
  sites,
  syncOutbox,
  units,
  unitXProduct,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { calendarDayInTimeZone } from '../services/reports/day-window.js';
import { resolveTenantLocale } from '../services/tenant-locale.js';
import { makeEnvelopeHeadersProxy } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let deviceId: string;
let tenantTimeZone: string;

function context(): Context {
  return {
    req: {
      server: server.app,
      headers: makeEnvelopeHeadersProxy({
        getDeviceId: () => deviceId,
        getSiteId: () => siteId,
      }),
      user: { userId, email: 'admin@localhost', role: 'admin', tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as unknown as Context['res'],
    db: getDatabase(),
    user: { id: userId, email: 'admin@localhost', role: 'admin', tenantId },
    tenantId,
    siteId,
  };
}

function businessDayFromNow(days: number): string {
  return calendarDayInTimeZone(new Date(Date.now() + days * 86_400_000), tenantTimeZone);
}

async function createProvider(name: string): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await getDatabase().insert(providers).values({
    id,
    tenantId,
    name,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function createProduct(name: string): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await getDatabase().insert(products).values({
    id,
    tenantId,
    name,
    sku: `CON-${nanoid(6)}`,
    price: 10,
    price2: 10,
    price3: 10,
    cost: 10,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 0,
    initialCost: 10,
    minStock: 0,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** One remisión-style purchase carrying a single product line. */
async function createRemissionPurchase(
  providerId: string,
  productId: string,
  quantity: number,
  unitCost: number,
  equivalence = 1
): Promise<string> {
  const db = getDatabase();
  const purchaseId = nanoid();
  const now = new Date().toISOString();
  const lineTotal = Number((quantity * unitCost).toFixed(2));
  await db.insert(purchases).values({
    id: purchaseId,
    tenantId,
    purchaseNumber: `REM-${nanoid(6)}`,
    providerId,
    siteId,
    status: 'completed',
    subtotal: lineTotal,
    total: lineTotal,
    createdBy: userId,
    syncVersion: 1,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(purchaseItems).values({
    id: nanoid(),
    purchaseId,
    productId,
    quantity,
    unitId: baseUnitId,
    unitEquivalence: equivalence,
    costPerUnit: unitCost,
    baseUnitCost: Number((unitCost / equivalence).toFixed(2)),
    total: lineTotal,
  });
  return purchaseId;
}

/**
 * A purchase created through the real purchase command, so its receipt carries
 * the frozen value evidence that a return must reverse. A directly inserted
 * fixture row would let the return path pass for the wrong reason.
 */
async function createPurchasedStock(
  caller: ReturnType<typeof appRouter.createCaller>,
  providerId: string,
  productId: string,
  quantity: number,
  costPerUnit: number
): Promise<{ purchaseId: string; purchaseItemId: string }> {
  const db = getDatabase();
  const now = new Date().toISOString();
  await db.insert(unitXProduct).values({
    id: nanoid(),
    productId,
    unitId: baseUnitId,
    equivalence: 1,
    price: costPerUnit,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  const created = await caller.purchases.create({
    providerId,
    items: [{ productId, unitId: baseUnitId, quantity, costPerUnit }],
  });
  const line = await db
    .select()
    .from(purchaseItems)
    .where(eq(purchaseItems.purchaseId, created.id))
    .get();
  if (!line) throw new Error('Expected the purchase line');
  return { purchaseId: created.id, purchaseItemId: line.id };
}

describe('provider payable consolidation', () => {
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
    if (!site) throw new Error('Expected active site');
    siteId = site.id;
    tenantTimeZone = (await resolveTenantLocale(db, tenantId)).timezone;
    deviceId = (
      await registerDeviceService(db, {
        tenantId,
        userId,
        kind: 'web',
        name: 'provider-payables-consolidation.test',
      })
    ).deviceId;
    const seededUnits = await db.select().from(units).where(eq(units.tenantId, tenantId)).all();
    const baseUnit = seededUnits.find(unit => unit.abbreviation === 'UND');
    if (!baseUnit) throw new Error('Expected seeded base unit');
    baseUnitId = baseUnit.id;
  });

  afterAll(async () => {
    await server.close();
  });

  it('consolidates two remissions into one invoice that matches line by line', async () => {
    const db = getDatabase();
    const providerId = await createProvider(`Consolidation ${nanoid(5)}`);
    const productId = await createProduct('Piñata grande');
    const first = await createRemissionPurchase(providerId, productId, 5, 10);
    const second = await createRemissionPurchase(providerId, productId, 5, 10);

    const caller = appRouter.createCaller(context());
    const invoice = await caller.providerPayables.createInvoice({
      providerId,
      purchaseIds: [first, second],
      lines: [{ productId, quantity: 10, unitCost: 10 }],
      documentNumber: `FAC-${nanoid(6)}`,
      issuedAt: businessDayFromNow(-2),
      dueAt: businessDayFromNow(28),
      amount: 100,
    });

    const invoiceRow = await db
      .select({ purchaseId: providerPayableInvoices.purchaseId })
      .from(providerPayableInvoices)
      .where(eq(providerPayableInvoices.id, invoice.id))
      .get();
    expect(invoiceRow?.purchaseId).toBeNull();

    const links = db
      .select({ purchaseId: providerPayableInvoicePurchases.purchaseId })
      .from(providerPayableInvoicePurchases)
      .where(eq(providerPayableInvoicePurchases.invoiceId, invoice.id))
      .all();
    expect(links.map(link => link.purchaseId).sort()).toEqual([first, second].sort());

    const audit = db
      .select({ after: auditLogs.after })
      .from(auditLogs)
      .where(and(eq(auditLogs.resourceId, invoice.id), eq(auditLogs.action, 'provider_payable.invoice.create')))
      .get();
    expect(audit?.after).toMatchObject({ purchaseIds: [first, second] });

    const available = await caller.providerPayables.availablePurchases({ providerId });
    const stillListed = available.items.filter(
      item => item.id === first || item.id === second
    );
    expect(stillListed).toEqual([]);
  });

  it('rejects an invoice whose lines do not match what was received', async () => {
    const providerId = await createProvider(`Mismatch ${nanoid(5)}`);
    const productId = await createProduct('Listón por rollo');
    const first = await createRemissionPurchase(providerId, productId, 6, 10);
    const second = await createRemissionPurchase(providerId, productId, 6, 10);

    const caller = appRouter.createCaller(context());
    // 12 received, 11 invoiced.
    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseIds: [first, second],
        lines: [{ productId, quantity: 11, unitCost: 10 }],
        documentNumber: `FAC-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-2),
        dueAt: businessDayFromNow(28),
        amount: 110,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PROVIDER_PAYABLE_INVOICE_LINES_MISMATCH' },
    });

    // 12 units but at another price.
    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseIds: [first, second],
        lines: [{ productId, quantity: 12, unitCost: 11 }],
        documentNumber: `FAC-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-2),
        dueAt: businessDayFromNow(28),
        amount: 132,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PROVIDER_PAYABLE_INVOICE_LINES_MISMATCH' },
    });
  });

  it('rejects an invoice whose amount disagrees with its own lines', async () => {
    const providerId = await createProvider(`Amount ${nanoid(5)}`);
    const productId = await createProduct('Papel crepé');
    const purchase = await createRemissionPurchase(providerId, productId, 4, 10);

    const caller = appRouter.createCaller(context());
    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseIds: [purchase],
        lines: [{ productId, quantity: 4, unitCost: 10 }],
        documentNumber: `FAC-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-2),
        dueAt: businessDayFromNow(28),
        amount: 39,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PROVIDER_PAYABLE_INVOICE_AMOUNT_MISMATCH' },
    });
  });

  it('refuses a duplicated purchase, a foreign site and an already invoiced purchase', async () => {
    const providerId = await createProvider(`Guards ${nanoid(5)}`);
    const productId = await createProduct('Cinta adhesiva');
    const purchase = await createRemissionPurchase(providerId, productId, 3, 10);

    const caller = appRouter.createCaller(context());
    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseIds: [purchase, purchase],
        lines: [{ productId, quantity: 6, unitCost: 10 }],
        documentNumber: `FAC-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-2),
        dueAt: businessDayFromNow(28),
        amount: 60,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PROVIDER_PAYABLE_PURCHASE_DUPLICATED' },
    });

    const invoice = await caller.providerPayables.createInvoice({
      providerId,
      purchaseIds: [purchase],
      lines: [{ productId, quantity: 3, unitCost: 10 }],
      documentNumber: `FAC-${nanoid(6)}`,
      issuedAt: businessDayFromNow(-2),
      dueAt: businessDayFromNow(28),
      amount: 30,
    });

    // The same purchase cannot be invoiced again through any path.
    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseId: purchase,
        documentNumber: `FAC-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-2),
        dueAt: businessDayFromNow(28),
        amount: 30,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PROVIDER_PAYABLE_PURCHASE_ALREADY_INVOICED' },
    });

    const links = getDatabase()
      .select({ purchaseId: providerPayableInvoicePurchases.purchaseId })
      .from(providerPayableInvoicePurchases)
      .where(eq(providerPayableInvoicePurchases.invoiceId, invoice.id))
      .all();
    expect(links).toEqual([{ purchaseId: purchase }]);
  });

  it('requires lines when several purchases are consolidated', async () => {
    const providerId = await createProvider(`Require lines ${nanoid(5)}`);
    const productId = await createProduct('Globos pack 100');
    const first = await createRemissionPurchase(providerId, productId, 2, 10);
    const second = await createRemissionPurchase(providerId, productId, 2, 10);

    const caller = appRouter.createCaller(context());
    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseIds: [first, second],
        documentNumber: `FAC-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-2),
        dueAt: businessDayFromNow(28),
        amount: 40,
      })
    ).rejects.toThrow(/Invoice lines are required/i);
  });

  it('rejects consolidation across sites without leaving any rows behind', async () => {
    const db = getDatabase();
    const providerId = await createProvider(`Mixed site ${nanoid(5)}`);
    const productId = await createProduct('Papel picoteo');
    const homeSite = await createRemissionPurchase(providerId, productId, 2, 10);

    const otherSiteId = nanoid();
    const now = new Date().toISOString();
    const seededSite = db
      .select({ companyId: sites.companyId })
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!seededSite?.companyId) throw new Error('Expected a seeded company site');
    await db.insert(sites).values({
      id: otherSiteId,
      tenantId,
      companyId: seededSite.companyId,
      name: 'Sucursal prueba',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const awayPurchaseId = nanoid();
    await db.insert(purchases).values({
      id: awayPurchaseId,
      tenantId,
      purchaseNumber: `REM-X-${nanoid(5)}`,
      providerId,
      siteId: otherSiteId,
      status: 'completed',
      subtotal: 20,
      total: 20,
      createdBy: userId,
      syncVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    const before = db
      .select({ count: sql<number>`count(*)` })
      .from(providerPayableInvoicePurchases)
      .get()?.count ?? 0;

    const caller = appRouter.createCaller(context());
    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseIds: [homeSite, awayPurchaseId],
        lines: [{ productId, quantity: 4, unitCost: 10 }],
        documentNumber: `FAC-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-2),
        dueAt: businessDayFromNow(28),
        amount: 40,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PROVIDER_PAYABLE_PURCHASE_SITE_MISMATCH' },
    });

    const after = db
      .select({ count: sql<number>`count(*)` })
      .from(providerPayableInvoicePurchases)
      .get()?.count ?? 0;
    expect(after).toBe(before);
  });

  it('cannot reuse a purchase after a bridge-only consolidation', async () => {
    const providerId = await createProvider(`Bridge reuse ${nanoid(5)}`);
    const productId = await createProduct('Cartulina');
    const first = await createRemissionPurchase(providerId, productId, 2, 10);
    const second = await createRemissionPurchase(providerId, productId, 2, 10);

    const caller = appRouter.createCaller(context());
    await caller.providerPayables.createInvoice({
      providerId,
      purchaseIds: [first, second],
      lines: [{ productId, quantity: 4, unitCost: 10 }],
      documentNumber: `FAC-${nanoid(6)}`,
      issuedAt: businessDayFromNow(-2),
      dueAt: businessDayFromNow(28),
      amount: 40,
    });

    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseId: first,
        documentNumber: `FAC-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-2),
        dueAt: businessDayFromNow(28),
        amount: 20,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PROVIDER_PAYABLE_PURCHASE_ALREADY_INVOICED' },
    });
  });

  it('accepts a fractional base-unit rate when it rounds to the received total', async () => {
    const providerId = await createProvider(`Fractional ${nanoid(5)}`);
    const productId = await createProduct('Papel silueta rollo 3m');
    // One 3-unit pack worth 10: the purchase keeps its two-decimal cost rule,
    // but the supplier's invoice line rates it in base units as 10/3, which
    // whole cents cannot express. The line total must round to the received
    // total, and the input schema must accept the repeating rate.
    const purchase = await createRemissionPurchase(providerId, productId, 1, 10, 3);

    const caller = appRouter.createCaller(context());
    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseIds: [purchase],
        lines: [{ productId, quantity: 3, unitCost: 3.3334 }],
        documentNumber: `FAC-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-2),
        dueAt: businessDayFromNow(28),
        amount: 10,
      })
    ).resolves.toMatchObject({ providerId });
  });

  it('reconciles a partially returned purchase against what the store kept', async () => {
    const db = getDatabase();
    const providerId = await createProvider(`Returns ${nanoid(5)}`);
    const productId = await createProduct('Bulto de arroz');
    const caller = appRouter.createCaller(context());
    const { purchaseId, purchaseItemId } = await createPurchasedStock(
      caller,
      providerId,
      productId,
      100,
      10
    );

    const returned = await caller.purchases.returnPurchase({
      id: purchaseId,
      items: [{ purchaseItemId, quantity: 30 }],
      reason: 'Sacos rotos',
    });
    expect(returned.status).toBe('partial_returned');

    // The overstatement this finding is about: invoicing everything that once
    // arrived, as if 30 had never gone back.
    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseIds: [purchaseId],
        lines: [{ productId, quantity: 100, unitCost: 10 }],
        documentNumber: `FAC-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-2),
        dueAt: businessDayFromNow(28),
        amount: 1000,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PROVIDER_PAYABLE_INVOICE_LINES_MISMATCH' },
    });

    // 70 units are still on the shelf, so the delivery remains invoiceable and
    // the picker must still offer it.
    const available = await caller.providerPayables.availablePurchases({ providerId });
    expect(available.items.map(item => item.id)).toEqual([purchaseId]);

    // What the store actually kept: 70 units, 700.
    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseIds: [purchaseId],
        lines: [{ productId, quantity: 70, unitCost: 10 }],
        documentNumber: `FAC-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-2),
        dueAt: businessDayFromNow(28),
        amount: 700,
      })
    ).resolves.toMatchObject({ providerId });

    const links = db
      .select({ purchaseId: providerPayableInvoicePurchases.purchaseId })
      .from(providerPayableInvoicePurchases)
      .where(eq(providerPayableInvoicePurchases.purchaseId, purchaseId))
      .all();
    expect(links).toEqual([{ purchaseId }]);
  });

  it('still refuses to invoice a fully returned purchase', async () => {
    const providerId = await createProvider(`Full return ${nanoid(5)}`);
    const productId = await createProduct('Caja devuelta');
    const caller = appRouter.createCaller(context());
    const { purchaseId, purchaseItemId } = await createPurchasedStock(
      caller,
      providerId,
      productId,
      4,
      10
    );

    const returned = await caller.purchases.returnPurchase({
      id: purchaseId,
      items: [{ purchaseItemId, quantity: 4 }],
      reason: 'Pedido equivocado',
    });
    expect(returned.status).toBe('returned');

    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseIds: [purchaseId],
        documentNumber: `FAC-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-2),
        dueAt: businessDayFromNow(28),
        amount: 40,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PROVIDER_PAYABLE_PURCHASE_NOT_COMPLETED' },
    });
    const available = await caller.providerPayables.availablePurchases({ providerId });
    expect(available.items).toEqual([]);
  });

  it('rejects a purchaseId that contradicts purchaseIds', async () => {
    const db = getDatabase();
    const providerId = await createProvider(`Ambiguous ${nanoid(5)}`);
    const productId = await createProduct('Bolsa de regalo');
    const first = await createRemissionPurchase(providerId, productId, 2, 10);
    const second = await createRemissionPurchase(providerId, productId, 2, 10);

    const caller = appRouter.createCaller(context());
    // Two keys pointing at different purchases: silently honouring one of them
    // is how a buró invoice ends up covering the wrong remisión.
    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseId: first,
        purchaseIds: [second],
        documentNumber: `FAC-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-2),
        dueAt: businessDayFromNow(28),
        amount: 20,
      })
    ).rejects.toThrow(/purchaseId and purchaseIds/i);

    // Nothing is persisted by the refused command.
    expect(
      db
        .select({ id: providerPayableInvoices.id })
        .from(providerPayableInvoices)
        .where(eq(providerPayableInvoices.providerId, providerId))
        .all()
    ).toEqual([]);
    expect(
      db
        .select({ id: providerPayableInvoicePurchases.id })
        .from(providerPayableInvoicePurchases)
        .where(inArray(providerPayableInvoicePurchases.purchaseId, [first, second]))
        .all()
    ).toEqual([]);
  });

  it('enqueues the invoice ahead of the purchase links it carries', async () => {
    const db = getDatabase();
    const providerId = await createProvider(`Sync order ${nanoid(5)}`);
    const productId = await createProduct('Servilletas');
    const first = await createRemissionPurchase(providerId, productId, 2, 10);
    const second = await createRemissionPurchase(providerId, productId, 2, 10);

    const caller = appRouter.createCaller(context());
    const invoice = await caller.providerPayables.createInvoice({
      providerId,
      purchaseIds: [first, second],
      lines: [{ productId, quantity: 4, unitCost: 10 }],
      documentNumber: `FAC-${nanoid(6)}`,
      issuedAt: businessDayFromNow(-2),
      dueAt: businessDayFromNow(28),
      amount: 40,
    });

    const linkIds = db
      .select({ id: providerPayableInvoicePurchases.id })
      .from(providerPayableInvoicePurchases)
      .where(eq(providerPayableInvoicePurchases.invoiceId, invoice.id))
      .all()
      .map(row => row.id);
    expect(linkIds).toHaveLength(2);

    // The drain order a remote uses (`trpc/routers/sync/push.ts`).
    const drained = db
      .select({
        entityType: syncOutbox.entityType,
        entityId: syncOutbox.entityId,
        priority: syncOutbox.priority,
      })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          inArray(syncOutbox.entityId, [invoice.id, ...linkIds])
        )
      )
      .orderBy(desc(syncOutbox.priority), asc(syncOutbox.createdAt))
      .all();

    expect(drained).toHaveLength(3);
    expect(drained[0]).toMatchObject({
      entityType: 'provider_payable_invoices',
      entityId: invoice.id,
    });
    // Both rows are written by one transaction from one clock, so their
    // created_at values can tie. Only a strictly higher priority keeps the
    // parent first when they do.
    for (const child of drained.slice(1)) {
      expect(child.entityType).toBe('provider_payable_invoice_purchases');
      expect(child.priority).toBeLessThan(drained[0]!.priority);
    }
  });
});
