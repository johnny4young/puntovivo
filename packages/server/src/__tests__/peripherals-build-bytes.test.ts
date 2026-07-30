/**
 * `peripherals.buildReceiptBytes` + `buildDrawerKickBytes`
 * read-only procedures for the hub_client local hardware bridge.
 *
 * Per ADR-0008 rule 6 the bridge runs on the terminal that owns the
 * physical printer; the server only resolves the active peripheral
 * and serializes the bytes. The procedures MUST NEVER write
 * `hardware_outbox` (or any operational table). Tests pin the row
 * count before + after as a hard invariant.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { and, count, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  companies,
  customers,
  fiscalDocumentItems,
  fiscalDocuments,
  fiscalNumberingResolutions,
  hardwareOutbox,
  managerApprovalRequests,
  receiptTemplates,
  saleItems,
  sales,
  sites,
  sitePeripherals,
  tenants,
  products,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { freshCriticalContext } from './utils/criticalCommandFixture.js';
import { seedCommittedSaleSession } from './utils/cashSessionFixture.js';
import { ESCPOS_BYTES } from '../services/peripherals/escpos/byte-builder.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let seededSaleId: string;
let foreignTenantId: string;
let foreignSaleId: string;
let foreignSiteId: string;
let deviceId: string;
let approverId: string;
let saleTemplateId: string;
let snapshotCustomerId: string;
let snapshotProductId: string;
let originalSiteName: string;
let originalUserName: string;
let originalCompanyId: string;
let originalCompanyName: string;
let originalCompanyTaxId: string | null;
let originalCompanyAddress: string | null;
let originalCompanyPhone: string | null;
let originalCompanyEmail: string | null;

function buildContext(
  role: 'admin' | 'manager' | 'cashier' = 'cashier',
  tenantOverride?: string
): Context {
  const effectiveTenant = tenantOverride ?? tenantId;
  return freshCriticalContext({
    db: getDatabase(),
    serverApp: server.app,
    tenantId: effectiveTenant,
    userId,
    email: 'admin@localhost',
    role,
    siteId,
    deviceId,
  });
}

async function countHardwareOutbox(): Promise<number> {
  const row = await getDatabase()
    .select({ value: count() })
    .from(hardwareOutbox)
    .where(eq(hardwareOutbox.tenantId, tenantId))
    .get();
  return Number(row?.value ?? 0);
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const seededUser = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!seededUser) throw new Error('Expected seeded admin user');
  tenantId = seededUser.tenantId;
  userId = seededUser.id;
  originalUserName = seededUser.name;

  const seededSite = await db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();
  if (!seededSite) throw new Error('Expected seeded site');
  siteId = seededSite.id;
  originalSiteName = seededSite.name;
  const seededCompany = await db
    .select()
    .from(companies)
    .where(and(eq(companies.id, seededSite.companyId), eq(companies.tenantId, tenantId)))
    .get();
  if (!seededCompany) throw new Error('Expected seeded company');
  originalCompanyId = seededCompany.id;
  originalCompanyName = seededCompany.name;
  originalCompanyTaxId = seededCompany.taxId;
  originalCompanyAddress = seededCompany.address;
  originalCompanyPhone = seededCompany.phone;
  originalCompanyEmail = seededCompany.email;
  deviceId = (
    await registerDevice(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'peripherals-build-bytes',
    })
  ).deviceId;
  approverId = nanoid();
  await db.insert(users).values({
    id: approverId,
    tenantId,
    email: `bytes-approver-${approverId}@example.test`,
    name: 'Bytes Approver',
    passwordHash: 'not-used-by-router-tests',
    role: 'manager',
    isActive: true,
  });

  // Insert a minimal sale row for the in-tenant tests. The seed
  // does not create sales by default in :memory: mode, so the test
  // owns its fixture.
  seededSaleId = nanoid();
  // a committed sale needs a cash session at the schema level.
  const seededSessionId = await seedCommittedSaleSession({
    tenantId,
    cashierId: userId,
    siteId,
  });
  snapshotCustomerId = nanoid();
  snapshotProductId = nanoid();
  await db.insert(customers).values({
    id: snapshotCustomerId,
    tenantId,
    name: 'Cliente congelado',
    taxId: 'CLIENTE-ID-ORIGINAL',
  });
  await db.insert(products).values({
    id: snapshotProductId,
    tenantId,
    name: 'Producto congelado',
    sku: 'SNAPSHOT-001',
  });
  await db.insert(sales).values({
    id: seededSaleId,
    tenantId,
    saleNumber: 'TEST-074B-001',
    customerId: snapshotCustomerId,
    customerNameSnapshot: 'Cliente congelado',
    siteNameSnapshot: originalSiteName,
    cashierNameSnapshot: originalUserName,
    receiptIdentitySnapshotVersion: 1,
    companyNameSnapshot: originalCompanyName,
    companyTaxIdSnapshot: originalCompanyTaxId,
    companyAddressSnapshot: originalCompanyAddress,
    companyPhoneSnapshot: originalCompanyPhone,
    companyEmailSnapshot: originalCompanyEmail,
    customerTaxIdSnapshot: 'CLIENTE-ID-ORIGINAL',
    subtotal: 100,
    taxAmount: 19,
    discountAmount: 0,
    total: 119,
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    cashSessionId: seededSessionId,
    createdBy: userId,
  });
  await db.insert(saleItems).values({
    id: nanoid(),
    saleId: seededSaleId,
    productId: snapshotProductId,
    productNameSnapshot: 'Producto congelado',
    productSkuSnapshot: 'SNAPSHOT-001',
    quantity: 1,
    unitPrice: 119,
    taxRate: 19,
    taxAmount: 19,
    total: 119,
  });
  const adminCaller = appRouter.createCaller(buildContext('admin'));
  const saleTemplate = await adminCaller.receiptTemplates.create({
    kind: 'sale',
    name: 'Runtime sale template',
    isDefault: true,
    layout: {
      paperWidth: '80mm',
      blocks: [
        { type: 'text', value: 'TPL {{sale.saleNumber}}', bold: true },
        { type: 'text', value: 'Dirección Única' },
        { type: 'barcode128', source: '{{sale.saleNumber}}', heightMm: 12 },
      ],
    },
  });
  saleTemplateId = saleTemplate.id;

  // Manufacture a foreign tenant + sale to assert the cross-tenant
  // guard. The foreign tenant only needs a valid `tenants` row + a
  // sale with the same minimal shape.
  foreignTenantId = nanoid();
  await db.insert(tenants).values({
    id: foreignTenantId,
    name: 'Foreign tenant for cross-tenant test',
    slug: `foreign-${foreignTenantId.slice(0, 6)}`,
    settings: {},
  });
  // A site row owned by the foreign tenant so the cross-tenant
  // siteId guard tests have a valid id that scopes to the OTHER
  // tenant. Without this row, `ensureTenantSite` would
  // fail on missing-id semantics rather than tenant-mismatch
  // semantics — both throw, but the second is what we want to pin.
  // `sites.company_id` is NOT NULL so we mint a foreign company first.
  const foreignCompanyId = nanoid();
  await db.insert(companies).values({
    id: foreignCompanyId,
    tenantId: foreignTenantId,
    name: 'Foreign tenant company',
  });
  foreignSiteId = nanoid();
  await db.insert(sites).values({
    id: foreignSiteId,
    tenantId: foreignTenantId,
    companyId: foreignCompanyId,
    name: 'Foreign tenant flagship',
    code: 'FRN-001',
    isActive: true,
  });
  // The foreign sale needs a `created_by` user belonging to that
  // tenant — reuse the seeded admin since FK only checks the user
  // exists, not their tenant scoping.
  foreignSaleId = nanoid();
  const foreignSessionId = await seedCommittedSaleSession({
    tenantId: foreignTenantId,
    cashierId: userId,
    siteId: foreignSiteId,
  });
  await db.insert(sales).values({
    id: foreignSaleId,
    tenantId: foreignTenantId,
    saleNumber: 'FOREIGN-001',
    subtotal: 50,
    taxAmount: 0,
    discountAmount: 0,
    total: 50,
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    cashSessionId: foreignSessionId,
    createdBy: userId,
  });
});

afterAll(async () => {
  await server.close();
});

afterEach(async () => {
  await getDatabase().delete(sitePeripherals).where(eq(sitePeripherals.tenantId, tenantId));
});

describe('peripherals.buildReceiptBytes', () => {
  it('renders system HTML from the active default template', async () => {
    const caller = appRouter.createCaller(buildContext());
    const result = await caller.peripherals.renderReceiptHtml({
      saleId: seededSaleId,
      siteId,
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected template HTML');
    expect(result.templateKind).toBe('sale');
    expect(result.html).toContain('TPL TEST-074B-001');
    expect(result.html).toContain('class="barcode-svg"');
  });

  it('keeps sale-time receipt identity after related records change and falls back for historical rows', async () => {
    const db = getDatabase();
    const template = await db
      .select({ layout: receiptTemplates.layout })
      .from(receiptTemplates)
      .where(eq(receiptTemplates.id, saleTemplateId))
      .get();
    if (!template) throw new Error('Expected runtime sale template');

    const detailedLayout = {
      paperWidth: '80mm' as const,
      blocks: [
        { type: 'text' as const, value: 'Cajero {{sale.cashier}}' },
        { type: 'text' as const, value: 'Sede {{sale.site}}' },
        { type: 'text' as const, value: 'Cliente {{sale.customer}}' },
        { type: 'text' as const, value: 'Documento {{sale.customerTaxId}}' },
        { type: 'text' as const, value: 'Empresa {{company.name}}' },
        { type: 'text' as const, value: 'NIT {{company.taxId}}' },
        { type: 'text' as const, value: 'Dirección {{company.address}}' },
        { type: 'text' as const, value: 'Teléfono {{company.phone}}' },
        { type: 'text' as const, value: 'Correo {{company.email}}' },
        {
          type: 'itemsTable' as const,
          columns: ['name', 'qty', 'unitPrice', 'total'] as const,
        },
      ],
    };
    await Promise.all([
      db
        .update(receiptTemplates)
        .set({ layout: detailedLayout })
        .where(eq(receiptTemplates.id, saleTemplateId)),
      db
        .update(customers)
        .set({ name: 'Cliente renombrado', taxId: 'CLIENTE-ID-NUEVO' })
        .where(and(eq(customers.id, snapshotCustomerId), eq(customers.tenantId, tenantId))),
      db
        .update(companies)
        .set({
          name: 'Empresa renombrada',
          taxId: 'NIT-NUEVO',
          address: 'Dirección nueva',
          phone: 'Teléfono nuevo',
          email: 'correo-nuevo@example.test',
        })
        .where(and(eq(companies.id, originalCompanyId), eq(companies.tenantId, tenantId))),
      db
        .update(products)
        .set({ name: 'Producto renombrado', sku: 'RENAMED-001' })
        .where(and(eq(products.id, snapshotProductId), eq(products.tenantId, tenantId))),
      db
        .update(sites)
        .set({ name: 'Sede renombrada' })
        .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId))),
      db
        .update(users)
        .set({ name: 'Cajero renombrado' })
        .where(and(eq(users.id, userId), eq(users.tenantId, tenantId))),
    ]);

    try {
      const caller = appRouter.createCaller(buildContext());
      const snapshotted = await caller.peripherals.renderReceiptHtml({
        saleId: seededSaleId,
        siteId,
      });
      expect(snapshotted.status).toBe('ready');
      if (snapshotted.status !== 'ready') throw new Error('Expected snapshotted receipt HTML');
      expect(snapshotted.html).toContain(`Cajero ${originalUserName}`);
      expect(snapshotted.html).toContain(`Sede ${originalSiteName}`);
      expect(snapshotted.html).toContain('Cliente Cliente congelado');
      expect(snapshotted.html).toContain('Documento CLIENTE-ID-ORIGINAL');
      expect(snapshotted.html).toContain(`Empresa ${originalCompanyName}`);
      if (originalCompanyTaxId) {
        expect(snapshotted.html).toContain(`NIT ${originalCompanyTaxId}`);
      }
      if (originalCompanyAddress) {
        expect(snapshotted.html).toContain(`Dirección ${originalCompanyAddress}`);
      }
      if (originalCompanyPhone) {
        expect(snapshotted.html).toContain(`Teléfono ${originalCompanyPhone}`);
      }
      if (originalCompanyEmail) {
        expect(snapshotted.html).toContain(`Correo ${originalCompanyEmail}`);
      }
      expect(snapshotted.html).toContain('Producto congelado');
      expect(snapshotted.html).not.toContain('renombrado');
      expect(snapshotted.html).not.toContain('CLIENTE-ID-NUEVO');
      expect(snapshotted.html).not.toContain('NIT-NUEVO');

      await Promise.all([
        db
          .update(sales)
          .set({
            customerNameSnapshot: null,
            siteNameSnapshot: null,
            cashierNameSnapshot: null,
            receiptIdentitySnapshotVersion: 0,
            companyNameSnapshot: null,
            companyTaxIdSnapshot: null,
            companyAddressSnapshot: null,
            companyPhoneSnapshot: null,
            companyEmailSnapshot: null,
            customerTaxIdSnapshot: null,
          })
          .where(eq(sales.id, seededSaleId)),
        db
          .update(saleItems)
          .set({ productNameSnapshot: null, productSkuSnapshot: null })
          .where(eq(saleItems.saleId, seededSaleId)),
      ]);
      const historical = await caller.peripherals.renderReceiptHtml({
        saleId: seededSaleId,
        siteId,
      });
      expect(historical.status).toBe('ready');
      if (historical.status !== 'ready') throw new Error('Expected historical receipt HTML');
      expect(historical.html).toContain('Cajero Cajero renombrado');
      expect(historical.html).toContain('Sede Sede renombrada');
      expect(historical.html).toContain('Cliente Cliente renombrado');
      expect(historical.html).toContain('Documento CLIENTE-ID-NUEVO');
      expect(historical.html).toContain('Empresa Empresa renombrada');
      expect(historical.html).toContain('NIT NIT-NUEVO');
      expect(historical.html).toContain('Dirección Dirección nueva');
      expect(historical.html).toContain('Teléfono Teléfono nuevo');
      expect(historical.html).toContain('Correo correo-nuevo@example.test');
      expect(historical.html).toContain('Producto renombrado');
    } finally {
      await Promise.all([
        db
          .update(receiptTemplates)
          .set({ layout: template.layout })
          .where(eq(receiptTemplates.id, saleTemplateId)),
        db
          .update(customers)
          .set({ name: 'Cliente congelado', taxId: 'CLIENTE-ID-ORIGINAL' })
          .where(eq(customers.id, snapshotCustomerId)),
        db
          .update(companies)
          .set({
            name: originalCompanyName,
            taxId: originalCompanyTaxId,
            address: originalCompanyAddress,
            phone: originalCompanyPhone,
            email: originalCompanyEmail,
          })
          .where(eq(companies.id, originalCompanyId)),
        db
          .update(products)
          .set({ name: 'Producto congelado', sku: 'SNAPSHOT-001' })
          .where(eq(products.id, snapshotProductId)),
        db.update(sites).set({ name: originalSiteName }).where(eq(sites.id, siteId)),
        db.update(users).set({ name: originalUserName }).where(eq(users.id, userId)),
        db
          .update(sales)
          .set({
            customerNameSnapshot: 'Cliente congelado',
            siteNameSnapshot: originalSiteName,
            cashierNameSnapshot: originalUserName,
            receiptIdentitySnapshotVersion: 1,
            companyNameSnapshot: originalCompanyName,
            companyTaxIdSnapshot: originalCompanyTaxId,
            companyAddressSnapshot: originalCompanyAddress,
            companyPhoneSnapshot: originalCompanyPhone,
            companyEmailSnapshot: originalCompanyEmail,
            customerTaxIdSnapshot: 'CLIENTE-ID-ORIGINAL',
          })
          .where(eq(sales.id, seededSaleId)),
        db
          .update(saleItems)
          .set({
            productNameSnapshot: 'Producto congelado',
            productSkuSnapshot: 'SNAPSHOT-001',
          })
          .where(eq(saleItems.saleId, seededSaleId)),
      ]);
    }
  });

  it('returns system-fallback when no escpos peripheral is registered', async () => {
    const before = await countHardwareOutbox();
    const caller = appRouter.createCaller(buildContext());
    const result = await caller.peripherals.buildReceiptBytes({
      saleId: seededSaleId,
      siteId,
    });
    expect(result.status).toBe('system-fallback');
    expect(result.bytes).toEqual([]);
    expect(result.transportHint).toBeNull();
    expect(await countHardwareOutbox()).toBe(before);
  });

  it('returns system-fallback when the printer driver is not escpos', async () => {
    await getDatabase().insert(sitePeripherals).values({
      id: nanoid(),
      tenantId,
      siteId,
      kind: 'printer',
      driver: 'system',
      config: {},
      displayName: 'System printer',
      isActive: true,
    });
    const before = await countHardwareOutbox();
    const caller = appRouter.createCaller(buildContext());
    const result = await caller.peripherals.buildReceiptBytes({
      saleId: seededSaleId,
      siteId,
    });
    expect(result.status).toBe('system-fallback');
    expect(await countHardwareOutbox()).toBe(before);
  });

  it('returns ready bytes with transport hint when an escpos printer is registered', async () => {
    await getDatabase()
      .insert(sitePeripherals)
      .values({
        id: nanoid(),
        tenantId,
        siteId,
        kind: 'printer',
        driver: 'escpos',
        config: {
          channel: 'tcp',
          host: '192.168.1.50',
          port: 9100,
          paperWidth: '80mm',
          characterSet: 'cp858',
        },
        displayName: 'ESC/POS receipt printer',
        isActive: true,
      });
    const before = await countHardwareOutbox();
    const caller = appRouter.createCaller(buildContext());
    const result = await caller.peripherals.buildReceiptBytes({
      saleId: seededSaleId,
      siteId,
    });
    expect(result.status).toBe('ready');
    expect(result.bytes.length).toBeGreaterThan(0);
    expect(result.bytes[0]).toBe(0x1b); // ESC INIT prefix
    expect(result.paperWidth).toBe('80mm');
    expect(result.characterSet).toBe('cp858');
    expect(result.bytes.slice(0, 5)).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    expect(result.bytes).toContain(0xe9); // Ú in cp858
    const printable = result.bytes
      .map(byte => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : ''))
      .join('');
    expect(printable).toContain('TPL TEST-074B-001');
    expect(
      result.bytes.some(
        (byte, index) =>
          byte === 0x1d && result.bytes[index + 1] === 0x6b && result.bytes[index + 2] === 0x49
      )
    ).toBe(true);
    expect(result.bytes.slice(-8)).toEqual([...ESCPOS_BYTES.DRAWER_KICK, ...ESCPOS_BYTES.CUT_FULL]);
    expect(result.transportHint).toEqual({
      channel: 'tcp',
      host: '192.168.1.50',
      port: 9100,
      vendorId: null,
      productId: null,
      devicePath: null,
      timeoutMs: null,
    });
    // Hard invariant per ADR-0008 rule 6.
    expect(await countHardwareOutbox()).toBe(before);
  });

  it('keeps the legacy ESC/POS receipt when no active template exists', async () => {
    const db = getDatabase();
    await db.insert(sitePeripherals).values({
      id: nanoid(),
      tenantId,
      siteId,
      kind: 'printer',
      driver: 'escpos',
      config: {
        channel: 'tcp',
        host: '192.168.1.50',
        port: 9100,
        paperWidth: '80mm',
        characterSet: 'cp858',
      },
      displayName: 'Legacy fallback printer',
      isActive: true,
    });
    await db
      .update(receiptTemplates)
      .set({ isActive: false })
      .where(eq(receiptTemplates.tenantId, tenantId));
    try {
      const result = await appRouter
        .createCaller(buildContext())
        .peripherals.buildReceiptBytes({ saleId: seededSaleId, siteId });
      expect(result.status).toBe('ready');
      const printable = result.bytes
        .map(byte => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : ''))
        .join('');
      expect(printable).toContain('TEST-074B-001');
      expect(printable).not.toContain('TPL TEST-074B-001');
    } finally {
      await db
        .update(receiptTemplates)
        .set({ isActive: true })
        .where(eq(receiptTemplates.tenantId, tenantId));
    }
  });

  it('uses the fiscal template and preserves mock evidence for fiscal sales', async () => {
    const db = getDatabase();
    const adminCaller = appRouter.createCaller(buildContext('admin'));
    const fiscalTemplate = await adminCaller.receiptTemplates.create({
      kind: 'fiscal_dee',
      name: 'Runtime fiscal template',
      isDefault: true,
      layout: {
        paperWidth: '80mm',
        blocks: [
          { type: 'text', value: 'FISCAL {{sale.saleNumber}}', bold: true },
          { type: 'text', value: 'Documento {{fiscal.documentNumber}}' },
          { type: 'text', value: 'Comprador {{sale.customer}} / {{sale.customerTaxId}}' },
          { type: 'text', value: 'Fecha {{ date(sale.createdAt) }}' },
          {
            type: 'itemsTable',
            columns: ['name', 'qty', 'unitPrice', 'discount', 'total'],
          },
          {
            type: 'totalsBlock',
            show: ['subtotal', 'discount', 'taxTotal', 'grandTotal'],
          },
        ],
      },
    });
    const resolutionId = nanoid();
    const fiscalDocumentId = nanoid();
    const voidFiscalDocumentId = nanoid();
    await db.insert(fiscalNumberingResolutions).values({
      id: resolutionId,
      tenantId,
      siteId,
      kind: 'DEE',
      resolutionNumber: 'TEST-DIAN-001',
      prefix: 'DEMO',
      fromNumber: 1,
      toNumber: 100,
      currentNumber: 2,
      technicalKey: 'test-only',
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: '2027-01-01T00:00:00.000Z',
    });
    await db.insert(fiscalDocuments).values({
      id: fiscalDocumentId,
      tenantId,
      source: 'sale',
      sourceId: seededSaleId,
      kind: 'DEE',
      resolutionId,
      consecutive: 1,
      documentNumber: 'DEMO-1',
      cufe: 'f'.repeat(96),
      status: 'accepted',
      buyerTaxId: '222222222222',
      buyerCountryCode: 'CO',
      buyerTaxIdTypeCode: '13',
      buyerName: 'Consumidor final',
      subtotal: 180,
      taxAmount: 34.2,
      discountAmount: 20,
      totalAmount: 214.2,
      currencyCode: 'COP',
      localeCode: 'es-CO',
      providerId: 'mock',
      emittedByUserId: userId,
      emittedAt: '2026-07-23T15:40:36.000Z',
    });
    await db.insert(fiscalDocumentItems).values({
      id: nanoid(),
      fiscalDocumentId,
      lineNumber: 1,
      productName: 'Producto fiscal congelado',
      productSku: 'FISCAL-SNAPSHOT',
      unitMeasureCode: 'EA',
      quantity: 2,
      unitPrice: 100,
      discountAmount: 20,
      taxRate: 19,
      taxAmount: 34.2,
      taxCategoryCode: '01',
      lineTotal: 214.2,
    });
    await db.insert(fiscalDocuments).values({
      id: voidFiscalDocumentId,
      tenantId,
      source: 'void',
      sourceId: seededSaleId,
      kind: 'NC',
      resolutionId,
      consecutive: 2,
      documentNumber: 'DEMO-NC-1',
      cufe: 'e'.repeat(96),
      status: 'accepted',
      buyerTaxId: '222222222222',
      buyerCountryCode: 'CO',
      buyerTaxIdTypeCode: '13',
      buyerName: 'Consumidor final',
      subtotal: 180,
      taxAmount: 34.2,
      discountAmount: 20,
      totalAmount: 214.2,
      currencyCode: 'COP',
      localeCode: 'es-CO',
      originalCufe: 'f'.repeat(96),
      providerId: 'mock',
      emittedByUserId: userId,
      emittedAt: '2026-07-22T15:40:36.000Z',
    });
    try {
      const result = await appRouter
        .createCaller(buildContext())
        .peripherals.renderReceiptHtml({ saleId: seededSaleId, siteId });
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') throw new Error('Expected fiscal template HTML');
      expect(result.templateKind).toBe('fiscal_dee');
      expect(result.html).toContain('FISCAL TEST-074B-001');
      expect(result.html).toContain('Documento DEMO-1');
      expect(result.html).toContain('DEMO-NC-1');
      expect(result.html).toContain('Comprador Consumidor final / 222222222222');
      expect(result.html).toContain('Fecha 23/07/2026');
      expect(result.html).toContain('Producto fiscal congelado');
      expect(result.html).toContain('Solo demostración');
      expect(result.html).toContain('TEST-DIAN-001');
      expect(result.html).toContain('$\u00a0214');
      expect(result.html).not.toContain('$\u00a0119');
      expect(result.html).not.toContain('catalogo-vpfe.dian.gov.co');
    } finally {
      await db.delete(fiscalDocuments).where(eq(fiscalDocuments.id, voidFiscalDocumentId));
      await db.delete(fiscalDocuments).where(eq(fiscalDocuments.id, fiscalDocumentId));
      await db
        .delete(fiscalNumberingResolutions)
        .where(eq(fiscalNumberingResolutions.id, resolutionId));
      await db.delete(receiptTemplates).where(eq(receiptTemplates.id, fiscalTemplate.id));
    }
  });

  it('rejects a saleId from a foreign tenant (cross-tenant guard)', async () => {
    await getDatabase()
      .insert(sitePeripherals)
      .values({
        id: nanoid(),
        tenantId,
        siteId,
        kind: 'printer',
        driver: 'escpos',
        config: { channel: 'tcp', host: '192.168.1.50', port: 9100 },
        displayName: 'ESC/POS receipt printer',
        isActive: true,
      });
    const caller = appRouter.createCaller(buildContext());
    await expect(
      caller.peripherals.buildReceiptBytes({
        saleId: foreignSaleId,
        siteId,
      })
    ).rejects.toThrow(TRPCError);
  });

  it('rejects a siteId from a foreign tenant (ensureTenantSite guard)', async () => {
    // Pass a saleId that belongs to the local tenant but a siteId
    // owned by the foreign tenant — covers the second guard vector
    // beyond `getSaleRecord`.
    const caller = appRouter.createCaller(buildContext());
    await expect(
      caller.peripherals.buildReceiptBytes({
        saleId: seededSaleId,
        siteId: foreignSiteId,
      })
    ).rejects.toThrow(TRPCError);
  });
});

describe('peripherals.buildDrawerKickBytes', () => {
  it('returns no-drawer-registered when no escpos drawer exists', async () => {
    const before = await countHardwareOutbox();
    const caller = appRouter.createCaller(buildContext('manager'));
    const result = await caller.peripherals.buildDrawerKickBytes({ siteId });
    expect(result.status).toBe('no-drawer-registered');
    expect(result.bytes).toEqual([]);
    expect(result.transportHint).toBeNull();
    expect(await countHardwareOutbox()).toBe(before);
  });

  it('returns the canonical drawer-pulse bytes when an escpos drawer is registered', async () => {
    await getDatabase()
      .insert(sitePeripherals)
      .values({
        id: nanoid(),
        tenantId,
        siteId,
        kind: 'cash_drawer',
        driver: 'escpos',
        config: { channel: 'tcp', host: '192.168.1.50', port: 9100 },
        displayName: 'ESC/POS cash drawer',
        isActive: true,
      });
    const before = await countHardwareOutbox();
    const caller = appRouter.createCaller(buildContext('manager'));
    const result = await caller.peripherals.buildDrawerKickBytes({ siteId });
    expect(result.status).toBe('ready');
    expect(result.bytes).toEqual(Array.from(ESCPOS_BYTES.DRAWER_KICK));
    expect(result.transportHint).toEqual({
      channel: 'tcp',
      host: '192.168.1.50',
      port: 9100,
      vendorId: null,
      productId: null,
      devicePath: null,
      timeoutMs: null,
    });
    expect(await countHardwareOutbox()).toBe(before);
  });

  it('requires a one-time approval from a cashier', async () => {
    await getDatabase()
      .insert(sitePeripherals)
      .values({
        id: nanoid(),
        tenantId,
        siteId,
        kind: 'cash_drawer',
        driver: 'escpos',
        config: { channel: 'tcp', host: '192.168.1.50', port: 9100 },
        displayName: 'ESC/POS cash drawer',
        isActive: true,
      });
    const caller = appRouter.createCaller(buildContext('cashier'));
    await expect(caller.peripherals.buildDrawerKickBytes({ siteId })).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_REQUIRED' }),
    });
  });

  it('consumes the cashier grant before returning hub-client pulse bytes', async () => {
    await getDatabase()
      .insert(sitePeripherals)
      .values({
        id: nanoid(),
        tenantId,
        siteId,
        kind: 'cash_drawer',
        driver: 'escpos',
        config: { channel: 'tcp', host: '192.168.1.50', port: 9100 },
        displayName: 'ESC/POS cash drawer',
        isActive: true,
      });
    const approvalRequestId = nanoid();
    const timestamp = new Date().toISOString();
    await getDatabase()
      .insert(managerApprovalRequests)
      .values({
        id: approvalRequestId,
        tenantId,
        siteId,
        requesterId: userId,
        action: 'cash_drawer_open',
        status: 'approved',
        reason: 'Open from hub client',
        resourceType: 'site',
        resourceId: siteId,
        summary: { label: 'Main site' },
        requestedAt: timestamp,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        decidedAt: timestamp,
        decidedBy: approverId,
        grantExpiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    const result = await appRouter
      .createCaller(buildContext('cashier'))
      .peripherals.buildDrawerKickBytes({ siteId, approvalRequestId });
    expect(result.status).toBe('ready');
    const consumed = await getDatabase()
      .select({ status: managerApprovalRequests.status })
      .from(managerApprovalRequests)
      .where(eq(managerApprovalRequests.id, approvalRequestId))
      .get();
    expect(consumed?.status).toBe('consumed');
  });

  it('rejects a siteId from a foreign tenant (ensureTenantSite guard)', async () => {
    const caller = appRouter.createCaller(buildContext('manager'));
    await expect(
      caller.peripherals.buildDrawerKickBytes({ siteId: foreignSiteId })
    ).rejects.toThrow(TRPCError);
  });
});
