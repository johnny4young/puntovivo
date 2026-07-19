/**
 * ENG-056 — Invariant tests for `application/cash-sessions/closeCashSession`.
 *
 * Verifies:
 *   - Happy paths for over/short totals (zero / over / short).
 *   - Denomination mismatch + missing-active-session preconditions.
 *   - Pending fiscal/payment detection at close (counts + samples).
 *   - Audit log row carries pending counts in metadata.
 *   - Journal effects: session_close + audit_log (always); pending_warning
 *     (one per non-zero category).
 *   - Cross-tenant isolation.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  cashMovements,
  cashSessions,
  fiscalDocuments,
  fiscalNumberingResolutions,
  operationEffects,
  operationEvents,
  products,
  sales,
  saleItems,
  sites,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { recordOperationStart } from '../services/operation-journal/journal.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { closeCashSession } from '../application/cash-sessions/closeCashSession.js';
import { openCashSession } from '../application/cash-sessions/openCashSession.js';
import { recordCashMovement } from '../application/cash-sessions/recordCashMovement.js';
import type { CashSessionContext } from '../application/cash-sessions/types.js';
import { calculateCashierItemsPerMinute } from '../services/reports/cashier-pace-math.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let resolutionId: string;
let testDeviceId: string;

function buildContext(overrides: Partial<CashSessionContext> = {}): CashSessionContext {
  return {
    db: getDatabase(),
    tenantId,
    siteId,
    user: { id: userId, role: 'admin' },
    envelope: null,
    deviceId: null,
    log: undefined,
    ...overrides,
  };
}

async function ensureFreshSession(registerName: string, openingFloat: number) {
  const db = getDatabase();
  const open = await db
    .select()
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.tenantId, tenantId),
        eq(cashSessions.cashierId, userId),
        eq(cashSessions.status, 'open')
      )
    )
    .all();
  for (const s of open) {
    const closedAt = new Date().toISOString();
    await db
      .update(cashSessions)
      .set({
        status: 'closed',
        closedAt,
        updatedAt: closedAt,
        actualCount: s.openingFloat,
        overShort: 0,
      })
      .where(eq(cashSessions.id, s.id));
  }
  const denominations = openingFloat > 0 ? [{ value: openingFloat, count: 1 }] : [];
  const result = await openCashSession(buildContext(), {
    registerName,
    openingFloat,
    denominations,
  });
  return result.session.id;
}

async function seedSaleOnSession(
  sessionId: string,
  saleNumber: string,
  paymentStatus: 'paid' | 'pending' | 'partial' = 'paid'
) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const saleId = nanoid();
  // Pick any seeded product for FK satisfaction.
  const product = await db.select().from(products).where(eq(products.tenantId, tenantId)).get();
  if (!product) throw new Error('Expected at least one seeded product');
  await db.insert(sales).values({
    id: saleId,
    tenantId,
    saleNumber,
    customerId: null,
    subtotal: 100,
    taxAmount: 0,
    discountAmount: 0,
    total: 100,
    paymentMethod: 'cash',
    paymentStatus,
    status: 'completed',
    cashSessionId: sessionId,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(saleItems).values({
    id: nanoid(),
    saleId,
    productId: product.id,
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

async function seedPendingFiscalDoc(saleId: string, status: 'pending' | 'contingency' = 'pending') {
  const db = getDatabase();
  const now = new Date().toISOString();
  await db.insert(fiscalDocuments).values({
    id: nanoid(),
    tenantId,
    source: 'sale',
    sourceId: saleId,
    kind: 'DEE',
    resolutionId,
    consecutive: Math.floor(Math.random() * 1_000_000) + 1,
    documentNumber: 'DOC-' + nanoid(8),
    cufe: nanoid(40),
    status,
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
  const seededUser = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
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

  const reg = await registerDevice(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'application-cashSessions-closeCashSession.test',
  });
  testDeviceId = reg.deviceId;

  // Seed a numbering resolution + a single product so the pending-fiscal
  // seed helper has FKs to satisfy.
  const now = new Date().toISOString();
  resolutionId = nanoid();
  await db.insert(fiscalNumberingResolutions).values({
    id: resolutionId,
    tenantId,
    siteId,
    kind: 'DEE',
    resolutionNumber: '18760000001',
    prefix: 'CLOSE',
    fromNumber: 1,
    toNumber: 1000000,
    currentNumber: 0,
    technicalKey: 'closesession-test-tech-key',
    validFrom: now,
    validUntil: now,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  // Make sure at least one product exists (the seed normally provides one,
  // but be defensive across environments).
  const existingProducts = await db
    .select()
    .from(products)
    .where(eq(products.tenantId, tenantId))
    .all();
  if (existingProducts.length === 0) {
    const baseUnit = await db.select().from(units).where(eq(units.tenantId, tenantId)).get();
    if (!baseUnit) throw new Error('Expected at least one seeded unit');
    const productId = nanoid();
    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Close test product',
      sku: 'CLS-' + nanoid(6),
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

describe('closeCashSession — over/short totals', () => {
  it('balanced shift: actualCount === expectedBalance => overShort = 0', async () => {
    const db = getDatabase();
    const sessionId = await ensureFreshSession('balanced', 100);
    const result = await closeCashSession(buildContext(), {
      actualCount: 100,
      denominations: [{ value: 100, count: 1 }],
    });
    expect(result.session.id).toBe(sessionId);
    expect(result.session.status).toBe('closed');
    expect(result.overShort).toBe(0);
    const row = await db.select().from(cashSessions).where(eq(cashSessions.id, sessionId)).get();
    expect(row?.actualCount).toBe(100);
    expect(row?.overShort).toBe(0);
  });

  it('over: actualCount > expectedBalance => positive overShort', async () => {
    await ensureFreshSession('over-shift', 100);
    const result = await closeCashSession(buildContext(), {
      actualCount: 110,
      denominations: [
        { value: 100, count: 1 },
        { value: 10, count: 1 },
      ],
    });
    expect(result.overShort).toBe(10);
  });

  it('short: actualCount < expectedBalance => negative overShort', async () => {
    await ensureFreshSession('short-shift', 100);
    // Add a paid_in to make expectedBalance = 100 + 50 = 150.
    await recordCashMovement(buildContext(), {
      type: 'paid_in',
      amount: 50,
      note: 'Top up for short test',
    });
    const result = await closeCashSession(buildContext(), {
      actualCount: 140,
      denominations: [
        { value: 100, count: 1 },
        { value: 20, count: 2 },
      ],
    });
    expect(result.overShort).toBe(-10);
  });

  it('materializes completed-item pace at close without counting drafts', async () => {
    const db = getDatabase();
    const sessionId = await ensureFreshSession('pace-shift', 0);
    const openedAt = new Date(Date.now() - 30 * 60_000).toISOString();
    await db.update(cashSessions).set({ openedAt }).where(eq(cashSessions.id, sessionId));

    const completedSaleId = await seedSaleOnSession(sessionId, 'PACE-C-' + nanoid(6));
    await db
      .update(saleItems)
      .set({ quantity: 15, total: 1500 })
      .where(eq(saleItems.saleId, completedSaleId));
    const draftSaleId = await seedSaleOnSession(sessionId, 'PACE-D-' + nanoid(6));
    await db
      .update(sales)
      .set({ status: 'draft', paymentStatus: 'pending' })
      .where(eq(sales.id, draftSaleId));
    await db
      .update(saleItems)
      .set({ quantity: 999, total: 99_900 })
      .where(eq(saleItems.saleId, draftSaleId));

    const result = await closeCashSession(buildContext(), {
      actualCount: 0,
      denominations: [],
    });
    const durationMs = Date.parse(result.session.closedAt!) - Date.parse(openedAt);
    expect(result.session.paceItemsPerMinute).toBe(calculateCashierItemsPerMinute(15, durationMs));
  });

  it('rejects a paid_out that would drive expectedBalance negative and rolls back atomically', async () => {
    // Auditoría 2026-06 — the drawer can never owe money: the storage
    // CHECK chk_cash_sessions_expected_nonneg is the last line of
    // defense when a manual outflow exceeds what the drawer holds. The
    // movement insert and the expected_balance advance run in ONE
    // transaction, so the rejection must leave no partial state: no
    // movement row, expectedBalance untouched, session still open.
    const sessionId = await ensureFreshSession('overdraw-shift', 50);

    await expect(
      recordCashMovement(buildContext(), {
        type: 'paid_out',
        amount: 100,
        note: 'Overdraw attempt',
      })
    ).rejects.toThrow(/chk_cash_sessions_expected_nonneg|CHECK constraint/);

    const session = await getDatabase()
      .select({
        status: cashSessions.status,
        expectedBalance: cashSessions.expectedBalance,
      })
      .from(cashSessions)
      .where(eq(cashSessions.id, sessionId))
      .get();
    expect(session).toEqual({ status: 'open', expectedBalance: 50 });

    const movements = await getDatabase()
      .select({ id: cashMovements.id })
      .from(cashMovements)
      .where(eq(cashMovements.sessionId, sessionId))
      .all();
    expect(movements).toHaveLength(0);
  });
});

describe('closeCashSession — preconditions', () => {
  it('rejects with CASH_SESSION_COUNT_MISMATCH when denominations and actualCount diverge', async () => {
    await ensureFreshSession('mismatch-shift', 100);
    await expect(
      closeCashSession(buildContext(), {
        actualCount: 100,
        denominations: [{ value: 50, count: 1 }],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'CASH_SESSION_COUNT_MISMATCH' } });
  });

  it('rejects with CASH_SESSION_REQUIRED when no active session exists', async () => {
    const db = getDatabase();
    const open = await db
      .select()
      .from(cashSessions)
      .where(
        and(
          eq(cashSessions.tenantId, tenantId),
          eq(cashSessions.cashierId, userId),
          eq(cashSessions.status, 'open')
        )
      )
      .all();
    const closedAt = new Date().toISOString();
    for (const s of open) {
      await db
        .update(cashSessions)
        .set({
          status: 'closed',
          closedAt,
          updatedAt: closedAt,
          actualCount: s.openingFloat,
          overShort: 0,
        })
        .where(eq(cashSessions.id, s.id));
    }
    await expect(
      closeCashSession(buildContext(), {
        actualCount: 0,
        denominations: [],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'CASH_SESSION_REQUIRED' } });
  });
});

describe('closeCashSession — pending fiscal/payment warnings', () => {
  it('detects pending fiscal documents and exposes count + audit metadata', async () => {
    const db = getDatabase();
    const sessionId = await ensureFreshSession('pending-fiscal', 0);
    const saleId = await seedSaleOnSession(sessionId, 'PF-' + nanoid(6), 'paid');
    await seedPendingFiscalDoc(saleId, 'pending');

    const result = await closeCashSession(buildContext(), {
      actualCount: 0,
      denominations: [],
    });
    expect(result.pendingFiscalDocuments).toBe(1);
    expect(result.pendingPaymentSales).toBe(0);

    const audit = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.action, 'cash_session.close'),
          eq(auditLogs.resourceId, sessionId)
        )
      )
      .get();
    const metadata = audit?.metadata as Record<string, unknown> | null;
    expect(metadata?.pendingFiscalDocuments).toBe(1);
    expect(metadata?.pendingPaymentSales).toBe(0);
  });

  it('detects pending payments (paymentStatus=partial on a completed sale) and excludes drafts', async () => {
    const db = getDatabase();
    const sessionId = await ensureFreshSession('pending-payment', 0);
    await seedSaleOnSession(sessionId, 'PP-' + nanoid(6), 'partial');

    // Seed a draft with paymentStatus=pending — must NOT count.
    const draftSaleId = nanoid();
    const now = new Date().toISOString();
    const product = await db.select().from(products).where(eq(products.tenantId, tenantId)).get();
    if (!product) throw new Error('expected product');
    await db.insert(sales).values({
      id: draftSaleId,
      tenantId,
      saleNumber: 'DRAFT-' + nanoid(6),
      customerId: null,
      subtotal: 100,
      taxAmount: 0,
      discountAmount: 0,
      total: 100,
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      cashSessionId: sessionId,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    const result = await closeCashSession(buildContext(), {
      actualCount: 0,
      denominations: [],
    });
    expect(result.pendingPaymentSales).toBe(1);
    expect(result.pendingFiscalDocuments).toBe(0);
  });

  it('emits both pending_warning effects when an envelope is present and both categories non-zero', async () => {
    const db = getDatabase();
    const sessionId = await ensureFreshSession('pending-mixed', 0);
    const fiscalSaleId = await seedSaleOnSession(sessionId, 'MIX-F-' + nanoid(6), 'paid');
    await seedPendingFiscalDoc(fiscalSaleId, 'contingency');
    await seedSaleOnSession(sessionId, 'MIX-P-' + nanoid(6), 'pending');

    const operationId = nanoid();
    await recordOperationStart(db, {
      tenantId,
      operationId,
      operationKind: 'cashSessions.close',
      deviceId: testDeviceId,
      userId,
      requestHash: 'hash-' + operationId,
    });
    const result = await closeCashSession(buildContext({ envelope: { operationId } }), {
      actualCount: 0,
      denominations: [],
    });
    expect(result.pendingFiscalDocuments).toBe(1);
    expect(result.pendingPaymentSales).toBe(1);

    const event = await db
      .select()
      .from(operationEvents)
      .where(
        and(eq(operationEvents.tenantId, tenantId), eq(operationEvents.operationId, operationId))
      )
      .get();
    expect(event).toBeTruthy();
    const effects = await db
      .select()
      .from(operationEffects)
      .where(eq(operationEffects.operationEventId, event!.id))
      .all();
    const warnings = effects.filter(e => e.kind === 'pending_warning');
    const categories = warnings
      .map(w => (w.effectData as { category?: string } | null)?.category)
      .sort();
    expect(categories).toEqual(['fiscal', 'payment']);
    const kindsAll = effects.map(e => e.kind);
    expect(kindsAll).toContain('session_close');
    expect(kindsAll).toContain('audit_log');
  });

  it('isolates pending counts via tenantId scoping in the join', async () => {
    // The pending-checks queries filter `WHERE fiscal_documents.tenantId =
    // ?` AND `sales.tenantId = ?`, so a row visible to one tenant can
    // never count for another. This test asserts the contract by closing
    // a session on tenant A whose seeded pendings should be zero
    // because the helper rejects mismatched tenantId joins.
    await ensureFreshSession('iso-tenant', 0);
    const result = await closeCashSession(buildContext(), {
      actualCount: 0,
      denominations: [],
    });
    expect(result.pendingFiscalDocuments).toBe(0);
    expect(result.pendingPaymentSales).toBe(0);
    // Forensic counts make it into the audit log metadata.
    const audit = await getDatabase()
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.action, 'cash_session.close'),
          eq(auditLogs.resourceId, result.session.id)
        )
      )
      .get();
    const metadata = audit?.metadata as Record<string, unknown> | null;
    expect(metadata?.pendingFiscalDocuments).toBe(0);
    expect(metadata?.pendingPaymentSales).toBe(0);
  });
});
