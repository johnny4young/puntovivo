/**
 * ENG-056 — Invariant tests for the pending-checks helpers in
 * `application/cash-sessions/pending-checks`.
 *
 * Pure read queries — fast tests, no use-case orchestration.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  fiscalDocuments,
  fiscalNumberingResolutions,
  products,
  saleItems,
  sales,
  sites,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { getPendingChecksForSession } from '../application/cash-sessions/pending-checks.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let resolutionId: string;
let productId: string;

async function seedSession(registerName: string): Promise<string> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const sessionId = nanoid();
  await db.insert(cashSessions).values({
    id: sessionId,
    tenantId,
    siteId,
    cashierId: userId,
    registerName,
    openingFloat: 0,
    openingCountDenominations: [],
    expectedBalance: 0,
    actualCount: null,
    actualCountDenominations: null,
    overShort: null,
    status: 'open',
    openedAt: now,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  return sessionId;
}

async function seedSale(args: {
  sessionId: string;
  saleNumber: string;
  status: 'completed' | 'draft' | 'voided';
  paymentStatus: 'paid' | 'pending' | 'partial' | 'refunded';
}): Promise<string> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const saleId = nanoid();
  await db.insert(sales).values({
    id: saleId,
    tenantId,
    saleNumber: args.saleNumber,
    customerId: null,
    subtotal: 100,
    taxAmount: 0,
    discountAmount: 0,
    total: 100,
    paymentMethod: 'cash',
    paymentStatus: args.paymentStatus,
    status: args.status,
    cashSessionId: args.sessionId,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(saleItems).values({
    id: nanoid(),
    saleId,
    productId,
    quantity: 1,
    unitPrice: 100,
    unitEquivalence: 1,
    discount: 0,
    taxRate: 0,
    taxAmount: 0,
    costAtSale: 50,
    total: 100,
  });
  return saleId;
}

async function seedFiscalDoc(args: {
  saleId: string;
  status: 'pending' | 'sent' | 'accepted' | 'rejected' | 'contingency';
}) {
  const db = getDatabase();
  const now = new Date().toISOString();
  await db.insert(fiscalDocuments).values({
    id: nanoid(),
    tenantId,
    source: 'sale',
    sourceId: args.saleId,
    kind: 'DEE',
    resolutionId,
    consecutive: Math.floor(Math.random() * 1_000_000) + 1,
    documentNumber: 'PC-' + nanoid(8),
    cufe: nanoid(40),
    status: args.status,
    customerId: null,
    buyerTaxId: '222222222222',
    buyerTaxIdTypeCode: '31',
    buyerName: 'Consumidor final',
    subtotal: 100,
    taxAmount: 0,
    discountAmount: 0,
    totalAmount: 100,
    currencyCode: 'COP',
    localeCode: 'es-CO',
    providerId: 'mock',
    emittedByUserId: userId,
    emittedAt: now,
    updatedAt: now,
  });
}

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
  const seededSite = await db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();
  if (!seededSite) throw new Error('Expected seeded site');
  siteId = seededSite.id;

  const now = new Date().toISOString();
  resolutionId = nanoid();
  await db.insert(fiscalNumberingResolutions).values({
    id: resolutionId,
    tenantId,
    siteId,
    kind: 'DEE',
    resolutionNumber: '18760000999',
    prefix: 'PC',
    fromNumber: 1,
    toNumber: 1000000,
    currentNumber: 0,
    technicalKey: 'pendingchecks-test-tech-key',
    validFrom: now,
    validUntil: now,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  // Ensure at least one product
  const existing = await db.select().from(products).where(eq(products.tenantId, tenantId)).get();
  if (existing) {
    productId = existing.id;
  } else {
    const baseUnit = await db.select().from(units).where(eq(units.tenantId, tenantId)).get();
    if (!baseUnit) throw new Error('Expected at least one seeded unit');
    productId = nanoid();
    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'PendingChecks product',
      sku: 'PC-' + nanoid(6),
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
      taxRate: 0,
      initialCost: 50,
      stock: 100,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: baseUnit.id,
      equivalence: 1,
      price: 100,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });
  }
});

afterAll(async () => {
  await server.close();
});

describe('getPendingChecksForSession', () => {
  it('returns zeroed counts and empty samples for a session with no sales', async () => {
    const sessionId = await seedSession('empty');
    const result = await getPendingChecksForSession(getDatabase(), tenantId, sessionId);
    expect(result.pendingFiscalDocuments).toBe(0);
    expect(result.pendingPaymentSales).toBe(0);
    expect(result.fiscalSamples).toEqual([]);
    expect(result.paymentSamples).toEqual([]);
  });

  it('counts pending fiscal documents (status=pending)', async () => {
    const sessionId = await seedSession('one-pending');
    const saleId = await seedSale({ sessionId, saleNumber: 'OP-' + nanoid(6), status: 'completed', paymentStatus: 'paid' });
    await seedFiscalDoc({ saleId, status: 'pending' });
    const result = await getPendingChecksForSession(getDatabase(), tenantId, sessionId);
    expect(result.pendingFiscalDocuments).toBe(1);
    expect(result.fiscalSamples[0].saleId).toBe(saleId);
  });

  it('counts contingency fiscal documents alongside pending', async () => {
    const sessionId = await seedSession('contingency');
    const saleId = await seedSale({ sessionId, saleNumber: 'CT-' + nanoid(6), status: 'completed', paymentStatus: 'paid' });
    await seedFiscalDoc({ saleId, status: 'contingency' });
    const result = await getPendingChecksForSession(getDatabase(), tenantId, sessionId);
    expect(result.pendingFiscalDocuments).toBe(1);
    expect(result.fiscalSamples[0].status).toBe('contingency');
  });

  it('excludes accepted/sent/rejected fiscal documents', async () => {
    const sessionId = await seedSession('accepted-only');
    const saleId = await seedSale({ sessionId, saleNumber: 'AC-' + nanoid(6), status: 'completed', paymentStatus: 'paid' });
    await seedFiscalDoc({ saleId, status: 'accepted' });
    const result = await getPendingChecksForSession(getDatabase(), tenantId, sessionId);
    expect(result.pendingFiscalDocuments).toBe(0);
  });

  it('counts partial paymentStatus on completed sales', async () => {
    const sessionId = await seedSession('partial-payment');
    await seedSale({ sessionId, saleNumber: 'PT-' + nanoid(6), status: 'completed', paymentStatus: 'partial' });
    const result = await getPendingChecksForSession(getDatabase(), tenantId, sessionId);
    expect(result.pendingPaymentSales).toBe(1);
    expect(result.paymentSamples[0].paymentStatus).toBe('partial');
  });

  it('excludes pending paymentStatus on draft sales (filter status=completed)', async () => {
    const sessionId = await seedSession('draft-pending');
    await seedSale({ sessionId, saleNumber: 'DR-' + nanoid(6), status: 'draft', paymentStatus: 'pending' });
    const result = await getPendingChecksForSession(getDatabase(), tenantId, sessionId);
    expect(result.pendingPaymentSales).toBe(0);
  });

  it('caps samples at 5 even when many pending rows exist', async () => {
    const sessionId = await seedSession('lots-of-pending');
    for (let i = 0; i < 7; i++) {
      const saleId = await seedSale({
        sessionId,
        saleNumber: 'LP-' + i + '-' + nanoid(4),
        status: 'completed',
        paymentStatus: 'partial',
      });
      // Also make 7 fiscal pendings.
      await seedFiscalDoc({ saleId, status: 'pending' });
    }
    const result = await getPendingChecksForSession(getDatabase(), tenantId, sessionId);
    expect(result.pendingFiscalDocuments).toBe(7);
    expect(result.fiscalSamples.length).toBe(5);
    expect(result.pendingPaymentSales).toBe(7);
    expect(result.paymentSamples.length).toBe(5);
  });

  it('isolates pending counts across tenants', async () => {
    const sessionId = await seedSession('tenant-iso');
    const saleId = await seedSale({ sessionId, saleNumber: 'TI-' + nanoid(6), status: 'completed', paymentStatus: 'paid' });
    await seedFiscalDoc({ saleId, status: 'pending' });

    // Query under a different tenant id; the row must be invisible.
    const result = await getPendingChecksForSession(
      getDatabase(),
      'unknown-tenant-' + nanoid(),
      sessionId
    );
    expect(result.pendingFiscalDocuments).toBe(0);
    expect(result.pendingPaymentSales).toBe(0);
  });
});
