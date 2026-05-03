/**
 * ENG-018 + ENG-019 — sales park-and-resume + receipt reprint.
 *
 * HTTP-less integration coverage against an in-memory SQLite DB via
 * `appRouter.createCaller()`, matching the pattern of
 * `audit-logs.test.ts` and `sales.test.ts`.
 *
 * Covered invariants:
 * - park (suspend): tenant scope, status guard, idempotent re-suspend,
 *   audit row written.
 * - resume: owner can resume; non-owner cashier is blocked; manager
 *   override allowed; clears suspension state; emits audit row with
 *   override metadata when the caller is not the original cashier.
 * - listDrafts: cashier scope (own only), manager scope (all), search
 *   matches label + saleNumber, pagination.
 * - discardDraft: flips to 'cancelled', same lock rules as resume, and
 *   reverses stock debited at draft creation.
 * - getForReprint (ENG-019): increments `reprintCount`, stamps
 *   timestamps, rejects drafts, cashier limited to active session,
 *   manager override, audit row emitted with reason metadata.
 * - cross-tenant isolation: a user in tenant B cannot see tenant A's
 *   drafts nor reprint tenant A's sales.
 */

import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { makeEnvelopeHeadersProxy } from './utils/criticalCommandFixture.js';
import {
  auditLogs,
  cashMovements,
  cashSessions,
  companies,
  inventoryMovements,
  products,
  salePayments,
  sales,
  sites,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { completeDraftInput } from '../trpc/schemas/sales.js';

let server: PuntovivoServer;
let tenantId: string;
let adminId: string;
let managerId: string;
let cashier1Id: string;
let cashier2Id: string;
let primarySiteId: string;
let baseUnitId: string;
let productId: string;
let cashier1SessionId: string;
let cashier2SessionId: string;

let otherTenantId: string;
let otherAdminId: string;

/**
 * ENG-052b — Per-tenant device id cache. Cross-tenant tests register
 * a device for both tenants up-front; the proxy looks up the right
 * one based on the tenant in the active context.
 */
const deviceIdByTenant: Map<string, string> = new Map();

function createContext(
  userId: string,
  role: 'admin' | 'manager' | 'cashier' | 'viewer',
  tenant: string,
  siteId: string | null
): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: makeEnvelopeHeadersProxy({
        getDeviceId: () => deviceIdByTenant.get(tenant),
        getSiteId: () => siteId,
      }),
      user: {
        userId,
        email: `${role}@localhost`,
        role,
        tenantId: tenant,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: {
      id: userId,
      email: `${role}@localhost`,
      role,
      tenantId: tenant,
    },
    tenantId: tenant,
    siteId,
  };
}

async function openSession(userId: string, role: 'admin' | 'manager' | 'cashier') {
  const caller = appRouter.createCaller(
    createContext(userId, role, tenantId, primarySiteId)
  );
  const session = await caller.cashSessions.open({
    registerName: `Register ${userId.slice(0, 6)}`,
    openingFloat: 100,
    denominations: [{ value: 50, count: 2 }],
  });
  return session;
}

describe('Sales park-and-resume + reprint (ENG-018 / ENG-019)', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();

    const seededAdmin = await db
      .select()
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!seededAdmin) throw new Error('Expected seeded admin user');
    tenantId = seededAdmin.tenantId;
    adminId = seededAdmin.id;

    const mainSite = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!mainSite) throw new Error('Expected seeded main site');
    primarySiteId = mainSite.id;

    const seededUnits = await db
      .select()
      .from(units)
      .where(eq(units.tenantId, tenantId))
      .all();
    const baseUnit = seededUnits.find(unit => unit.abbreviation === 'UND');
    if (!baseUnit) throw new Error('Expected seeded UND unit');
    baseUnitId = baseUnit.id;

    // Seed a manager and two cashiers.
    const now = new Date().toISOString();
    managerId = nanoid();
    cashier1Id = nanoid();
    cashier2Id = nanoid();
    await db.insert(users).values([
      {
        id: managerId,
        tenantId,
        email: 'manager@localhost',
        passwordHash: 'x',
        name: 'Manager',
        role: 'manager',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: cashier1Id,
        tenantId,
        email: 'cashier1@localhost',
        passwordHash: 'x',
        name: 'Cashier One',
        role: 'cashier',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: cashier2Id,
        tenantId,
        email: 'cashier2@localhost',
        passwordHash: 'x',
        name: 'Cashier Two',
        role: 'cashier',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // Product + unit mapping so `sales.create` can build a draft.
    productId = nanoid();
    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Park Product',
      sku: 'PARK-01',
      price: 10,
      price2: 10,
      price3: 10,
      cost: 5,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 5,
      stock: 200,
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
      price: 10,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    // ENG-052b — register the primary tenant device BEFORE
    // `openSession()` runs, since `cashSessions.open` is now a
    // critical procedure.
    const primaryRegistration = await registerDeviceService(db, {
      tenantId,
      userId: adminId,
      kind: 'web',
      name: 'sales-park.test.primary',
    });
    deviceIdByTenant.set(tenantId, primaryRegistration.deviceId);

    const session1 = await openSession(cashier1Id, 'cashier');
    cashier1SessionId = session1.id;
    const session2 = await openSession(cashier2Id, 'cashier');
    cashier2SessionId = session2.id;

    // Second tenant so we can assert cross-tenant isolation.
    otherTenantId = nanoid();
    otherAdminId = nanoid();
    const otherCompanyId = nanoid();
    const otherSiteId = nanoid();
    await db.insert(tenants).values({
      id: otherTenantId,
      name: 'Other Tenant',
      slug: `other-${nanoid(6).toLowerCase()}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: otherAdminId,
      tenantId: otherTenantId,
      email: 'other-admin@localhost',
      passwordHash: 'x',
      name: 'Other Admin',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: otherCompanyId,
      tenantId: otherTenantId,
      name: 'Other Co',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: otherSiteId,
      tenantId: otherTenantId,
      companyId: otherCompanyId,
      name: 'Other Site',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // ENG-052b — register a device for the second tenant so the
    // cross-tenant isolation tests can drive critical procedures
    // from either side. The primary tenant's device was registered
    // earlier (before `openSession()` ran).
    const otherRegistration = await registerDeviceService(db, {
      tenantId: otherTenantId,
      userId: otherAdminId,
      kind: 'web',
      name: 'sales-park.test.other',
    });
    deviceIdByTenant.set(otherTenantId, otherRegistration.deviceId);
  });

  afterAll(async () => {
    await server.close();
  });

  // Helper: create a draft sale owned by `cashier` and return its id. Uses
  // the tRPC `sales.create` mutation so the active-session wiring is real.
  async function createDraftSale(
    cashierId: string,
    sessionId: string
  ): Promise<string> {
    const caller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    const created = await caller.sales.create({
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 10,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      discountAmount: 0,
    });
    // Prevent `sessionId` unused lint warning when the mutation ignores it.
    void sessionId;
    return created.id;
  }

  describe('sales.suspend (ENG-018)', () => {
    it('stamps suspension columns, writes a sale.park audit row, and is idempotent', async () => {
      const saleId = await createDraftSale(cashier1Id, cashier1SessionId);
      const caller = appRouter.createCaller(
        createContext(cashier1Id, 'cashier', tenantId, primarySiteId)
      );

      await caller.sales.suspend({ saleId, label: 'Table 5' });

      const db = getDatabase();
      const stored = await db.select().from(sales).where(eq(sales.id, saleId)).get();
      expect(stored?.suspendedBy).toBe(cashier1Id);
      expect(stored?.suspendedLabel).toBe('Table 5');
      expect(stored?.suspendedAt).toBeTruthy();

      const firstAudit = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.resourceId, saleId),
            eq(auditLogs.action, 'sale.park')
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .get();
      expect(firstAudit?.metadata).toMatchObject({ label: 'Table 5' });

      // Idempotent re-suspend: refreshes label + timestamp, still passes.
      await caller.sales.suspend({ saleId, label: 'Table 6' });
      const refreshed = await db.select().from(sales).where(eq(sales.id, saleId)).get();
      expect(refreshed?.suspendedLabel).toBe('Table 6');
    });

    it('rejects non-draft sales', async () => {
      const saleId = await createDraftSale(cashier1Id, cashier1SessionId);
      const db = getDatabase();
      // Force status to completed so the guard trips.
      await db
        .update(sales)
        .set({ status: 'completed' })
        .where(eq(sales.id, saleId));

      const caller = appRouter.createCaller(
        createContext(cashier1Id, 'cashier', tenantId, primarySiteId)
      );
      await expect(
        caller.sales.suspend({ saleId })
      ).rejects.toThrowError(TRPCError);
    });

    it('is cross-tenant isolated', async () => {
      const saleId = await createDraftSale(cashier1Id, cashier1SessionId);
      const otherCaller = appRouter.createCaller(
        createContext(otherAdminId, 'admin', otherTenantId, null)
      );
      await expect(
        otherCaller.sales.suspend({ saleId })
      ).rejects.toThrowError(/not found/i);
    });
  });

  describe('sales.resume (ENG-018)', () => {
    it('lets the owning cashier resume and clears suspension state', async () => {
      const saleId = await createDraftSale(cashier1Id, cashier1SessionId);
      const caller = appRouter.createCaller(
        createContext(cashier1Id, 'cashier', tenantId, primarySiteId)
      );

      await caller.sales.suspend({ saleId, label: 'L' });
      const result = await caller.sales.resume({ saleId });

      expect(result.suspendedAt).toBeNull();
      expect(result.suspendedBy).toBeNull();
      expect(result.status).toBe('draft');
      expect(result.items).toHaveLength(1);

      const db = getDatabase();
      const audit = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.resourceId, saleId),
            eq(auditLogs.action, 'sale.resume')
          )
        )
        .get();
      expect(audit).toBeTruthy();
    });

    it('blocks a different cashier from resuming and lets manager override', async () => {
      const saleId = await createDraftSale(cashier1Id, cashier1SessionId);
      const c1 = appRouter.createCaller(
        createContext(cashier1Id, 'cashier', tenantId, primarySiteId)
      );
      await c1.sales.suspend({ saleId });

      const c2 = appRouter.createCaller(
        createContext(cashier2Id, 'cashier', tenantId, primarySiteId)
      );
      await expect(c2.sales.resume({ saleId })).rejects.toThrowError(
        /suspended this sale/i
      );

      const mgr = appRouter.createCaller(
        createContext(managerId, 'manager', tenantId, primarySiteId)
      );
      const result = await mgr.sales.resume({ saleId });
      expect(result.suspendedAt).toBeNull();

      const db = getDatabase();
      const audit = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.resourceId, saleId),
            eq(auditLogs.action, 'sale.resume')
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .get();
      expect(audit?.metadata).toMatchObject({
        override: true,
        originalSuspendedBy: cashier1Id,
      });
    });

    it('rejects resume when the sale is not suspended', async () => {
      const saleId = await createDraftSale(cashier1Id, cashier1SessionId);
      const caller = appRouter.createCaller(
        createContext(cashier1Id, 'cashier', tenantId, primarySiteId)
      );
      await expect(caller.sales.resume({ saleId })).rejects.toThrowError(
        /not suspended/i
      );
    });
  });

  describe('sales.listDrafts (ENG-018)', () => {
    it('scopes cashier drafts to the caller and shows all drafts to managers', async () => {
      const saleA = await createDraftSale(cashier1Id, cashier1SessionId);
      const saleB = await createDraftSale(cashier2Id, cashier2SessionId);

      await appRouter
        .createCaller(createContext(cashier1Id, 'cashier', tenantId, primarySiteId))
        .sales.suspend({ saleId: saleA, label: 'Alpha' });
      await appRouter
        .createCaller(createContext(cashier2Id, 'cashier', tenantId, primarySiteId))
        .sales.suspend({ saleId: saleB, label: 'Beta' });

      const cashier1List = await appRouter
        .createCaller(createContext(cashier1Id, 'cashier', tenantId, primarySiteId))
        .sales.listDrafts({ page: 1, perPage: 50 });
      const cashier1Ids = cashier1List.items.map(item => item.id);
      expect(cashier1Ids).toContain(saleA);
      expect(cashier1Ids).not.toContain(saleB);

      const managerList = await appRouter
        .createCaller(createContext(managerId, 'manager', tenantId, primarySiteId))
        .sales.listDrafts({ page: 1, perPage: 50 });
      const managerIds = managerList.items.map(item => item.id);
      expect(managerIds).toEqual(expect.arrayContaining([saleA, saleB]));

      const searched = await appRouter
        .createCaller(createContext(managerId, 'manager', tenantId, primarySiteId))
        .sales.listDrafts({ page: 1, perPage: 50, search: 'alpha' });
      const searchedIds = searched.items.map(item => item.id);
      expect(searchedIds).toContain(saleA);
      expect(searchedIds).not.toContain(saleB);
    });
  });

  describe('sales.discardDraft (ENG-018)', () => {
    it('flips status to cancelled and clears suspension metadata', async () => {
      const saleId = await createDraftSale(cashier1Id, cashier1SessionId);
      const caller = appRouter.createCaller(
        createContext(cashier1Id, 'cashier', tenantId, primarySiteId)
      );
      await caller.sales.suspend({ saleId });
      await caller.sales.discardDraft({ saleId });

      const db = getDatabase();
      const stored = await db.select().from(sales).where(eq(sales.id, saleId)).get();
      expect(stored?.status).toBe('cancelled');
      expect(stored?.suspendedAt).toBeNull();
    });

    it('blocks a non-owner cashier (neither creator nor suspender)', async () => {
      const saleId = await createDraftSale(cashier1Id, cashier1SessionId);
      await appRouter
        .createCaller(createContext(cashier1Id, 'cashier', tenantId, primarySiteId))
        .sales.suspend({ saleId });

      const c2 = appRouter.createCaller(
        createContext(cashier2Id, 'cashier', tenantId, primarySiteId)
      );
      await expect(c2.sales.discardDraft({ saleId })).rejects.toThrowError(
        /cashier who created or suspended/i
      );
    });

    it('reverses stock on discard (ENG-018c fix for 77bb686 bug)', async () => {
      // Dedicated product so stock movement is easy to assert without
      // interference from other tests running in the same describe block.
      const db = getDatabase();
      const reversalProductId = nanoid();
      const reversalSku = `PARK-REV-${nanoid(6)}`;
      const timestamp = new Date().toISOString();
      await db.insert(products).values({
        id: reversalProductId,
        tenantId,
        name: 'Reversal Probe',
        sku: reversalSku,
        price: 10,
        price2: 10,
        price3: 10,
        cost: 5,
        marginPercent1: 0,
        marginPercent2: 0,
        marginPercent3: 0,
        marginAmount1: 0,
        marginAmount2: 0,
        marginAmount3: 0,
        taxRate: 0,
        initialCost: 5,
        stock: 50,
        minStock: 0,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await db.insert(unitXProduct).values({
        id: nanoid(),
        productId: reversalProductId,
        unitId: baseUnitId,
        equivalence: 1,
        price: 10,
        isBase: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const caller = appRouter.createCaller(
        createContext(cashier1Id, 'cashier', tenantId, primarySiteId)
      );

      // Baseline: product stock is 50 after seeding.
      const seeded = await db
        .select({ stock: products.stock })
        .from(products)
        .where(eq(products.id, reversalProductId))
        .get();
      expect(seeded?.stock).toBe(50);

      // Draft creation debits stock by 3 units (ENG-018 baseline model).
      const draft = await caller.sales.create({
        items: [
          {
            productId: reversalProductId,
            unitId: baseUnitId,
            quantity: 3,
            unitPrice: 10,
            discount: 0,
          },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'draft',
        discountAmount: 0,
      });

      const afterDraft = await db
        .select({ stock: products.stock })
        .from(products)
        .where(eq(products.id, reversalProductId))
        .get();
      expect(afterDraft?.stock).toBe(47);

      // Discard the draft: stock must return to the pre-draft baseline.
      await caller.sales.discardDraft({ saleId: draft.id });

      const afterDiscard = await db
        .select({ stock: products.stock })
        .from(products)
        .where(eq(products.id, reversalProductId))
        .get();
      expect(afterDiscard?.stock).toBe(50);

      // An `inventoryMovements` row of type 'return' documents the
      // reversal so audit tooling can reconcile the timeline.
      const returnMovement = await db
        .select()
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.tenantId, tenantId),
            eq(inventoryMovements.productId, reversalProductId),
            eq(inventoryMovements.reference, draft.id),
            eq(inventoryMovements.type, 'return')
          )
        )
        .get();
      expect(returnMovement?.quantity).toBe(3);
      expect(returnMovement?.previousStock).toBe(47);
      expect(returnMovement?.newStock).toBe(50);

      // Sale row itself is cancelled with the reversal count in metadata.
      const discardedSale = await db
        .select()
        .from(sales)
        .where(eq(sales.id, draft.id))
        .get();
      expect(discardedSale?.status).toBe('cancelled');
      expect(discardedSale?.suspendedAt).toBeNull();

      const audit = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.resourceId, draft.id),
            eq(auditLogs.action, 'sale.park')
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .get();
      expect(audit?.metadata).toMatchObject({
        discarded: true,
        reversedItems: 1,
      });
    });

    it('lets the creator discard an orphan draft that was never suspended', async () => {
      // Regression: pre-ENG-018c lock only accepted suspendedBy, leaving
      // drafts whose suspend call failed mid-flight permanently stuck.
      const saleId = await createDraftSale(cashier1Id, cashier1SessionId);
      const caller = appRouter.createCaller(
        createContext(cashier1Id, 'cashier', tenantId, primarySiteId)
      );
      const result = await caller.sales.discardDraft({ saleId });
      expect(result.status).toBe('cancelled');
    });
  });

  describe('sales.getForReprint (ENG-019)', () => {
    async function createCompletedSale(cashierId: string) {
      const caller = appRouter.createCaller(
        createContext(cashierId, 'cashier', tenantId, primarySiteId)
      );
      const result = await caller.sales.create({
        items: [
          {
            productId,
            unitId: baseUnitId,
            quantity: 1,
            unitPrice: 10,
            discount: 0,
          },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'completed',
        amountReceived: 10,
        discountAmount: 0,
      });
      return result.id;
    }

    it('increments reprintCount, stamps timestamps, and writes an audit row', async () => {
      const saleId = await createCompletedSale(cashier1Id);
      const caller = appRouter.createCaller(
        createContext(cashier1Id, 'cashier', tenantId, primarySiteId)
      );

      const first = await caller.sales.getForReprint({
        saleId,
        reason: 'paper_out',
      });
      expect(first.reprintCount).toBe(1);
      expect(first.lastReprintedBy).toBe(cashier1Id);
      expect(first.lastReprintedAt).toBeTruthy();

      const db = getDatabase();
      const audit = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.resourceId, saleId),
            eq(auditLogs.action, 'sale.reprint')
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .get();
      expect(audit?.metadata).toMatchObject({
        count: 1,
        reason: 'paper_out',
      });

      const second = await caller.sales.getForReprint({ saleId });
      expect(second.reprintCount).toBe(2);
    });

    it('rejects drafts', async () => {
      const saleId = await createDraftSale(cashier1Id, cashier1SessionId);
      const caller = appRouter.createCaller(
        createContext(cashier1Id, 'cashier', tenantId, primarySiteId)
      );
      await expect(
        caller.sales.getForReprint({ saleId })
      ).rejects.toThrowError(/draft/i);
    });

    it('blocks cashier from reprinting another cashier active-session sale, but manager can', async () => {
      const saleId = await createCompletedSale(cashier1Id);

      const c2 = appRouter.createCaller(
        createContext(cashier2Id, 'cashier', tenantId, primarySiteId)
      );
      await expect(c2.sales.getForReprint({ saleId })).rejects.toThrowError(
        /active cash session/i
      );

      const mgr = appRouter.createCaller(
        createContext(managerId, 'manager', tenantId, primarySiteId)
      );
      const result = await mgr.sales.getForReprint({ saleId });
      expect(result.reprintCount).toBeGreaterThanOrEqual(1);
    });

    it('is cross-tenant isolated', async () => {
      const saleId = await createCompletedSale(cashier1Id);
      const otherCaller = appRouter.createCaller(
        createContext(otherAdminId, 'admin', otherTenantId, null)
      );
      await expect(
        otherCaller.sales.getForReprint({ saleId })
      ).rejects.toThrowError(/not found/i);
    });
  });

  describe('sales.completeDraft (ENG-018c)', () => {
    it('flips a non-suspended draft to completed, replaces payments, and binds to the active cash session', async () => {
      const draftId = await createDraftSale(cashier1Id, cashier1SessionId);
      const caller = appRouter.createCaller(
        createContext(cashier1Id, 'cashier', tenantId, primarySiteId)
      );

      const db = getDatabase();
      const beforeCompletion = await db
        .select({ stock: products.stock })
        .from(products)
        .where(eq(products.id, productId))
        .get();
      const stockBeforeComplete = beforeCompletion?.stock ?? 0;

      const completed = await caller.sales.completeDraft({
        saleId: draftId,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        amountReceived: 15,
        notes: 'Completed from draft',
      });

      expect(completed.status).toBe('completed');
      expect(completed.paymentStatus).toBe('paid');
      expect(completed.notes).toBe('Completed from draft');

      // Stock must NOT move on completeDraft — it was already debited at
      // create-time. Double-debit is the whole bug this split prevents.
      const afterCompletion = await db
        .select({ stock: products.stock })
        .from(products)
        .where(eq(products.id, productId))
        .get();
      expect(afterCompletion?.stock).toBe(stockBeforeComplete);

      // The active cash session gets re-bound so reports aggregate the
      // income on the session that physically received the cash.
      const storedSale = await db
        .select({
          cashSessionId: sales.cashSessionId,
          status: sales.status,
          paymentStatus: sales.paymentStatus,
        })
        .from(sales)
        .where(eq(sales.id, draftId))
        .get();
      expect(storedSale?.cashSessionId).toBe(cashier1SessionId);
      expect(storedSale?.status).toBe('completed');

      // The initial placeholder payment row from `sales.create` must be
      // replaced by the real tender(s) the operator registered.
      const payments = await db
        .select()
        .from(salePayments)
        .where(eq(salePayments.saleId, draftId))
        .all();
      expect(payments).toHaveLength(1);
      expect(payments[0]?.method).toBe('cash');
      // Cash total is sale total (10) for a non-split tender, not the
      // amount received (15) — the 5 unit difference is change.
      expect(payments[0]?.amount).toBe(10);

      // And a cash movement lands on the active session so its expected
      // balance reflects the freshly collected cash.
      const cashMovement = await db
        .select()
        .from(cashMovements)
        .where(eq(cashMovements.referenceId, draftId))
        .get();
      expect(cashMovement).toBeTruthy();
      expect(cashMovement?.sessionId).toBe(cashier1SessionId);
      expect(cashMovement?.type).toBe('sale');

      // An audit row captures the draft → completed transition in the
      // same transaction, matching the void / return / park / discard
      // pattern. Forensics: knowing who finalized a parked draft and
      // when is how disputes get resolved.
      const audit = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.resourceId, draftId),
            eq(auditLogs.action, 'sale.complete')
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .get();
      expect(audit).toBeTruthy();
      expect(audit?.actorId).toBe(cashier1Id);
      expect(audit?.before).toMatchObject({ status: 'draft' });
      expect(audit?.after).toMatchObject({
        status: 'completed',
        cashSessionId: cashier1SessionId,
      });
      expect(audit?.metadata).toMatchObject({ completedFromDraft: true });
    });

    it('rejects completion of a suspended draft (caller must resume first)', async () => {
      const draftId = await createDraftSale(cashier1Id, cashier1SessionId);
      const caller = appRouter.createCaller(
        createContext(cashier1Id, 'cashier', tenantId, primarySiteId)
      );
      await caller.sales.suspend({ saleId: draftId, label: 'Mesa X' });

      await expect(
        caller.sales.completeDraft({
          saleId: draftId,
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          amountReceived: 10,
        })
      ).rejects.toThrowError(/resume/i);
    });

    it('rejects completion when the sale is not a draft', async () => {
      // Create a completed sale directly and try to complete it again.
      const caller = appRouter.createCaller(
        createContext(cashier1Id, 'cashier', tenantId, primarySiteId)
      );
      const sale = await caller.sales.create({
        items: [
          {
            productId,
            unitId: baseUnitId,
            quantity: 1,
            unitPrice: 10,
            discount: 0,
          },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 10,
        discountAmount: 0,
      });
      await expect(
        caller.sales.completeDraft({
          saleId: sale.id,
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          amountReceived: 10,
        })
      ).rejects.toThrowError(/draft/i);
    });

    it('blocks a non-creator cashier but allows manager override', async () => {
      const draftId = await createDraftSale(cashier1Id, cashier1SessionId);

      const cashier2Caller = appRouter.createCaller(
        createContext(cashier2Id, 'cashier', tenantId, primarySiteId)
      );
      await expect(
        cashier2Caller.sales.completeDraft({
          saleId: draftId,
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          amountReceived: 10,
        })
      ).rejects.toThrowError(/cashier who created/i);

      // Manager can complete any draft (the override path).
      const managerCaller = appRouter.createCaller(
        createContext(managerId, 'manager', tenantId, primarySiteId)
      );
      // Manager needs an active cash session to receive the sale.
      await managerCaller.cashSessions.open({
        registerName: `Mgr register ${nanoid(4)}`,
        openingFloat: 100,
        denominations: [{ value: 50, count: 2 }],
      });
      const completed = await managerCaller.sales.completeDraft({
        saleId: draftId,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        amountReceived: 10,
      });
      expect(completed.status).toBe('completed');
    });

    it('blocks viewers explicitly before ownership checks', async () => {
      const draftId = await createDraftSale(cashier1Id, cashier1SessionId);
      const viewerCaller = appRouter.createCaller(
        createContext(cashier1Id, 'viewer', tenantId, primarySiteId)
      );

      await expect(
        viewerCaller.sales.completeDraft({
          saleId: draftId,
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          amountReceived: 10,
        })
      ).rejects.toThrowError(/cashiers, managers, and administrators/i);
    });

    it('rejects refunded as a completion payment status at the input boundary', () => {
      const parsed = completeDraftInput.safeParse({
        saleId: 'draft-1',
        paymentMethod: 'cash',
        paymentStatus: 'refunded',
        amountReceived: 10,
      });

      expect(parsed.success).toBe(false);
    });

    it('is cross-tenant isolated', async () => {
      const draftId = await createDraftSale(cashier1Id, cashier1SessionId);
      const otherCaller = appRouter.createCaller(
        createContext(otherAdminId, 'admin', otherTenantId, null)
      );
      await expect(
        otherCaller.sales.completeDraft({
          saleId: draftId,
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          amountReceived: 10,
        })
      ).rejects.toThrowError(/not found/i);
    });
  });
});
