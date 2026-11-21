import { and, eq } from 'drizzle-orm';
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
  units,
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
  unitCost: number
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
    documentType: 'remision',
    documentNumber: `RM-${nanoid(4)}`,
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
    unitEquivalence: 1,
    costPerUnit: unitCost,
    baseUnitCost: unitCost,
    total: lineTotal,
    createdAt: now,
    updatedAt: now,
  });
  return purchaseId;
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
});
