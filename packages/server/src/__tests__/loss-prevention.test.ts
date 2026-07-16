import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  cashSessions,
  companies,
  lossPreventionSettings,
  sales,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import {
  checkoutDiscountPercent,
  claimShiftLossPreventionApproval,
  evaluateCheckoutLossPrevention,
  evaluateShiftLossPrevention,
  isTimeInsideBlockedWindow,
  normalizeLossPreventionSettings,
  recordShiftLossPreventionTrigger,
  requiredLossPreventionApprovalCount,
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

function disabledShiftPolicies() {
  return {
    refunds: { enabled: false, maxCount: 0, maxAmount: 0 },
    voids: { enabled: false, maxCount: 0, maxAmount: 0 },
    noSale: { enabled: false, maxCount: 0 },
  };
}

function disabledAlertSettings() {
  return { whatsappHandoff: { enabled: false, recipientPhone: '' } };
}

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
      version: 4,
      alerts: disabledAlertSettings(),
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
      alerts: { whatsappHandoff: { enabled: true, recipientPhone: '+57 300 123 4567' } },
      roles: {
        cashier: {
          maxDiscountPercent: 7.5,
          afterHoursSale: {
            enabled: true,
            blockedFrom: '22:00',
            blockedUntil: '06:00',
          },
          shift: disabledShiftPolicies(),
          dualApproval: { enabled: false, thresholdAmount: 0 },
        },
        manager: {
          maxDiscountPercent: 25,
          afterHoursSale: {
            enabled: false,
            blockedFrom: '23:00',
            blockedUntil: '05:00',
          },
          shift: disabledShiftPolicies(),
          dualApproval: { enabled: false, thresholdAmount: 0 },
        },
      },
    });
    expect(next.roles.cashier.maxDiscountPercent).toBe(7.5);
    expect(next.alerts.whatsappHandoff).toEqual({
      enabled: true,
      recipientPhone: '573001234567',
    });

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

  it('preserves v4 alert delivery when a v3 renderer updates role limits', async () => {
    const harness = await seedHarness('rolling-upgrade');
    const roles = {
      cashier: {
        maxDiscountPercent: 5,
        afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
        shift: disabledShiftPolicies(),
        dualApproval: { enabled: false, thresholdAmount: 0 },
      },
      manager: {
        maxDiscountPercent: 20,
        afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
        shift: disabledShiftPolicies(),
        dualApproval: { enabled: false, thresholdAmount: 0 },
      },
    };

    const configureFixture = await criticalContext(harness, 'admin');
    const configured = await appRouter
      .createCaller(configureFixture.context)
      .lossPrevention.updateSettings({
        roles,
        alerts: {
          whatsappHandoff: { enabled: true, recipientPhone: '+57 300 123 4567' },
        },
      });
    expect(configured.alerts.whatsappHandoff).toEqual({
      enabled: true,
      recipientPhone: '573001234567',
    });

    const legacyFixture = await criticalContext(harness, 'admin');
    const updated = await appRouter
      .createCaller(legacyFixture.context)
      .lossPrevention.updateSettings({
        roles: {
          ...roles,
          cashier: { ...roles.cashier, maxDiscountPercent: 8.5 },
        },
      });
    expect(updated).toMatchObject({
      version: 4,
      roles: { cashier: { maxDiscountPercent: 8.5 } },
      alerts: {
        whatsappHandoff: { enabled: true, recipientPhone: '573001234567' },
      },
    });
  });

  it('rejects invalid windows and non-admin settings access', async () => {
    const harness = await seedHarness('roles');
    const manager = appRouter.createCaller(buildContext(harness, 'manager'));
    await expect(manager.lossPrevention.getSettings()).rejects.toThrow(/administrators/i);

    const managerFixture = await criticalContext(harness, 'manager');
    await expect(
      appRouter.createCaller(managerFixture.context).lossPrevention.updateSettings({
        alerts: disabledAlertSettings(),
        roles: {
          cashier: {
            maxDiscountPercent: 5,
            afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
            shift: disabledShiftPolicies(),
            dualApproval: { enabled: false, thresholdAmount: 0 },
          },
          manager: {
            maxDiscountPercent: 20,
            afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
            shift: disabledShiftPolicies(),
            dualApproval: { enabled: false, thresholdAmount: 0 },
          },
        },
      })
    ).rejects.toThrow(/administrators/i);

    const adminFixture = await criticalContext(harness, 'admin');
    await expect(
      appRouter.createCaller(adminFixture.context).lossPrevention.updateSettings({
        alerts: disabledAlertSettings(),
        roles: {
          cashier: {
            maxDiscountPercent: 5,
            afterHoursSale: { enabled: true, blockedFrom: '22:00', blockedUntil: '22:00' },
            shift: disabledShiftPolicies(),
            dualApproval: { enabled: false, thresholdAmount: 0 },
          },
          manager: {
            maxDiscountPercent: 20,
            afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
            shift: disabledShiftPolicies(),
            dualApproval: { enabled: false, thresholdAmount: 0 },
          },
        },
      })
    ).rejects.toThrow(/distinct start and end times/i);

    const invalidPhoneFixture = await criticalContext(harness, 'admin');
    await expect(
      appRouter.createCaller(invalidPhoneFixture.context).lossPrevention.updateSettings({
        alerts: { whatsappHandoff: { enabled: true, recipientPhone: '5-------' } },
        roles: {
          cashier: {
            maxDiscountPercent: 5,
            afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
            shift: disabledShiftPolicies(),
            dualApproval: { enabled: false, thresholdAmount: 0 },
          },
          manager: {
            maxDiscountPercent: 20,
            afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
            shift: disabledShiftPolicies(),
            dualApproval: { enabled: false, thresholdAmount: 0 },
          },
        },
      })
    ).rejects.toThrow(/valid international WhatsApp number/i);
  });

  it('evaluates role thresholds, local blocked time, drafts, and admin bypass', async () => {
    const harness = await seedHarness('evaluate');
    writeLossPreventionSettings(getDatabase(), harness.tenantId, {
      version: 4,
      alerts: disabledAlertSettings(),
      roles: {
        cashier: {
          maxDiscountPercent: 10,
          afterHoursSale: { enabled: true, blockedFrom: '22:00', blockedUntil: '06:00' },
          shift: disabledShiftPolicies(),
          dualApproval: { enabled: false, thresholdAmount: 0 },
        },
        manager: {
          maxDiscountPercent: 20,
          afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
          shift: disabledShiftPolicies(),
          dualApproval: { enabled: false, thresholdAmount: 0 },
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

  it('requires dual approval only above the configured monetary threshold', async () => {
    const harness = await seedHarness('dual-boundary');
    writeLossPreventionSettings(getDatabase(), harness.tenantId, {
      version: 4,
      alerts: disabledAlertSettings(),
      roles: {
        cashier: {
          maxDiscountPercent: 100,
          afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
          shift: disabledShiftPolicies(),
          dualApproval: { enabled: true, thresholdAmount: 125 },
        },
        manager: {
          maxDiscountPercent: 100,
          afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
          shift: disabledShiftPolicies(),
          dualApproval: { enabled: false, thresholdAmount: 0 },
        },
      },
    });

    const required = (action: string, amount: number, role = 'cashier') =>
      requiredLossPreventionApprovalCount({
        db: getDatabase(),
        tenantId: harness.tenantId,
        role,
        action,
        amount,
      });

    expect(required('sale_refund', 125)).toBe(1);
    expect(required('sale_refund', 125.01)).toBe(2);
    expect(required('cash_drawer_open', 500)).toBe(1);
    expect(required('sale_refund', 500, 'admin')).toBe(1);

    const checkoutAtThreshold = await evaluateCheckoutLossPrevention({
      db: getDatabase(),
      tenantId: harness.tenantId,
      role: 'cashier',
      isCompletion: true,
      items: [{ ...items[0]!, quantity: 1, unitPrice: 1000 }],
      discountAmount: 125,
    });
    expect(checkoutAtThreshold.requiredActions).toEqual([]);

    const checkoutAboveThreshold = await evaluateCheckoutLossPrevention({
      db: getDatabase(),
      tenantId: harness.tenantId,
      role: 'cashier',
      isCompletion: true,
      items: [{ ...items[0]!, quantity: 1, unitPrice: 1000 }],
      discountAmount: 125.01,
    });
    expect(checkoutAboveThreshold).toMatchObject({
      requiredActions: ['sale_discount'],
      violations: [
        {
          kind: 'dual_approval_threshold',
          action: 'sale_discount',
          observedAmount: 125.01,
          thresholdAmount: 125,
        },
      ],
    });

    const refundAtThreshold = evaluateShiftLossPrevention({
      db: getDatabase(),
      tenantId: harness.tenantId,
      siteId: harness.siteId,
      actorId: harness.cashierId,
      role: 'cashier',
      action: 'sale_refund',
      amount: 125,
    });
    expect(refundAtThreshold).toMatchObject({ requiresApproval: false, violations: [] });

    const refundAboveThreshold = evaluateShiftLossPrevention({
      db: getDatabase(),
      tenantId: harness.tenantId,
      siteId: harness.siteId,
      actorId: harness.cashierId,
      role: 'cashier',
      action: 'sale_refund',
      amount: 125.01,
    });
    expect(refundAboveThreshold).toMatchObject({
      requiresApproval: true,
      violations: [
        {
          kind: 'dual_approval_threshold',
          action: 'sale_refund',
          reason: 'dual_approval_threshold',
          observedAmount: 125.01,
          thresholdAmount: 125,
        },
      ],
    });

    const noSale = evaluateShiftLossPrevention({
      db: getDatabase(),
      tenantId: harness.tenantId,
      siteId: harness.siteId,
      actorId: harness.cashierId,
      role: 'cashier',
      action: 'cash_drawer_open',
      amount: 500,
    });
    expect(noSale).toMatchObject({ policyEnabled: false, requiresApproval: false, violations: [] });
  });

  it('keeps settings isolated between tenants', async () => {
    const a = await seedHarness('iso-a');
    const b = await seedHarness('iso-b');
    writeLossPreventionSettings(getDatabase(), a.tenantId, {
      version: 4,
      alerts: disabledAlertSettings(),
      roles: {
        cashier: {
          maxDiscountPercent: 12,
          afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
          shift: disabledShiftPolicies(),
          dualApproval: { enabled: false, thresholdAmount: 0 },
        },
        manager: {
          maxDiscountPercent: 30,
          afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
          shift: disabledShiftPolicies(),
          dualApproval: { enabled: false, thresholdAmount: 0 },
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

  it('upgrades older policy rows with disabled shift controls', () => {
    const normalized = normalizeLossPreventionSettings({
      version: 1,
      roles: {
        cashier: {
          maxDiscountPercent: 3,
          afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
        },
        manager: {
          maxDiscountPercent: 30,
          afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
        },
      },
    });
    expect(normalized).toMatchObject({
      version: 4,
      alerts: disabledAlertSettings(),
      roles: {
        cashier: { maxDiscountPercent: 3, shift: disabledShiftPolicies() },
        manager: { maxDiscountPercent: 30, shift: disabledShiftPolicies() },
      },
    });
  });

  it('normalizes the optional WhatsApp handoff without weakening in-app alerts', () => {
    expect(
      normalizeLossPreventionSettings({
        alerts: {
          whatsappHandoff: { enabled: true, recipientPhone: '+57 (300) 123-4567' },
        },
      }).alerts.whatsappHandoff
    ).toEqual({ enabled: true, recipientPhone: '573001234567' });
    expect(
      normalizeLossPreventionSettings({
        alerts: { whatsappHandoff: { enabled: true, recipientPhone: 'invalid' } },
      }).alerts.whatsappHandoff
    ).toEqual({ enabled: false, recipientPhone: '' });
  });

  it('normalizes shift amount caps with the shared monetary rounding contract', () => {
    const normalized = normalizeLossPreventionSettings({
      roles: {
        cashier: {
          shift: {
            refunds: { enabled: true, maxCount: 1, maxAmount: 1.005 },
          },
        },
      },
    });

    expect(normalized.roles.cashier.shift.refunds.maxAmount).toBe(1.01);
  });

  it('counts completed actor actions only inside the active cash shift', async () => {
    const harness = await seedHarness('shift-usage');
    const openedAt = '2026-07-16T01:00:00.000Z';
    getDatabase()
      .insert(cashSessions)
      .values({
        id: 'loss-session-shift-usage',
        tenantId: harness.tenantId,
        siteId: harness.siteId,
        cashierId: harness.managerId,
        registerName: 'Manager register',
        openingFloat: 0,
        openingCountDenominations: [],
        expectedBalance: 0,
        status: 'open',
        openedAt,
        createdAt: openedAt,
        updatedAt: openedAt,
      })
      .run();
    writeLossPreventionSettings(getDatabase(), harness.tenantId, {
      version: 4,
      alerts: disabledAlertSettings(),
      roles: {
        cashier: {
          maxDiscountPercent: 0,
          afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
          shift: disabledShiftPolicies(),
          dualApproval: { enabled: false, thresholdAmount: 0 },
        },
        manager: {
          maxDiscountPercent: 100,
          afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
          shift: {
            refunds: { enabled: true, maxCount: 2, maxAmount: 100 },
            voids: { enabled: true, maxCount: 1, maxAmount: 75 },
            noSale: { enabled: true, maxCount: 1 },
          },
          dualApproval: { enabled: false, thresholdAmount: 0 },
        },
      },
    });
    getDatabase()
      .insert(auditLogs)
      .values([
        {
          id: 'loss-refund-current',
          tenantId: harness.tenantId,
          actorId: harness.managerId,
          action: 'sale.return',
          resourceType: 'sale',
          resourceId: 'sale-current',
          before: null,
          after: { refundAmount: 40 },
          createdAt: '2026-07-16T01:30:00.000Z',
        },
        {
          id: 'loss-refund-prior-shift',
          tenantId: harness.tenantId,
          actorId: harness.managerId,
          action: 'sale.return',
          resourceType: 'sale',
          resourceId: 'sale-prior',
          before: null,
          after: { refundAmount: 999 },
          createdAt: '2026-07-16T00:59:59.000Z',
        },
        {
          id: 'loss-refund-other-actor',
          tenantId: harness.tenantId,
          actorId: harness.cashierId,
          action: 'sale.return',
          resourceType: 'sale',
          resourceId: 'sale-other-actor',
          before: null,
          after: { refundAmount: 999 },
          createdAt: '2026-07-16T01:45:00.000Z',
        },
        {
          id: 'loss-refund-other-shift',
          tenantId: harness.tenantId,
          actorId: harness.managerId,
          action: 'sale.return',
          resourceType: 'sale',
          resourceId: 'sale-other-shift',
          before: null,
          after: { refundAmount: 999 },
          metadata: { lossPreventionCashSessionId: 'another-site-session' },
          createdAt: '2026-07-16T01:47:00.000Z',
        },
        {
          id: 'loss-void-current',
          tenantId: harness.tenantId,
          actorId: harness.managerId,
          action: 'sale.void',
          resourceType: 'sale',
          resourceId: 'void-current',
          before: { total: 40 },
          after: null,
          metadata: { lossPreventionCashSessionId: 'loss-session-shift-usage' },
          createdAt: '2026-07-16T01:48:00.000Z',
        },
        {
          id: 'loss-no-sale-current',
          tenantId: harness.tenantId,
          actorId: harness.managerId,
          action: 'cash_drawer.open',
          resourceType: 'site',
          resourceId: harness.siteId,
          before: null,
          after: { dispatchMode: 'server' },
          createdAt: '2026-07-16T01:50:00.000Z',
        },
      ])
      .run();

    const allowedRefund = await evaluateShiftLossPrevention({
      db: getDatabase(),
      tenantId: harness.tenantId,
      siteId: harness.siteId,
      actorId: harness.managerId,
      role: 'manager',
      action: 'sale_refund',
      amount: 50,
    });
    expect(allowedRefund).toMatchObject({
      cashSessionId: 'loss-session-shift-usage',
      requiresApproval: false,
    });

    const blockedRefund = await evaluateShiftLossPrevention({
      db: getDatabase(),
      tenantId: harness.tenantId,
      siteId: harness.siteId,
      actorId: harness.managerId,
      role: 'manager',
      action: 'sale_refund',
      amount: 61,
    });
    expect(blockedRefund).toMatchObject({
      requiresApproval: true,
      violation: {
        kind: 'shift_refund_limit',
        reason: 'limit_exceeded',
        exceeded: ['amount'],
        currentCount: 1,
        prospectiveCount: 2,
        currentAmount: 40,
        prospectiveAmount: 101,
        maxCount: 2,
        maxAmount: 100,
      },
    });
    expect(() =>
      claimShiftLossPreventionApproval({
        db: getDatabase(),
        tenantId: harness.tenantId,
        siteId: harness.siteId,
        requesterId: harness.managerId,
        requesterRole: 'manager',
        action: 'sale_refund',
        resourceType: 'sale',
        resourceId: 'sale-next',
        evaluation: blockedRefund,
      })
    ).toThrow(/approved manager request/i);

    const blockedNoSale = await evaluateShiftLossPrevention({
      db: getDatabase(),
      tenantId: harness.tenantId,
      siteId: harness.siteId,
      actorId: harness.managerId,
      role: 'manager',
      action: 'cash_drawer_open',
    });
    expect(blockedNoSale.violation).toMatchObject({
      kind: 'no_sale_limit',
      exceeded: ['count'],
      currentCount: 1,
      prospectiveCount: 2,
      maxCount: 1,
    });

    const blockedVoid = evaluateShiftLossPrevention({
      db: getDatabase(),
      tenantId: harness.tenantId,
      siteId: harness.siteId,
      actorId: harness.managerId,
      role: 'manager',
      action: 'sale_void',
      amount: 36,
    });
    expect(blockedVoid.violation).toMatchObject({
      kind: 'shift_void_limit',
      exceeded: ['count', 'amount'],
      currentCount: 1,
      prospectiveCount: 2,
      currentAmount: 40,
      prospectiveAmount: 76,
      maxCount: 1,
      maxAmount: 75,
    });

    recordShiftLossPreventionTrigger({
      db: getDatabase(),
      tenantId: harness.tenantId,
      actorId: harness.managerId,
      siteId: harness.siteId,
      resourceType: 'sale',
      resourceId: 'sale-next',
      evaluation: blockedRefund,
    });
    const trigger = getDatabase()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, 'shift_refund_limit'))
      .get();
    expect(trigger).toMatchObject({
      tenantId: harness.tenantId,
      actorId: harness.managerId,
      action: 'loss_prevention.triggered',
      resourceType: 'loss_prevention_rule',
      after: { requiredAction: 'sale_refund', approvalProvided: false },
    });
    expect(trigger?.metadata).toMatchObject({
      cashSessionId: 'loss-session-shift-usage',
      actionResourceId: 'sale-next',
      prospectiveAmount: 101,
    });

    const currentSaleId = 'loss-sale-shift-usage';
    getDatabase()
      .insert(sales)
      .values({
        id: currentSaleId,
        tenantId: harness.tenantId,
        saleNumber: 'LOSS-SHIFT-001',
        total: 61,
        createdBy: harness.managerId,
        createdAt: openedAt,
        updatedAt: openedAt,
      })
      .run();
    const manager = appRouter.createCaller(buildContext(harness, 'manager'));
    await expect(
      manager.lossPrevention.evaluateShiftAction({
        action: 'sale_refund',
        saleId: currentSaleId,
      })
    ).resolves.toMatchObject({
      cashSessionId: 'loss-session-shift-usage',
      requiresApproval: true,
      violation: { currentAmount: 40, prospectiveAmount: 101 },
    });

    const foreign = await seedHarness('shift-foreign-sale');
    getDatabase()
      .insert(sales)
      .values({
        id: 'loss-sale-shift-foreign',
        tenantId: foreign.tenantId,
        saleNumber: 'LOSS-FOREIGN-001',
        total: 61,
        createdBy: foreign.managerId,
        createdAt: openedAt,
        updatedAt: openedAt,
      })
      .run();
    await expect(
      manager.lossPrevention.evaluateShiftAction({
        action: 'sale_refund',
        saleId: 'loss-sale-shift-foreign',
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SALE_NOT_FOUND' }),
    });
  });

  it('fails closed when an enabled shift rule has no active cash session', async () => {
    const harness = await seedHarness('shift-missing');
    writeLossPreventionSettings(getDatabase(), harness.tenantId, {
      version: 4,
      alerts: disabledAlertSettings(),
      roles: {
        cashier: {
          maxDiscountPercent: 0,
          afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
          shift: disabledShiftPolicies(),
          dualApproval: { enabled: false, thresholdAmount: 0 },
        },
        manager: {
          maxDiscountPercent: 100,
          afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
          shift: {
            refunds: { enabled: true, maxCount: 5, maxAmount: 500 },
            voids: { enabled: false, maxCount: 0, maxAmount: 0 },
            noSale: { enabled: false, maxCount: 0 },
          },
          dualApproval: { enabled: false, thresholdAmount: 0 },
        },
      },
    });
    expect(
      evaluateShiftLossPrevention({
        db: getDatabase(),
        tenantId: harness.tenantId,
        siteId: harness.siteId,
        actorId: harness.managerId,
        role: 'manager',
        action: 'sale_refund',
        amount: 10,
      })
    ).toMatchObject({
      cashSessionId: null,
      requiresApproval: true,
      violation: { reason: 'shift_unavailable', exceeded: ['shift'] },
    });
  });

  it('routes only new site-scoped triggers into the shared manager alert center', async () => {
    const harness = await seedHarness('alerts');
    writeLossPreventionSettings(getDatabase(), harness.tenantId, {
      version: 4,
      alerts: {
        whatsappHandoff: { enabled: true, recipientPhone: '+57 301 555 0101' },
      },
      roles: {
        cashier: {
          maxDiscountPercent: 0,
          afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
          shift: {
            refunds: { enabled: true, maxCount: 0, maxAmount: 0 },
            voids: { enabled: false, maxCount: 0, maxAmount: 0 },
            noSale: { enabled: false, maxCount: 0 },
          },
          dualApproval: { enabled: false, thresholdAmount: 0 },
        },
        manager: {
          maxDiscountPercent: 100,
          afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
          shift: disabledShiftPolicies(),
          dualApproval: { enabled: false, thresholdAmount: 0 },
        },
      },
    });
    const evaluation = evaluateShiftLossPrevention({
      db: getDatabase(),
      tenantId: harness.tenantId,
      siteId: harness.siteId,
      actorId: harness.cashierId,
      role: 'cashier',
      action: 'sale_refund',
      amount: 50,
    });
    expect(evaluation.alertChannels).toEqual(['in_app', 'whatsapp_handoff']);
    recordShiftLossPreventionTrigger({
      db: getDatabase(),
      tenantId: harness.tenantId,
      actorId: harness.cashierId,
      siteId: harness.siteId,
      resourceType: 'sale',
      resourceId: 'loss-alert-sale',
      evaluation,
    });
    getDatabase()
      .insert(auditLogs)
      .values({
        id: 'loss-alert-legacy',
        tenantId: harness.tenantId,
        actorId: harness.cashierId,
        action: 'loss_prevention.triggered',
        resourceType: 'loss_prevention_rule',
        resourceId: 'shift_refund_limit',
        after: { requiredAction: 'sale_refund', approvalProvided: false },
        metadata: { siteId: harness.siteId, kind: 'shift_refund_limit', role: 'cashier' },
        createdAt: new Date().toISOString(),
      })
      .run();

    const manager = appRouter.createCaller(buildContext(harness, 'manager'));
    const initial = await manager.lossPrevention.listAlerts({ siteId: harness.siteId, limit: 20 });
    expect(initial).toMatchObject({
      unacknowledgedCount: 1,
      whatsappHandoff: { enabled: true, recipientPhone: '573015550101' },
      items: [
        {
          kind: 'shift_refund_limit',
          action: 'sale_refund',
          approvalProvided: false,
          actorId: harness.cashierId,
          actorName: 'Cashier alerts',
          actorRole: 'cashier',
          siteId: harness.siteId,
          siteName: 'Loss site alerts',
          channels: ['in_app', 'whatsapp_handoff'],
          acknowledgedAt: null,
        },
      ],
    });
    expect(initial.items).toHaveLength(1);

    const cashier = appRouter.createCaller(buildContext(harness, 'cashier'));
    await expect(
      cashier.lossPrevention.listAlerts({ siteId: harness.siteId, limit: 20 })
    ).rejects.toThrow(/administrators and managers/i);

    const alertId = initial.items[0]!.id;
    const acknowledgeFixture = await criticalContext(harness, 'manager');
    await expect(
      appRouter.createCaller(acknowledgeFixture.context).lossPrevention.acknowledgeAlert({
        siteId: harness.siteId,
        alertId,
      })
    ).resolves.toEqual({ alertId, acknowledged: true, alreadyAcknowledged: false });

    const reviewed = await manager.lossPrevention.listAlerts({ siteId: harness.siteId, limit: 20 });
    expect(reviewed.unacknowledgedCount).toBe(0);
    expect(reviewed.items[0]).toMatchObject({
      acknowledgedById: harness.managerId,
      acknowledgedByName: 'Manager alerts',
    });
    expect(reviewed.items[0]?.acknowledgedAt).toEqual(expect.any(String));

    const replayFixture = await criticalContext(harness, 'admin');
    await expect(
      appRouter.createCaller(replayFixture.context).lossPrevention.acknowledgeAlert({
        siteId: harness.siteId,
        alertId,
      })
    ).resolves.toEqual({ alertId, acknowledged: true, alreadyAcknowledged: true });
    expect(
      getDatabase()
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'loss_prevention.alert.acknowledged'))
        .all()
        .filter(row => row.resourceId === alertId)
    ).toHaveLength(1);

    const currentSettings = resolveLossPreventionSettings(getDatabase(), harness.tenantId);
    writeLossPreventionSettings(getDatabase(), harness.tenantId, {
      ...currentSettings,
      alerts: {
        whatsappHandoff: { enabled: false, recipientPhone: '+57 301 555 0101' },
      },
    });
    expect(
      resolveLossPreventionSettings(getDatabase(), harness.tenantId).alerts.whatsappHandoff
    ).toEqual({ enabled: false, recipientPhone: '573015550101' });
    await expect(
      manager.lossPrevention.listAlerts({ siteId: harness.siteId, limit: 20 })
    ).resolves.toMatchObject({
      whatsappHandoff: { enabled: false, recipientPhone: '' },
    });

    const foreign = await seedHarness('alerts-foreign');
    const foreignFixture = await criticalContext(foreign, 'manager');
    await expect(
      appRouter.createCaller(foreignFixture.context).lossPrevention.acknowledgeAlert({
        siteId: foreign.siteId,
        alertId,
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'LOSS_PREVENTION_ALERT_NOT_FOUND' }),
    });
  });

  it('keeps older pending alerts reachable when reviewed history fills the feed limit', async () => {
    const harness = await seedHarness('alert-priority');
    getDatabase()
      .insert(auditLogs)
      .values([
        {
          id: 'loss-alert-old-pending',
          tenantId: harness.tenantId,
          actorId: harness.cashierId,
          action: 'loss_prevention.triggered',
          resourceType: 'loss_prevention_rule',
          resourceId: 'shift_refund_limit',
          after: {
            requiredAction: 'sale_refund',
            approvalProvided: false,
            alertChannels: ['in_app'],
          },
          metadata: {
            siteId: harness.siteId,
            kind: 'shift_refund_limit',
            role: 'cashier',
          },
          createdAt: '2026-07-15T10:00:00.000Z',
        },
        {
          id: 'loss-alert-new-pending',
          tenantId: harness.tenantId,
          actorId: harness.cashierId,
          action: 'loss_prevention.triggered',
          resourceType: 'loss_prevention_rule',
          resourceId: 'shift_void_limit',
          after: {
            requiredAction: 'sale_void',
            approvalProvided: false,
            alertChannels: ['in_app'],
          },
          metadata: {
            siteId: harness.siteId,
            kind: 'shift_void_limit',
            role: 'cashier',
          },
          createdAt: '2026-07-16T10:00:00.000Z',
        },
      ])
      .run();

    const manager = appRouter.createCaller(buildContext(harness, 'manager'));
    const first = await manager.lossPrevention.listAlerts({ siteId: harness.siteId, limit: 1 });
    expect(first.unacknowledgedCount).toBe(2);
    expect(first.items.map(item => item.id)).toEqual(['loss-alert-new-pending']);

    const fixture = await criticalContext(harness, 'manager');
    await appRouter.createCaller(fixture.context).lossPrevention.acknowledgeAlert({
      siteId: harness.siteId,
      alertId: 'loss-alert-new-pending',
    });

    const next = await manager.lossPrevention.listAlerts({ siteId: harness.siteId, limit: 1 });
    expect(next.unacknowledgedCount).toBe(1);
    expect(next.items.map(item => item.id)).toEqual(['loss-alert-old-pending']);
  });
});
