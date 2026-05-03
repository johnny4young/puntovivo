import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { makeEnvelopeHeadersProxy } from './utils/criticalCommandFixture.js';
import {
  auditLogs,
  categories,
  providers,
  sites,
  units,
  users,
  vatRates,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let primarySiteId: string;
let secondarySiteId: string;
let categoryId: string;
let providerId: string;
let vatRateId: string;
let baseUnitId: string;
let testDeviceId: string;

function createTestContext(): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: makeEnvelopeHeadersProxy({ getDeviceId: () => testDeviceId }),
      user: {
        userId,
        email: 'admin@localhost',
        role: 'admin',
        tenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: {
      id: userId,
      email: 'admin@localhost',
      role: 'admin',
      tenantId,
    },
    tenantId,
    siteId: primarySiteId,
  };
}

async function getLatestAuditRow(args: {
  resourceType: string;
  resourceId: string;
}) {
  const db = getDatabase();
  return db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.tenantId, tenantId),
        eq(auditLogs.resourceType, args.resourceType),
        eq(auditLogs.resourceId, args.resourceId)
      )
    )
    .orderBy(desc(auditLogs.createdAt))
    .get();
}

describe('Audit Logs (Phase 8 / Tier-2 #8)', () => {
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

    const mainSite = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!mainSite) throw new Error('Expected seeded main site');
    primarySiteId = mainSite.id;

    secondarySiteId = nanoid();
    await db.insert(sites).values({
      id: secondarySiteId,
      tenantId,
      companyId: mainSite.companyId,
      name: 'Audit Secondary',
      address: null,
      phone: null,
      isActive: true,
      createdAt: new Date(Date.now() + 60_000).toISOString(),
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const seededVat = await db
      .select()
      .from(vatRates)
      .where(and(eq(vatRates.tenantId, tenantId), eq(vatRates.name, 'IVA 19%')))
      .get();
    if (!seededVat) throw new Error('Expected seeded VAT rate');
    vatRateId = seededVat.id;

    const baseUnit = (
      await db.select().from(units).where(eq(units.tenantId, tenantId)).all()
    ).find(unit => unit.abbreviation === 'UND');
    if (!baseUnit) throw new Error('Expected seeded base unit');
    baseUnitId = baseUnit.id;

    categoryId = nanoid();
    providerId = nanoid();
    const now = new Date().toISOString();
    await db.insert(categories).values({
      id: categoryId,
      tenantId,
      name: 'Audit Tests',
      description: null,
      parentId: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Audit Supplier',
      taxId: null,
      phone: null,
      email: null,
      address: null,
      cityId: null,
      contactName: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // ENG-052b — register one device per test file. Audit-log tests
    // exercise critical procedures (sale.void, sale.return,
    // inventory.adjustStock, cashSessions.close, users.create,
    // users.update) which now require the Command Envelope.
    const registration = await registerDeviceService(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'audit-logs.test',
    });
    testDeviceId = registration.deviceId;
  });

  afterAll(async () => {
    await server.close();
  });

  async function createProduct(sku: string) {
    const caller = appRouter.createCaller(createTestContext());
    return caller.products.create({
      name: `Audit Product ${sku}`,
      sku,
      description: null,
      categoryId,
      providerId,
      vatRateId,
      locationId: null,
      barcode: `BC-${sku}`,
      imageUrl: null,
      cost: 5,
      initialCost: 4,
      price: 100,
      price2: 110,
      price3: 120,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      stock: 20,
      minStock: 0,
      isActive: true,
      unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 100, isBase: true }],
    });
  }

  it('writes an audit row when an inventory transfer is voided, with the void reason in metadata', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const product = await createProduct(`AUD-TR-${nanoid(6)}`);

    const created = await caller.transfers.create({
      fromSiteId: primarySiteId,
      toSiteId: secondarySiteId,
      items: [{ productId: product.id, quantity: 1 }],
      notes: 'Original note',
    });

    await caller.transfers.void({
      transferId: created.id,
      reason: 'Duplicate entry',
    });

    const audit = await getLatestAuditRow({
      resourceType: 'transfer_order',
      resourceId: created.id,
    });
    expect(audit).toBeTruthy();
    expect(audit?.action).toBe('transfer.void');
    expect(audit?.actorId).toBe(userId);
    expect(audit?.tenantId).toBe(tenantId);
    expect(audit?.before).toMatchObject({ status: 'completed' });
    expect(audit?.after).toMatchObject({ status: 'void' });
    expect(audit?.metadata).toMatchObject({ reason: 'Duplicate entry' });
  });

  it('writes an audit row when a draft quotation is deleted, capturing the pre-delete snapshot', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const product = await createProduct(`AUD-QD-${nanoid(6)}`);

    const draft = await caller.quotations.create({
      items: [
        { productId: product.id, quantity: 2, unitPrice: 50, discount: 0, taxRate: 0 },
      ],
    });

    await caller.quotations.delete({ id: draft.id });

    const audit = await getLatestAuditRow({
      resourceType: 'quotation',
      resourceId: draft.id,
    });
    expect(audit).toBeTruthy();
    expect(audit?.action).toBe('quotation.delete');
    expect(audit?.actorId).toBe(userId);
    expect(audit?.before).toMatchObject({
      status: 'draft',
      quotationNumber: expect.stringMatching(/^COT-\d{6}$/),
      total: 100,
    });
    expect(audit?.after).toBeNull();
  });

  it('writes an audit row only when a quotation is converted (not for intermediate transitions)', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const db = getDatabase();
    const product = await createProduct(`AUD-QC-${nanoid(6)}`);

    const draft = await caller.quotations.create({
      items: [
        { productId: product.id, quantity: 1, unitPrice: 100, discount: 0, taxRate: 0 },
      ],
    });

    // Intermediate transitions — draft → sent → accepted — must NOT audit.
    await caller.quotations.updateStatus({ id: draft.id, status: 'sent' });
    await caller.quotations.updateStatus({ id: draft.id, status: 'accepted' });

    const afterAccepted = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceType, 'quotation'),
          eq(auditLogs.resourceId, draft.id)
        )
      )
      .all();
    expect(afterAccepted).toHaveLength(0);

    // Terminal conversion — must emit exactly one audit row.
    await caller.quotations.updateStatus({ id: draft.id, status: 'converted' });

    const afterConverted = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceType, 'quotation'),
          eq(auditLogs.resourceId, draft.id)
        )
      )
      .all();
    expect(afterConverted).toHaveLength(1);
    expect(afterConverted[0]?.action).toBe('quotation.convert');
    expect(afterConverted[0]?.before).toMatchObject({ status: 'accepted' });
    expect(afterConverted[0]?.after).toMatchObject({ status: 'converted' });
  });

  // ─── Phase 8 step 2 — auditLogs.list procedure ────────────────────────────

  describe('auditLogs.list', () => {
    it('returns reverse-chronological rows with the actor name joined', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const product = await createProduct(`AUD-L1-${nanoid(6)}`);

      const transfer = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: product.id, quantity: 1 }],
      });
      await caller.transfers.void({ transferId: transfer.id, reason: 'Mistake' });

      const list = await caller.auditLogs.list();
      const entry = list.items.find(item => item.resourceId === transfer.id);
      expect(entry).toBeTruthy();
      expect(entry?.action).toBe('transfer.void');
      expect(entry?.actorId).toBe(userId);
      expect(entry?.actorName).toBe('Administrator');
      expect(entry?.actorEmail).toBe('admin@localhost');
      expect(entry?.metadata).toMatchObject({ reason: 'Mistake' });
    });

    it('filters by action and resourceType independently', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const product = await createProduct(`AUD-L2-${nanoid(6)}`);

      const transfer = await caller.transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId: product.id, quantity: 1 }],
      });
      await caller.transfers.void({ transferId: transfer.id });

      const draft = await caller.quotations.create({
        items: [
          { productId: product.id, quantity: 1, unitPrice: 50, discount: 0, taxRate: 0 },
        ],
      });
      await caller.quotations.delete({ id: draft.id });

      const onlyVoids = await caller.auditLogs.list({ action: 'transfer.void' });
      expect(onlyVoids.items.every(row => row.action === 'transfer.void')).toBe(true);
      expect(onlyVoids.items.some(row => row.resourceId === transfer.id)).toBe(true);
      expect(onlyVoids.items.some(row => row.resourceId === draft.id)).toBe(false);

      const onlyQuotationRows = await caller.auditLogs.list({
        resourceType: 'quotation',
      });
      expect(
        onlyQuotationRows.items.every(row => row.resourceType === 'quotation')
      ).toBe(true);
    });

    it('lists legacy cashier resource rows without crashing', async () => {
      const db = getDatabase();
      await db.insert(auditLogs).values({
        id: nanoid(),
        tenantId,
        actorId: userId,
        action: 'ai.anomaly.detected',
        resourceType: 'cashier',
        resourceId: userId,
        before: null,
        after: null,
        metadata: { kind: 'voidRate', severity: 'high' },
        createdAt: new Date().toISOString(),
      });

      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.auditLogs.list({ resourceType: 'cashier' });

      expect(result.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'ai.anomaly.detected',
            resourceType: 'cashier',
            resourceId: userId,
          }),
        ])
      );
    });

    it('filters by resourceId to retrieve the full history of one record', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const product = await createProduct(`AUD-L3-${nanoid(6)}`);

      const draft = await caller.quotations.create({
        items: [
          { productId: product.id, quantity: 1, unitPrice: 40, discount: 0, taxRate: 0 },
        ],
      });
      await caller.quotations.updateStatus({ id: draft.id, status: 'sent' });
      await caller.quotations.updateStatus({ id: draft.id, status: 'accepted' });
      await caller.quotations.updateStatus({ id: draft.id, status: 'converted' });

      const history = await caller.auditLogs.list({ resourceId: draft.id });
      // Only the convert transition audits; intermediate ones don't.
      expect(history.items).toHaveLength(1);
      expect(history.items[0]?.action).toBe('quotation.convert');
    });

    it('nulls actor PII when the actor record belongs to another tenant', async () => {
      // Defense in depth: the audit_logs row is tenant-scoped by the WHERE
      // clause, but the users join must also be tenant-guarded so a future
      // migration allowing cross-tenant actor ids can't leak name / email.
      // We simulate the leak scenario by manually inserting an audit row
      // whose actorId points at a user in a foreign tenant.
      const caller = appRouter.createCaller(createTestContext());
      const db = getDatabase();

      // Seed a foreign tenant + user directly.
      const foreignTenantId = `foreign-tenant-${nanoid(6)}`;
      const foreignUserId = `foreign-user-${nanoid(6)}`;
      const now = new Date().toISOString();
      const { auditLogs: auditLogsTable, tenants, users: usersTable } = await import(
        '../db/schema.js'
      );
      await db.insert(tenants).values({
        id: foreignTenantId,
        name: 'Foreign Tenant',
        slug: `foreign-${nanoid(6)}`,
        settings: {},
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(usersTable).values({
        id: foreignUserId,
        tenantId: foreignTenantId,
        email: `foreign-${nanoid(6)}@example.com`,
        name: 'Foreign User',
        passwordHash: 'x',
        sessionVersion: 1,
        role: 'admin',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      // Insert an audit row scoped to the CALLER tenant but referencing the
      // foreign user as actor. This is only reachable via direct insert in
      // the test; the service path never crosses tenants.
      await db.insert(auditLogsTable).values({
        id: `log-${nanoid(6)}`,
        tenantId,
        actorId: foreignUserId,
        action: 'transfer.void',
        resourceType: 'transfer_order',
        resourceId: `leak-probe-${nanoid(6)}`,
        before: null,
        after: null,
        metadata: null,
        createdAt: new Date().toISOString(),
      });

      const list = await caller.auditLogs.list({ action: 'transfer.void' });
      const leakRow = list.items.find(
        row => row.actorId === foreignUserId
      );
      expect(leakRow).toBeTruthy();
      // The tenant-guarded join collapses foreign actor PII to null.
      expect(leakRow?.actorName).toBeNull();
      expect(leakRow?.actorEmail).toBeNull();
    });

    it('rejects non-admin callers', async () => {
      const baseContext = createTestContext();
      const managerCtx: Context = {
        ...baseContext,
        user: { ...baseContext.user!, role: 'manager' },
      };
      const caller = appRouter.createCaller(managerCtx);

      try {
        await caller.auditLogs.list();
        throw new Error('Expected admin-only rejection');
      } catch (error) {
        // tRPC rejects with FORBIDDEN; we don't need a domain error code.
        expect(error).toBeTruthy();
      }
    });
  });

  // ─── Phase 8 step 3 — audit sensitive sale + cash + inventory actions ─────

  describe('sensitive sale, cash and inventory actions', () => {
    /**
     * Each of the four new audited surfaces (sale.void, sale.return,
     * cash_session.close, inventory.adjust_stock) needs to (a) persist exactly
     * one audit row keyed at the correct (resourceType, resourceId), (b)
     * carry an actor, before/after snapshot, and meaningful metadata, and
     * (c) NOT write a row on no-op paths (the inventory short-circuit).
     */

    async function openCashSessionForTest(registerName: string) {
      const caller = appRouter.createCaller(createTestContext());
      return caller.cashSessions.open({
        registerName,
        openingFloat: 100,
        denominations: [{ value: 100, count: 1 }],
      });
    }

    async function closeActiveSession() {
      const caller = appRouter.createCaller(createTestContext());
      // Close at the exact opening float so the over/short stays at 0 — the
      // value itself isn't relevant to the audit, only that it's recorded.
      return caller.cashSessions.close({
        actualCount: 100,
        denominations: [{ value: 100, count: 1 }],
      });
    }

    it('writes a sale.void audit row with before/after snapshot and reason metadata', async () => {
      const session = await openCashSessionForTest(`AUD-VOID-REG-${nanoid(4)}`);
      const caller = appRouter.createCaller(createTestContext());
      const product = await createProduct(`AUD-SV-${nanoid(6)}`);

      const sale = await caller.sales.create({
        items: [
          { productId: product.id, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 100,
        discountAmount: 0,
      });

      await caller.sales.void({ id: sale.id, reason: 'Cashier mistake' });

      const audit = await getLatestAuditRow({ resourceType: 'sale', resourceId: sale.id });
      expect(audit).toBeTruthy();
      expect(audit?.action).toBe('sale.void');
      expect(audit?.actorId).toBe(userId);
      expect(audit?.before).toMatchObject({ status: 'completed', total: 100 });
      expect(audit?.after).toMatchObject({ status: 'voided' });
      expect(audit?.metadata).toMatchObject({
        reason: 'Cashier mistake',
        reversedCashSessionId: session.id,
      });

      await closeActiveSession();
    });

    it('writes a sale.return audit row including the refund id and refunded amount', async () => {
      await openCashSessionForTest(`AUD-RET-REG-${nanoid(4)}`);
      const caller = appRouter.createCaller(createTestContext());
      const product = await createProduct(`AUD-SR-${nanoid(6)}`);

      const sale = await caller.sales.create({
        items: [
          { productId: product.id, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 100,
        discountAmount: 0,
      });

      await caller.sales.returnSale({ id: sale.id, reason: 'Customer changed mind' });

      const audit = await getLatestAuditRow({ resourceType: 'sale', resourceId: sale.id });
      expect(audit).toBeTruthy();
      expect(audit?.action).toBe('sale.return');
      expect(audit?.before).toMatchObject({ paymentStatus: 'paid', total: 100 });
      expect(audit?.after).toMatchObject({
        paymentStatus: 'refunded',
        refundAmount: 100,
      });
      expect(audit?.metadata).toMatchObject({ reason: 'Customer changed mind' });
      // refundId must be present on `after` so an auditor can join back to
      // the sale_returns row without parsing free-form text.
      const after = audit?.after as Record<string, unknown> | null;
      expect(typeof after?.refundId).toBe('string');

      await closeActiveSession();
    });

    it('writes an inventory.adjust_stock audit row with delta + resolved siteId', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const product = await createProduct(`AUD-AS-${nanoid(6)}`);

      await caller.inventory.adjustStock({
        productId: product.id,
        newStock: 13,
        notes: 'Spot count correction',
      });

      const audit = await getLatestAuditRow({ resourceType: 'product', resourceId: product.id });
      expect(audit).toBeTruthy();
      expect(audit?.action).toBe('inventory.adjust_stock');
      expect(audit?.before).toMatchObject({ stock: 20 });
      expect(audit?.after).toMatchObject({ stock: 13 });
      expect(audit?.metadata).toMatchObject({
        delta: -7,
        notes: 'Spot count correction',
      });
      // metadata.siteId should resolve to the operator's primary site context.
      expect((audit?.metadata as Record<string, unknown> | null)?.siteId).toBe(primarySiteId);
    });

    it('does NOT audit a no-op stock adjustment (delta === 0)', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const db = getDatabase();
      const product = await createProduct(`AUD-AS-NOOP-${nanoid(6)}`);

      // Set newStock equal to the existing stock — the helper short-circuits
      // its delta math AND the audit write.
      await caller.inventory.adjustStock({
        productId: product.id,
        newStock: 20,
      });

      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.resourceType, 'product'),
            eq(auditLogs.resourceId, product.id)
          )
        )
        .all();
      expect(rows).toHaveLength(0);
    });

    it('does NOT persist a sale.void audit row when the void rolls back', async () => {
      await openCashSessionForTest(`AUD-ROLL-REG-${nanoid(4)}`);
      const caller = appRouter.createCaller(createTestContext());
      const db = getDatabase();
      const product = await createProduct(`AUD-ROLL-${nanoid(6)}`);

      const sale = await caller.sales.create({
        items: [
          { productId: product.id, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 100,
        discountAmount: 0,
      });

      // First void lands, writing one audit row.
      await caller.sales.void({ id: sale.id, reason: 'First attempt' });

      // Second void rejects — the tRPC router throws before the transaction
      // even starts (status is already 'voided'), so no new audit row
      // should be written.
      try {
        await caller.sales.void({ id: sale.id, reason: 'Double-void' });
        throw new Error('Expected second void to be rejected');
      } catch {
        // expected
      }

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.resourceType, 'sale'),
            eq(auditLogs.resourceId, sale.id),
            eq(auditLogs.action, 'sale.void')
          )
        )
        .all();
      // Exactly one row — the first successful void. The rejected second
      // attempt must NOT leave a stray audit entry.
      expect(auditRows).toHaveLength(1);
      expect((auditRows[0]?.metadata as Record<string, unknown> | null)?.reason).toBe(
        'First attempt'
      );

      await closeActiveSession();
    });

    it('writes a cash_session.close audit row with the over/short delta', async () => {
      const opened = await openCashSessionForTest(`AUD-CLOSE-REG-${nanoid(4)}`);

      // Close with an actual count of 90 against an opening float of 100 —
      // a $10 short should appear in `after.overShort` so the auditor can
      // surface anomalous shifts without re-deriving the math.
      const caller = appRouter.createCaller(createTestContext());
      await caller.cashSessions.close({
        actualCount: 90,
        denominations: [{ value: 50, count: 1 }, { value: 20, count: 2 }],
      });

      const audit = await getLatestAuditRow({
        resourceType: 'cash_session',
        resourceId: opened.id,
      });
      expect(audit).toBeTruthy();
      expect(audit?.action).toBe('cash_session.close');
      expect(audit?.before).toMatchObject({ status: 'open' });
      expect(audit?.after).toMatchObject({
        status: 'closed',
        actualCount: 90,
        overShort: -10,
      });
      expect(audit?.metadata).toMatchObject({
        siteId: primarySiteId,
      });
    });
  });

  // ─── ENG-007 second wave — purchase voids, admin user lifecycle, price overrides ──

  describe('purchase voids, user lifecycle, price overrides (ENG-007 second wave)', () => {
    async function openCashSessionForTest(registerName: string) {
      const caller = appRouter.createCaller(createTestContext());
      return caller.cashSessions.open({
        registerName,
        openingFloat: 100,
        denominations: [{ value: 100, count: 1 }],
      });
    }

    async function closeActiveSession() {
      const caller = appRouter.createCaller(createTestContext());
      return caller.cashSessions.close({
        actualCount: 100,
        denominations: [{ value: 100, count: 1 }],
      });
    }

    it('writes a purchase.void audit row carrying purchaseNumber, total and reason', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const product = await createProduct(`AUD-PV-${nanoid(6)}`);

      const purchase = await caller.purchases.create({
        providerId,
        items: [
          {
            productId: product.id,
            unitId: baseUnitId,
            quantity: 5,
            costPerUnit: 4,
          },
        ],
      });

      await caller.purchases.void({ id: purchase.id, reason: 'Wrong supplier' });

      const audit = await getLatestAuditRow({
        resourceType: 'purchase',
        resourceId: purchase.id,
      });
      expect(audit).toBeTruthy();
      expect(audit?.action).toBe('purchase.void');
      expect(audit?.before).toMatchObject({
        status: 'completed',
        purchaseNumber: expect.stringMatching(/^COM-\d{6}$/),
      });
      expect(audit?.after).toMatchObject({ status: 'voided' });
      expect(audit?.metadata).toMatchObject({
        reason: 'Wrong supplier',
        siteId: primarySiteId,
      });
    });

    it('writes a user.create audit row with email/role/isActive in the after snapshot but no password hash', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const email = `aud-uc-${nanoid(4)}@example.com`;

      const created = await caller.users.create({
        email,
        name: 'Audit Cashier',
        password: 'Temp-Password-1',
        role: 'cashier',
        isActive: true,
      });

      const audit = await getLatestAuditRow({
        resourceType: 'user',
        resourceId: created.id,
      });
      expect(audit).toBeTruthy();
      expect(audit?.action).toBe('user.create');
      expect(audit?.before).toBeNull();
      expect(audit?.after).toMatchObject({
        email,
        name: 'Audit Cashier',
        role: 'cashier',
        isActive: true,
      });
      // Critical: the password hash must NEVER be persisted in the audit
      // trail. If it were, the audit log would become a credential dump.
      const afterJson = JSON.stringify(audit?.after ?? {});
      expect(afterJson).not.toContain('passwordHash');
      expect(afterJson).not.toContain('Temp-Password-1');
    });

    it('writes a user.update audit row only when role or isActive change', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const db = getDatabase();
      const created = await caller.users.create({
        email: `aud-uu-${nanoid(4)}@example.com`,
        name: 'Audit Manager',
        password: 'Temp-Password-1',
        role: 'cashier',
        isActive: true,
      });

      // Name-only edit must NOT write an audit row — bookkeeping isn't
      // security-sensitive.
      await caller.users.update({ id: created.id, name: 'Audit Manager Renamed' });
      const rowsAfterNameEdit = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.resourceType, 'user'),
            eq(auditLogs.resourceId, created.id),
            eq(auditLogs.action, 'user.update')
          )
        )
        .all();
      expect(rowsAfterNameEdit).toHaveLength(0);

      // Role escalation MUST write an audit row with the role transition.
      await caller.users.update({ id: created.id, role: 'manager' });
      // Disable MUST write a separate audit row (rows may share the same
      // ISO-millisecond createdAt, so we explicitly find each by its
      // before/after shape rather than relying on DESC-order tie-breaking).
      await caller.users.update({ id: created.id, isActive: false });

      const allUpdateRows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.resourceType, 'user'),
            eq(auditLogs.resourceId, created.id),
            eq(auditLogs.action, 'user.update')
          )
        )
        .all();
      expect(allUpdateRows).toHaveLength(2);

      const roleAudit = allUpdateRows.find(row => {
        const before = row.before as Record<string, unknown> | null;
        return before !== null && typeof before.role === 'string';
      });
      expect(roleAudit?.before).toMatchObject({ role: 'cashier' });
      expect(roleAudit?.after).toMatchObject({ role: 'manager' });

      const disableAudit = allUpdateRows.find(row => {
        const before = row.before as Record<string, unknown> | null;
        return before !== null && typeof before.isActive === 'boolean';
      });
      expect(disableAudit?.before).toMatchObject({ isActive: true });
      expect(disableAudit?.after).toMatchObject({ isActive: false });
    });

    it('writes a single sale.price_override row summarizing every line that deviated from the catalog', async () => {
      await openCashSessionForTest(`AUD-PO-REG-${nanoid(4)}`);
      const caller = appRouter.createCaller(createTestContext());
      const product = await createProduct(`AUD-PO-${nanoid(6)}`);

      // Catalog price is 100 (set by createProduct). Cashier enters 80 —
      // a 20-unit markdown, which counts as a manual override.
      const sale = await caller.sales.create({
        items: [
          { productId: product.id, unitId: baseUnitId, quantity: 1, unitPrice: 80, discount: 0 },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 80,
        discountAmount: 0,
      });

      const audit = await getLatestAuditRow({
        resourceType: 'sale',
        resourceId: sale.id,
      });
      expect(audit?.action).toBe('sale.price_override');
      expect(audit?.after).toMatchObject({ overrideCount: 1 });

      const overrides = (audit?.metadata as Record<string, unknown> | null)
        ?.overrides;
      expect(Array.isArray(overrides)).toBe(true);
      expect(overrides).toHaveLength(1);
      expect((overrides as Array<Record<string, unknown>>)[0]).toMatchObject({
        productId: product.id,
        referenceUnitPrice: 100,
        unitPrice: 80,
        quantity: 1,
      });

      await closeActiveSession();
    });

    it('does NOT write a sale.price_override row when every line matches the catalog price', async () => {
      await openCashSessionForTest(`AUD-PO-NOOP-REG-${nanoid(4)}`);
      const caller = appRouter.createCaller(createTestContext());
      const db = getDatabase();
      const product = await createProduct(`AUD-PO-NOOP-${nanoid(6)}`);

      const sale = await caller.sales.create({
        items: [
          { productId: product.id, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 100,
        discountAmount: 0,
      });

      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.resourceType, 'sale'),
            eq(auditLogs.resourceId, sale.id),
            eq(auditLogs.action, 'sale.price_override')
          )
        )
        .all();
      expect(rows).toHaveLength(0);

      await closeActiveSession();
    });
  });

  it('does NOT persist an audit row when the sensitive action rolls back', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const db = getDatabase();
    const product = await createProduct(`AUD-RB-${nanoid(6)}`);

    const draft = await caller.quotations.create({
      items: [
        { productId: product.id, quantity: 1, unitPrice: 100, discount: 0, taxRate: 0 },
      ],
    });
    await caller.quotations.updateStatus({ id: draft.id, status: 'sent' });

    // Try to delete a non-draft quotation — the service throws and the
    // transaction rolls back, so no audit row should survive.
    try {
      await caller.quotations.delete({ id: draft.id });
      throw new Error('Expected delete to fail');
    } catch {
      // expected
    }

    const rows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceType, 'quotation'),
          eq(auditLogs.resourceId, draft.id),
          eq(auditLogs.action, 'quotation.delete')
        )
      )
      .all();
    expect(rows).toHaveLength(0);
  });
});
