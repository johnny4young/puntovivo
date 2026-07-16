import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  companies,
  lossPreventionSettings,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import {
  checkoutDiscountPercent,
  evaluateCheckoutLossPrevention,
  isTimeInsideBlockedWindow,
  resolveLossPreventionSettings,
  writeLossPreventionSettings,
} from '../services/loss-prevention/index.js';
import type { Context } from '../trpc/context.js';
import { appRouter } from '../trpc/router.js';
import {
  createCriticalCommandFixture,
  type CriticalCommandFixture,
} from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;

interface Harness {
  tenantId: string;
  siteId: string;
  adminId: string;
  managerId: string;
  cashierId: string;
}

async function seedHarness(suffix: string): Promise<Harness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `loss-tenant-${suffix}`;
  const companyId = `loss-company-${suffix}`;
  const siteId = `loss-site-${suffix}`;
  const adminId = `loss-admin-${suffix}`;
  const managerId = `loss-manager-${suffix}`;
  const cashierId = `loss-cashier-${suffix}`;
  await db.insert(tenants).values({
    id: tenantId,
    name: `Loss tenant ${suffix}`,
    slug: `loss-${suffix}`,
    settings: { preserved: true },
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: `Loss company ${suffix}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values({
    id: siteId,
    tenantId,
    companyId,
    name: `Loss site ${suffix}`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: `admin-${suffix}@loss.test`,
      name: `Admin ${suffix}`,
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: managerId,
      tenantId,
      email: `manager-${suffix}@loss.test`,
      name: `Manager ${suffix}`,
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'manager',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: cashierId,
      tenantId,
      email: `cashier-${suffix}@loss.test`,
      name: `Cashier ${suffix}`,
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return { tenantId, siteId, adminId, managerId, cashierId };
}

function buildContext(harness: Harness, role: 'admin' | 'manager' | 'cashier'): Context {
  const userId =
    role === 'admin' ? harness.adminId : role === 'manager' ? harness.managerId : harness.cashierId;
  const req = {
    server: server.app,
    headers: {},
    user: { userId, email: `${role}@loss.test`, role, tenantId: harness.tenantId },
    jwtVerify: async () => {},
  } as unknown as Context['req'];
  return {
    req,
    res: {} as Context['res'],
    db: getDatabase(),
    user: {
      id: userId,
      email: `${role}@loss.test`,
      role,
      tenantId: harness.tenantId,
    },
    tenantId: harness.tenantId,
    siteId: harness.siteId,
  };
}

function criticalContext(
  harness: Harness,
  role: 'admin' | 'manager' | 'cashier'
): Promise<CriticalCommandFixture> {
  const context = buildContext(harness, role);
  return createCriticalCommandFixture({
    db: getDatabase(),
    serverApp: server.app,
    tenantId: harness.tenantId,
    userId: context.user!.id,
    email: context.user!.email,
    role,
    siteId: harness.siteId,
  });
}

const items = [
  {
    productId: 'product-1',
    unitId: 'unit-1',
    quantity: 2,
    unitPrice: 50,
    discount: 0,
  },
];

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  await server.close();
});

describe('ENG-142a loss-prevention policy', () => {
  it('uses boundary-safe aggregate discount math and overnight windows', () => {
    expect(checkoutDiscountPercent(items, 10)).toBe(10);
    expect(checkoutDiscountPercent(items, 10.001)).toBe(10.001);
    expect(checkoutDiscountPercent([{ quantity: 1, unitPrice: 100_000 }], 0.01)).toBeCloseTo(
      0.00001,
      10
    );
    expect(checkoutDiscountPercent([{ quantity: 3, unitPrice: 0.335 }], 0.1)).toBeCloseTo(
      9.900990099,
      9
    );
    expect(checkoutDiscountPercent([], 50)).toBe(0);
    expect(isTimeInsideBlockedWindow('22:00', '22:00', '06:00')).toBe(true);
    expect(isTimeInsideBlockedWindow('05:59', '22:00', '06:00')).toBe(true);
    expect(isTimeInsideBlockedWindow('06:00', '22:00', '06:00')).toBe(false);
    expect(isTimeInsideBlockedWindow('12:00', '09:00', '17:00')).toBe(true);
    expect(isTimeInsideBlockedWindow('17:00', '09:00', '17:00')).toBe(false);
  });

  it('preserves the pre-existing cashier discount gate in defaults', async () => {
    const harness = await seedHarness('defaults');
    const admin = appRouter.createCaller(buildContext(harness, 'admin'));
    await expect(admin.lossPrevention.getSettings()).resolves.toMatchObject({
      version: 1,
      roles: {
        cashier: { maxDiscountPercent: 0 },
        manager: { maxDiscountPercent: 100 },
      },
    });

    const cashier = appRouter.createCaller(buildContext(harness, 'cashier'));
    const evaluation = await cashier.lossPrevention.evaluateCheckout({
      items,
      discountAmount: 0.01,
    });
    expect(evaluation.requiredActions).toEqual(['sale_discount']);
    expect(evaluation.violations).toEqual([
      expect.objectContaining({
        kind: 'max_discount',
        observedPercent: 0.01,
        thresholdPercent: 0,
      }),
    ]);

    const tinyDiscount = await cashier.lossPrevention.evaluateCheckout({
      items: [{ ...items[0]!, quantity: 1, unitPrice: 100_000 }],
      discountAmount: 0.01,
    });
    expect(tinyDiscount.requiredActions).toEqual(['sale_discount']);
    expect(tinyDiscount.violations).toEqual([
      expect.objectContaining({
        kind: 'max_discount',
        observedPercent: 0.00001,
        thresholdPercent: 0,
      }),
    ]);

    await expect(
      cashier.lossPrevention.evaluateCheckout({
        items: Array.from({ length: 201 }, (_, index) => ({
          ...items[0]!,
          productId: `large-cart-product-${index}`,
        })),
        discountAmount: 0,
      })
    ).resolves.toMatchObject({ requiredActions: [] });
  });

  it('updates a complete policy atomically with its audit evidence', async () => {
    const harness = await seedHarness('update');
    const fixture = await criticalContext(harness, 'admin');
    const caller = appRouter.createCaller(fixture.context);
    const next = await caller.lossPrevention.updateSettings({
      roles: {
        cashier: {
          maxDiscountPercent: 7.5,
          afterHoursSale: {
            enabled: true,
            blockedFrom: '22:00',
            blockedUntil: '06:00',
          },
        },
        manager: {
          maxDiscountPercent: 25,
          afterHoursSale: {
            enabled: false,
            blockedFrom: '23:00',
            blockedUntil: '05:00',
          },
        },
      },
    });
    expect(next.roles.cashier.maxDiscountPercent).toBe(7.5);

    const tenant = getDatabase()
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, harness.tenantId))
      .get();
    expect((tenant?.settings as Record<string, unknown>).preserved).toBe(true);
    expect(resolveLossPreventionSettings(getDatabase(), harness.tenantId)).toEqual(next);
    expect(
      getDatabase()
        .select({ policy: lossPreventionSettings.policy })
        .from(lossPreventionSettings)
        .where(eq(lossPreventionSettings.tenantId, harness.tenantId))
        .get()?.policy
    ).toEqual(next);

    // A stale full-blob sibling writer can no longer erase the safety rail:
    // policy storage is isolated from legacy tenants.settings namespaces.
    const staleSiblingSnapshot = tenant?.settings ?? {};
    getDatabase()
      .update(tenants)
      .set({ settings: { ...staleSiblingSnapshot, ai: { enabled: true } } })
      .where(eq(tenants.id, harness.tenantId))
      .run();
    expect(resolveLossPreventionSettings(getDatabase(), harness.tenantId)).toEqual(next);
    expect(
      getDatabase()
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, harness.tenantId))
        .get()?.settings
    ).toMatchObject({ preserved: true, ai: { enabled: true } });

    const evidence = getDatabase()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, harness.tenantId))
      .all()
      .filter(row => row.action === 'loss_prevention.settings.updated');
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      actorId: harness.adminId,
      resourceType: 'loss_prevention_rule',
      resourceId: harness.tenantId,
      operationId: fixture.envelope.operationId,
    });
    expect(evidence[0]?.before).toMatchObject({
      roles: { cashier: { maxDiscountPercent: 0 } },
    });
    expect(evidence[0]?.after).toMatchObject({
      roles: { cashier: { maxDiscountPercent: 7.5 } },
    });
  });

  it('rejects invalid windows and non-admin settings access', async () => {
    const harness = await seedHarness('roles');
    const manager = appRouter.createCaller(buildContext(harness, 'manager'));
    await expect(manager.lossPrevention.getSettings()).rejects.toThrow(/administrators/i);

    const managerFixture = await criticalContext(harness, 'manager');
    await expect(
      appRouter.createCaller(managerFixture.context).lossPrevention.updateSettings({
        roles: {
          cashier: {
            maxDiscountPercent: 5,
            afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
          },
          manager: {
            maxDiscountPercent: 20,
            afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
          },
        },
      })
    ).rejects.toThrow(/administrators/i);

    const adminFixture = await criticalContext(harness, 'admin');
    await expect(
      appRouter.createCaller(adminFixture.context).lossPrevention.updateSettings({
        roles: {
          cashier: {
            maxDiscountPercent: 5,
            afterHoursSale: { enabled: true, blockedFrom: '22:00', blockedUntil: '22:00' },
          },
          manager: {
            maxDiscountPercent: 20,
            afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
          },
        },
      })
    ).rejects.toThrow(/distinct start and end times/i);
  });

  it('evaluates role thresholds, local blocked time, drafts, and admin bypass', async () => {
    const harness = await seedHarness('evaluate');
    writeLossPreventionSettings(getDatabase(), harness.tenantId, {
      version: 1,
      roles: {
        cashier: {
          maxDiscountPercent: 10,
          afterHoursSale: { enabled: true, blockedFrom: '22:00', blockedUntil: '06:00' },
        },
        manager: {
          maxDiscountPercent: 20,
          afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
        },
      },
    });

    const cashier = await evaluateCheckoutLossPrevention({
      db: getDatabase(),
      tenantId: harness.tenantId,
      role: 'cashier',
      isCompletion: true,
      items,
      discountAmount: 10.01,
      // Fallback tenant locale is America/New_York: 04:30Z = 00:30 EDT.
      nowIso: '2026-07-15T04:30:00.000Z',
    });
    expect(cashier.requiredActions).toEqual(['sale_discount', 'sale_after_hours']);

    const manager = await evaluateCheckoutLossPrevention({
      db: getDatabase(),
      tenantId: harness.tenantId,
      role: 'manager',
      isCompletion: true,
      items,
      discountAmount: 20,
      nowIso: '2026-07-15T04:30:00.000Z',
    });
    expect(manager.requiredActions).toEqual([]);

    const draft = await evaluateCheckoutLossPrevention({
      db: getDatabase(),
      tenantId: harness.tenantId,
      role: 'cashier',
      isCompletion: false,
      items,
      discountAmount: 99,
      nowIso: '2026-07-15T04:30:00.000Z',
    });
    expect(draft.requiredActions).toEqual([]);

    const admin = await evaluateCheckoutLossPrevention({
      db: getDatabase(),
      tenantId: harness.tenantId,
      role: 'admin',
      isCompletion: true,
      items,
      discountAmount: 99,
      nowIso: '2026-07-15T04:30:00.000Z',
    });
    expect(admin.policy).toBeNull();
    expect(admin.requiredActions).toEqual([]);
  });

  it('keeps settings isolated between tenants', async () => {
    const a = await seedHarness('iso-a');
    const b = await seedHarness('iso-b');
    writeLossPreventionSettings(getDatabase(), a.tenantId, {
      version: 1,
      roles: {
        cashier: {
          maxDiscountPercent: 12,
          afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
        },
        manager: {
          maxDiscountPercent: 30,
          afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
        },
      },
    });
    expect(
      resolveLossPreventionSettings(getDatabase(), a.tenantId).roles.cashier.maxDiscountPercent
    ).toBe(12);
    expect(
      resolveLossPreventionSettings(getDatabase(), b.tenantId).roles.cashier.maxDiscountPercent
    ).toBe(0);
  });
});
