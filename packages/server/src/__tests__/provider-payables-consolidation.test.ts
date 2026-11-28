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
  await getDatabase()
    .insert(products)
    .values({
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
      .where(
        and(
          eq(auditLogs.resourceId, invoice.id),
          eq(auditLogs.action, 'provider_payable.invoice.create')
        )
      )
      .get();
    expect(audit?.after).toMatchObject({ purchaseIds: [first, second] });

    const available = await caller.providerPayables.availablePurchases({ providerId });
    const stillListed = available.items.filter(item => item.id === first || item.id === second);
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

    const countRows = () => ({
      links:
        db
          .select({ count: sql<number>`count(*)` })
          .from(providerPayableInvoicePurchases)
          .get()?.count ?? 0,
      invoices:
        db
          .select({ count: sql<number>`count(*)` })
          .from(providerPayableInvoices)
          .where(eq(providerPayableInvoices.providerId, providerId))
          .get()?.count ?? 0,
    });
    const before = countRows();

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

    expect(countRows()).toEqual(before);
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

    // Invoicing everything that once arrived, as if 30 had never gone back,
    // overstates the payable.
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
    // the picker must expose the net kept total (700), not gross receipt (1000).
    const available = await caller.providerPayables.availablePurchases({ providerId });
    expect(available.items).toEqual([expect.objectContaining({ id: purchaseId, total: 700 })]);

    // Invoicing without lines still refuses the pre-return gross amount.
    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseId,
        documentNumber: `FAC-GROSS-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-2),
        dueAt: businessDayFromNow(28),
        amount: 1000,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PROVIDER_PAYABLE_INVOICE_AMOUNT_MISMATCH' },
    });

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

  it('reconciles net purchase lines plus taxAmount and surfaces consolidated purchases in overview', async () => {
    const db = getDatabase();
    const providerId = await createProvider(`VAT consolidation ${nanoid(5)}`);
    const productId = await createProduct('Harina bulto 50kg');
    const first = await createRemissionPurchase(providerId, productId, 5, 10);
    const second = await createRemissionPurchase(providerId, productId, 5, 10);
    const purchaseRows = db
      .select({ id: purchases.id, purchaseNumber: purchases.purchaseNumber })
      .from(purchases)
      .where(inArray(purchases.id, [first, second]))
      .all();

    const caller = appRouter.createCaller(context());
    // Amount must equal linesTotal + taxAmount (100 + 19 = 119).
    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseIds: [first, second],
        lines: [{ productId, quantity: 10, unitCost: 10 }],
        documentNumber: `FAC-TAX-BAD-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-2),
        dueAt: businessDayFromNow(28),
        amount: 118,
        taxAmount: 19,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PROVIDER_PAYABLE_INVOICE_AMOUNT_MISMATCH' },
      message: expect.stringMatching(/lines total 100\.00 plus tax 19\.00/i),
    });

    const invoice = await caller.providerPayables.createInvoice({
      providerId,
      purchaseIds: [first, second],
      lines: [{ productId, quantity: 10, unitCost: 10 }],
      documentNumber: `FAC-TAX-${nanoid(6)}`,
      issuedAt: businessDayFromNow(-2),
      dueAt: businessDayFromNow(28),
      amount: 119,
      taxAmount: 19,
    });

    const overview = await caller.providerPayables.overview({ providerId });
    const entry = overview.invoices.find(item => item.id === invoice.id);
    expect(entry).toMatchObject({
      id: invoice.id,
      amount: 119,
      taxAmount: 19,
      purchaseId: null,
      purchaseNumber: null,
    });
    expect(entry?.purchaseIds.slice().sort()).toEqual([first, second].sort());
    expect(entry?.purchaseNumbers.slice().sort()).toEqual(
      purchaseRows.map(row => row.purchaseNumber).sort()
    );
  });

  it('rejects lines without any linked purchase at the input boundary', async () => {
    const providerId = await createProvider(`No purchase lines ${nanoid(5)}`);
    const productId = await createProduct('Etiqueta térmica');
    const caller = appRouter.createCaller(context());

    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        lines: [{ productId, quantity: 2, unitCost: 10 }],
        documentNumber: `FAC-NOPUR-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-2),
        dueAt: businessDayFromNow(28),
        amount: 20,
      })
    ).rejects.toThrow(/Invoice lines require at least one linked purchase/i);
  });

  it('reconciles a partially returned purchase whose fully returned item had fractional return rounding', async () => {
    const db = getDatabase();
    const providerId = await createProvider(`Fractional return ${nanoid(5)}`);
    const returnedProductId = await createProduct('Esencia 1L');
    const keptProductId = await createProduct('Azúcar 10kg');
    const now = new Date().toISOString();
    await db.insert(unitXProduct).values([
      {
        id: nanoid(),
        productId: returnedProductId,
        unitId: baseUnitId,
        equivalence: 1,
        price: 10.01,
        isBase: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: nanoid(),
        productId: keptProductId,
        unitId: baseUnitId,
        equivalence: 1,
        price: 10,
        isBase: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const caller = appRouter.createCaller(context());
    const created = await caller.purchases.create({
      providerId,
      items: [
        { productId: returnedProductId, unitId: baseUnitId, quantity: 1, costPerUnit: 10.01 },
        { productId: keptProductId, unitId: baseUnitId, quantity: 10, costPerUnit: 10 },
      ],
    });
    const returnedLine = db
      .select()
      .from(purchaseItems)
      .where(
        and(
          eq(purchaseItems.purchaseId, created.id),
          eq(purchaseItems.productId, returnedProductId)
        )
      )
      .get();
    if (!returnedLine) throw new Error('Expected returned product purchase line');

    // Two 0.5 returns of 10.01 each round to 5.01 (10.02 total), leaving a -0.01
    // naive total residual even though 100% of the item was returned.
    await caller.purchases.returnPurchase({
      id: created.id,
      items: [{ purchaseItemId: returnedLine.id, quantity: 0.5 }],
      reason: 'Primera mitad dañada',
    });
    const afterSecond = await caller.purchases.returnPurchase({
      id: created.id,
      items: [{ purchaseItemId: returnedLine.id, quantity: 0.5 }],
      reason: 'Segunda mitad dañada',
    });
    expect(afterSecond.status).toBe('partial_returned');

    // The picker must offer the balance the invoice command reconciles to.
    const available = await caller.providerPayables.availablePurchases({ providerId });
    expect(available.items).toEqual([expect.objectContaining({ id: created.id, total: 100 })]);

    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseIds: [created.id],
        lines: [{ productId: keptProductId, quantity: 10, unitCost: 10 }],
        documentNumber: `FAC-FRAC-RET-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-2),
        dueAt: businessDayFromNow(28),
        amount: 100,
      })
    ).resolves.toMatchObject({ providerId, amount: 100 });
  });

  it('rolls back overlapping consolidation and rejects foreign-provider purchases', async () => {
    const providerId = await createProvider(`Overlap ${nanoid(5)}`);
    const otherProviderId = await createProvider(`Foreign ${nanoid(5)}`);
    const productId = await createProduct('Vaso descartable');
    const p1 = await createRemissionPurchase(providerId, productId, 2, 10);
    const p2 = await createRemissionPurchase(providerId, productId, 2, 10);
    const p3 = await createRemissionPurchase(providerId, productId, 2, 10);
    const foreignPurchase = await createRemissionPurchase(otherProviderId, productId, 2, 10);

    const caller = appRouter.createCaller(context());
    await caller.providerPayables.createInvoice({
      providerId,
      purchaseIds: [p1, p2],
      lines: [{ productId, quantity: 4, unitCost: 10 }],
      documentNumber: `FAC-OV1-${nanoid(6)}`,
      issuedAt: businessDayFromNow(-2),
      dueAt: businessDayFromNow(28),
      amount: 40,
    });

    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseIds: [p3, p2],
        lines: [{ productId, quantity: 4, unitCost: 10 }],
        documentNumber: `FAC-OV2-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-2),
        dueAt: businessDayFromNow(28),
        amount: 40,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PROVIDER_PAYABLE_PURCHASE_ALREADY_INVOICED' },
    });

    // p3 remains unlinked and available after the rolled-back overlap.
    const available = await caller.providerPayables.availablePurchases({ providerId });
    expect(available.items.map(item => item.id)).toEqual([p3]);

    // Mixing a foreign provider's purchase is rejected.
    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseIds: [p3, foreignPurchase],
        lines: [{ productId, quantity: 4, unitCost: 10 }],
        documentNumber: `FAC-FOR-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-2),
        dueAt: businessDayFromNow(28),
        amount: 40,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PROVIDER_PAYABLE_PURCHASE_MISMATCH' },
    });
  });

  it('orders purchase -> invoice -> invoice_purchases in sync outbox and drains bridge rows via sync.push', async () => {
    const db = getDatabase();
    const providerId = await createProvider(`Sync chain ${nanoid(5)}`);
    const productId = await createProduct('Mantel plástico');
    const caller = appRouter.createCaller(context());
    const { purchaseId } = await createPurchasedStock(caller, providerId, productId, 5, 10);

    const invoice = await caller.providerPayables.createInvoice({
      providerId,
      purchaseIds: [purchaseId],
      lines: [
        { productId, quantity: 2, unitCost: 10 },
        { productId, quantity: 3, unitCost: 10 },
      ],
      documentNumber: `FAC-SYNC-CHAIN-${nanoid(6)}`,
      issuedAt: businessDayFromNow(-2),
      dueAt: businessDayFromNow(28),
      amount: 50,
    });

    const link = db
      .select({ id: providerPayableInvoicePurchases.id })
      .from(providerPayableInvoicePurchases)
      .where(eq(providerPayableInvoicePurchases.invoiceId, invoice.id))
      .get();
    if (!link) throw new Error('Expected invoice purchase link');

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
          inArray(syncOutbox.entityId, [purchaseId, invoice.id, link.id])
        )
      )
      .orderBy(desc(syncOutbox.priority), asc(syncOutbox.createdAt))
      .all();

    expect(drained.map(row => row.entityType)).toEqual([
      'purchases',
      'provider_payable_invoices',
      'provider_payable_invoice_purchases',
    ]);

    const pushed = await caller.sync.push({ limit: 100 });
    expect(pushed.errors.filter(message => message.includes('provider_payable'))).toEqual([]);
    const linkOutbox = db
      .select({ status: syncOutbox.status })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          eq(syncOutbox.entityType, 'provider_payable_invoice_purchases'),
          eq(syncOutbox.entityId, link.id)
        )
      )
      .get();
    expect(linkOutbox?.status).toBe('synced');
  });
});
