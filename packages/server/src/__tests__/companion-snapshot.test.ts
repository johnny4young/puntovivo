import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { sales, tenantLocaleSettings, tenants, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { seedCommittedSaleSession } from './utils/cashSessionFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let adminId: string;
let viewerId: string;
let cashierId: string;

function context(userId: string, role: 'admin' | 'manager' | 'cashier' | 'viewer'): Context {
  const user = { id: userId, email: `${userId}@example.com`, role, tenantId };
  return {
    req: {
      server: server.app,
      headers: {},
      user: { userId, email: user.email, role, tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db: getDatabase(),
    user,
    tenantId,
    siteId: null,
  };
}

async function insertSale(input: {
  id: string;
  tenantId: string;
  userId: string;
  cashSessionId: string;
  saleNumber: string;
  total: number;
  completedAt: string;
  paymentStatus?: 'paid' | 'refunded';
  returnState?: 'partially_refunded' | 'refunded';
}) {
  await getDatabase()
    .insert(sales)
    .values({
      id: input.id,
      tenantId: input.tenantId,
      saleNumber: input.saleNumber,
      subtotal: input.total,
      taxAmount: 0,
      discountAmount: 0,
      total: input.total,
      paymentMethod: 'cash',
      paymentStatus: input.paymentStatus ?? 'paid',
      returnState: input.returnState ?? null,
      status: 'completed',
      cashSessionId: input.cashSessionId,
      createdBy: input.userId,
      checkoutCompletedAt: input.completedAt,
      createdAt: input.completedAt,
      updatedAt: input.completedAt,
    });
}

describe('companion.snapshot', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin user');
    tenantId = admin.tenantId;
    adminId = admin.id;
    viewerId = 'companion-viewer';
    cashierId = 'companion-cashier';

    await db
      .update(tenants)
      .set({ settings: { modules: { companion: true } } })
      .where(eq(tenants.id, tenantId));
    await db
      .insert(tenantLocaleSettings)
      .values({
        tenantId,
        countryCode: 'CO',
        timezoneOverride: 'America/Bogota',
      })
      .onConflictDoUpdate({
        target: tenantLocaleSettings.tenantId,
        set: { timezoneOverride: 'America/Bogota' },
      });
    await db.insert(users).values([
      {
        id: viewerId,
        tenantId,
        email: 'companion-viewer@example.com',
        name: 'Companion Viewer',
        passwordHash: admin.passwordHash,
        role: 'viewer',
      },
      {
        id: cashierId,
        tenantId,
        email: 'companion-cashier@example.com',
        name: 'Companion Cashier',
        passwordHash: admin.passwordHash,
        role: 'cashier',
      },
    ]);

    const sessionId = await seedCommittedSaleSession({ tenantId, cashierId: adminId });
    for (let index = 0; index < 14; index += 1) {
      await insertSale({
        id: `companion-sale-${index}`,
        tenantId,
        userId: adminId,
        cashSessionId: sessionId,
        saleNumber: `CMP-${String(index).padStart(3, '0')}`,
        total: index + 1,
        completedAt: `2026-08-28T${String(6 + index).padStart(2, '0')}:00:00.000Z`,
      });
    }
    await insertSale({
      id: 'companion-prior-day',
      tenantId,
      userId: adminId,
      cashSessionId: sessionId,
      saleNumber: 'CMP-PRIOR',
      total: 1_000,
      completedAt: '2026-08-28T04:59:59.999Z',
    });
    await insertSale({
      id: 'companion-refunded',
      tenantId,
      userId: adminId,
      cashSessionId: sessionId,
      saleNumber: 'CMP-REFUND',
      total: 2_000,
      completedAt: '2026-08-28T15:30:00.000Z',
      returnState: 'refunded',
    });

    const foreignTenantId = 'companion-foreign-tenant';
    const foreignUserId = 'companion-foreign-user';
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign Companion',
      slug: 'foreign-companion',
      settings: { modules: { companion: true } },
      defaultCurrencyCode: 'COP',
    });
    await db.insert(tenantLocaleSettings).values({
      tenantId: foreignTenantId,
      countryCode: 'CO',
      timezoneOverride: 'America/Bogota',
    });
    await db.insert(users).values({
      id: foreignUserId,
      tenantId: foreignTenantId,
      email: 'foreign-companion@example.com',
      name: 'Foreign Companion',
      passwordHash: admin.passwordHash,
      role: 'admin',
    });
    const foreignSession = await seedCommittedSaleSession({
      tenantId: foreignTenantId,
      cashierId: foreignUserId,
    });
    await insertSale({
      id: 'companion-foreign-sale',
      tenantId: foreignTenantId,
      userId: foreignUserId,
      cashSessionId: foreignSession,
      saleNumber: 'FOREIGN-001',
      total: 9_999,
      completedAt: '2026-08-28T15:00:00.000Z',
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('grants the minimal read model to viewer and admin but not cashier', async () => {
    const viewer = await appRouter
      .createCaller(context(viewerId, 'viewer'))
      .companion.snapshot({ date: '2026-08-28' });
    const admin = await appRouter
      .createCaller(context(adminId, 'admin'))
      .companion.snapshot({ date: '2026-08-28' });

    expect(viewer.stats).toEqual({ revenue: 105, orders: 14 });
    expect(admin.stats).toEqual(viewer.stats);
    expect(viewer.recentSales).toHaveLength(12);
    expect(viewer.recentSales[0]?.saleNumber).toBe('CMP-013');
    expect(JSON.stringify(viewer)).not.toContain('Companion Viewer');
    expect(JSON.stringify(viewer)).not.toContain('FOREIGN-001');
    expect(JSON.stringify(viewer)).not.toContain('9999');

    await expect(
      appRouter
        .createCaller(context(cashierId, 'cashier'))
        .companion.snapshot({ date: '2026-08-28' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('uses the tenant calendar boundary and excludes refunded sales', async () => {
    const snapshot = await appRouter
      .createCaller(context(viewerId, 'viewer'))
      .companion.snapshot({ date: '2026-08-27' });
    expect(snapshot.stats).toEqual({ revenue: 1_000, orders: 1 });
    expect(snapshot.recentSales.map(sale => sale.saleNumber)).toEqual(['CMP-PRIOR']);
  });

  it('fails closed when the opt-in Companion module is disabled', async () => {
    const db = getDatabase();
    await db
      .update(tenants)
      .set({ settings: { modules: { companion: false } } })
      .where(eq(tenants.id, tenantId));
    await expect(
      appRouter.createCaller(context(viewerId, 'viewer')).companion.snapshot({ date: '2026-08-28' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await db
      .update(tenants)
      .set({ settings: { modules: { companion: true } } })
      .where(eq(tenants.id, tenantId));
  });
});
