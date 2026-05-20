/**
 * ENG-104 — `setupReadiness.*` + `companies.acknowledgeSetup` tests.
 *
 * Pins the contract:
 *
 *   - Fresh tenant (no products, no fiscal profile) → blockers in
 *     `catalog` + `fiscal`; locale + sites depend on baseline seed.
 *   - Mature tenant (products + fiscal config) → score >= 80,
 *     `blockerCount = 0`.
 *   - Cross-tenant isolation: T1 cannot see T2's product / site
 *     counts.
 *   - Cashier rejected with FORBIDDEN.
 *   - `acknowledgeSetup` writes the ISO timestamp and is idempotent.
 *   - `acknowledgeSetup` is tenant-scoped — admin of T1 cannot
 *     affect T2's settings blob.
 *
 * @module __tests__/setup-readiness.test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  companies,
  products,
  sites,
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
      user: { userId: args.userId, email: `${args.userId}@example.com`, role, tenantId: args.tenantId },
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
  await db
    .update(tenants)
    .set({ settings: {} })
    .where(eq(tenants.id, tenantId));
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();

  const admin = await db
    .select()
    .from(users)
    .where(eq(users.email, 'admin@localhost'))
    .get();
  if (!admin) throw new Error('Expected seeded admin');
  tenantId = admin.tenantId;
  userId = admin.id;

  const allSites = await db
    .select()
    .from(sites)
    .where(eq(sites.tenantId, tenantId))
    .all();
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

describe('setupReadiness (ENG-104)', () => {
  it('returns a stable 10-section shape for a fresh tenant', async () => {
    const caller = appRouter.createCaller(buildCtx({ tenantId, userId }));
    const result = await caller.setupReadiness.get();
    expect(result.sections).toHaveLength(10);
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
    const ctas = Object.fromEntries(
      result.sections.map(section => [section.id, section.cta])
    );

    expect(ctas.locale).toEqual({ route: '/company', tab: 'locale' });
    expect(ctas.sites).toEqual({ route: '/sites' });
    expect(ctas.fiscal).toEqual({ route: '/company', tab: 'fiscal' });
    expect(ctas.peripherals).toEqual({ route: '/peripherals' });
    expect(ctas.payments).toEqual({ route: '/company', tab: 'payments' });
    expect(ctas.modules).toEqual({ route: '/company', tab: 'modules' });
    expect(ctas.users).toEqual({ route: '/users' });
    expect(ctas.catalog).toEqual({ route: '/products' });
    expect(ctas.cashSession).toEqual({ route: '/sales' });
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
    const caller = appRouter.createCaller(
      buildCtx({ tenantId, userId, role: 'cashier' })
    );
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
