/**
 * Integration tests for the fiscal outbox + worker.
 *
 * These tests boot a real Fastify-mounted server (`createServer({
 * dbPath: ':memory:' })`) and complete sales through the full tRPC
 * stack to verify the four acceptance paths:
 *
 * 1. Happy: sale completes, outbox transitions queued -> accepted,
 * fiscal_documents row mirrors to status='accepted'.
 * 2. Outage-contingency: stub adapter throws a recoverable error,
 * sale STILL completes, fiscal_documents row exists with
 * status='contingency', outbox row goes to retrying.
 * 3. Outage-rejected: stub adapter throws a non-recoverable error,
 * sale STILL completes, fiscal_documents row exists with
 * status='rejected', outbox row goes to dead_letter.
 * 4. Retry router: a contingency row can be re-armed via
 * reports.fiscal.retryDocument so the next tick processes it.
 *
 * @module __tests__/fiscal-outbox-integration
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  customers,
  fiscalDocuments,
  fiscalDocumentItems,
  fiscalEmissionIntents,
  fiscalNumberingResolutions,
  fiscalOutbox,
  cashMovements,
  inventoryBalances,
  products,
  saleItems,
  sales,
  sites,
  tenantLocaleSettings,
  tenants,
  unitXProduct,
  units,
  users,
  webhookOutbox,
} from '../db/schema.js';
import {
  insertFiscalIntentInTransaction,
  materializeFiscalEmissionIntent,
  prepareSaleFiscalIntent,
} from '../services/fiscal/orchestrator/intents.js';
import {
  __clearFiscalAdapterOverridesForTest,
  __setFiscalAdapterForTest,
} from '../services/fiscal/registry.js';
import { FiscalProviderError, type NormalizedFiscalErrorKind } from '../services/fiscal/errors.js';
import type {
  FiscalAdapter,
  FiscalAdapterCapabilities,
  FiscalAdapterConfig,
  FiscalAdapterIssueInput,
  FiscalAdapterIssueResult,
  FiscalAdapterValidationResult,
  FiscalAdapterVoidInput,
} from '../services/fiscal/adapter.js';
import { computeCufe } from '../services/fiscal/cufe.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';
import { appRouter } from '../trpc/router.js';
import { getSaleRecord } from '../application/sales/sale-read.js';
import { __withExpectedTestLogs } from '../logging/logger.js';
import { getPendingFiscalForSession } from '../application/cash-sessions/pending-checks.js';
import { resolveFiscalDocumentSnapshot } from '../services/fiscal/orchestrator/snapshots.js';

function withExpectedFiscalFailure<T>(callback: () => T | Promise<T>): Promise<T> {
  return __withExpectedTestLogs(
    [
      {
        level: 'warn',
        module: 'fiscal-outbox-worker',
        message: 'outbox row failed',
      },
    ],
    callback
  );
}

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let registerName: string;
let resolutionId: string;
let cashSessionId: string;
let testDeviceId: string;

class StubAdapter implements FiscalAdapter {
  readonly providerId = 'mock-co';
  readonly countryCode = 'CO';
  readonly capabilities: FiscalAdapterCapabilities = {
    supportsVoid: true,
    supportsDebitNote: true,
    supportsFetchStatus: true,
  };

  constructor(
    private readonly behavior:
      | { kind: 'happy' }
      | { kind: 'recoverable'; errorKind: NormalizedFiscalErrorKind }
      | { kind: 'non-recoverable'; errorKind: NormalizedFiscalErrorKind }
  ) {}

  async validateConfig(_input: FiscalAdapterConfig): Promise<FiscalAdapterValidationResult> {
    return { ok: true, issues: [] };
  }

  async issue(input: FiscalAdapterIssueInput): Promise<FiscalAdapterIssueResult> {
    if (this.behavior.kind === 'recoverable' || this.behavior.kind === 'non-recoverable') {
      throw new FiscalProviderError(this.behavior.errorKind, {
        message: `Stub adapter forced ${this.behavior.errorKind}`,
      });
    }
    const cufe = computeCufe({
      documentNumber: input.resolution.documentNumber,
      issueDate: input.issueDate,
      issueTime: input.issueTime,
      subtotal: input.subtotal,
      ivaAmount: input.ivaAmount,
      incAmount: input.incAmount,
      icaAmount: input.icaAmount,
      totalAmount: input.totalAmount,
      issuerNit: input.issuerNit,
      buyerIdTypeCode: input.buyer.taxIdTypeCode,
      buyerIdNumber: input.buyer.taxId,
      technicalKey: input.resolution.technicalKey,
      environment: '2',
    });
    return {
      cufe,
      status: 'accepted',
      providerId: this.providerId,
      providerResponse: { simulated: true },
      xmlRef: null,
    };
  }

  async voidDocument(_input: FiscalAdapterVoidInput): Promise<FiscalAdapterIssueResult> {
    return {
      cufe: 'void-' + nanoid(),
      status: 'accepted',
      providerId: this.providerId,
      providerResponse: null,
      xmlRef: null,
    };
  }

  async fetchStatus() {
    return 'accepted' as const;
  }
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
  const baseUnit = await db
    .select()
    .from(units)
    .where(and(eq(units.tenantId, tenantId), eq(units.abbreviation, 'UND')))
    .get();
  if (!baseUnit) throw new Error('Expected seeded UND unit');
  baseUnitId = baseUnit.id;

  // Enable DIAN for the tenant.
  const tenant = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
  await db
    .update(tenants)
    .set({
      settings: {
        ...((tenant?.settings as Record<string, unknown>) ?? {}),
        fiscal_dian_enabled: true,
      },
    })
    .where(eq(tenants.id, tenantId))
    .run();

  // pin the tenant locale to CO so the QR builder dispatches
  // to the DIAN URL branch. Without this the resolver falls back to
  // LOCALE_FALLBACK (US) and qrPayload always returns null.
  const localeNow = new Date().toISOString();
  await db
    .insert(tenantLocaleSettings)
    .values({
      tenantId,
      countryCode: 'CO',
      localeOverride: null,
      currencyOverride: null,
      timezoneOverride: null,
      firstDayOfWeekOverride: null,
      updatedAt: localeNow,
    })
    .onConflictDoUpdate({
      target: tenantLocaleSettings.tenantId,
      set: { countryCode: 'CO', updatedAt: localeNow },
    });

  // Seed numbering resolution.
  const now = new Date().toISOString();
  resolutionId = nanoid();
  await db.insert(fiscalNumberingResolutions).values({
    id: resolutionId,
    tenantId,
    siteId,
    kind: 'DEE',
    resolutionNumber: '18760000001',
    prefix: 'OB',
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
  const originalResolution = db
    .select()
    .from(fiscalNumberingResolutions)
    .where(eq(fiscalNumberingResolutions.id, resolutionId))
    .get()!;
  await db
    .insert(fiscalNumberingResolutions)
    .values({ ...originalResolution, id: nanoid(), kind: 'NC', prefix: 'NC-OB' });

  // Register a device + open a cash session.
  const reg = await registerDevice(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'fiscal-outbox-integration.test',
  });
  testDeviceId = reg.deviceId;

  registerName = `fiscal-outbox-${nanoid(4)}`;
  const fresh = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId,
    userId,
    email: 'admin@localhost',
    siteId,
    deviceId: testDeviceId,
    defaultRole: 'admin',
  });
  const caller = appRouter.createCaller(fresh());
  const session = await caller.cashSessions.open({
    registerName,
    openingFloat: 100,
    denominations: [{ value: 100, count: 1 }],
  });
  cashSessionId = session.id;
});

afterAll(async () => {
  __clearFiscalAdapterOverridesForTest();
  await server.close();
});

afterEach(() => {
  __clearFiscalAdapterOverridesForTest();
});

async function setEventsApiActive(enabled: boolean): Promise<void> {
  const db = getDatabase();
  const row = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const settings =
    row?.settings && typeof row.settings === 'object'
      ? (row.settings as Record<string, unknown>)
      : {};
  const modules =
    settings.modules && typeof settings.modules === 'object'
      ? (settings.modules as Record<string, unknown>)
      : {};
  await db
    .update(tenants)
    .set({
      settings: {
        ...settings,
        modules: { ...modules, 'events-api': enabled },
      },
    })
    .where(eq(tenants.id, tenantId))
    .run();
}

async function seedProductAndSale(args: {
  sku: string;
  productName: string;
  status?: 'draft' | 'completed';
  customerId?: string | null;
  unitPrice?: number;
  quantity?: number;
  discount?: number;
}): Promise<{ saleId: string; productId: string }> {
  const db = getDatabase();
  const fresh = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId,
    userId,
    email: 'admin@localhost',
    siteId,
    deviceId: testDeviceId,
    defaultRole: 'admin',
  });
  const caller = appRouter.createCaller(fresh());
  const productId = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id: productId,
    tenantId,
    name: args.productName,
    sku: args.sku,
    sellByFraction: args.quantity !== undefined,
    fractionStep: args.quantity !== undefined ? 0.001 : null,
    fractionMinimum: args.quantity !== undefined ? 0.001 : null,
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
    price: 100,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  // Stock lives in inventory_balances now (products.stock removed). Seed the
  // opening on_hand at the active site so the sale's stock check passes.
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
  const sale = await caller.sales.create({
    items: [
      {
        productId,
        unitId: baseUnitId,
        quantity: args.quantity ?? 1,
        unitPrice: args.unitPrice ?? 100,
        discount: args.discount ?? 0,
      },
    ],
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: args.status ?? 'completed',
    ...(args.customerId !== undefined ? { customerId: args.customerId } : {}),
    amountReceived: 100,
    discountAmount: 0,
  });
  return { saleId: sale.id, productId };
}

async function readFiscalDocAndOutbox(saleId: string) {
  const db = getDatabase();
  const doc = await db
    .select()
    .from(fiscalDocuments)
    .where(and(eq(fiscalDocuments.tenantId, tenantId), eq(fiscalDocuments.sourceId, saleId)))
    .get();
  const outbox = doc
    ? await db.select().from(fiscalOutbox).where(eq(fiscalOutbox.fiscalDocumentId, doc.id)).get()
    : undefined;
  return { doc, outbox };
}

async function waitForFiscalDocument(saleId: string, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await readFiscalDocAndOutbox(saleId);
    if (row.doc) return row;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Fiscal document for sale ${saleId} was not materialized before timeout`);
}

describe('fiscal outbox — happy path', () => {
  it('completes a sale, transitions outbox to accepted, mirrors fiscal_documents.status', async () => {
    __setFiscalAdapterForTest('CO', new StubAdapter({ kind: 'happy' }));
    const { saleId } = await seedProductAndSale({
      sku: 'OB-HAPPY-' + nanoid(6),
      productName: 'Outbox happy product',
    });
    // Drive the worker explicitly (the orchestrator's fire-and-forget tick
    // may have already run, but we tick again to ensure terminal state).
    await server.fiscalWorker.tickOnce(tenantId);
    const { doc, outbox } = await readFiscalDocAndOutbox(saleId);
    expect(doc).toBeTruthy();
    const intent = await getDatabase()
      .select()
      .from(fiscalEmissionIntents)
      .where(
        and(eq(fiscalEmissionIntents.tenantId, tenantId), eq(fiscalEmissionIntents.saleId, saleId))
      )
      .get();
    expect(intent).toMatchObject({
      source: 'sale',
      sourceId: saleId,
      status: 'materialized',
      fiscalDocumentId: doc?.id,
    });
    expect(doc?.status).toBe('accepted');
    expect(doc?.cufe).not.toMatch(/^pending-/);
    expect(outbox).toBeTruthy();
    expect(outbox?.status).toBe('accepted');
    expect(outbox?.cufe).toBe(doc?.cufe);
  });

  it('recovers a committed intent after a pre-materialization crash without rereading labels', async () => {
    __setFiscalAdapterForTest('CO', new StubAdapter({ kind: 'happy' }));
    await server.fiscalWorker.stop();
    try {
      const db = getDatabase();
      const customerId = `intent-customer-${nanoid()}`;
      const frozenCustomerName = 'Frozen fiscal customer';
      const frozenProductName = 'Frozen fiscal product';
      const now = new Date().toISOString();
      await db.insert(customers).values({
        id: customerId,
        tenantId,
        name: frozenCustomerName,
        taxId: '901234567',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const { saleId, productId } = await seedProductAndSale({
        sku: 'OB-INTENT-' + nanoid(6),
        productName: frozenProductName,
        status: 'draft',
        customerId,
      });
      const sale = await db
        .select()
        .from(sales)
        .where(and(eq(sales.tenantId, tenantId), eq(sales.id, saleId)))
        .get();
      const item = await db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).get();
      if (!sale || !item) throw new Error('Expected draft sale fixture');
      const prepared = await prepareSaleFiscalIntent({
        db,
        tenantId,
        userId,
        saleId,
        siteId,
        customerId,
        paymentMethod: sale.paymentMethod,
        amounts: {
          subtotal: sale.subtotal,
          taxAmount: sale.taxAmount,
          discountAmount: sale.discountAmount,
          total: sale.total,
        },
        lines: [
          {
            lineNumber: 1,
            productId,
            productName: item.productNameSnapshot ?? frozenProductName,
            productSku: item.productSkuSnapshot,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discountAmount: 0,
            taxRate: item.taxRate,
            taxKind: item.taxKind,
            taxAmount: item.taxAmount,
            lineTotal: item.total,
            unitStandardCode: item.unitStandardCode,
          },
        ],
        completedAt: now,
        log: { warn: () => undefined, debug: () => undefined },
      });
      expect(prepared?.status).toBe('queued');
      const beforeNumber = await db
        .select({ currentNumber: fiscalNumberingResolutions.currentNumber })
        .from(fiscalNumberingResolutions)
        .where(eq(fiscalNumberingResolutions.id, resolutionId))
        .get();

      db.transaction(tx => {
        tx.update(sales)
          .set({ status: 'completed', updatedAt: now })
          .where(and(eq(sales.tenantId, tenantId), eq(sales.id, saleId)))
          .run();
        insertFiscalIntentInTransaction(tx as unknown as typeof db, prepared);
      });

      expect(
        await db
          .select()
          .from(fiscalDocuments)
          .where(and(eq(fiscalDocuments.tenantId, tenantId), eq(fiscalDocuments.sourceId, saleId)))
          .get()
      ).toBeUndefined();
      await db
        .update(customers)
        .set({ name: 'Mutated customer after commit' })
        .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));
      await db
        .update(products)
        .set({ name: 'Mutated product after commit' })
        .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)));

      server.fiscalWorker.start();
      const { doc: recovered } = await waitForFiscalDocument(saleId);
      expect(recovered).toMatchObject({
        buyerName: frozenCustomerName,
        status: 'accepted',
      });
      const recoveredItem = recovered
        ? await db
            .select()
            .from(fiscalDocumentItems)
            .where(eq(fiscalDocumentItems.fiscalDocumentId, recovered.id))
            .get()
        : undefined;
      expect(recoveredItem?.productName).toBe(frozenProductName);

      const intent = await db
        .select()
        .from(fiscalEmissionIntents)
        .where(
          and(
            eq(fiscalEmissionIntents.tenantId, tenantId),
            eq(fiscalEmissionIntents.saleId, saleId)
          )
        )
        .get();
      expect(intent).toMatchObject({
        status: 'materialized',
        fiscalDocumentId: recovered?.id,
      });
      if (!intent) throw new Error('Expected materialized fiscal intent');
      await materializeFiscalEmissionIntent({
        db,
        tenantId,
        intentId: intent.id,
        log: { warn: () => undefined, debug: () => undefined },
      });
      expect(
        await db
          .select()
          .from(fiscalDocuments)
          .where(and(eq(fiscalDocuments.tenantId, tenantId), eq(fiscalDocuments.sourceId, saleId)))
          .all()
      ).toHaveLength(1);
      expect(
        await db
          .select({ currentNumber: fiscalNumberingResolutions.currentNumber })
          .from(fiscalNumberingResolutions)
          .where(eq(fiscalNumberingResolutions.id, resolutionId))
          .get()
      ).toEqual({ currentNumber: (beforeNumber?.currentNumber ?? 0) + 1 });
    } finally {
      server.fiscalWorker.start();
    }
  });

  it('blocks a committed intent when its frozen numbering resolution changes', async () => {
    __setFiscalAdapterForTest('CO', new StubAdapter({ kind: 'happy' }));
    await server.fiscalWorker.stop();
    const db = getDatabase();
    const originalResolution = await db
      .select({
        prefix: fiscalNumberingResolutions.prefix,
        currentNumber: fiscalNumberingResolutions.currentNumber,
      })
      .from(fiscalNumberingResolutions)
      .where(eq(fiscalNumberingResolutions.id, resolutionId))
      .get();
    if (!originalResolution) throw new Error('Expected numbering resolution fixture');
    try {
      const { saleId, productId } = await seedProductAndSale({
        sku: 'OB-RESOLUTION-FENCE-' + nanoid(6),
        productName: 'Resolution-fenced product',
        status: 'draft',
      });
      const sale = await db
        .select()
        .from(sales)
        .where(and(eq(sales.tenantId, tenantId), eq(sales.id, saleId)))
        .get();
      const item = await db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).get();
      if (!sale || !item) throw new Error('Expected draft sale fixture');
      const now = new Date().toISOString();
      const prepared = await prepareSaleFiscalIntent({
        db,
        tenantId,
        userId,
        saleId,
        siteId,
        customerId: null,
        paymentMethod: sale.paymentMethod,
        amounts: {
          subtotal: sale.subtotal,
          taxAmount: sale.taxAmount,
          discountAmount: sale.discountAmount,
          total: sale.total,
        },
        lines: [
          {
            lineNumber: 1,
            productId,
            productName: item.productNameSnapshot ?? 'Resolution-fenced product',
            productSku: item.productSkuSnapshot,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discountAmount: item.discount,
            taxRate: item.taxRate,
            taxKind: item.taxKind,
            taxAmount: item.taxAmount,
            lineTotal: item.total,
            unitStandardCode: item.unitStandardCode,
          },
        ],
        completedAt: now,
        log: { warn: () => undefined, debug: () => undefined },
      });
      expect(prepared?.status).toBe('queued');
      db.transaction(tx => {
        insertFiscalIntentInTransaction(tx as unknown as typeof db, prepared);
      });

      await db
        .update(fiscalNumberingResolutions)
        .set({ prefix: 'MUTATED-' })
        .where(eq(fiscalNumberingResolutions.id, resolutionId));
      if (!prepared) throw new Error('Expected prepared fiscal intent');
      await materializeFiscalEmissionIntent({
        db,
        tenantId,
        intentId: prepared.id,
        log: { warn: () => undefined, debug: () => undefined },
      });

      expect(
        await db
          .select({
            status: fiscalEmissionIntents.status,
            lastError: fiscalEmissionIntents.lastError,
          })
          .from(fiscalEmissionIntents)
          .where(eq(fiscalEmissionIntents.id, prepared.id))
          .get()
      ).toMatchObject({
        status: 'blocked',
        lastError: { code: 'FISCAL_INTENT_BLOCKED', reason: 'numbering_resolution_changed' },
      });
      expect(
        await db
          .select({ id: fiscalDocuments.id })
          .from(fiscalDocuments)
          .where(and(eq(fiscalDocuments.tenantId, tenantId), eq(fiscalDocuments.sourceId, saleId)))
          .all()
      ).toHaveLength(0);
      expect(
        await db
          .select({ currentNumber: fiscalNumberingResolutions.currentNumber })
          .from(fiscalNumberingResolutions)
          .where(eq(fiscalNumberingResolutions.id, resolutionId))
          .get()
      ).toEqual({ currentNumber: originalResolution.currentNumber });
    } finally {
      await db
        .update(fiscalNumberingResolutions)
        .set({ prefix: originalResolution.prefix })
        .where(eq(fiscalNumberingResolutions.id, resolutionId));
      server.fiscalWorker.start();
    }
  });

  it('persists the same durable intent when a draft is settled', async () => {
    __setFiscalAdapterForTest('CO', new StubAdapter({ kind: 'happy' }));
    const originalProductName = 'Draft fiscal intent product';
    const { saleId, productId } = await seedProductAndSale({
      sku: 'OB-DRAFT-INTENT-' + nanoid(6),
      productName: originalProductName,
      status: 'draft',
    });
    const db = getDatabase();
    await db
      .update(products)
      .set({ name: 'Catalog name changed before settlement' })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)));
    const fresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId,
      email: 'admin@localhost',
      siteId,
      deviceId: testDeviceId,
      defaultRole: 'admin',
    });
    await appRouter.createCaller(fresh()).sales.completeDraft({
      saleId,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 100,
    });
    await server.fiscalWorker.tickOnce(tenantId);

    const intent = await db
      .select()
      .from(fiscalEmissionIntents)
      .where(
        and(eq(fiscalEmissionIntents.tenantId, tenantId), eq(fiscalEmissionIntents.saleId, saleId))
      )
      .get();
    expect(intent).toMatchObject({ status: 'materialized', sourceId: saleId });
    const materialized = await readFiscalDocAndOutbox(saleId);
    expect(materialized).toMatchObject({
      doc: { status: 'accepted' },
      outbox: { status: 'accepted' },
    });
    const fiscalItem = materialized.doc
      ? await db
          .select({ productName: fiscalDocumentItems.productName })
          .from(fiscalDocumentItems)
          .where(eq(fiscalDocumentItems.fiscalDocumentId, materialized.doc.id))
          .get()
      : undefined;
    expect(fiscalItem?.productName).toBe(originalProductName);
  });

  it('enqueues fiscal_document.accepted when events-api is ON', async () => {
    await setEventsApiActive(true);
    try {
      __setFiscalAdapterForTest('CO', new StubAdapter({ kind: 'happy' }));
      const { saleId } = await seedProductAndSale({
        sku: 'OB-EVENT-FISCAL-' + nanoid(6),
        productName: 'Outbox fiscal event product',
      });
      await server.fiscalWorker.tickOnce(tenantId);
      const { doc } = await readFiscalDocAndOutbox(saleId);
      expect(doc?.status).toBe('accepted');

      const rows = await getDatabase()
        .select()
        .from(webhookOutbox)
        .where(
          and(
            eq(webhookOutbox.tenantId, tenantId),
            eq(webhookOutbox.eventType, 'fiscal_document.accepted')
          )
        )
        .all();
      const row = rows.find(item => item.idempotencyKey === doc?.id);
      expect(row).toBeTruthy();
      expect(row?.payload).toMatchObject({
        fiscalDocumentId: doc?.id,
        cufe: doc?.cufe,
        documentNumber: doc?.documentNumber,
        source: 'sale',
        sourceId: saleId,
        countryCode: 'CO',
        providerId: 'mock-co',
      });
    } finally {
      await setEventsApiActive(false);
    }
  });

  // A locally accepted document from the Colombia mock remains useful
  // operational evidence, but must not become an authority-verification QR.
  it('labels accepted mock evidence without exposing a DIAN verification QR', async () => {
    __setFiscalAdapterForTest('CO', new StubAdapter({ kind: 'happy' }));
    const { saleId } = await seedProductAndSale({
      sku: 'OB-QR-OK-' + nanoid(6),
      productName: 'Outbox QR happy product',
    });
    await server.fiscalWorker.tickOnce(tenantId);
    const record = await getSaleRecord(getDatabase(), tenantId, saleId);
    expect(record.fiscalDocuments).toHaveLength(1);
    const fd = record.fiscalDocuments![0];
    expect(fd.status).toBe('accepted');
    expect(fd.cufe).not.toMatch(/^pending-/);
    expect(fd.maturity).toBe('mock');
    expect(fd.qrPayload).toBeNull();
    expect(fd.resolution).toContain('18760000001');
    expect(fd.resolution).toContain('OB 1-1000000');
  });
});

describe('fiscal outbox — outage path (recoverable)', () => {
  it('completes the sale, mirrors doc to contingency, outbox to retrying', async () => {
    __setFiscalAdapterForTest(
      'CO',
      new StubAdapter({ kind: 'recoverable', errorKind: 'PROVIDER_5XX' })
    );
    const { saleId } = await withExpectedFiscalFailure(async () => {
      const seeded = await seedProductAndSale({
        sku: 'OB-CONT-' + nanoid(6),
        productName: 'Outbox contingency product',
      });
      await server.fiscalWorker.tickOnce(tenantId);
      return seeded;
    });
    const { doc, outbox } = await readFiscalDocAndOutbox(saleId);
    expect(doc).toBeTruthy();
    expect(doc?.status).toBe('contingency');
    expect(doc?.cufe).toMatch(/^pending-/); // placeholder unchanged
    expect(outbox?.status).toBe('retrying');
    expect(outbox?.attempts).toBe(1);
    expect((outbox?.lastError as Record<string, unknown> | null)?.errorCode).toBe('PROVIDER_5XX');

    // Sale itself: assert NOT rolled back.
    const saleRow = await getDatabase()
      .select({ status: sales.status })
      .from(sales)
      .where(eq(sales.id, saleId))
      .get();
    expect(saleRow?.status).toBe('completed');
  });

  // getSaleRecord must NOT expose a scannable QR for a
  // contingency document. The receipt renderer relies on this
  // null-gate to skip the QR block while still printing the status
  // copy ("Contingencia") so the customer/operator never sees a
  // dead URL claiming "Aceptado".
  it('returns null qrPayload via getSaleRecord on contingency', async () => {
    __setFiscalAdapterForTest(
      'CO',
      new StubAdapter({ kind: 'recoverable', errorKind: 'NETWORK_TIMEOUT' })
    );
    const { saleId } = await withExpectedFiscalFailure(async () => {
      const seeded = await seedProductAndSale({
        sku: 'OB-QR-CONT-' + nanoid(6),
        productName: 'Outbox QR contingency product',
      });
      await server.fiscalWorker.tickOnce(tenantId);
      return seeded;
    });
    const record = await getSaleRecord(getDatabase(), tenantId, saleId);
    expect(record.fiscalDocuments).toHaveLength(1);
    const fd = record.fiscalDocuments![0];
    expect(fd.status).toBe('contingency');
    expect(fd.qrPayload).toBeNull();
    // Defense in depth: the placeholder cufe MUST stay invisible to the renderer.
    expect(fd.cufe).toMatch(/^pending-/);
  });
});

describe('fiscal outbox — non-recoverable path', () => {
  it('completes the sale, mirrors doc to rejected, outbox to dead_letter', async () => {
    __setFiscalAdapterForTest(
      'CO',
      new StubAdapter({ kind: 'non-recoverable', errorKind: 'MALFORMED_REQUEST' })
    );
    const { saleId } = await withExpectedFiscalFailure(async () => {
      const seeded = await seedProductAndSale({
        sku: 'OB-DEAD-' + nanoid(6),
        productName: 'Outbox dead-letter product',
      });
      await server.fiscalWorker.tickOnce(tenantId);
      return seeded;
    });
    const { doc, outbox } = await readFiscalDocAndOutbox(saleId);
    expect(doc?.status).toBe('rejected');
    expect(outbox?.status).toBe('dead_letter');
    expect((outbox?.lastError as Record<string, unknown> | null)?.errorCode).toBe(
      'MALFORMED_REQUEST'
    );

    const saleRow = await getDatabase()
      .select({ status: sales.status })
      .from(sales)
      .where(eq(sales.id, saleId))
      .get();
    expect(saleRow?.status).toBe('completed');
  });
});

describe('fiscal outbox — retry router', () => {
  it('re-arms a contingency row so the next tick processes it', async () => {
    // First emission: recoverable failure.
    __setFiscalAdapterForTest(
      'CO',
      new StubAdapter({ kind: 'recoverable', errorKind: 'NETWORK_TIMEOUT' })
    );
    const { saleId } = await withExpectedFiscalFailure(async () => {
      const seeded = await seedProductAndSale({
        sku: 'OB-RETRY-' + nanoid(6),
        productName: 'Outbox retry product',
      });
      await server.fiscalWorker.tickOnce(tenantId);
      return seeded;
    });
    const { doc: docAfterFail, outbox: outboxAfterFail } = await readFiscalDocAndOutbox(saleId);
    expect(docAfterFail?.status).toBe('contingency');
    expect(outboxAfterFail?.status).toBe('retrying');

    // Now switch to a happy adapter and call retryDocument; the next tick
    // should drain the row to accepted.
    __setFiscalAdapterForTest('CO', new StubAdapter({ kind: 'happy' }));
    const fresh = makeFreshContextFactory({
      db: getDatabase(),
      serverApp: server.app,
      tenantId,
      userId,
      email: 'admin@localhost',
      siteId,
      deviceId: testDeviceId,
      defaultRole: 'admin',
    });
    const caller = appRouter.createCaller(fresh());
    const retryResult = await caller.reports.fiscal.retryDocument({
      fiscalDocumentId: docAfterFail!.id,
    });
    expect(retryResult.rearmed).toBe(true);

    await server.fiscalWorker.tickOnce(tenantId);
    const { doc, outbox } = await readFiscalDocAndOutbox(saleId);
    expect(doc?.status).toBe('accepted');
    expect(outbox?.status).toBe('accepted');
  });

  it('does not requeue an older dead-letter after retry already accepted', async () => {
    __setFiscalAdapterForTest(
      'CO',
      new StubAdapter({ kind: 'non-recoverable', errorKind: 'MALFORMED_REQUEST' })
    );
    const { saleId } = await withExpectedFiscalFailure(async () => {
      const seeded = await seedProductAndSale({
        sku: 'OB-DEAD-RETRY-' + nanoid(6),
        productName: 'Outbox dead-letter retry product',
      });
      await server.fiscalWorker.tickOnce(tenantId);
      return seeded;
    });
    const { doc: deadDoc, outbox: deadOutbox } = await readFiscalDocAndOutbox(saleId);
    expect(deadDoc?.status).toBe('rejected');
    expect(deadOutbox?.status).toBe('dead_letter');

    __setFiscalAdapterForTest('CO', new StubAdapter({ kind: 'happy' }));
    const fresh = makeFreshContextFactory({
      db: getDatabase(),
      serverApp: server.app,
      tenantId,
      userId,
      email: 'admin@localhost',
      siteId,
      deviceId: testDeviceId,
      defaultRole: 'admin',
    });
    const caller = appRouter.createCaller(fresh());
    const retryResult = await caller.reports.fiscal.retryDocument({
      fiscalDocumentId: deadDoc!.id,
    });
    expect(retryResult.requeuedAs).toBeTruthy();

    await server.fiscalWorker.tickOnce(tenantId);
    const rowsAfterAccept = await getDatabase()
      .select()
      .from(fiscalOutbox)
      .where(eq(fiscalOutbox.fiscalDocumentId, deadDoc!.id))
      .all();
    expect(rowsAfterAccept.map(row => row.status).sort()).toEqual(['accepted', 'dead_letter']);

    const retryAfterAccepted = await caller.reports.fiscal.retryDocument({
      fiscalDocumentId: deadDoc!.id,
    });
    expect(retryAfterAccepted).toEqual({ rearmed: false });

    const rowsAfterSecondRetry = await getDatabase()
      .select()
      .from(fiscalOutbox)
      .where(eq(fiscalOutbox.fiscalDocumentId, deadDoc!.id))
      .all();
    expect(rowsAfterSecondRetry).toHaveLength(rowsAfterAccept.length);
  });
});

describe('fiscal outbox — pending checks integration', () => {
  it('cashSessions.pendingChecks counts contingency docs and excludes rejected', async () => {
    // Contingency doc.
    __setFiscalAdapterForTest(
      'CO',
      new StubAdapter({ kind: 'recoverable', errorKind: 'PROVIDER_5XX' })
    );
    await withExpectedFiscalFailure(async () => {
      await seedProductAndSale({
        sku: 'PC-CONT-' + nanoid(6),
        productName: 'Pending check contingency',
      });
      await server.fiscalWorker.tickOnce(tenantId);
    });

    // Rejected doc.
    __setFiscalAdapterForTest(
      'CO',
      new StubAdapter({ kind: 'non-recoverable', errorKind: 'MALFORMED_REQUEST' })
    );
    await withExpectedFiscalFailure(async () => {
      await seedProductAndSale({
        sku: 'PC-DEAD-' + nanoid(6),
        productName: 'Pending check dead',
      });
      await server.fiscalWorker.tickOnce(tenantId);
    });

    // Query pendingChecks for the active session.
    const fresh = makeFreshContextFactory({
      db: getDatabase(),
      serverApp: server.app,
      tenantId,
      userId,
      email: 'admin@localhost',
      siteId,
      deviceId: testDeviceId,
      defaultRole: 'admin',
    });
    const caller = appRouter.createCaller(fresh());
    const result = await caller.cashSessions.pendingChecks();
    // Contingency documents and pre-document obligations count; rejected
    // documents do NOT. Earlier crash tests deliberately preserve a blocked
    // intent on this same session.
    expect(result.pendingFiscalDocuments).toBeGreaterThanOrEqual(1);
    expect(
      result.fiscalSamples.every(s =>
        [
          'pending',
          'contingency',
          'queued',
          'materializing',
          'blocked',
          'retrying',
          'dead_letter',
        ].includes(s.status)
      )
    ).toBe(true);

    // Light cleanup: close the session counter to the dummy expected
    // (doesn't matter for the assertion, we just inspect rows directly).
    void cashSessionId;
  });
});

describe('durable credit notes with the real Colombia mock', () => {
  it('waits for original fiscal evidence without exhausting the transient retry budget', async () => {
    const db = getDatabase();
    const { saleId } = await seedProductAndSale({
      sku: `WAIT-${nanoid()}`,
      productName: 'Original dependency product',
    });
    await server.fiscalWorker.tickOnce(tenantId);
    const { doc: original } = await readFiscalDocAndOutbox(saleId);
    await server.fiscalWorker.stop();
    try {
      db.update(fiscalDocuments)
        .set({ status: 'contingency' })
        .where(eq(fiscalDocuments.id, original!.id))
        .run();
      const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()!;
      const snapshot = await resolveFiscalDocumentSnapshot(db, {
        tenantId,
        source: 'void',
        sourceId: saleId,
        saleId,
        sale,
      });
      const prepared = await prepareSaleFiscalIntent({
        db,
        tenantId,
        userId,
        saleId,
        siteId,
        customerId: sale.customerId,
        paymentMethod: sale.paymentMethod,
        amounts: snapshot.amounts,
        lines: snapshot.lines,
        completedAt: new Date().toISOString(),
        source: 'void',
        sourceId: saleId,
        kind: 'NC',
        log: { warn: () => {}, debug: () => {} },
      });
      expect(prepared).not.toBeNull();
      db.transaction(tx => insertFiscalIntentInTransaction(tx, prepared!));
      for (let attempt = 0; attempt < 10; attempt++) {
        db.update(fiscalEmissionIntents)
          .set({ nextRetryAt: null })
          .where(eq(fiscalEmissionIntents.id, prepared!.id))
          .run();
        expect(
          await materializeFiscalEmissionIntent({
            db,
            tenantId,
            intentId: prepared!.id,
            log: { warn: () => {}, debug: () => {} },
          })
        ).toBeNull();
      }
      expect(
        db
          .select()
          .from(fiscalEmissionIntents)
          .where(eq(fiscalEmissionIntents.id, prepared!.id))
          .get()
      ).toMatchObject({
        status: 'retrying',
        attempts: 0,
        lastError: { reason: 'original_dee_not_accepted' },
      });
      db.update(fiscalDocuments)
        .set({ status: 'accepted' })
        .where(eq(fiscalDocuments.id, original!.id))
        .run();
      db.update(fiscalEmissionIntents)
        .set({ nextRetryAt: null })
        .where(eq(fiscalEmissionIntents.id, prepared!.id))
        .run();
      expect(
        await materializeFiscalEmissionIntent({
          db,
          tenantId,
          intentId: prepared!.id,
          log: { warn: () => {}, debug: () => {} },
        })
      ).not.toBeNull();
    } finally {
      server.fiscalWorker.start();
    }
  });

  it.each(['void', 'return'] as const)(
    'recovers %s after commit and preserves the original fiscal identity',
    async source => {
      const db = getDatabase();
      const locale = db
        .select()
        .from(tenantLocaleSettings)
        .where(eq(tenantLocaleSettings.tenantId, tenantId))
        .get()!;
      db.update(tenantLocaleSettings)
        .set({ localeOverride: 'en-US' })
        .where(eq(tenantLocaleSettings.tenantId, tenantId))
        .run();
      const { saleId } = await seedProductAndSale({
        sku: `NC-${source}-${nanoid()}`,
        productName: 'NC recovery product',
        quantity: 1,
      });
      await server.fiscalWorker.tickOnce(tenantId);
      const { doc: original } = await readFiscalDocAndOutbox(saleId);
      expect(original).toMatchObject({
        providerId: 'mock-co',
        status: 'sent',
        localeCode: 'en-US',
      });
      await server.fiscalWorker.stop();
      const sqlite = db.$client;
      sqlite.exec(`CREATE TEMP TRIGGER fail_nc_claim BEFORE UPDATE OF status ON fiscal_emission_intents
      WHEN NEW.kind = 'NC' AND NEW.status = 'materializing'
      BEGIN SELECT RAISE(ABORT, 'simulated process boundary after reversal commit'); END;`);
      const fresh = makeFreshContextFactory({
        db,
        serverApp: server.app,
        tenantId,
        userId,
        email: 'admin@localhost',
        siteId,
        deviceId: testDeviceId,
        defaultRole: 'admin',
      });
      try {
        db.update(tenantLocaleSettings)
          .set({ currencyOverride: 'USD', localeOverride: 'es' })
          .where(eq(tenantLocaleSettings.tenantId, tenantId))
          .run();
        const caller = appRouter.createCaller(fresh());
        if (source === 'void') {
          await caller.sales.void({ id: saleId, reason: 'Crash recovery verification' });
        } else {
          const line = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).get()!;
          await caller.sales.returnSale({
            id: saleId,
            items: [{ saleItemId: line.id, quantity: 0.5 }],
            reason: 'Crash recovery verification',
          });
        }
        const intent = db
          .select()
          .from(fiscalEmissionIntents)
          .where(
            and(eq(fiscalEmissionIntents.saleId, saleId), eq(fiscalEmissionIntents.kind, 'NC'))
          )
          .get()!;
        expect(intent).toMatchObject({ status: 'queued', source });
        expect(
          db
            .select()
            .from(cashMovements)
            .where(and(eq(cashMovements.referenceId, saleId), eq(cashMovements.type, 'refund')))
            .all()
        ).toHaveLength(1);
        const pendingBefore = await getPendingFiscalForSession(db, tenantId, cashSessionId);
        sqlite.exec('DROP TRIGGER fail_nc_claim');
        const materialized = await materializeFiscalEmissionIntent({
          db,
          tenantId,
          intentId: intent.id,
          log: { warn: () => {}, debug: () => {} },
        });
        expect(materialized).not.toBeNull();
        const note = db
          .select()
          .from(fiscalDocuments)
          .where(eq(fiscalDocuments.id, materialized!.id))
          .get()!;
        expect(note).toMatchObject({
          source,
          kind: 'NC',
          originalCufe: original!.cufe,
          currencyCode: original!.currencyCode,
          localeCode: original!.localeCode,
          buyerTaxId: original!.buyerTaxId,
          buyerName: original!.buyerName,
          totalAmount: source === 'void' ? 100 : 50,
        });
        expect(note.originalCufe).not.toMatch(/^pending-/);
        // Materialization must move the same obligation from intent to document,
        // including returnId-based notes, without dropping or double-counting it.
        expect((await getPendingFiscalForSession(db, tenantId, cashSessionId)).count).toBe(
          pendingBefore.count
        );
        server.fiscalWorker.start();
        await vi.waitFor(() => {
          const emitted = db
            .select()
            .from(fiscalDocuments)
            .where(eq(fiscalDocuments.id, note.id))
            .get()!;
          expect(emitted.status).toBe('sent');
          expect(emitted.cufe).not.toMatch(/^pending-/);
        });
      } finally {
        sqlite.exec('DROP TRIGGER IF EXISTS fail_nc_claim');
        db.update(tenantLocaleSettings)
          .set({ currencyOverride: locale.currencyOverride, localeOverride: locale.localeOverride })
          .where(eq(tenantLocaleSettings.tenantId, tenantId))
          .run();
        server.fiscalWorker.start();
      }
    }
  );

  it.each(['completed', 'draft'] as const)(
    'uses gross-first rounding in %s fiscal snapshots',
    async status => {
      const { saleId } = await seedProductAndSale({
        sku: `ROUND-${nanoid()}`,
        productName: 'Fractional fiscal product',
        status,
        unitPrice: 0.15,
        quantity: 0.967,
        discount: 10,
      });
      if (status === 'draft') {
        const fresh = makeFreshContextFactory({
          db: getDatabase(),
          serverApp: server.app,
          tenantId,
          userId,
          email: 'admin@localhost',
          siteId,
          deviceId: testDeviceId,
          defaultRole: 'admin',
        });
        await appRouter
          .createCaller(fresh())
          .sales.completeDraft({ saleId, paymentMethod: 'cash', amountReceived: 1 });
      }
      const { doc } = await waitForFiscalDocument(saleId);
      const line = getDatabase()
        .select()
        .from(fiscalDocumentItems)
        .where(eq(fiscalDocumentItems.fiscalDocumentId, doc!.id))
        .get()!;
      expect(line).toMatchObject({ discountAmount: 0.02, lineTotal: 0.13 });
    }
  );
});
