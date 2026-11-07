/**
 * Colombian sales issue the DEE whatever the amount and an FEV only on request.
 * @module __tests__/sales-electronic-invoice
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { TRPCError } from '@trpc/server';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  customers,
  fiscalDocuments,
  fiscalEmissionIntents,
  fiscalNumberingResolutions,
  inventoryBalances,
  products,
  sales,
  sites,
  tenantLocaleSettings,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';
import { appRouter } from '../trpc/router.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { computeNitVerificationDigit } from '../services/fiscal/packs/co/nit.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let fevResolutionId: string;
// Each critical command needs its own envelope, so every call gets a fresh api().
let api: () => ReturnType<typeof appRouter.createCaller>;

const UVT_2026 = 52_374;
const ABOVE_FIVE_UVT = 300_000;

const NIT_BUYER = {
  name: 'Ferretería La 14 SAS',
  identificationTypeCode: '31',
  identificationNumber: '900.373.115',
  email: 'compras@ferreteria14.co',
};

async function setTenantSettings(patch: Record<string, unknown>): Promise<void> {
  const db = getDatabase();
  const row = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
  await db
    .update(tenants)
    .set({ settings: { ...((row?.settings as Record<string, unknown>) ?? {}), ...patch } })
    .where(eq(tenants.id, tenantId))
    .run();
}

async function insertResolution(kind: 'DEE' | 'FEV' | 'NC', prefix: string): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await getDatabase()
    .insert(fiscalNumberingResolutions)
    .values({
      id,
      tenantId,
      siteId,
      kind,
      resolutionNumber: '18760000001',
      prefix,
      fromNumber: 1,
      toNumber: 1_000_000,
      currentNumber: 0,
      technicalKey: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
      validFrom: new Date(Date.now() - 60_000).toISOString(),
      validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000).toISOString(),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  return id;
}

async function seedProduct(price: number): Promise<string> {
  const db = getDatabase();
  const productId = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id: productId,
    tenantId,
    name: `Taladro ${productId.slice(0, 4)}`,
    sku: `EI-${nanoid(6)}`,
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
    productId,
    unitId: baseUnitId,
    equivalence: 1,
    price,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(inventoryBalances).values({
    id: nanoid(),
    tenantId,
    siteId,
    productId,
    onHand: 50,
    reserved: 0,
    createdAt: now,
    updatedAt: now,
  });
  return productId;
}

async function sell(args: {
  price: number;
  customerId?: string;
  electronicInvoice?: { buyer: typeof NIT_BUYER | Record<string, string> };
}) {
  const productId = await seedProduct(args.price);
  return api().sales.create({
    items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: args.price, discount: 0 }],
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    amountReceived: args.price,
    discountAmount: 0,
    ...(args.customerId ? { customerId: args.customerId } : {}),
    ...(args.electronicInvoice
      ? { electronicInvoice: args.electronicInvoice as { buyer: typeof NIT_BUYER } }
      : {}),
  });
}

async function waitForDocument(sourceId: string, kind: 'DEE' | 'FEV' | 'NC') {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const doc = await getDatabase()
      .select()
      .from(fiscalDocuments)
      .where(
        and(
          eq(fiscalDocuments.tenantId, tenantId),
          eq(fiscalDocuments.sourceId, sourceId),
          eq(fiscalDocuments.kind, kind)
        )
      )
      .get();
    if (doc) return doc;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`No ${kind} document for ${sourceId}`);
}

function saleIntent(saleId: string) {
  return getDatabase()
    .select()
    .from(fiscalEmissionIntents)
    .where(
      and(
        eq(fiscalEmissionIntents.tenantId, tenantId),
        eq(fiscalEmissionIntents.source, 'sale'),
        eq(fiscalEmissionIntents.sourceId, saleId)
      )
    )
    .get();
}

async function expectServerError(promise: Promise<unknown>, errorCode: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(TRPCError);
  expect((error as TRPCError).cause).toBeInstanceOf(ServerErrorWithCode);
  expect(((error as TRPCError).cause as ServerErrorWithCode).errorCode).toBe(errorCode);
}

function countSales(): number {
  return getDatabase().select().from(sales).where(eq(sales.tenantId, tenantId)).all().length;
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!admin) throw new Error('Expected seeded admin user');
  tenantId = admin.tenantId;
  userId = admin.id;
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
  if (!unit) throw new Error('Expected seeded UND unit');
  baseUnitId = unit.id;

  await setTenantSettings({
    fiscal_dian_enabled: true,
    fiscal: { co: { nit: '900373115-3', softwareId: 'sw-test', softwarePin: '12301' } },
  });
  const now = new Date().toISOString();
  await db
    .insert(tenantLocaleSettings)
    .values({
      tenantId,
      countryCode: 'CO',
      localeOverride: null,
      currencyOverride: null,
      timezoneOverride: null,
      firstDayOfWeekOverride: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: tenantLocaleSettings.tenantId,
      set: { countryCode: 'CO', updatedAt: now },
    });
  await insertResolution('DEE', 'POS');
  await insertResolution('NC', 'NC');

  const device = await registerDevice(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'sales-electronic-invoice.test',
  });
  const fresh = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId,
    userId,
    email: 'admin@localhost',
    siteId,
    deviceId: device.deviceId,
    defaultRole: 'admin',
  });
  api = () => appRouter.createCaller(fresh());
  await api().cashSessions.open({
    registerName: `einvoice-${nanoid(4)}`,
    openingFloat: 100,
    denominations: [{ value: 100, count: 1 }],
  });
});

afterAll(async () => {
  await server.close();
});

describe('sales.electronicInvoiceAvailability', () => {
  it('is off until the site has an active FEV numbering range', async () => {
    await expect(api().sales.electronicInvoiceAvailability()).resolves.toEqual({
      available: false,
      identificationTypes: [],
    });

    fevResolutionId = await insertResolution('FEV', 'FE');
    const availability = await api().sales.electronicInvoiceAvailability();
    expect(availability.available).toBe(true);
    expect(availability.identificationTypes.map(type => type.code)).toEqual(
      expect.arrayContaining(['13', '22', '31', '41'])
    );
  });
});

describe('sales.create — Colombian sale document', () => {
  it('issues the POS equivalent document above 5 UVT when the buyer did not ask for an invoice', async () => {
    expect(ABOVE_FIVE_UVT).toBeGreaterThan(5 * UVT_2026);
    const sale = await sell({ price: ABOVE_FIVE_UVT });

    expect(saleIntent(sale.id)?.kind).toBe('DEE');
    const doc = await waitForDocument(sale.id, 'DEE');
    expect(doc).toMatchObject({
      totalAmount: ABOVE_FIVE_UVT,
      buyerTaxId: '222222222222',
      buyerName: 'Consumidor final',
      buyerEmail: null,
    });
  });

  it('issues an electronic invoice naming the buyer when the buyer asked for one', async () => {
    const sale = await sell({ price: 12_000, electronicInvoice: { buyer: NIT_BUYER } });

    expect(saleIntent(sale.id)?.kind).toBe('FEV');
    const doc = await waitForDocument(sale.id, 'FEV');
    expect(doc).toMatchObject({
      resolutionId: fevResolutionId,
      customerId: null,
      buyerTaxIdTypeCode: '31',
      buyerTaxId: '900373115-3',
      buyerName: 'Ferretería La 14 SAS',
      buyerEmail: 'compras@ferreteria14.co',
    });
    expect(doc.documentNumber).toMatch(/^FE\d{10}$/);
    expect(doc.xmlRef).toContain('<cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>');
  });

  it('accepts an invoice request without email for a printed hand-over', async () => {
    const { email: _email, ...withoutEmail } = NIT_BUYER;
    const sale = await sell({
      price: 8_000,
      electronicInvoice: {
        buyer: { ...withoutEmail, identificationTypeCode: '13', identificationNumber: '1.020.304' },
      },
    });
    const doc = await waitForDocument(sale.id, 'FEV');
    expect(doc).toMatchObject({
      buyerTaxIdTypeCode: '13',
      buyerTaxId: '1020304',
      buyerEmail: null,
    });
  });

  it('refuses malformed buyer data before writing the sale', async () => {
    const before = countSales();
    await expectServerError(
      sell({
        price: 5_000,
        electronicInvoice: { buyer: { ...NIT_BUYER, identificationNumber: '900373115-9' } },
      }),
      'ELECTRONIC_INVOICE_BUYER_INVALID'
    );
    await expectServerError(
      sell({
        price: 5_000,
        electronicInvoice: { buyer: { ...NIT_BUYER, identificationTypeCode: '99' } },
      }),
      'ELECTRONIC_INVOICE_BUYER_INVALID'
    );
    await expectServerError(
      sell({
        price: 5_000,
        electronicInvoice: { buyer: { ...NIT_BUYER, identificationNumber: '222222222222' } },
      }),
      'ELECTRONIC_INVOICE_BUYER_INVALID'
    );
    expect(countSales()).toBe(before);
  });

  it('refuses an invoice request on a draft', async () => {
    const productId = await seedProduct(5_000);
    await expect(
      api().sales.create({
        items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 5_000, discount: 0 }],
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'draft',
        discountAmount: 0,
        electronicInvoice: { buyer: NIT_BUYER },
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses the request before writing the sale when the site has no usable FEV range', async () => {
    const db = getDatabase();
    db.update(fiscalNumberingResolutions)
      .set({ isActive: false })
      .where(eq(fiscalNumberingResolutions.id, fevResolutionId))
      .run();
    try {
      const before = countSales();
      await expectServerError(
        sell({ price: 9_000, electronicInvoice: { buyer: NIT_BUYER } }),
        'ELECTRONIC_INVOICE_UNAVAILABLE'
      );
      expect(countSales()).toBe(before);
    } finally {
      db.update(fiscalNumberingResolutions)
        .set({ isActive: true })
        .where(eq(fiscalNumberingResolutions.id, fevResolutionId))
        .run();
    }
  });

  it('hashes a natural-person NIT without its verification digit', async () => {
    const dv = computeNitVerificationDigit('8765432');
    const sale = await sell({
      price: 4_000,
      electronicInvoice: {
        buyer: {
          name: 'Ana Gómez',
          identificationTypeCode: '31',
          identificationNumber: '8.765.432',
        },
      },
    });
    const doc = await waitForDocument(sale.id, 'FEV');
    expect(doc.buyerTaxId).toBe(`8765432-${dv}`);
    expect(doc.xmlRef).toContain('<cbc:CompanyID>8765432</cbc:CompanyID>');
  });

  it('links the invoice to the attached customer only when it names that customer', async () => {
    const customerId = nanoid();
    const now = new Date().toISOString();
    await getDatabase().insert(customers).values({
      id: customerId,
      tenantId,
      name: 'Ana Gómez',
      taxId: '1.020.304.050',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const anaBuyer = {
      name: 'Ana Gómez',
      identificationTypeCode: '13',
      identificationNumber: '1020304050',
    };

    const own = await sell({ price: 3_000, customerId, electronicInvoice: { buyer: anaBuyer } });
    expect((await waitForDocument(own.id, 'FEV')).customerId).toBe(customerId);

    const thirdParty = await sell({
      price: 3_000,
      customerId,
      electronicInvoice: { buyer: NIT_BUYER },
    });
    expect((await waitForDocument(thirdParty.id, 'FEV')).customerId).toBeNull();
  });

  it('refuses an invoice request when the Colombian pack is off', async () => {
    await setTenantSettings({ fiscal_dian_enabled: false });
    try {
      const before = countSales();
      await expectServerError(
        sell({ price: 5_000, electronicInvoice: { buyer: NIT_BUYER } }),
        'ELECTRONIC_INVOICE_UNAVAILABLE'
      );
      expect(countSales()).toBe(before);
      await expect(api().sales.electronicInvoiceAvailability()).resolves.toMatchObject({
        available: false,
      });
    } finally {
      await setTenantSettings({ fiscal_dian_enabled: true });
    }
  });
});

describe('sales.completeDraft — Colombian sale document', () => {
  it('issues an electronic invoice when a resumed draft is paid with the request', async () => {
    const productId = await seedProduct(6_000);
    const draft = await api().sales.create({
      items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 6_000, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      discountAmount: 0,
    });

    await api().sales.completeDraft({
      saleId: draft.id,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 6_000,
      electronicInvoice: { buyer: NIT_BUYER },
    });

    expect(saleIntent(draft.id)?.kind).toBe('FEV');
    const doc = await waitForDocument(draft.id, 'FEV');
    expect(doc).toMatchObject({ buyerTaxId: '900373115-3', buyerName: NIT_BUYER.name });
  });
});

describe('sales.void — note references the invoice', () => {
  it('credits an electronic invoice with a type 91 credit note', async () => {
    const sale = await sell({ price: 15_000, electronicInvoice: { buyer: NIT_BUYER } });
    const invoice = await waitForDocument(sale.id, 'FEV');

    await api().sales.void({ id: sale.id, reason: 'Cliente devolvió el pedido' });
    const note = await waitForDocument(sale.id, 'NC');

    expect(note.originalCufe).toBe(invoice.cufe);
    expect(note.buyerTaxId).toBe('900373115-3');
    expect(note.xmlRef).toContain('<cbc:CreditNoteTypeCode>91</cbc:CreditNoteTypeCode>');
  });

  it('keeps the adjustment note type for a POS equivalent document', async () => {
    const sale = await sell({ price: 7_000 });
    await waitForDocument(sale.id, 'DEE');

    await api().sales.void({ id: sale.id, reason: 'Error de digitación' });
    const note = await waitForDocument(sale.id, 'NC');

    expect(note.xmlRef).toContain('<cbc:CreditNoteTypeCode>94</cbc:CreditNoteTypeCode>');
  });
});
