/**
 * `emitFiscalDocument` integration tests.
 *
 * Runs HTTP-less against the in-memory sqlite DB seeded by `createServer`.
 * Uses `ColombiaMockAdapter` directly so the CUFE stays deterministic and we
 * can assert byte-for-byte equality with `computeCufe`.
 *
 * Coverage:
 * - Feature flag off → returns null, no fiscal document row inserted.
 * - Happy path → CUFE matches pure `computeCufe`; buyer + line snapshots
 * land on the fiscal_documents / fiscal_document_items rows.
 * - Consumidor final (customerId null) → buyer defaults to DIAN constants
 * (222222222222, '31', 'Consumidor final') without touching customers.
 * - Buyer snapshot immutability: mutating `customers.name` post-emission
 * leaves `fiscal_documents.buyer_name` unchanged.
 * - Line snapshot immutability: mutating `products.name` post-emission
 * leaves `fiscal_document_items.product_name` unchanged.
 * - Idempotency: calling emit twice with the same
 * (tenantId, source, sourceId, kind) returns the first row (no dup).
 * - Cross-tenant isolation: tenant B cannot see tenant A's documents.
 * - Resolution consecutive advancement after each emission.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  companies,
  customers,
  fiscalDocumentItems,
  fiscalDocuments,
  fiscalNumberingResolutions,
  products,
  saleItems,
  sales,
  sites,
  tenantLocaleSettings,
  tenants,
  users,
} from '../db/schema.js';
import { CONSUMIDOR_FINAL, computeCufe } from '../services/fiscal/cufe.js';
import { ColombiaMockAdapter } from '../services/fiscal/packs/co/mock-adapter.js';
import { emitFiscalDocument, enqueueFiscalEmission } from '../services/fiscal/orchestrator.js';

let server: PuntovivoServer;

interface TenantHarness {
  tenantId: string;
  userId: string;
  companyId: string;
  siteId: string;
  cashSessionId: string;
  productId: string;
  customerId: string;
  resolutionId: string;
}

async function seedFiscalTenant(slugSuffix: string, enableFlag: boolean): Promise<TenantHarness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `tenant-${slugSuffix}`;
  const userId = `user-${slugSuffix}`;
  const companyId = `company-${slugSuffix}`;
  const siteId = `site-${slugSuffix}`;
  const cashSessionId = `cash-${slugSuffix}`;
  const productId = `product-${slugSuffix}`;
  const customerId = `customer-${slugSuffix}`;
  const resolutionId = `res-${slugSuffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `Fiscal Tenant ${slugSuffix}`,
    slug: `fiscal-${slugSuffix}`,
    settings: enableFlag ? { fiscal_dian_enabled: true } : {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(users).values({
    id: userId,
    tenantId,
    email: `admin-${slugSuffix}@example.com`,
    name: `Admin ${slugSuffix}`,
    passwordHash: 'x',
    sessionVersion: 1,
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: `Company ${slugSuffix}`,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(sites).values({
    id: siteId,
    tenantId,
    companyId,
    name: `Site ${slugSuffix}`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(cashSessions).values({
    id: cashSessionId,
    tenantId,
    siteId,
    cashierId: userId,
    registerName: `register-${slugSuffix}`,
    openingFloat: 0,
    openingCountDenominations: [],
    expectedBalance: 0,
    status: 'open',
    openedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(products).values({
    id: productId,
    tenantId,
    name: `Product ${slugSuffix}`,
    sku: `SKU-${slugSuffix}`,
    price: 100,
    price2: 100,
    price3: 100,
    cost: 50,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 19,
    initialCost: 50,
    stock: 100,
    minStock: 0,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(customers).values({
    id: customerId,
    tenantId,
    name: `Customer ${slugSuffix}`,
    taxId: '800123456',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(fiscalNumberingResolutions).values({
    id: resolutionId,
    tenantId,
    siteId,
    kind: 'DEE',
    resolutionNumber: '18760000001',
    prefix: `PFX${slugSuffix.slice(0, 3).toUpperCase()}`,
    fromNumber: 1,
    toNumber: 10000,
    currentNumber: 0,
    technicalKey: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
    validFrom: now,
    validUntil: now,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  return {
    tenantId,
    userId,
    companyId,
    siteId,
    cashSessionId,
    productId,
    customerId,
    resolutionId,
  };
}

async function seedCompletedSale(opts: {
  harness: TenantHarness;
  saleNumber: string;
  customerId: string | null;
  subtotal?: number;
  taxAmount?: number;
  total?: number;
}): Promise<string> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const saleId = nanoid();
  const subtotal = opts.subtotal ?? 100;
  const taxAmount = opts.taxAmount ?? 19;
  const total = opts.total ?? 119;

  await db.insert(sales).values({
    id: saleId,
    tenantId: opts.harness.tenantId,
    saleNumber: opts.saleNumber,
    customerId: opts.customerId,
    subtotal,
    taxAmount,
    discountAmount: 0,
    total,
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    cashSessionId: opts.harness.cashSessionId,
    createdBy: opts.harness.userId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(saleItems).values({
    id: nanoid(),
    saleId,
    productId: opts.harness.productId,
    quantity: 1,
    unitPrice: subtotal,
    unitEquivalence: 1,
    discount: 0,
    taxRate: 19,
    taxAmount,
    costAtSale: 50,
    total,
  });

  return saleId;
}

async function seedSecondSiteResolution(
  harness: TenantHarness,
  suffix: string
): Promise<TenantHarness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const siteId = `site-${suffix}`;
  const cashSessionId = `cash-${suffix}`;
  const resolutionId = `res-${suffix}`;

  await db.insert(sites).values({
    id: siteId,
    tenantId: harness.tenantId,
    companyId: harness.companyId,
    name: `Site ${suffix}`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(cashSessions).values({
    id: cashSessionId,
    tenantId: harness.tenantId,
    siteId,
    cashierId: harness.userId,
    registerName: `register-${suffix}`,
    openingFloat: 0,
    openingCountDenominations: [],
    expectedBalance: 0,
    status: 'open',
    openedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(fiscalNumberingResolutions).values({
    id: resolutionId,
    tenantId: harness.tenantId,
    siteId,
    kind: 'DEE',
    resolutionNumber: '18760000002',
    prefix: `S${suffix.slice(0, 3).toUpperCase()}`,
    fromNumber: 1,
    toNumber: 10000,
    currentNumber: 41,
    technicalKey: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
    validFrom: now,
    validUntil: now,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  return {
    ...harness,
    siteId,
    cashSessionId,
    resolutionId,
  };
}

describe('emitFiscalDocument', () => {
  let harness: TenantHarness;
  let adapter: ColombiaMockAdapter;

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    harness = await seedFiscalTenant('a', /* enableFlag */ true);
    adapter = new ColombiaMockAdapter();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    const db = getDatabase();
    // Reset fiscal state between tests so (tenant, documentNumber) and
    // (source, sourceId, kind) are not polluted across cases.
    await db.delete(fiscalDocumentItems);
    await db.delete(fiscalDocuments);
    await db
      .update(fiscalNumberingResolutions)
      .set({ currentNumber: 0 })
      .where(eq(fiscalNumberingResolutions.id, harness.resolutionId));
  });

  it('returns null and inserts no row when fiscal_dian_enabled is false', async () => {
    const db = getDatabase();
    // Flip the flag off for this single assertion then restore.
    await db.update(tenants).set({ settings: {} }).where(eq(tenants.id, harness.tenantId));

    const saleId = await seedCompletedSale({
      harness,
      saleNumber: 'DISABLED-0001',
      customerId: harness.customerId,
    });

    const result = await emitFiscalDocument({
      tx: db,
      tenantId: harness.tenantId,
      userId: harness.userId,
      source: 'sale',
      sourceId: saleId,
      saleId,
      kind: 'DEE',
      adapter,
    });

    expect(result).toBeNull();
    const rows = await db
      .select()
      .from(fiscalDocuments)
      .where(eq(fiscalDocuments.tenantId, harness.tenantId))
      .all();
    expect(rows).toHaveLength(0);

    // Restore the flag for the rest of the suite.
    await db
      .update(tenants)
      .set({ settings: { fiscal_dian_enabled: true } })
      .where(eq(tenants.id, harness.tenantId));
  });

  it('skips emission (no row) for an unsupported country, sale stays non-fatal', async () => {
    const db = getDatabase();
    // Move the tenant to a country with no fiscal pack; keep DIAN enabled.
    // the registry no longer falls back to a Colombia-shaped
    // document; the orchestrator must skip emission cleanly so the sale
    // still completes.
    await db
      .update(tenantLocaleSettings)
      .set({ countryCode: 'US' })
      .where(eq(tenantLocaleSettings.tenantId, harness.tenantId));

    try {
      const saleId = await seedCompletedSale({
        harness,
        saleNumber: 'UNSUPPORTED-0001',
        customerId: harness.customerId,
      });

      const result = await enqueueFiscalEmission({
        db,
        tenantId: harness.tenantId,
        userId: harness.userId,
        source: 'sale',
        sourceId: saleId,
        saleId,
        kind: 'DEE',
      });

      expect(result).toBeNull();
      const rows = await db
        .select()
        .from(fiscalDocuments)
        .where(eq(fiscalDocuments.tenantId, harness.tenantId))
        .all();
      expect(rows).toHaveLength(0);
    } finally {
      // Restore CO for the rest of the suite even if an assertion fails.
      await db
        .update(tenantLocaleSettings)
        .set({ countryCode: 'CO' })
        .where(eq(tenantLocaleSettings.tenantId, harness.tenantId));
    }
  });

  it('emits a fiscal_document with a deterministic CUFE matching computeCufe', async () => {
    const db = getDatabase();
    const saleId = await seedCompletedSale({
      harness,
      saleNumber: 'HAPPY-0001',
      customerId: harness.customerId,
    });

    const result = await emitFiscalDocument({
      tx: db,
      tenantId: harness.tenantId,
      userId: harness.userId,
      source: 'sale',
      sourceId: saleId,
      saleId,
      kind: 'DEE',
      adapter,
    });

    expect(result).not.toBeNull();
    expect(result?.cufe).toMatch(/^[0-9a-f]{96}$/);
    expect(result?.status).toBe('sent');
    expect(result?.documentNumber).toMatch(/^PFXA0+1$/);

    const stored = await db
      .select()
      .from(fiscalDocuments)
      .where(eq(fiscalDocuments.id, result!.id))
      .get();
    expect(stored).toBeTruthy();
    expect(stored!.tenantId).toBe(harness.tenantId);
    expect(stored!.source).toBe('sale');
    expect(stored!.sourceId).toBe(saleId);
    expect(stored!.kind).toBe('DEE');
    expect(stored!.consecutive).toBe(1);
    expect(stored!.status).toBe('sent');
    expect(stored!.providerId).toBe('mock-co');
    expect(stored!.customerId).toBe(harness.customerId);
    expect(stored!.buyerName).toBe(`Customer a`);
    expect(stored!.buyerTaxId).toBe('800123456');
    expect(stored!.subtotal).toBeCloseTo(100);
    expect(stored!.taxAmount).toBeCloseTo(19);
    expect(stored!.totalAmount).toBeCloseTo(119);
    expect(stored!.currencyCode).toBeDefined();

    // Line snapshot is materialized with product name + sku at emission.
    const items = await db
      .select()
      .from(fiscalDocumentItems)
      .where(eq(fiscalDocumentItems.fiscalDocumentId, result!.id))
      .all();
    expect(items).toHaveLength(1);
    expect(items[0]?.productName).toBe(`Product a`);
    expect(items[0]?.productSku).toBe(`SKU-a`);
    expect(items[0]?.quantity).toBe(1);
    expect(items[0]?.lineTotal).toBeCloseTo(119);
    expect(items[0]?.taxCategoryCode).toBe('01');

    // Resolution consecutive advanced.
    const refreshed = await db
      .select()
      .from(fiscalNumberingResolutions)
      .where(eq(fiscalNumberingResolutions.id, harness.resolutionId))
      .get();
    expect(refreshed?.currentNumber).toBe(1);

    // CUFE equals the pure helper for the same inputs. We re-derive it
    // from the stored snapshot so we don't rebuild the adapter input
    // lookup logic here.
    const expectedCufe = computeCufe({
      documentNumber: stored!.documentNumber,
      issueDate: stored!.emittedAt.slice(0, 10),
      issueTime: stored!.emittedAt.slice(11, 19) + 'Z',
      subtotal: stored!.subtotal,
      ivaAmount: stored!.taxAmount,
      incAmount: 0,
      icaAmount: 0,
      totalAmount: stored!.totalAmount,
      issuerNit: harness.tenantId,
      buyerIdTypeCode: stored!.buyerTaxIdTypeCode,
      buyerIdNumber: stored!.buyerTaxId,
      technicalKey: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
      environment: '2',
    });
    expect(stored!.cufe).toBe(expectedCufe);
  });

  it('falls back to consumidor final constants when customerId is null', async () => {
    const db = getDatabase();
    const saleId = await seedCompletedSale({
      harness,
      saleNumber: 'FINAL-0001',
      customerId: null,
    });

    const result = await emitFiscalDocument({
      tx: db,
      tenantId: harness.tenantId,
      userId: harness.userId,
      source: 'sale',
      sourceId: saleId,
      saleId,
      kind: 'DEE',
      adapter,
    });

    expect(result).not.toBeNull();
    const stored = await db
      .select()
      .from(fiscalDocuments)
      .where(eq(fiscalDocuments.id, result!.id))
      .get();
    expect(stored?.customerId).toBeNull();
    expect(stored?.buyerTaxId).toBe(CONSUMIDOR_FINAL.taxId);
    expect(stored?.buyerTaxIdTypeCode).toBe(CONSUMIDOR_FINAL.taxIdTypeCode);
    expect(stored?.buyerName).toBe(CONSUMIDOR_FINAL.name);
    expect(stored?.buyerEmail).toBeNull();
  });

  it('uses the numbering resolution that belongs to the sale site', async () => {
    const db = getDatabase();
    const secondSiteHarness = await seedSecondSiteResolution(harness, 'site-b');
    const saleId = await seedCompletedSale({
      harness: secondSiteHarness,
      saleNumber: 'SITE-B-0001',
      customerId: harness.customerId,
    });

    const result = await emitFiscalDocument({
      tx: db,
      tenantId: harness.tenantId,
      userId: harness.userId,
      source: 'sale',
      sourceId: saleId,
      saleId,
      kind: 'DEE',
      adapter,
    });

    expect(result).not.toBeNull();
    expect(result?.documentNumber).toMatch(/^SSIT0+42$/);

    const primaryResolution = await db
      .select()
      .from(fiscalNumberingResolutions)
      .where(eq(fiscalNumberingResolutions.id, harness.resolutionId))
      .get();
    const secondSiteResolution = await db
      .select()
      .from(fiscalNumberingResolutions)
      .where(eq(fiscalNumberingResolutions.id, secondSiteHarness.resolutionId))
      .get();

    expect(primaryResolution?.currentNumber).toBe(0);
    expect(secondSiteResolution?.currentNumber).toBe(42);
  });

  it('freezes buyer snapshot: mutating customers.name after emission leaves fiscal_documents.buyer_name unchanged', async () => {
    const db = getDatabase();
    const saleId = await seedCompletedSale({
      harness,
      saleNumber: 'FROZEN-0001',
      customerId: harness.customerId,
    });

    const result = await emitFiscalDocument({
      tx: db,
      tenantId: harness.tenantId,
      userId: harness.userId,
      source: 'sale',
      sourceId: saleId,
      saleId,
      kind: 'DEE',
      adapter,
    });
    expect(result).not.toBeNull();

    // Mutate the source customer row AFTER emission.
    await db
      .update(customers)
      .set({ name: 'Customer Renamed', taxId: '999999999' })
      .where(eq(customers.id, harness.customerId));

    const stored = await db
      .select()
      .from(fiscalDocuments)
      .where(eq(fiscalDocuments.id, result!.id))
      .get();
    // Snapshot is frozen — the fiscal document reflects the ORIGINAL name.
    expect(stored?.buyerName).toBe('Customer a');
    expect(stored?.buyerTaxId).toBe('800123456');

    // Reset the customer for later tests.
    await db
      .update(customers)
      .set({ name: 'Customer a', taxId: '800123456' })
      .where(eq(customers.id, harness.customerId));
  });

  it('freezes line snapshot: mutating products.name after emission leaves fiscal_document_items.product_name unchanged', async () => {
    const db = getDatabase();
    const saleId = await seedCompletedSale({
      harness,
      saleNumber: 'LINE-0001',
      customerId: harness.customerId,
    });

    const result = await emitFiscalDocument({
      tx: db,
      tenantId: harness.tenantId,
      userId: harness.userId,
      source: 'sale',
      sourceId: saleId,
      saleId,
      kind: 'DEE',
      adapter,
    });
    expect(result).not.toBeNull();

    await db
      .update(products)
      .set({ name: 'Product Renamed', sku: 'SKU-RENAMED' })
      .where(eq(products.id, harness.productId));

    const items = await db
      .select()
      .from(fiscalDocumentItems)
      .where(eq(fiscalDocumentItems.fiscalDocumentId, result!.id))
      .all();
    expect(items[0]?.productName).toBe('Product a');
    expect(items[0]?.productSku).toBe('SKU-a');

    await db
      .update(products)
      .set({ name: 'Product a', sku: 'SKU-a' })
      .where(eq(products.id, harness.productId));
  });

  it('is idempotent by (tenantId, source, sourceId, kind)', async () => {
    const db = getDatabase();
    const saleId = await seedCompletedSale({
      harness,
      saleNumber: 'IDEMP-0001',
      customerId: harness.customerId,
    });

    const first = await emitFiscalDocument({
      tx: db,
      tenantId: harness.tenantId,
      userId: harness.userId,
      source: 'sale',
      sourceId: saleId,
      saleId,
      kind: 'DEE',
      adapter,
    });
    const second = await emitFiscalDocument({
      tx: db,
      tenantId: harness.tenantId,
      userId: harness.userId,
      source: 'sale',
      sourceId: saleId,
      saleId,
      kind: 'DEE',
      adapter,
    });

    expect(first?.id).toBe(second?.id);
    expect(first?.cufe).toBe(second?.cufe);

    const rows = await db
      .select()
      .from(fiscalDocuments)
      .where(
        and(
          eq(fiscalDocuments.tenantId, harness.tenantId),
          eq(fiscalDocuments.sourceId, saleId),
          eq(fiscalDocuments.kind, 'DEE')
        )
      )
      .all();
    expect(rows).toHaveLength(1);

    const refreshed = await db
      .select()
      .from(fiscalNumberingResolutions)
      .where(eq(fiscalNumberingResolutions.id, harness.resolutionId))
      .get();
    // The second call should NOT advance the consecutive.
    expect(refreshed?.currentNumber).toBe(1);
  });

  it('rolls back the fiscal header and line snapshots when persistence fails mid-write', async () => {
    const db = getDatabase();
    const saleId = await seedCompletedSale({
      harness,
      saleNumber: 'ROLLBACK-0001',
      customerId: harness.customerId,
    });
    await db.insert(saleItems).values({
      id: nanoid(),
      saleId,
      productId: harness.productId,
      quantity: 1,
      unitPrice: 100,
      unitEquivalence: 1,
      discount: 0,
      taxRate: 19,
      taxAmount: 19,
      costAtSale: 50,
      total: 119,
    });

    await db.run(
      sql.raw(`
      CREATE TRIGGER fail_second_fiscal_item
      BEFORE INSERT ON fiscal_document_items
      WHEN NEW.line_number = 2
      BEGIN
        SELECT RAISE(ABORT, 'forced fiscal item failure');
      END
    `)
    );

    try {
      await expect(
        emitFiscalDocument({
          tx: db,
          tenantId: harness.tenantId,
          userId: harness.userId,
          source: 'sale',
          sourceId: saleId,
          saleId,
          kind: 'DEE',
          adapter,
        })
      ).rejects.toThrow(/forced fiscal item failure/);
    } finally {
      await db.run(sql.raw('DROP TRIGGER IF EXISTS fail_second_fiscal_item'));
    }

    const docs = await db
      .select()
      .from(fiscalDocuments)
      .where(
        and(eq(fiscalDocuments.tenantId, harness.tenantId), eq(fiscalDocuments.sourceId, saleId))
      )
      .all();
    expect(docs).toHaveLength(0);

    const items = await db.select().from(fiscalDocumentItems).all();
    expect(items).toHaveLength(0);

    const resolution = await db
      .select()
      .from(fiscalNumberingResolutions)
      .where(eq(fiscalNumberingResolutions.id, harness.resolutionId))
      .get();
    expect(resolution?.currentNumber).toBe(0);
  });

  it('isolates fiscal documents across tenants', async () => {
    const db = getDatabase();
    const harnessB = await seedFiscalTenant('b', /* enableFlag */ true);

    const saleA = await seedCompletedSale({
      harness,
      saleNumber: 'TENANT-A-0001',
      customerId: harness.customerId,
    });
    const saleB = await seedCompletedSale({
      harness: harnessB,
      saleNumber: 'TENANT-B-0001',
      customerId: harnessB.customerId,
    });

    const resA = await emitFiscalDocument({
      tx: db,
      tenantId: harness.tenantId,
      userId: harness.userId,
      source: 'sale',
      sourceId: saleA,
      saleId: saleA,
      kind: 'DEE',
      adapter,
    });
    const resB = await emitFiscalDocument({
      tx: db,
      tenantId: harnessB.tenantId,
      userId: harnessB.userId,
      source: 'sale',
      sourceId: saleB,
      saleId: saleB,
      kind: 'DEE',
      adapter,
    });

    expect(resA?.cufe).not.toBe(resB?.cufe);

    const tenantARows = await db
      .select()
      .from(fiscalDocuments)
      .where(eq(fiscalDocuments.tenantId, harness.tenantId))
      .all();
    const tenantBRows = await db
      .select()
      .from(fiscalDocuments)
      .where(eq(fiscalDocuments.tenantId, harnessB.tenantId))
      .all();
    expect(tenantARows).toHaveLength(1);
    expect(tenantBRows).toHaveLength(1);
    expect(tenantARows[0]?.id).toBe(resA?.id);
    expect(tenantBRows[0]?.id).toBe(resB?.id);
  });

  it('skips emission when no active resolution is configured for the tenant', async () => {
    const db = getDatabase();
    // Disable the only resolution.
    await db
      .update(fiscalNumberingResolutions)
      .set({ isActive: false })
      .where(eq(fiscalNumberingResolutions.id, harness.resolutionId));

    const saleId = await seedCompletedSale({
      harness,
      saleNumber: 'NORES-0001',
      customerId: harness.customerId,
    });

    const result = await emitFiscalDocument({
      tx: db,
      tenantId: harness.tenantId,
      userId: harness.userId,
      source: 'sale',
      sourceId: saleId,
      saleId,
      kind: 'DEE',
      adapter,
    });
    expect(result).toBeNull();

    // Restore.
    await db
      .update(fiscalNumberingResolutions)
      .set({ isActive: true })
      .where(eq(fiscalNumberingResolutions.id, harness.resolutionId));
  });
});
