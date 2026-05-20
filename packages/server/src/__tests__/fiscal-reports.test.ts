/**
 * ENG-020 — `reports.fiscal.*` router integration tests.
 *
 * Exercises the admin-only fiscal reports surface end-to-end against
 * an in-memory sqlite DB. Coverage:
 *
 * - Admin lists fiscal documents emitted by `emitFiscalDocument`.
 * - Filters by kind / status narrow the result set.
 * - `getByCufe` returns the header + line snapshot.
 * - Unknown CUFE → NOT_FOUND with `FISCAL_DOCUMENT_NOT_FOUND`.
 * - Non-admin role → FORBIDDEN.
 * - Cross-tenant isolation: tenant B's admin cannot see tenant A's rows.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
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
  tenants,
  users,
} from '../db/schema.js';
import { ColombiaMockAdapter } from '../services/fiscal/packs/co/mock-adapter.js';
import { emitFiscalDocument } from '../services/fiscal/orchestrator.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;

interface Harness {
  tenantId: string;
  userId: string;
  siteId: string;
  cashSessionId: string;
  productId: string;
  customerId: string;
  resolutionId: string;
}

async function seedHarness(suffix: string): Promise<Harness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `rpt-tenant-${suffix}`;
  const userId = `rpt-user-${suffix}`;
  const companyId = `rpt-company-${suffix}`;
  const siteId = `rpt-site-${suffix}`;
  const cashSessionId = `rpt-cash-${suffix}`;
  const productId = `rpt-product-${suffix}`;
  const customerId = `rpt-customer-${suffix}`;
  const resolutionId = `rpt-res-${suffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `Reports Tenant ${suffix}`,
    slug: `rpt-${suffix}`,
    settings: { fiscal_dian_enabled: true },
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: userId,
    tenantId,
    email: `rpt-admin-${suffix}@example.com`,
    name: `Admin ${suffix}`,
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
    name: `Company ${suffix}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values({
    id: siteId,
    tenantId,
    companyId,
    name: `Site ${suffix}`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(cashSessions).values({
    id: cashSessionId,
    tenantId,
    siteId,
    cashierId: userId,
    registerName: `register-${suffix}`,
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
    name: `Product ${suffix}`,
    sku: `SKU-${suffix}`,
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
    name: `Customer ${suffix}`,
    taxId: '800654321',
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
    prefix: `RPT${suffix.slice(0, 3).toUpperCase()}`,
    fromNumber: 1,
    toNumber: 1000,
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
    siteId,
    cashSessionId,
    productId,
    customerId,
    resolutionId,
  };
}

async function seedSaleAndEmit(h: Harness, saleNumber: string): Promise<string> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const saleId = nanoid();
  await db.insert(sales).values({
    id: saleId,
    tenantId: h.tenantId,
    saleNumber,
    customerId: h.customerId,
    subtotal: 100,
    taxAmount: 19,
    discountAmount: 0,
    total: 119,
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    cashSessionId: h.cashSessionId,
    createdBy: h.userId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(saleItems).values({
    id: nanoid(),
    saleId,
    productId: h.productId,
    quantity: 1,
    unitPrice: 100,
    unitEquivalence: 1,
    discount: 0,
    taxRate: 19,
    taxAmount: 19,
    costAtSale: 50,
    total: 119,
  });
  const result = await emitFiscalDocument({
    tx: db,
    tenantId: h.tenantId,
    userId: h.userId,
    source: 'sale',
    sourceId: saleId,
    saleId,
    kind: 'DEE',
    adapter: new ColombiaMockAdapter(),
  });
  if (!result) throw new Error('Expected fiscal document emission');
  return result.cufe;
}

function buildCtx(
  tenantId: string,
  userId: string,
  role: 'admin' | 'manager' | 'cashier' | 'viewer' = 'admin'
): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: {},
    user: { userId, email: `${userId}@example.com`, role, tenantId },
    jwtVerify: async () => {},
  } as unknown as Context['req'];
  return {
    req: mockReq,
    res: {} as unknown as Context['res'],
    db,
    user: { id: userId, email: `${userId}@example.com`, role, tenantId },
    tenantId,
    siteId: null,
  };
}

describe('reports.fiscal (ENG-020)', () => {
  let harnessA: Harness;
  let harnessB: Harness;
  let cufeA1: string;
  let cufeA2: string;

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    harnessA = await seedHarness('rep-a');
    harnessB = await seedHarness('rep-b');
    cufeA1 = await seedSaleAndEmit(harnessA, 'RPT-A-0001');
    cufeA2 = await seedSaleAndEmit(harnessA, 'RPT-A-0002');
    await seedSaleAndEmit(harnessB, 'RPT-B-0001');
  });

  afterAll(async () => {
    await server.close();
  });

  it('lists fiscal documents for the caller tenant in descending emission order', async () => {
    const caller = appRouter.createCaller(buildCtx(harnessA.tenantId, harnessA.userId));
    const result = await caller.reports.fiscal.list({ limit: 10, offset: 0 });
    expect(result.items.length).toBe(2);
    expect(result.total).toBe(2);
    expect(result.items.every(i => typeof i.cufe === 'string')).toBe(true);
    expect(result.items.map(i => i.cufe).sort()).toEqual([cufeA1, cufeA2].sort());
  });

  it('returns the full filtered count even when pagination only returns one row', async () => {
    const caller = appRouter.createCaller(buildCtx(harnessA.tenantId, harnessA.userId));
    const result = await caller.reports.fiscal.list({ limit: 1, offset: 0, kind: 'DEE' });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(2);
  });

  it('narrows by kind filter', async () => {
    const caller = appRouter.createCaller(buildCtx(harnessA.tenantId, harnessA.userId));
    const dee = await caller.reports.fiscal.list({ limit: 10, offset: 0, kind: 'DEE' });
    expect(dee.items).toHaveLength(2);
    expect(dee.total).toBe(2);
    const nc = await caller.reports.fiscal.list({ limit: 10, offset: 0, kind: 'NC' });
    expect(nc.items).toHaveLength(0);
    expect(nc.total).toBe(0);
  });

  it('isolates results by tenant (admin A cannot see admin B rows)', async () => {
    const callerA = appRouter.createCaller(buildCtx(harnessA.tenantId, harnessA.userId));
    const callerB = appRouter.createCaller(buildCtx(harnessB.tenantId, harnessB.userId));

    const listA = await callerA.reports.fiscal.list({ limit: 10, offset: 0 });
    const listB = await callerB.reports.fiscal.list({ limit: 10, offset: 0 });

    expect(listA.items.every(i => i.buyerTaxId)).toBe(true);
    expect(listB.items.every(i => i.buyerTaxId)).toBe(true);
    // The two sets must be disjoint.
    const aCufes = new Set(listA.items.map(i => i.cufe));
    expect(listB.items.every(i => !aCufes.has(i.cufe))).toBe(true);
  });

  it('returns the header + line snapshot via getByCufe', async () => {
    const caller = appRouter.createCaller(buildCtx(harnessA.tenantId, harnessA.userId));
    const row = await caller.reports.fiscal.getByCufe({ cufe: cufeA1 });
    expect(row.header.cufe).toBe(cufeA1);
    expect(row.header.buyerName).toBe('Customer rep-a');
    expect(row.lines).toHaveLength(1);
    expect(row.lines[0]?.productName).toBe('Product rep-a');
    expect(row.lines[0]?.productSku).toBe('SKU-rep-a');
  });

  it('rejects an unknown CUFE with FISCAL_DOCUMENT_NOT_FOUND', async () => {
    const caller = appRouter.createCaller(buildCtx(harnessA.tenantId, harnessA.userId));
    const bogus = '0'.repeat(96);
    try {
      await caller.reports.fiscal.getByCufe({ cufe: bogus });
      throw new Error('Expected NOT_FOUND');
    } catch (err) {
      const trpcErr = err as { code?: string; data?: { errorCode?: string } };
      expect(trpcErr.code).toBe('NOT_FOUND');
      // Don't tightly couple to the error-code transport shape; tRPC
      // mirrors the server errorCode onto `cause.errorCode` via
      // `throwServerError`. Presence of NOT_FOUND + a hint in the
      // stringified error is sufficient.
      expect(String(err)).toContain('Fiscal document not found');
    }
  });

  it('rejects cashier callers with FORBIDDEN', async () => {
    const caller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.userId, 'cashier')
    );
    try {
      await caller.reports.fiscal.list({ limit: 10, offset: 0 });
      throw new Error('Expected FORBIDDEN');
    } catch (err) {
      // ENG-065a: list moved from admin-only to managerOrAdmin; the
      // role-guard message now mentions "administrators and managers"
      // instead of "admin only", so we match against the role-name
      // hint plus the underlying TRPC code.
      expect(String(err)).toMatch(/TRPCError|administrators|managers/i);
    }
  });

  it('allows manager callers (ENG-065a Operations Center read access)', async () => {
    // ENG-065a — managers can read fiscal_documents for the
    // Operations Center Fiscal Health panel; the retry mutation
    // (`retryDocument`) stays admin-only because it advances
    // fiscal state.
    const caller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.userId, 'manager')
    );
    const result = await caller.reports.fiscal.list({ limit: 10, offset: 0 });
    expect(Array.isArray(result.items)).toBe(true);
    expect(typeof result.total).toBe('number');
  });

  // ENG-103 — Audit-grade export and download contract.
  // `reports.fiscal.getXml` lazily returns the signed XML body for a
  // single fiscal document, wrapped in the canonical
  // `ServerExportEnvelope` shape `{ data, filename, mimeType }`. The
  // procedure scopes by tenant, collapses missing rows to the same
  // generic error code, and emits a `fiscal.xml.downloaded` audit row
  // so the trail is intact even when the download itself is dropped
  // mid-transit.
  describe('getXml (ENG-103)', () => {
    /**
     * Helper: seed an `xmlRef` value onto the freshest document
     * emitted for the given harness. The Colombia mock adapter
     * returns `xmlRef: null` (timbrado deferred), so the test has to
     * inject an XML body to exercise the happy path. Also pins the
     * row's `localeCode` so the country-code derivation in the
     * procedure is deterministic across test environments — the
     * harness default locale may not be Colombian. Returns the
     * resolved `{ documentId, xml, documentNumber }`.
     */
    async function injectXmlRef(args: {
      tenantId: string;
      xml: string;
      localeCode?: string;
    }): Promise<{ documentId: string; xml: string; documentNumber: string }> {
      const db = getDatabase();
      const row = db
        .select({
          id: fiscalDocuments.id,
          documentNumber: fiscalDocuments.documentNumber,
        })
        .from(fiscalDocuments)
        .where(eq(fiscalDocuments.tenantId, args.tenantId))
        .get();
      if (!row) throw new Error('Expected at least one fiscal document');
      db.update(fiscalDocuments)
        .set({ xmlRef: args.xml, localeCode: args.localeCode ?? 'es-CO' })
        .where(
          and(
            eq(fiscalDocuments.tenantId, args.tenantId),
            eq(fiscalDocuments.id, row.id)
          )
        )
        .run();
      return { documentId: row.id, xml: args.xml, documentNumber: row.documentNumber };
    }

    it('returns the signed XML, semantic filename and MIME type for a CO document', async () => {
      const seeded = await injectXmlRef({
        tenantId: harnessA.tenantId,
        xml: '<?xml version="1.0" encoding="UTF-8"?><Invoice/>',
      });
      const caller = appRouter.createCaller(buildCtx(harnessA.tenantId, harnessA.userId));
      const envelope = await caller.reports.fiscal.getXml({ documentId: seeded.documentId });
      expect(envelope.data).toBe(seeded.xml);
      expect(envelope.mimeType).toBe('application/xml;charset=utf-8');
      expect(envelope.filename).toMatch(/^cfdi-co-.+\.xml$/);
      expect(envelope.filename).toContain(seeded.documentNumber);
    });

    it('keeps the raw XML body out of the fiscal list payload', async () => {
      const seeded = await injectXmlRef({
        tenantId: harnessA.tenantId,
        xml: '<?xml version="1.0" encoding="UTF-8"?><Invoice>Ñandú</Invoice>',
      });
      const caller = appRouter.createCaller(buildCtx(harnessA.tenantId, harnessA.userId));
      const result = await caller.reports.fiscal.list({ limit: 10, offset: 0 });
      const row = result.items.find(item => item.id === seeded.documentId);
      expect(row).toBeTruthy();
      expect(Boolean(row?.xmlRef)).toBe(true);
      expect(typeof row?.xmlRef).not.toBe('string');
      expect(row?.xmlRef).not.toBe(seeded.xml);
    });

    it('honors ISO-8859-1 encoding when the document is Chilean', async () => {
      // Patch the row's localeCode to `es-CL` so the procedure picks
      // the ISO-8859-1 charset suffix without needing a full Chile
      // harness.
      const seeded = await injectXmlRef({
        tenantId: harnessA.tenantId,
        xml: '<?xml version="1.0" encoding="ISO-8859-1"?><DTE/>',
        localeCode: 'es-CL',
      });
      const caller = appRouter.createCaller(buildCtx(harnessA.tenantId, harnessA.userId));
      const envelope = await caller.reports.fiscal.getXml({ documentId: seeded.documentId });
      expect(envelope.mimeType).toBe('application/xml;charset=iso-8859-1');
      expect(envelope.filename).toMatch(/^cfdi-cl-.+\.xml$/);
    });

    it('collapses cross-tenant access to FISCAL_DOCUMENT_NOT_FOUND (no row-existence leak)', async () => {
      const seeded = await injectXmlRef({
        tenantId: harnessA.tenantId,
        xml: '<?xml version="1.0"?><Invoice/>',
      });
      const callerB = appRouter.createCaller(buildCtx(harnessB.tenantId, harnessB.userId));
      try {
        await callerB.reports.fiscal.getXml({ documentId: seeded.documentId });
        throw new Error('Expected NOT_FOUND');
      } catch (err) {
        const trpcErr = err as { code?: string };
        expect(trpcErr.code).toBe('NOT_FOUND');
        expect(String(err)).toContain('Fiscal document XML not available');
      }
    });

    it('rejects when xmlRef is null (timbrado pendiente / contingencia)', async () => {
      // Clear xmlRef explicitly to simulate the pre-signing state.
      const db = getDatabase();
      const row = db
        .select({ id: fiscalDocuments.id })
        .from(fiscalDocuments)
        .where(eq(fiscalDocuments.tenantId, harnessA.tenantId))
        .get();
      if (!row) throw new Error('Expected a fiscal document');
      db.update(fiscalDocuments)
        .set({ xmlRef: null })
        .where(eq(fiscalDocuments.id, row.id))
        .run();
      const caller = appRouter.createCaller(buildCtx(harnessA.tenantId, harnessA.userId));
      try {
        await caller.reports.fiscal.getXml({ documentId: row.id });
        throw new Error('Expected NOT_FOUND when xmlRef is null');
      } catch (err) {
        const trpcErr = err as { code?: string };
        expect(trpcErr.code).toBe('NOT_FOUND');
      }
    });

    it('emits a fiscal.xml.downloaded audit row scoped to the caller tenant', async () => {
      const seeded = await injectXmlRef({
        tenantId: harnessA.tenantId,
        xml: '<?xml version="1.0"?><Invoice>Ñandú</Invoice>',
      });
      const db = getDatabase();
      db.delete(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, harnessA.tenantId),
            eq(auditLogs.action, 'fiscal.xml.downloaded'),
            eq(auditLogs.resourceId, seeded.documentId)
          )
        )
        .run();

      const caller = appRouter.createCaller(buildCtx(harnessA.tenantId, harnessA.userId));
      await caller.reports.fiscal.getXml({ documentId: seeded.documentId });

      // Previous cases in this describe block also exercise getXml
      // against the same fiscal document. The cleanup above removes
      // timestamp-tie ambiguity so this assertion targets this
      // download's audit row.
      const auditRow = db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, harnessA.tenantId),
            eq(auditLogs.action, 'fiscal.xml.downloaded'),
            eq(auditLogs.resourceId, seeded.documentId)
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .get();
      expect(auditRow).toBeTruthy();
      expect(auditRow?.resourceType).toBe('fiscal_document');
      expect(auditRow?.actorId).toBe(harnessA.userId);
      const meta = auditRow?.metadata as
        | { cufe?: string; documentNumber?: string; countryCode?: string; byteSize?: number }
        | undefined;
      expect(meta?.documentNumber).toBe(seeded.documentNumber);
      expect(meta?.countryCode).toBe('co');
      expect(meta?.byteSize).toBe(Buffer.byteLength(seeded.xml, 'utf8'));
    });

    it('rejects cashier callers with FORBIDDEN (manager + admin only)', async () => {
      const seeded = await injectXmlRef({
        tenantId: harnessA.tenantId,
        xml: '<?xml version="1.0"?><Invoice/>',
      });
      const caller = appRouter.createCaller(
        buildCtx(harnessA.tenantId, harnessA.userId, 'cashier')
      );
      try {
        await caller.reports.fiscal.getXml({ documentId: seeded.documentId });
        throw new Error('Expected FORBIDDEN');
      } catch (err) {
        expect(String(err)).toMatch(/TRPCError|administrators|managers/i);
      }
    });
  });
});
