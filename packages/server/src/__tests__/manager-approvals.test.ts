import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import {
  auditLogs,
  companies,
  managerApprovalRequests,
  sales,
  sites,
  syncOutbox,
  tenants,
  users,
} from '../db/schema.js';
import { hashStaffPin } from '../security/staffPins.js';
import { registerDevice } from '../services/devices/devicesService.js';
import {
  checkoutApprovalResourceId,
  claimManagerApprovalGrant,
  consumeManagerApprovalGrant,
  enqueueConsumedManagerApproval,
  managerApprovalCount,
  releaseManagerApprovalClaim,
} from '../services/manager-approvals.js';
import {
  resolveLossPreventionSettings,
  writeLossPreventionSettings,
} from '../services/loss-prevention/settings.js';
import { appRouter } from '../trpc/router.js';
import {
  freshCriticalContext,
  type FreshContextOverrides,
} from './utils/criticalCommandFixture.js';
import { seedCommittedSaleSession } from './utils/cashSessionFixture.js';

let server: PuntovivoServer;
let db: DatabaseInstance;
let tenantId: string;
let siteId: string;
let approvalSaleId: string;

type EmployeeRole = 'admin' | 'manager' | 'cashier' | 'viewer';

async function createEmployee(role: EmployeeRole, pin?: string) {
  const id = nanoid();
  const email = `approval-${role}-${id}@example.test`;
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    tenantId,
    email,
    name: `Approval ${role}`,
    passwordHash: 'not-used-by-router-tests',
    staffPinHash: pin ? await hashStaffPin(pin) : null,
    role,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const registration = await registerDevice(db, {
    tenantId,
    userId: id,
    kind: 'web',
    name: `manager-approvals-${role}`,
  });
  return {
    id,
    email,
    fresh(overrides?: FreshContextOverrides) {
      return freshCriticalContext({
        db,
        serverApp: server.app,
        tenantId,
        userId: id,
        email,
        role,
        siteId,
        deviceId: registration.deviceId,
        ...overrides,
      });
    },
  };
}

function requestInput(
  action:
    | 'credit_override'
    | 'sale_void'
    | 'sale_discount'
    | 'cash_drawer_open'
    | 'sale_refund'
    | 'credit_sale'
    | 'sale_after_hours',
  resourceId = action === 'cash_drawer_open'
    ? siteId
    : action === 'sale_void' || action === 'sale_refund'
      ? approvalSaleId
      : nanoid()
) {
  return {
    action,
    reason: `Approval needed for ${action}`,
    resourceType: action === 'cash_drawer_open' ? 'site' : 'sale',
    resourceId,
    summary: { label: `Sensitive action ${action}`, amount: 125, currencyCode: 'USD' },
  } as const;
}

describe('manager approvals router (ENG-106c1)', () => {
  it('counts only distinct approval evidence while preserving legacy decisions', () => {
    const approvedAt = new Date().toISOString();
    expect(
      managerApprovalCount({
        approvalEvidence: [],
        decidedBy: 'legacy-manager',
        status: 'approved',
      })
    ).toBe(1);
    expect(
      managerApprovalCount({
        approvalEvidence: [],
        decidedBy: 'rejecting-manager',
        status: 'rejected',
      })
    ).toBe(0);
    expect(
      managerApprovalCount({
        approvalEvidence: [
          { approverId: 'manager-one', approverRole: 'manager', approvedAt },
          { approverId: 'manager-one', approverRole: 'manager', approvedAt },
        ],
        decidedBy: 'manager-one',
        status: 'rejected',
      })
    ).toBe(1);
  });

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    db = getDatabase();
    const seededAdmin = await db
      .select({ id: users.id, tenantId: users.tenantId })
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!seededAdmin) throw new Error('Expected seeded admin user');
    tenantId = seededAdmin.tenantId;
    const seededSite = await db
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.tenantId, tenantId))
      .get();
    if (!seededSite) throw new Error('Expected seeded site');
    siteId = seededSite.id;
    const cashSessionId = await seedCommittedSaleSession({
      tenantId,
      cashierId: seededAdmin.id,
      siteId,
    });
    approvalSaleId = nanoid();
    const now = new Date().toISOString();
    await db.insert(sales).values({
      id: approvalSaleId,
      tenantId,
      saleNumber: `APPROVAL-SALE-${approvalSaleId}`,
      currencyCode: 'USD',
      subtotal: 125,
      total: 125,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      cashSessionId,
      createdBy: seededAdmin.id,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('creates one bounded request with atomic audit and secret-free sync data', async () => {
    const cashier = await createEmployee('cashier');
    const input = requestInput('sale_discount');
    const created = await appRouter.createCaller(cashier.fresh()).managerApprovals.request(input);
    expect(created).toMatchObject({
      tenantId,
      siteId,
      requesterId: cashier.id,
      action: 'sale_discount',
      status: 'pending',
      requiredApproverRole: 'manager',
    });
    expect(Date.parse(created.expiresAt)).toBeGreaterThan(Date.parse(created.requestedAt));

    const duplicate = await appRouter.createCaller(cashier.fresh()).managerApprovals.request(input);
    expect(duplicate.id).toBe(created.id);

    const audit = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceId, created.id),
          eq(auditLogs.action, 'manager_approval.request')
        )
      )
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe(cashier.id);

    const syncRows = await db
      .select({ payload: syncOutbox.payload })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          eq(syncOutbox.entityType, 'manager_approval_requests'),
          eq(syncOutbox.entityId, created.id)
        )
      )
      .all();
    expect(syncRows).toHaveLength(1);
    expect(JSON.stringify(syncRows)).not.toMatch(/pin|hash/i);
  });

  it('derives checkout identity and financial summary from the bound context', async () => {
    const cashier = await createEmployee('cashier');
    const checkoutContext = {
      mode: 'fresh' as const,
      saleId: null,
      customerId: null,
      items: [
        {
          productId: 'product-1',
          unitId: 'unit-1',
          quantity: 1,
          unitPrice: 100,
          discount: 25,
        },
      ],
      paymentMethod: 'cash' as const,
      payments: [],
      amountReceived: 75,
      discountAmount: 25,
      total: 75,
      creditAmount: 0,
      tipAmount: 0,
      serviceChargeAmount: 0,
      currencyCode: 'USD',
    };
    const created = await appRouter.createCaller(cashier.fresh()).managerApprovals.request({
      action: 'sale_discount',
      reason: 'Price match requested',
      resourceType: 'sale_checkout',
      resourceId: 'checkout:sha256:forged',
      checkoutContext,
      summary: { label: 'Only one peso', amount: 1, currencyCode: 'USD' },
    });

    expect(created.resourceId).toBe(
      checkoutApprovalResourceId({ ...checkoutContext, currencyCode: 'COP' })
    );
    expect(created.summary).toEqual({
      label: 'checkout',
      amount: 25,
      currencyCode: 'COP',
    });
  });

  it('uses the checkout total for blocked-hours approvals and exposes them to managers', async () => {
    const cashier = await createEmployee('cashier');
    const manager = await createEmployee('manager');
    const checkoutContext = {
      mode: 'fresh' as const,
      saleId: null,
      customerId: null,
      items: [
        {
          productId: 'product-after-hours',
          unitId: 'unit-1',
          quantity: 1,
          unitPrice: 125,
          discount: 0,
        },
      ],
      paymentMethod: 'cash' as const,
      payments: [],
      amountReceived: 125,
      discountAmount: 0,
      total: 125,
      creditAmount: 0,
      tipAmount: 0,
      serviceChargeAmount: 0,
      currencyCode: 'USD',
    };
    const created = await appRouter.createCaller(cashier.fresh()).managerApprovals.request({
      action: 'sale_after_hours',
      reason: 'Customer arrived before closing',
      resourceType: 'sale_checkout',
      checkoutContext,
      summary: { label: 'Forged', amount: 1, currencyCode: 'USD' },
    });

    expect(created).toMatchObject({
      action: 'sale_after_hours',
      requiredApproverRole: 'manager',
      summary: { label: 'checkout', amount: 125, currencyCode: 'COP' },
    });
    const queue = await appRouter
      .createCaller(manager.fresh())
      .managerApprovals.queue({ limit: 50 });
    expect(queue.items).toContainEqual(
      expect.objectContaining({ id: created.id, action: 'sale_after_hours' })
    );
  });

  it('preserves the frozen sale currency when approving a resumed draft', async () => {
    const cashier = await createEmployee('cashier');
    const saleId = nanoid();
    const now = new Date().toISOString();
    await db.insert(sales).values({
      id: saleId,
      tenantId,
      saleNumber: `APPROVAL-DRAFT-${saleId}`,
      currencyCode: 'USD',
      status: 'draft',
      createdBy: cashier.id,
      createdAt: now,
      updatedAt: now,
    });
    const checkoutContext = {
      mode: 'fromDraft' as const,
      saleId,
      customerId: null,
      items: [
        {
          productId: 'product-draft',
          unitId: 'unit-draft',
          quantity: 1,
          unitPrice: 100,
          discount: 25,
        },
      ],
      paymentMethod: 'cash' as const,
      payments: [],
      amountReceived: 75,
      discountAmount: 25,
      total: 75,
      creditAmount: 0,
      tipAmount: 0,
      serviceChargeAmount: 0,
      currencyCode: 'COP',
    };

    const created = await appRouter.createCaller(cashier.fresh()).managerApprovals.request({
      action: 'sale_discount',
      reason: 'Resume the frozen USD draft',
      resourceType: 'sale_checkout',
      checkoutContext,
      summary: { label: 'Forged current-currency summary', amount: 1, currencyCode: 'COP' },
    });

    expect(created.resourceId).toBe(
      checkoutApprovalResourceId({ ...checkoutContext, currencyCode: 'USD' })
    );
    expect(created.summary).toEqual({
      label: 'checkout',
      amount: 25,
      currencyCode: 'USD',
    });
  });

  it('derives post-sale and drawer resources from tenant-owned rows', async () => {
    const cashier = await createEmployee('cashier');
    const caller = appRouter.createCaller(cashier.fresh());
    const refund = await caller.managerApprovals.request({
      ...requestInput('sale_refund'),
      summary: { label: 'Forged sale', amount: 1, currencyCode: 'COP' },
    });
    expect(refund).toMatchObject({
      resourceType: 'sale',
      resourceId: approvalSaleId,
      summary: {
        label: `APPROVAL-SALE-${approvalSaleId}`,
        amount: 125,
        currencyCode: 'USD',
      },
    });

    const drawer = await appRouter.createCaller(cashier.fresh()).managerApprovals.request({
      ...requestInput('cash_drawer_open'),
      summary: { label: 'Forged site' },
    });
    const site = await db
      .select({ name: sites.name })
      .from(sites)
      .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)))
      .get();
    expect(drawer).toMatchObject({
      resourceType: 'site',
      resourceId: siteId,
      summary: { label: site?.name },
    });

    await expect(
      appRouter.createCaller(cashier.fresh()).managerApprovals.request({
        ...requestInput('cash_drawer_open'),
        resourceId: nanoid(),
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_MISMATCH' }),
    });
  });

  it('filters the queue and available approvers by the original direct-role boundary', async () => {
    const cashier = await createEmployee('cashier');
    const manager = await createEmployee('manager', '246810');
    const admin = await createEmployee('admin', '135790');
    const refund = await appRouter
      .createCaller(cashier.fresh())
      .managerApprovals.request(requestInput('sale_refund'));
    const voidRequest = await appRouter
      .createCaller(cashier.fresh())
      .managerApprovals.request(requestInput('sale_void'));

    const managerQueue = await appRouter
      .createCaller(manager.fresh())
      .managerApprovals.queue({ limit: 20 });
    expect(managerQueue.approver).toEqual({ id: manager.id, hasPin: true });
    expect(managerQueue.items.some(item => item.id === refund.id)).toBe(true);
    expect(managerQueue.items.some(item => item.id === voidRequest.id)).toBe(false);

    const adminQueue = await appRouter
      .createCaller(admin.fresh())
      .managerApprovals.queue({ limit: 20 });
    expect(adminQueue.items.some(item => item.id === refund.id)).toBe(true);
    expect(adminQueue.items.some(item => item.id === voidRequest.id)).toBe(true);

    const voidApprovers = await appRouter
      .createCaller(cashier.fresh())
      .managerApprovals.availableApprovers({ action: 'sale_void' });
    expect(voidApprovers.some(approver => approver.id === admin.id && approver.hasPin)).toBe(true);
    expect(voidApprovers.some(approver => approver.id === manager.id)).toBe(false);
  });

  it('approves with a fresh manager PIN without replacing the cashier session', async () => {
    const cashier = await createEmployee('cashier');
    const manager = await createEmployee('manager', '864209');
    const request = await appRouter
      .createCaller(cashier.fresh())
      .managerApprovals.request(requestInput('credit_sale'));

    const decided = await appRouter.createCaller(cashier.fresh()).managerApprovals.decideWithPin({
      requestId: request.id,
      approverId: manager.id,
      pin: '864209',
      decision: 'approved',
    });
    expect(decided).toMatchObject({
      id: request.id,
      status: 'approved',
      decidedBy: manager.id,
      approverName: 'Approval manager',
    });
    expect(decided.grantExpiresAt).not.toBeNull();
    expect(Date.parse(decided.grantExpiresAt!)).toBeGreaterThan(Date.now());

    const audit = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceId, request.id),
          eq(auditLogs.action, 'manager_approval.approve')
        )
      )
      .get();
    expect(audit?.actorId).toBe(manager.id);
    expect(audit?.metadata).toMatchObject({
      sessionActorId: cashier.id,
      authMethod: 'staff_pin',
      pinFreshnessPolicy: 'per_decision',
    });
    expect(JSON.stringify(decided)).not.toMatch(/claimToken|pin|hash/i);

    const syncRows = await db
      .select({ payload: syncOutbox.payload })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          eq(syncOutbox.entityType, 'manager_approval_requests'),
          eq(syncOutbox.entityId, request.id)
        )
      )
      .all();
    expect(syncRows).toHaveLength(2);
    expect(JSON.stringify(syncRows)).not.toMatch(/claimToken|claimExpiresAt|pin|hash/i);
  });

  it('requires two distinct fresh-PIN decisions above the configured amount', async () => {
    const before = resolveLossPreventionSettings(db, tenantId);
    writeLossPreventionSettings(db, tenantId, {
      ...before,
      roles: {
        ...before.roles,
        cashier: {
          ...before.roles.cashier,
          dualApproval: { enabled: true, thresholdAmount: 100 },
        },
      },
    });
    try {
      const cashier = await createEmployee('cashier');
      const firstManager = await createEmployee('manager', '121212');
      const secondManager = await createEmployee('manager', '343434');
      const request = await appRouter
        .createCaller(cashier.fresh())
        .managerApprovals.request(requestInput('sale_refund'));
      expect(request).toMatchObject({
        status: 'pending',
        requiredApprovals: 2,
        approvalsCollected: 0,
      });

      const firstDecision = await appRouter
        .createCaller(cashier.fresh())
        .managerApprovals.decideWithPin({
          requestId: request.id,
          approverId: firstManager.id,
          pin: '121212',
          decision: 'approved',
        });
      expect(firstDecision).toMatchObject({
        status: 'pending',
        requiredApprovals: 2,
        approvalsCollected: 1,
        grantExpiresAt: null,
      });
      expect(() =>
        claimManagerApprovalGrant({
          db,
          tenantId,
          siteId,
          requesterId: cashier.id,
          requestId: request.id,
          action: 'sale_refund',
          resourceType: 'sale',
          resourceId: approvalSaleId,
        })
      ).toThrowError(
        expect.objectContaining({
          cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_REQUIRED' }),
        })
      );

      const firstQueue = await appRouter
        .createCaller(firstManager.fresh())
        .managerApprovals.queue({ limit: 50 });
      expect(firstQueue.items.some(item => item.id === request.id)).toBe(false);
      const secondQueue = await appRouter
        .createCaller(secondManager.fresh())
        .managerApprovals.queue({ limit: 50 });
      expect(secondQueue.items).toContainEqual(
        expect.objectContaining({ id: request.id, approvalsCollected: 1, requiredApprovals: 2 })
      );

      await expect(
        appRouter.createCaller(cashier.fresh()).managerApprovals.decideWithPin({
          requestId: request.id,
          approverId: firstManager.id,
          pin: '121212',
          decision: 'approved',
        })
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_PIN_INVALID' }),
      });

      const secondDecision = await appRouter
        .createCaller(cashier.fresh())
        .managerApprovals.decideWithPin({
          requestId: request.id,
          approverId: secondManager.id,
          pin: '343434',
          decision: 'approved',
        });
      expect(secondDecision).toMatchObject({
        status: 'approved',
        decidedBy: secondManager.id,
        requiredApprovals: 2,
        approvalsCollected: 2,
      });
      expect(secondDecision.approvalEvidence.map(item => item.approverId)).toEqual([
        firstManager.id,
        secondManager.id,
      ]);

      const claim = claimManagerApprovalGrant({
        db,
        tenantId,
        siteId,
        requesterId: cashier.id,
        requestId: request.id,
        action: 'sale_refund',
        resourceType: 'sale',
        resourceId: approvalSaleId,
      });
      releaseManagerApprovalClaim(db, tenantId, claim);

      const approvalAudits = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.resourceId, request.id),
            eq(auditLogs.action, 'manager_approval.approve')
          )
        )
        .all();
      expect(approvalAudits).toHaveLength(2);
      expect(approvalAudits.map(row => row.metadata?.approvalSequence)).toEqual([1, 2]);
    } finally {
      writeLossPreventionSettings(db, tenantId, before);
    }
  });

  it('closes a partially approved dual request when the next approver rejects it', async () => {
    const before = resolveLossPreventionSettings(db, tenantId);
    writeLossPreventionSettings(db, tenantId, {
      ...before,
      roles: {
        ...before.roles,
        cashier: {
          ...before.roles.cashier,
          dualApproval: { enabled: true, thresholdAmount: 100 },
        },
      },
    });
    try {
      const cashier = await createEmployee('cashier');
      const firstManager = await createEmployee('manager', '565656');
      const secondManager = await createEmployee('manager', '787878');
      const request = await appRouter
        .createCaller(cashier.fresh())
        .managerApprovals.request(requestInput('sale_refund'));

      const partial = await appRouter.createCaller(cashier.fresh()).managerApprovals.decideWithPin({
        requestId: request.id,
        approverId: firstManager.id,
        pin: '565656',
        decision: 'approved',
      });
      expect(partial).toMatchObject({ status: 'pending', approvalsCollected: 1 });

      const rejected = await appRouter
        .createCaller(cashier.fresh())
        .managerApprovals.decideWithPin({
          requestId: request.id,
          approverId: secondManager.id,
          pin: '787878',
          decision: 'rejected',
          reason: 'Discount evidence is incomplete',
        });
      expect(rejected).toMatchObject({
        status: 'rejected',
        decidedBy: secondManager.id,
        decisionReason: 'Discount evidence is incomplete',
        requiredApprovals: 2,
        approvalsCollected: 1,
        grantExpiresAt: null,
      });
      expect(rejected.approvalEvidence.map(item => item.approverId)).toEqual([firstManager.id]);
      expect(() =>
        claimManagerApprovalGrant({
          db,
          tenantId,
          siteId,
          requesterId: cashier.id,
          requestId: request.id,
          action: 'sale_refund',
          resourceType: 'sale',
          resourceId: approvalSaleId,
        })
      ).toThrowError(
        expect.objectContaining({
          cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_REQUIRED' }),
        })
      );
    } finally {
      writeLossPreventionSettings(db, tenantId, before);
    }
  });

  it('rejects invalid or under-privileged PINs without deciding the request', async () => {
    const cashier = await createEmployee('cashier');
    const unrelatedCashier = await createEmployee('cashier');
    const manager = await createEmployee('manager', '112233');
    const adminOnly = await appRouter
      .createCaller(cashier.fresh())
      .managerApprovals.request(requestInput('credit_override'));

    await expect(
      appRouter.createCaller(cashier.fresh()).managerApprovals.decideWithPin({
        requestId: adminOnly.id,
        approverId: manager.id,
        pin: '112233',
        decision: 'approved',
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_PIN_INVALID' }),
    });
    const unchanged = await db
      .select({ status: managerApprovalRequests.status })
      .from(managerApprovalRequests)
      .where(eq(managerApprovalRequests.id, adminOnly.id))
      .get();
    expect(unchanged?.status).toBe('pending');

    const managerRequest = await appRouter
      .createCaller(cashier.fresh())
      .managerApprovals.request(requestInput('sale_discount'));
    await expect(
      appRouter.createCaller(unrelatedCashier.fresh()).managerApprovals.decideWithPin({
        requestId: managerRequest.id,
        approverId: manager.id,
        pin: '112233',
        decision: 'approved',
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_PIN_INVALID' }),
    });
    const unrelatedAttempt = await db
      .select({ status: managerApprovalRequests.status })
      .from(managerApprovalRequests)
      .where(eq(managerApprovalRequests.id, managerRequest.id))
      .get();
    expect(unrelatedAttempt?.status).toBe('pending');
  });

  it('rejects self-approval without disclosing whether the submitted PIN was valid', async () => {
    const manager = await createEmployee('manager', '314159');
    const request = await appRouter
      .createCaller(manager.fresh())
      .managerApprovals.request(requestInput('sale_discount'));

    await expect(
      appRouter.createCaller(manager.fresh()).managerApprovals.decideWithPin({
        requestId: request.id,
        approverId: manager.id,
        pin: '314159',
        decision: 'approved',
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_PIN_INVALID' }),
    });
    const unchanged = await db
      .select({ status: managerApprovalRequests.status })
      .from(managerApprovalRequests)
      .where(eq(managerApprovalRequests.id, request.id))
      .get();
    expect(unchanged?.status).toBe('pending');
    const queue = await appRouter
      .createCaller(manager.fresh())
      .managerApprovals.queue({ limit: 20 });
    expect(queue.items.some(item => item.id === request.id)).toBe(false);
  });

  it('requires a rejection reason and records the rejecting manager', async () => {
    const cashier = await createEmployee('cashier');
    const manager = await createEmployee('manager', '445566');
    const request = await appRouter
      .createCaller(cashier.fresh())
      .managerApprovals.request(requestInput('cash_drawer_open'));

    await expect(
      appRouter.createCaller(cashier.fresh()).managerApprovals.decideWithPin({
        requestId: request.id,
        approverId: manager.id,
        pin: '445566',
        decision: 'rejected',
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const rejected = await appRouter.createCaller(cashier.fresh()).managerApprovals.decideWithPin({
      requestId: request.id,
      approverId: manager.id,
      pin: '445566',
      decision: 'rejected',
      reason: 'Drawer count is in progress',
    });
    expect(rejected).toMatchObject({
      status: 'rejected',
      decidedBy: manager.id,
      decisionReason: 'Drawer count is in progress',
    });
  });

  it('expires stale requests and keeps them out of the live queue', async () => {
    const cashier = await createEmployee('cashier');
    const manager = await createEmployee('manager', '778899');
    const request = await appRouter
      .createCaller(cashier.fresh())
      .managerApprovals.request(requestInput('sale_refund'));
    await db
      .update(managerApprovalRequests)
      .set({ expiresAt: '2020-01-01T00:00:00.000Z' })
      .where(eq(managerApprovalRequests.id, request.id));

    await expect(
      appRouter.createCaller(cashier.fresh()).managerApprovals.decideWithPin({
        requestId: request.id,
        approverId: manager.id,
        pin: '778899',
        decision: 'approved',
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_EXPIRED' }),
    });
    const mine = await appRouter.createCaller(cashier.fresh()).managerApprovals.mine({ limit: 20 });
    expect(mine.find(item => item.id === request.id)?.status).toBe('expired');
    const queue = await appRouter
      .createCaller(manager.fresh())
      .managerApprovals.queue({ limit: 20 });
    expect(queue.items.some(item => item.id === request.id)).toBe(false);
  });

  it('does not grant a request that expires while its PIN is being verified', async () => {
    const cashier = await createEmployee('cashier');
    const manager = await createEmployee('manager', '161803');
    const request = await appRouter
      .createCaller(cashier.fresh())
      .managerApprovals.request(requestInput('sale_discount'));
    await db
      .update(managerApprovalRequests)
      .set({ expiresAt: new Date(Date.now() + 5).toISOString() })
      .where(eq(managerApprovalRequests.id, request.id));

    await expect(
      appRouter.createCaller(cashier.fresh()).managerApprovals.decideWithPin({
        requestId: request.id,
        approverId: manager.id,
        pin: '161803',
        decision: 'approved',
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_EXPIRED' }),
    });
    const expired = await db
      .select({ status: managerApprovalRequests.status })
      .from(managerApprovalRequests)
      .where(eq(managerApprovalRequests.id, request.id))
      .get();
    expect(expired?.status).toBe('expired');
  });

  it('allows only the requester to cancel a pending request', async () => {
    const cashier = await createEmployee('cashier');
    const otherCashier = await createEmployee('cashier');
    const request = await appRouter
      .createCaller(cashier.fresh())
      .managerApprovals.request(requestInput('sale_discount'));

    await expect(
      appRouter.createCaller(otherCashier.fresh()).managerApprovals.cancel({
        requestId: request.id,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const cancelled = await appRouter
      .createCaller(cashier.fresh())
      .managerApprovals.cancel({ requestId: request.id });
    expect(cancelled.status).toBe('cancelled');
  });

  it('keeps viewer accounts out of request and queue surfaces', async () => {
    const viewer = await createEmployee('viewer');
    await expect(
      appRouter.createCaller(viewer.fresh()).managerApprovals.request(requestInput('sale_discount'))
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      appRouter.createCaller(viewer.fresh()).managerApprovals.queue({ limit: 20 })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('collapses cross-tenant decisions to not found and keeps foreign rows out of the queue', async () => {
    const manager = await createEmployee('manager', '271828');
    const foreignTenantId = nanoid();
    const foreignCompanyId = nanoid();
    const foreignSiteId = nanoid();
    const foreignCashierId = nanoid();
    const foreignRequestId = nanoid();
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign approvals tenant',
      slug: `foreign-approvals-${foreignTenantId}`,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: foreignCompanyId,
      tenantId: foreignTenantId,
      name: 'Foreign approvals company',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: foreignSiteId,
      tenantId: foreignTenantId,
      companyId: foreignCompanyId,
      name: 'Foreign approvals site',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: foreignCashierId,
      tenantId: foreignTenantId,
      email: `foreign-approval-cashier-${foreignCashierId}@example.test`,
      name: 'Foreign approval cashier',
      passwordHash: 'not-used-by-router-tests',
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(managerApprovalRequests).values({
      id: foreignRequestId,
      tenantId: foreignTenantId,
      siteId: foreignSiteId,
      requesterId: foreignCashierId,
      action: 'sale_discount',
      status: 'pending',
      reason: 'Foreign request must remain isolated',
      resourceType: 'sale',
      resourceId: nanoid(),
      summary: { label: 'Foreign approval request' },
      requestedAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: now,
      updatedAt: now,
    });

    const queue = await appRouter
      .createCaller(manager.fresh())
      .managerApprovals.queue({ limit: 50 });
    expect(queue.items.some(item => item.id === foreignRequestId)).toBe(false);
    await expect(
      appRouter.createCaller(manager.fresh()).managerApprovals.decideWithPin({
        requestId: foreignRequestId,
        approverId: manager.id,
        pin: '271828',
        decision: 'approved',
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_NOT_FOUND' }),
    });
  });

  it('claims and atomically consumes a checkout-bound grant without syncing its token', async () => {
    const cashier = await createEmployee('cashier');
    const manager = await createEmployee('manager');
    const context = {
      mode: 'fresh' as const,
      saleId: null,
      customerId: null,
      items: [
        {
          productId: 'product-1',
          unitId: 'unit-1',
          quantity: 1,
          unitPrice: 100,
          discount: 10,
        },
      ],
      paymentMethod: 'cash' as const,
      payments: [],
      amountReceived: 90,
      discountAmount: 10,
      total: 90,
      creditAmount: 0,
      tipAmount: 0,
      serviceChargeAmount: 0,
      currencyCode: 'COP',
    };
    const resourceId = checkoutApprovalResourceId(context);
    const requestId = nanoid();
    const now = new Date().toISOString();
    await db.insert(managerApprovalRequests).values({
      id: requestId,
      tenantId,
      siteId,
      requesterId: cashier.id,
      action: 'sale_discount',
      status: 'approved',
      reason: 'Price match verified',
      resourceType: 'sale_checkout',
      resourceId,
      summary: { label: 'Checkout $90', amount: 10, currencyCode: 'USD' },
      requestedAt: now,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      decidedAt: now,
      decidedBy: manager.id,
      grantExpiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
      createdAt: now,
      updatedAt: now,
    });

    const claim = claimManagerApprovalGrant({
      db,
      tenantId,
      siteId,
      requesterId: cashier.id,
      requestId,
      action: 'sale_discount',
      resourceType: 'sale_checkout',
      resourceId,
    });
    expect(claim.token).toMatch(/^[a-f0-9]{64}$/);
    await expect(() =>
      claimManagerApprovalGrant({
        db,
        tenantId,
        siteId,
        requesterId: cashier.id,
        requestId,
        action: 'sale_discount',
        resourceType: 'sale_checkout',
        resourceId,
      })
    ).toThrowError(
      expect.objectContaining({
        cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_UNAVAILABLE' }),
      })
    );

    db.transaction(tx => {
      consumeManagerApprovalGrant({
        tx,
        tenantId,
        requesterId: cashier.id,
        claim,
        consumedResourceType: 'sale',
        consumedResourceId: 'sale-consumed-1',
        metadata: { saleNumber: 'VTA-000001' },
      });
    });
    await enqueueConsumedManagerApproval(cashier.fresh(), requestId);

    const consumed = await db
      .select()
      .from(managerApprovalRequests)
      .where(eq(managerApprovalRequests.id, requestId))
      .get();
    expect(consumed).toMatchObject({
      status: 'consumed',
      resourceType: 'sale',
      resourceId: 'sale-consumed-1',
      claimToken: null,
      claimExpiresAt: null,
    });
    const consumeAudit = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.resourceId, requestId), eq(auditLogs.action, 'manager_approval.consume'))
      )
      .get();
    expect(consumeAudit?.metadata).toMatchObject({
      requesterId: cashier.id,
      approverId: manager.id,
      saleNumber: 'VTA-000001',
    });
    const synced = await db
      .select({ payload: syncOutbox.payload })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.entityId, requestId),
          eq(syncOutbox.entityType, 'manager_approval_requests')
        )
      )
      .all();
    expect(JSON.stringify(synced)).not.toMatch(/claimToken|claimExpiresAt/i);
  });

  it('rejects payload drift and releases a claim after an aborted sale transaction', async () => {
    const cashier = await createEmployee('cashier');
    const manager = await createEmployee('manager');
    const resourceId = checkoutApprovalResourceId({
      mode: 'fresh',
      saleId: null,
      customerId: 'customer-1',
      items: [],
      paymentMethod: 'credit',
      payments: [],
      amountReceived: 0,
      discountAmount: 0,
      total: 100,
      creditAmount: 100,
      tipAmount: 0,
      serviceChargeAmount: 0,
      currencyCode: 'COP',
    });
    const requestId = nanoid();
    const now = new Date().toISOString();
    await db.insert(managerApprovalRequests).values({
      id: requestId,
      tenantId,
      siteId,
      requesterId: cashier.id,
      action: 'credit_sale',
      status: 'approved',
      reason: 'Known customer',
      resourceType: 'sale_checkout',
      resourceId,
      summary: { label: 'Credit checkout' },
      requestedAt: now,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      decidedAt: now,
      decidedBy: manager.id,
      grantExpiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
      createdAt: now,
      updatedAt: now,
    });

    expect(() =>
      claimManagerApprovalGrant({
        db,
        tenantId,
        siteId,
        requesterId: cashier.id,
        requestId,
        action: 'credit_sale',
        resourceType: 'sale_checkout',
        resourceId: `${resourceId}-changed`,
      })
    ).toThrowError(
      expect.objectContaining({
        cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_MISMATCH' }),
      })
    );

    const claim = claimManagerApprovalGrant({
      db,
      tenantId,
      siteId,
      requesterId: cashier.id,
      requestId,
      action: 'credit_sale',
      resourceType: 'sale_checkout',
      resourceId,
    });
    expect(() =>
      db.transaction(() => {
        throw new Error('simulated sale rollback');
      })
    ).toThrow('simulated sale rollback');
    releaseManagerApprovalClaim(db, tenantId, claim);
    const released = await db
      .select({
        status: managerApprovalRequests.status,
        claimToken: managerApprovalRequests.claimToken,
      })
      .from(managerApprovalRequests)
      .where(eq(managerApprovalRequests.id, requestId))
      .get();
    expect(released).toEqual({ status: 'approved', claimToken: null });

    const expiredClaim = claimManagerApprovalGrant({
      db,
      tenantId,
      siteId,
      requesterId: cashier.id,
      requestId,
      action: 'credit_sale',
      resourceType: 'sale_checkout',
      resourceId,
    });
    await db
      .update(managerApprovalRequests)
      .set({ grantExpiresAt: new Date(Date.now() - 1_000).toISOString() })
      .where(eq(managerApprovalRequests.id, requestId));
    expect(() =>
      db.transaction(tx => {
        consumeManagerApprovalGrant({
          tx,
          tenantId,
          requesterId: cashier.id,
          claim: expiredClaim,
          consumedResourceType: 'sale',
          consumedResourceId: 'sale-too-late',
          metadata: { saleNumber: 'VTA-000002' },
        });
      })
    ).toThrowError(
      expect.objectContaining({
        cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_UNAVAILABLE' }),
      })
    );
  });
});
