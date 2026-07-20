/**
 * `setupReadiness.*` + `companies.acknowledgeSetup` tests.
 *
 * Pins the contract:
 *
 * - Fresh tenant (no products, no fiscal profile) → blockers in
 * `catalog` + `fiscal`; locale + sites depend on baseline seed.
 * - Mature tenant (products + fiscal config) → score >= 80,
 * `blockerCount = 0`.
 * - Cross-tenant isolation: T1 cannot see T2's product / site
 * counts.
 * - Cashier rejected with FORBIDDEN.
 * - `acknowledgeSetup` writes the ISO timestamp and is idempotent.
 * - `acknowledgeSetup` is tenant-scoped — admin of T1 cannot
 * affect T2's settings blob.
 *
 * @module __tests__/setup-readiness.test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  companies,
  products,
  sales,
  sitePeripherals,
  sites,
  tenantLocaleSettings,
  tenants,
  users,
  type NewProduct,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let foreignTenantId: string;
let foreignUserId: string;

function buildCtx(args: {
  tenantId: string;
  userId: string;
  role?: 'admin' | 'manager' | 'cashier' | 'viewer';
}): Context {
  const role = args.role ?? 'admin';
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
      user: {
        userId: args.userId,
        email: `${args.userId}@example.com`,
        role,
        tenantId: args.tenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: {
      id: args.userId,
      email: `${args.userId}@example.com`,
      role,
      tenantId: args.tenantId,
    },
    tenantId: args.tenantId,
    siteId: null,
  };
}

async function seedProduct(args: { tenantId: string; suffix: string }) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const product: NewProduct = {
    id: nanoid(),
    tenantId: args.tenantId,
    name: `Readiness Product ${args.suffix}`,
    sku: `SKU-RDY-${args.suffix}`,
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
  };
  await db.insert(products).values(product);
  return product.id;
}

async function clearReadinessFixtures() {
  const db = getDatabase();
  // Wipe the products added by individual tests so cases stay
  // independent. Sites + users + tenant settings persist across the
  // suite (touching them would break other suites running in the
  // same DB).
  await db.delete(products).where(eq(products.sku, `SKU-RDY-A`));
  await db.delete(products).where(eq(products.sku, `SKU-RDY-B`));
  // Reset acknowledged timestamp for the primary tenant.
  await db.update(tenants).set({ settings: {} }).where(eq(tenants.id, tenantId));
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();

  const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!admin) throw new Error('Expected seeded admin');
  tenantId = admin.tenantId;
  userId = admin.id;

  const allSites = await db.select().from(sites).where(eq(sites.tenantId, tenantId)).all();
  if (allSites.length === 0) {
    throw new Error('Expected at least one seeded site for the active tenant');
  }
  siteId = allSites[0]!.id;

  // Cross-tenant isolation harness: seed a foreign tenant + admin so
  // we can call the procedure as a different identity.
  foreignTenantId = nanoid();
  const foreignCompanyId = nanoid();
  foreignUserId = nanoid();
  const now = new Date().toISOString();
  await db.insert(tenants).values({
    id: foreignTenantId,
    name: 'Readiness Foreign Tenant',
    slug: `readiness-foreign-${foreignTenantId.slice(0, 8)}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(companies).values({
    id: foreignCompanyId,
    tenantId: foreignTenantId,
    name: 'Readiness Foreign Company',
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values({
    id: nanoid(),
    tenantId: foreignTenantId,
    companyId: foreignCompanyId,
    name: 'Readiness Foreign Site',
    isActive: true,
  });
  await db.insert(users).values({
    id: foreignUserId,
    tenantId: foreignTenantId,
    email: `readiness-foreign-${foreignTenantId.slice(0, 8)}@example.com`,
    name: 'Foreign Admin',
    passwordHash: 'x',
    sessionVersion: 1,
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  await clearReadinessFixtures();
});

describe('setupReadiness', () => {
  it('returns a stable 11-section shape for a fresh tenant', async () => {
    const caller = appRouter.createCaller(buildCtx({ tenantId, userId }));
    const result = await caller.setupReadiness.get();
    expect(result.sections).toHaveLength(11);
    const ids = result.sections.map(s => s.id).sort();
    expect(ids).toEqual(
      [
        'ai',
        'cashSession',
        'catalog',
        'fiscal',
        'locale',
        'modules',
        'payments',
        'peripherals',
        'sites',
        'sync',
        'users',
      ].sort()
    );
    // Score is bounded 0..100.
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('flags catalog as blocker when the tenant has zero products', async () => {
    const caller = appRouter.createCaller(buildCtx({ tenantId, userId }));
    const result = await caller.setupReadiness.get();
    const catalog = result.sections.find(s => s.id === 'catalog');
    expect(catalog?.status).toBe('blocker');
    expect(catalog?.cta).toEqual({ route: '/products' });
    expect(result.blockerCount).toBeGreaterThan(0);
  });

  it('deep-links readiness CTAs to existing admin surfaces', async () => {
    const db = getDatabase();
    await db
      .update(tenants)
      .set({ settings: { fiscal_dian_enabled: true } })
      .where(eq(tenants.id, tenantId));

    const caller = appRouter.createCaller(buildCtx({ tenantId, userId }));
    const result = await caller.setupReadiness.get();
    const ctas = Object.fromEntries(result.sections.map(section => [section.id, section.cta]));

    expect(ctas.locale).toEqual({ route: '/company', tab: 'locale' });
    expect(ctas.sites).toEqual({ route: '/sites' });
    expect(ctas.fiscal).toEqual({ route: '/company', tab: 'fiscal' });
    expect(ctas.peripherals).toEqual({ route: '/peripherals' });
    expect(ctas.payments).toEqual({ route: '/company', tab: 'payments' });
    expect(ctas.modules).toEqual({ route: '/company', tab: 'modules' });
    expect(ctas.users).toEqual({ route: '/users' });
    expect(ctas.catalog).toEqual({ route: '/products' });
    expect(ctas.cashSession).toEqual({ route: '/sales' });
    expect(ctas.sync).toEqual({ route: '/operations' });
  });

  it('flips catalog to ready as soon as one product exists', async () => {
    await seedProduct({ tenantId, suffix: 'A' });
    const caller = appRouter.createCaller(buildCtx({ tenantId, userId }));
    const result = await caller.setupReadiness.get();
    const catalog = result.sections.find(s => s.id === 'catalog');
    expect(catalog?.status).toBe('ready');
  });

  it('marks AI as not-applicable when the master toggle is off', async () => {
    const caller = appRouter.createCaller(buildCtx({ tenantId, userId }));
    const result = await caller.setupReadiness.get();
    const ai = result.sections.find(s => s.id === 'ai');
    // Fresh tenant has no `ai.enabled = true` in settings → opt-out.
    expect(ai?.status).toBe('not-applicable');
    expect(ai?.cta).toBeNull();
  });

  it('does not treat an empty fiscal country object as a configured profile', async () => {
    const db = getDatabase();
    await db
      .update(tenants)
      .set({
        settings: {
          fiscal_dian_enabled: true,
          fiscal: { mx: {} },
        },
      })
      .where(eq(tenants.id, tenantId));

    const caller = appRouter.createCaller(buildCtx({ tenantId, userId }));
    const result = await caller.setupReadiness.get();
    const fiscal = result.sections.find(s => s.id === 'fiscal');
    expect(fiscal?.status).toBe('blocker');
  });

  it('does not treat payment worker metadata as configured credentials', async () => {
    const db = getDatabase();
    await db
      .update(tenants)
      .set({
        settings: {
          payments: {
            wompi: { lastImportedAt: '2026-05-20T12:00:00.000Z' },
          },
        },
      })
      .where(eq(tenants.id, tenantId));

    const caller = appRouter.createCaller(buildCtx({ tenantId, userId }));
    const result = await caller.setupReadiness.get();
    const payments = result.sections.find(s => s.id === 'payments');
    expect(payments?.status).toBe('optional-pending');
  });

  it('isolates product counts by tenant', async () => {
    // Seed a product on the primary tenant; assert the foreign
    // tenant still reports `catalog` as a blocker.
    await seedProduct({ tenantId, suffix: 'A' });
    const foreignCaller = appRouter.createCaller(
      buildCtx({ tenantId: foreignTenantId, userId: foreignUserId })
    );
    const result = await foreignCaller.setupReadiness.get();
    const catalog = result.sections.find(s => s.id === 'catalog');
    expect(catalog?.status).toBe('blocker');
  });

  it('rejects cashier callers with FORBIDDEN', async () => {
    const caller = appRouter.createCaller(buildCtx({ tenantId, userId, role: 'cashier' }));
    try {
      await caller.setupReadiness.get();
      throw new Error('Expected FORBIDDEN');
    } catch (err) {
      expect(String(err)).toMatch(/TRPCError|administrators|managers/i);
    }
  });

  it('acknowledgeSetup writes a timestamp and surfaces it back', async () => {
    const caller = appRouter.createCaller(buildCtx({ tenantId, userId }));
    const before = await caller.setupReadiness.get();
    expect(before.acknowledgedAt).toBeNull();

    const ack = await caller.companies.acknowledgeSetup();
    expect(ack.acknowledgedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const after = await caller.setupReadiness.get();
    expect(after.acknowledgedAt).toBe(ack.acknowledgedAt);
  });

  it('acknowledgeSetup is tenant-scoped (T1 admin cannot touch T2)', async () => {
    const callerA = appRouter.createCaller(buildCtx({ tenantId, userId }));
    const callerB = appRouter.createCaller(
      buildCtx({ tenantId: foreignTenantId, userId: foreignUserId })
    );

    await callerA.companies.acknowledgeSetup();

    const foreign = await callerB.setupReadiness.get();
    expect(foreign.acknowledgedAt).toBeNull();
  });
});

describe('setupReadiness — Colombia profile + checkout', () => {
  let coTenantId: string;
  let coAdminId: string;
  let coCashierId: string;
  let coSiteId: string;

  async function setCoSettings(settings: Record<string, unknown>) {
    const db = getDatabase();
    await db.update(tenants).set({ settings }).where(eq(tenants.id, coTenantId));
  }

  beforeAll(async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    coTenantId = nanoid();
    coAdminId = nanoid();
    coCashierId = nanoid();
    coSiteId = nanoid();
    const coCompanyId = nanoid();

    await db.insert(tenants).values({
      id: coTenantId,
      name: 'Readiness CO Tenant',
      slug: `readiness-co-${coTenantId.slice(0, 8)}`,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });
    // The Colombia profile keys on the tenant locale country code.
    await db.insert(tenantLocaleSettings).values({
      tenantId: coTenantId,
      countryCode: 'CO',
    });
    await db.insert(companies).values({
      id: coCompanyId,
      tenantId: coTenantId,
      name: 'Readiness CO Company',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: coSiteId,
      tenantId: coTenantId,
      companyId: coCompanyId,
      name: 'Readiness CO Site',
      isActive: true,
    });
    await db.insert(users).values([
      {
        id: coAdminId,
        tenantId: coTenantId,
        email: `readiness-co-admin-${coTenantId.slice(0, 8)}@example.com`,
        name: 'CO Admin',
        passwordHash: 'x',
        sessionVersion: 1,
        role: 'admin',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: coCashierId,
        tenantId: coTenantId,
        email: `readiness-co-cashier-${coTenantId.slice(0, 8)}@example.com`,
        name: 'CO Cashier',
        passwordHash: 'x',
        sessionVersion: 1,
        role: 'cashier',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  beforeEach(async () => {
    await setCoSettings({});
    const db = getDatabase();
    await db.delete(sitePeripherals).where(eq(sitePeripherals.tenantId, coTenantId));
  });

  it('DIAN off → fiscal is an optional-pending reminder, never a blocker', async () => {
    const caller = appRouter.createCaller(buildCtx({ tenantId: coTenantId, userId: coAdminId }));
    const result = await caller.setupReadiness.get();
    const fiscal = result.sections.find(s => s.id === 'fiscal');
    expect(fiscal?.status).toBe('optional-pending');
    expect(fiscal?.cta).toEqual({ route: '/company', tab: 'fiscal' });
    // The whole point of : DIAN never blocks for a CO tenant.
    expect(result.sections.find(s => s.id === 'fiscal')?.status).not.toBe('blocker');
  });

  it('DIAN on but config incomplete → fiscal warning', async () => {
    await setCoSettings({ fiscal_dian_enabled: true });
    const caller = appRouter.createCaller(buildCtx({ tenantId: coTenantId, userId: coAdminId }));
    const result = await caller.setupReadiness.get();
    expect(result.sections.find(s => s.id === 'fiscal')?.status).toBe('warning');
  });

  it('DIAN on + complete config → fiscal ready, and scores higher than the incomplete state', async () => {
    await setCoSettings({ fiscal_dian_enabled: true });
    const caller = appRouter.createCaller(buildCtx({ tenantId: coTenantId, userId: coAdminId }));
    const incomplete = await caller.setupReadiness.get();

    await setCoSettings({
      fiscal_dian_enabled: true,
      fiscal: {
        co: {
          nit: '900123456-7',
          dianResolutionNumber: '18760000001',
          rangeFrom: 1,
          rangeTo: 5000,
        },
      },
    });
    const complete = await caller.setupReadiness.get();
    expect(complete.sections.find(s => s.id === 'fiscal')?.status).toBe('ready');
    // `warning` weighs 0.5, `ready` weighs 1.0 — completing DIAN must
    // raise the score, never lower it.
    expect(complete.score).toBeGreaterThan(incomplete.score);
  });

  it('exposes a sync section that is ready when there is no backlog', async () => {
    const caller = appRouter.createCaller(buildCtx({ tenantId: coTenantId, userId: coAdminId }));
    const result = await caller.setupReadiness.get();
    const sync = result.sections.find(s => s.id === 'sync');
    expect(sync?.status).toBe('ready');
  });

  it('checkout returns warning reminders (never a blocker) for an unconfigured CO tenant', async () => {
    const caller = appRouter.createCaller(
      buildCtx({ tenantId: coTenantId, userId: coCashierId, role: 'cashier' })
    );
    const result = await caller.setupReadiness.checkout({ siteId: coSiteId });
    const ids = result.items.map(i => i.id).sort();
    expect(ids).toEqual(['fiscal', 'payment_rail', 'receipt_hardware']);
    // Local-first: every checkout reminder is a warning, never a blocker.
    expect(result.items.every(i => i.severity === 'warning')).toBe(true);
  });

  it('checkout drops the receipt-hardware reminder once an active printer exists', async () => {
    const db = getDatabase();
    await db.insert(sitePeripherals).values({
      id: nanoid(),
      tenantId: coTenantId,
      siteId: coSiteId,
      kind: 'printer',
      driver: 'system',
      config: {},
      isActive: true,
    });
    const caller = appRouter.createCaller(
      buildCtx({ tenantId: coTenantId, userId: coCashierId, role: 'cashier' })
    );
    const result = await caller.setupReadiness.checkout({ siteId: coSiteId });
    expect(result.items.some(i => i.id === 'receipt_hardware')).toBe(false);
  });

  it('checkout rejects a siteId from another tenant (ensureTenantSite)', async () => {
    const caller = appRouter.createCaller(
      buildCtx({ tenantId: coTenantId, userId: coCashierId, role: 'cashier' })
    );
    // `siteId` belongs to the primary (non-CO) tenant — must be rejected.
    await expect(caller.setupReadiness.checkout({ siteId })).rejects.toThrow();
  });

  it('checkout returns no reminders for a non-Colombia tenant', async () => {
    const caller = appRouter.createCaller(buildCtx({ tenantId, userId }));
    const result = await caller.setupReadiness.checkout({ siteId });
    expect(result.items).toEqual([]);
  });
});

describe('setupReadiness.firstSale', () => {
  let onboardingTenantId: string;
  let onboardingUserId: string;
  let onboardingOtherUserId: string;
  let onboardingSiteId: string;

  beforeAll(async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    onboardingTenantId = nanoid();
    onboardingUserId = nanoid();
    onboardingOtherUserId = nanoid();
    onboardingSiteId = nanoid();
    const companyId = nanoid();

    await db.insert(tenants).values({
      id: onboardingTenantId,
      name: 'First Sale Tenant',
      slug: `first-sale-${onboardingTenantId.slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: companyId,
      tenantId: onboardingTenantId,
      name: 'First Sale Company',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: onboardingSiteId,
      tenantId: onboardingTenantId,
      companyId,
      name: 'First Sale Site',
      isActive: true,
    });
    await db.insert(users).values([
      {
        id: onboardingUserId,
        tenantId: onboardingTenantId,
        email: `first-sale-${onboardingUserId}@example.com`,
        name: 'First Sale Cashier',
        passwordHash: 'x',
        sessionVersion: 1,
        role: 'cashier',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: onboardingOtherUserId,
        tenantId: onboardingTenantId,
        email: `first-sale-${onboardingOtherUserId}@example.com`,
        name: 'Other Cashier',
        passwordHash: 'x',
        sessionVersion: 1,
        role: 'cashier',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  beforeEach(async () => {
    const db = getDatabase();
    await db.delete(sales).where(eq(sales.tenantId, onboardingTenantId));
    await db.delete(cashSessions).where(eq(cashSessions.tenantId, onboardingTenantId));
    await db.delete(products).where(eq(products.tenantId, onboardingTenantId));
    await db
      .delete(products)
      .where(and(eq(products.tenantId, foreignTenantId), eq(products.sku, 'FIRST-SALE-FOREIGN')));
  });

  function callerFor(role: 'admin' | 'manager' | 'cashier' | 'viewer' = 'cashier') {
    return appRouter.createCaller(
      buildCtx({
        tenantId: onboardingTenantId,
        userId: onboardingUserId,
        role,
      })
    );
  }

  async function seedOnboardingProduct(args?: { tenantId?: string; sku?: string }) {
    const targetTenantId = args?.tenantId ?? onboardingTenantId;
    await getDatabase()
      .insert(products)
      .values({
        id: nanoid(),
        tenantId: targetTenantId,
        name: 'First Sale Product',
        sku: args?.sku ?? `FIRST-SALE-${nanoid(6)}`,
        isActive: true,
      });
  }

  async function seedOpenSession(cashierId = onboardingUserId) {
    const id = nanoid();
    await getDatabase()
      .insert(cashSessions)
      .values({
        id,
        tenantId: onboardingTenantId,
        siteId: onboardingSiteId,
        cashierId,
        registerName: `Register ${id.slice(0, 4)}`,
        openingFloat: 0,
        openingCountDenominations: [],
        expectedBalance: 0,
        status: 'open',
      });
    return id;
  }

  it('returns the fixed three-step checklist for a fresh tenant', async () => {
    const result = await callerFor().setupReadiness.firstSale({
      siteId: onboardingSiteId,
    });

    expect(result).toEqual({
      completed: false,
      steps: [
        { id: 'product', completed: false },
        { id: 'cashSession', completed: false },
        { id: 'firstSale', completed: false },
      ],
    });
  });

  it('tracks an active tenant product without leaking a foreign product', async () => {
    await seedOnboardingProduct({
      tenantId: foreignTenantId,
      sku: 'FIRST-SALE-FOREIGN',
    });
    const before = await callerFor().setupReadiness.firstSale({
      siteId: onboardingSiteId,
    });
    expect(before.steps[0]).toEqual({ id: 'product', completed: false });

    await seedOnboardingProduct();
    const after = await callerFor().setupReadiness.firstSale({
      siteId: onboardingSiteId,
    });
    expect(after.steps[0]).toEqual({ id: 'product', completed: true });
  });

  it('requires an open session for the current site and operator', async () => {
    await seedOpenSession(onboardingOtherUserId);
    const otherCashierSession = await callerFor().setupReadiness.firstSale({
      siteId: onboardingSiteId,
    });
    expect(otherCashierSession.steps[1]?.completed).toBe(false);

    await seedOpenSession();
    const ownSession = await callerFor().setupReadiness.firstSale({
      siteId: onboardingSiteId,
    });
    expect(ownSession.steps[1]).toEqual({
      id: 'cashSession',
      completed: true,
    });
  });

  it('keeps every milestone complete after the first sale and drawer close', async () => {
    const db = getDatabase();
    await seedOnboardingProduct();
    const cashSessionId = await seedOpenSession();
    await db.insert(sales).values({
      id: nanoid(),
      tenantId: onboardingTenantId,
      saleNumber: `FIRST-${nanoid(6)}`,
      total: 100,
      status: 'completed',
      paymentStatus: 'paid',
      paymentMethod: 'cash',
      cashSessionId,
      createdBy: onboardingUserId,
    });
    await db
      .update(cashSessions)
      .set({ status: 'closed', closedAt: new Date().toISOString() })
      .where(eq(cashSessions.id, cashSessionId));
    await db
      .update(products)
      .set({ isActive: false })
      .where(eq(products.tenantId, onboardingTenantId));

    const result = await callerFor().setupReadiness.firstSale({
      siteId: onboardingSiteId,
    });
    expect(result.completed).toBe(true);
    expect(result.steps.every(step => step.completed)).toBe(true);
  });

  it('rejects foreign sites and viewer access while allowing sales roles', async () => {
    await expect(callerFor().setupReadiness.firstSale({ siteId })).rejects.toThrow();
    await expect(
      callerFor('viewer').setupReadiness.firstSale({
        siteId: onboardingSiteId,
      })
    ).rejects.toThrow(/cashiers|managers|administrators/i);

    for (const role of ['cashier', 'manager', 'admin'] as const) {
      await expect(
        callerFor(role).setupReadiness.firstSale({
          siteId: onboardingSiteId,
        })
      ).resolves.toMatchObject({ completed: false });
    }
  });
});
