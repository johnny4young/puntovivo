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

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  fiscalDocuments,
  fiscalNumberingResolutions,
  fiscalOutbox,
  inventoryBalances,
  products,
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
    validFrom: now,
    validUntil: now,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

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
}): Promise<{ saleId: string }> {
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
    items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 }],
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    amountReceived: 100,
    discountAmount: 0,
  });
  return { saleId: sale.id };
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
    expect(doc?.status).toBe('accepted');
    expect(doc?.cufe).not.toMatch(/^pending-/);
    expect(outbox).toBeTruthy();
    expect(outbox?.status).toBe('accepted');
    expect(outbox?.cufe).toBe(doc?.cufe);
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

  // getSaleRecord must surface the linked fiscal document
  // with a non-null qrPayload on accepted status, so the receipt
  // renderer can encode a scannable QR.
  it('exposes fiscalDocuments[0].qrPayload via getSaleRecord on accepted', async () => {
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
    expect(fd.qrPayload).toMatch(
      /^https:\/\/catalogo-vpfe\.dian\.gov\.co\/document\/searchqr\?documentkey=/
    );
  });
});

describe('fiscal outbox — outage path (recoverable)', () => {
  it('completes the sale, mirrors doc to contingency, outbox to retrying', async () => {
    __setFiscalAdapterForTest(
      'CO',
      new StubAdapter({ kind: 'recoverable', errorKind: 'PROVIDER_5XX' })
    );
    const { saleId } = await seedProductAndSale({
      sku: 'OB-CONT-' + nanoid(6),
      productName: 'Outbox contingency product',
    });
    await server.fiscalWorker.tickOnce(tenantId);
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
    const { saleId } = await seedProductAndSale({
      sku: 'OB-QR-CONT-' + nanoid(6),
      productName: 'Outbox QR contingency product',
    });
    await server.fiscalWorker.tickOnce(tenantId);
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
    const { saleId } = await seedProductAndSale({
      sku: 'OB-DEAD-' + nanoid(6),
      productName: 'Outbox dead-letter product',
    });
    await server.fiscalWorker.tickOnce(tenantId);
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
    const { saleId } = await seedProductAndSale({
      sku: 'OB-RETRY-' + nanoid(6),
      productName: 'Outbox retry product',
    });
    await server.fiscalWorker.tickOnce(tenantId);
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
    const { saleId } = await seedProductAndSale({
      sku: 'OB-DEAD-RETRY-' + nanoid(6),
      productName: 'Outbox dead-letter retry product',
    });
    await server.fiscalWorker.tickOnce(tenantId);
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
    await seedProductAndSale({
      sku: 'PC-CONT-' + nanoid(6),
      productName: 'Pending check contingency',
    });
    await server.fiscalWorker.tickOnce(tenantId);

    // Rejected doc.
    __setFiscalAdapterForTest(
      'CO',
      new StubAdapter({ kind: 'non-recoverable', errorKind: 'MALFORMED_REQUEST' })
    );
    await seedProductAndSale({
      sku: 'PC-DEAD-' + nanoid(6),
      productName: 'Pending check dead',
    });
    await server.fiscalWorker.tickOnce(tenantId);

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
    // Contingency rows count; rejected rows do NOT.
    expect(result.pendingFiscalDocuments).toBeGreaterThanOrEqual(1);
    expect(
      result.fiscalSamples.every(s => s.status === 'pending' || s.status === 'contingency')
    ).toBe(true);

    // Light cleanup: close the session counter to the dummy expected
    // (doesn't matter for the assertion, we just inspect rows directly).
    void cashSessionId;
  });
});
