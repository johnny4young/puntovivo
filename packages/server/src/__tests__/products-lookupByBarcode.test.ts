/**
 * ENG-061 — `products.lookupByBarcode` router tests.
 *
 * Covers exact-match resolution, GS1 prefix-2x weight/price decoding,
 * cross-tenant isolation, and the strict/permissive parse policies.
 *
 * The procedure is `tenantProcedure` (any tenant-authenticated user
 * can scan; cross-tenant isolation is the security gate). Cashiers
 * and viewers both succeed; the procedure rejects scans that
 * resolve to a different tenant's products by returning `null`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { products, tenants, units, users, vatRates } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let baseUnitId: string;
let vatRateId: string;
const now = () => new Date().toISOString();

// EAN-13 with verified checksum, treated as plain barcode (no GS1).
const EAN13_PLAIN = '9788471800213';
// GS1 prefix-2x weight-embedded: 2 0 12345 01234 9 — sku 12345, 1.234 kg.
const GS1_WEIGHT = '2012345012349';
// GS1 prefix-2x price-embedded:  2 1 12345 00199 9 — sku 12345, $1.99.
const GS1_PRICE = '2112345001999';

function makeContext(role: 'admin' | 'cashier' | 'viewer'): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
      user: { userId, email: 'admin@localhost', role, tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: { id: userId, email: 'admin@localhost', role, tenantId },
    tenantId,
    siteId: null,
  };
}

async function insertProduct(opts: {
  tenantId: string;
  barcode: string | null;
  name: string;
  isActive?: boolean;
}) {
  const db = getDatabase();
  const id = nanoid();
  await db.insert(products).values({
    id,
    tenantId: opts.tenantId,
    name: opts.name,
    sku: `SKU-${id.slice(0, 6)}`,
    description: null,
    categoryId: null,
    providerId: null,
    vatRateId,
    locationId: null,
    initialCost: 100,
    cost: 100,
    price: 200,
    price2: 220,
    price3: 240,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 0,
    stock: 50,
    minStock: 0,
    sellByFraction: false,
    fractionStep: null,
    fractionMinimum: null,
    isActive: opts.isActive ?? true,
    barcode: opts.barcode,
    imageUrl: null,
    embedding: null,
    embeddingModel: null,
    embeddingTextHash: null,
    embeddingUpdatedAt: null,
    createdAt: now(),
    updatedAt: now(),
  });
  return id;
}

describe('products.lookupByBarcode (ENG-061)', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const seededUser = await db
      .select()
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!seededUser) throw new Error('Expected seeded admin user');
    tenantId = seededUser.tenantId;
    userId = seededUser.id;
    const seededVatRate = await db.select().from(vatRates).where(eq(vatRates.tenantId, tenantId)).get();
    if (!seededVatRate) throw new Error('Expected seeded VAT rate');
    vatRateId = seededVatRate.id;
    const seededUnits = await db.select().from(units).where(eq(units.tenantId, tenantId)).all();
    const baseUnit = seededUnits.find(u => u.abbreviation === 'UND');
    if (!baseUnit) throw new Error('Expected seeded base unit');
    baseUnitId = baseUnit.id;
    void baseUnitId;
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns the product with parsed.kind=ean13 on an exact match', async () => {
    await insertProduct({ tenantId, barcode: EAN13_PLAIN, name: 'EAN13 product' });
    const caller = appRouter.createCaller(makeContext('cashier'));
    const result = await caller.products.lookupByBarcode({ barcode: EAN13_PLAIN });
    expect(result).not.toBeNull();
    expect(result!.product.barcode).toBe(EAN13_PLAIN);
    expect(result!.parsed.kind).toBe('ean13');
    expect(result!.suggestedQuantity).toBeNull();
    expect(result!.suggestedPrice).toBeNull();
  });

  it('returns null when no product carries the scanned barcode', async () => {
    const caller = appRouter.createCaller(makeContext('cashier'));
    const result = await caller.products.lookupByBarcode({ barcode: '0000000000000' });
    expect(result).toBeNull();
  });

  it('returns suggestedQuantity from a GS1 weight-embedded label and looks up by SKU prefix', async () => {
    // Product registered with barcode = 5-digit SKU prefix '12345'.
    await insertProduct({ tenantId, barcode: '12345', name: 'Weighted produce' });
    const caller = appRouter.createCaller(makeContext('cashier'));
    const result = await caller.products.lookupByBarcode({ barcode: GS1_WEIGHT });
    expect(result).not.toBeNull();
    expect(result!.parsed.kind).toBe('gs1-weight');
    expect(result!.product.barcode).toBe('12345');
    expect(result!.suggestedQuantity).toBe(1.234);
    expect(result!.suggestedPrice).toBeNull();
  });

  it('returns suggestedPrice from a GS1 price-embedded label and looks up by SKU prefix', async () => {
    await insertProduct({ tenantId, barcode: '12345', name: 'Bulk priced item' });
    const caller = appRouter.createCaller(makeContext('cashier'));
    const result = await caller.products.lookupByBarcode({ barcode: GS1_PRICE });
    expect(result).not.toBeNull();
    expect(result!.parsed.kind).toBe('gs1-price');
    expect(result!.suggestedPrice).toBe(1.99);
    expect(result!.suggestedQuantity).toBeNull();
  });

  it('honors gs1Scheme=none by looking up the full EAN-13 code', async () => {
    await insertProduct({ tenantId, barcode: GS1_WEIGHT, name: 'Full GS1 code product' });
    const caller = appRouter.createCaller(makeContext('cashier'));
    const result = await caller.products.lookupByBarcode({
      barcode: GS1_WEIGHT,
      gs1Scheme: 'none',
    });
    expect(result).not.toBeNull();
    expect(result!.product.barcode).toBe(GS1_WEIGHT);
    expect(result!.parsed.kind).toBe('ean13');
    expect(result!.suggestedQuantity).toBeNull();
  });

  it('honors cross-tenant isolation — a barcode from tenant B is null for tenant A', async () => {
    const db = getDatabase();
    const foreignTenantId = `tenant-${nanoid(6)}`;
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign Tenant',
      slug: `foreign-${nanoid(6)}`,
      settings: {},
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    });
    await insertProduct({ tenantId: foreignTenantId, barcode: '7700000000000', name: 'Other tenant product' });
    const caller = appRouter.createCaller(makeContext('cashier'));
    const result = await caller.products.lookupByBarcode({ barcode: '7700000000000' });
    expect(result).toBeNull();
  });

  it('returns null for a corrupted EAN-13 in strict policy', async () => {
    await insertProduct({ tenantId, barcode: '9788471800217', name: 'Corrupted barcode' });
    const caller = appRouter.createCaller(makeContext('cashier'));
    const result = await caller.products.lookupByBarcode({
      barcode: '9788471800217',
      parsePolicy: 'strict',
    });
    expect(result).toBeNull();
  });

  it('returns null for a corrupted GS1 label in strict policy', async () => {
    await insertProduct({ tenantId, barcode: '12345', name: 'Corrupted GS1 product' });
    const caller = appRouter.createCaller(makeContext('cashier'));
    const result = await caller.products.lookupByBarcode({
      barcode: '2012345012345',
      parsePolicy: 'strict',
    });
    expect(result).toBeNull();
  });

  it('falls through to exact lookup for basic Code128-style values in strict policy', async () => {
    await insertProduct({ tenantId, barcode: 'SKU-ABC-001', name: 'Code128 product' });
    const caller = appRouter.createCaller(makeContext('cashier'));
    const result = await caller.products.lookupByBarcode({
      barcode: 'SKU-ABC-001',
      parsePolicy: 'strict',
    });
    expect(result).not.toBeNull();
    expect(result!.product.name).toBe('Code128 product');
    expect(result!.parsed.kind).toBe('unknown');
  });

  it('falls through in permissive policy even when the checksum fails', async () => {
    // Use a different corrupted code to avoid colliding with the prior
    // strict-policy test's seeded product.
    await insertProduct({ tenantId, barcode: '9788471800218', name: 'Permissive lookup ok' });
    const caller = appRouter.createCaller(makeContext('cashier'));
    const result = await caller.products.lookupByBarcode({
      barcode: '9788471800218',
      parsePolicy: 'permissive',
    });
    expect(result).not.toBeNull();
    expect(result!.product.name).toBe('Permissive lookup ok');
    expect(result!.parsed.checksumValid).toBe(false);
  });

  it('skips inactive products', async () => {
    await insertProduct({ tenantId, barcode: '9999999999993', name: 'Inactive', isActive: false });
    const caller = appRouter.createCaller(makeContext('cashier'));
    const result = await caller.products.lookupByBarcode({ barcode: '9999999999993' });
    expect(result).toBeNull();
  });
});
