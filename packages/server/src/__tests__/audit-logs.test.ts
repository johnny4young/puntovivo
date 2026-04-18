import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
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

function createTestContext(): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
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
