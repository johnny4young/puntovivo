import { and, desc, eq, gt, inArray, isNull, lte, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { UserRole } from '@puntovivo/shared/roles';
import {
  managerApprovalRequests,
  sites,
  users,
  type ManagerApprovalAction,
  type ManagerApprovalRequest,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import {
  checkStaffPin,
  registerStaffPinFailure,
  registerStaffPinSuccess,
} from '../../security/loginRateLimit.js';
import { getDummyStaffPinHash, verifyStaffPin } from '../../security/staffPins.js';
import {
  canRoleApproveAction,
  effectiveManagerApprovalStatus,
  MANAGER_APPROVAL_GRANT_TTL_MS,
  MANAGER_APPROVAL_REQUEST_TTL_MS,
  requiredApproverLabel,
} from '../../services/manager-approvals.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import { router } from '../init.js';
import { asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import { criticalCommandCashierManagerOrAdminProcedure } from '../middleware/criticalCommand.js';
import {
  cashierManagerOrAdminProcedure,
  managerOrAdminProcedure,
} from '../middleware/roles.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  availableManagerApproversInput,
  cancelManagerApprovalInput,
  decideManagerApprovalWithPinInput,
  listManagerApprovalQueueInput,
  listOwnManagerApprovalsInput,
  requestManagerApprovalInput,
} from '../schemas/managerApprovals.js';

const MANAGER_ACTIONS: readonly ManagerApprovalAction[] = [
  'sale_discount',
  'cash_drawer_open',
  'sale_refund',
  'credit_sale',
];

function omitClaimState(request: ManagerApprovalRequest) {
  // Claim state is strictly server-internal. Even a null claimToken field in
  // today's response would silently become a credential leak once action
  // consumption starts returning or synchronizing an executing row.
  const { claimToken, claimExpiresAt, ...publicRequest } = request;
  void claimToken;
  void claimExpiresAt;
  return publicRequest;
}

function presentRequest(request: ManagerApprovalRequest, now: string) {
  return {
    ...omitClaimState(request),
    status: effectiveManagerApprovalStatus(request, now),
    requiredApproverRole: requiredApproverLabel(request.action),
  };
}

function throwApprovalNotFound(): never {
  throwServerError({
    trpcCode: 'NOT_FOUND',
    errorCode: 'MANAGER_APPROVAL_NOT_FOUND',
    message: 'Manager approval request not found',
  });
}

function throwApprovalNotPending(): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'MANAGER_APPROVAL_NOT_PENDING',
    message: 'Manager approval request is no longer pending',
  });
}

function throwApprovalExpired(): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'MANAGER_APPROVAL_EXPIRED',
    message: 'Manager approval request has expired',
  });
}

function throwApprovalPinInvalid(): never {
  throwServerError({
    trpcCode: 'UNAUTHORIZED',
    errorCode: 'MANAGER_APPROVAL_PIN_INVALID',
    message: 'Approver or PIN is invalid',
  });
}

function expireRequestIfNeeded(
  request: ManagerApprovalRequest,
  now: string
): boolean {
  if (request.status !== 'pending' || request.expiresAt > now) return false;
  request.status = 'expired';
  request.updatedAt = now;
  return true;
}

export const managerApprovalsRouter = router({
  /** Eligible identities are listed, but credential state is only a boolean. */
  availableApprovers: cashierManagerOrAdminProcedure
    .input(availableManagerApproversInput)
    .query(async ({ ctx, input }) => {
      const allowedRoles = requiredApproverLabel(input.action) === 'admin'
        ? (['admin'] as const)
        : (['admin', 'manager'] as const);
      const rows = await ctx.db
        .select({
          id: users.id,
          name: users.name,
          role: users.role,
          staffPinHash: users.staffPinHash,
        })
        .from(users)
        .where(
          and(
            eq(users.tenantId, ctx.tenantId),
            eq(users.isActive, true),
            ne(users.id, ctx.user!.id),
            inArray(users.role, allowedRoles)
          )
        )
        .orderBy(users.name)
        .all();

      return rows.map(({ staffPinHash, ...approver }) => ({
        ...approver,
        hasPin: staffPinHash !== null,
      }));
    }),

  mine: cashierManagerOrAdminProcedure
    .input(listOwnManagerApprovalsInput)
    .query(async ({ ctx, input }) => {
      const now = new Date().toISOString();
      const rows = await ctx.db
        .select({ request: managerApprovalRequests, siteName: sites.name })
        .from(managerApprovalRequests)
        .innerJoin(
          sites,
          and(
            eq(managerApprovalRequests.siteId, sites.id),
            eq(sites.tenantId, ctx.tenantId)
          )
        )
        .where(
          and(
            eq(managerApprovalRequests.tenantId, ctx.tenantId),
            eq(managerApprovalRequests.requesterId, ctx.user!.id)
          )
        )
        .orderBy(desc(managerApprovalRequests.requestedAt))
        .limit(input.limit)
        .all();

      return rows.map(row => ({
        ...presentRequest(row.request, now),
        siteName: row.siteName,
      }));
    }),

  queue: managerOrAdminProcedure
    .input(listManagerApprovalQueueInput)
    .query(async ({ ctx, input }) => {
      const now = new Date().toISOString();
      const conditions = [
        eq(managerApprovalRequests.tenantId, ctx.tenantId),
        eq(managerApprovalRequests.status, 'pending'),
        gt(managerApprovalRequests.expiresAt, now),
        ne(managerApprovalRequests.requesterId, ctx.user!.id),
      ];
      if (input.siteId) {
        await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
        conditions.push(eq(managerApprovalRequests.siteId, input.siteId));
      }
      if (ctx.user!.role === 'manager') {
        conditions.push(inArray(managerApprovalRequests.action, MANAGER_ACTIONS));
      }

      const [approver, rows] = await Promise.all([
        ctx.db
          .select({ id: users.id, staffPinHash: users.staffPinHash })
          .from(users)
          .where(and(eq(users.id, ctx.user!.id), eq(users.tenantId, ctx.tenantId)))
          .get(),
        ctx.db
          .select({
            request: managerApprovalRequests,
            requesterName: users.name,
            siteName: sites.name,
          })
          .from(managerApprovalRequests)
          .innerJoin(
            users,
            and(
              eq(managerApprovalRequests.requesterId, users.id),
              eq(users.tenantId, ctx.tenantId)
            )
          )
          .innerJoin(
            sites,
            and(
              eq(managerApprovalRequests.siteId, sites.id),
              eq(sites.tenantId, ctx.tenantId)
            )
          )
          .where(and(...conditions))
          .orderBy(managerApprovalRequests.requestedAt)
          .limit(input.limit)
          .all(),
      ]);

      return {
        approver: {
          id: ctx.user!.id,
          hasPin: approver?.staffPinHash !== null && approver !== undefined,
        },
        items: rows.map(row => ({
          ...presentRequest(row.request, now),
          requesterName: row.requesterName,
          siteName: row.siteName,
        })),
      };
    }),

  request: criticalCommandCashierManagerOrAdminProcedure
    .input(requestManagerApprovalInput)
    .mutation(async ({ ctx, input }) => {
      const criticalCtx = asCriticalCommandContext(ctx);
      const siteId = criticalCtx.siteId;
      if (!siteId) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'MANAGER_APPROVAL_SITE_REQUIRED',
          message: 'Manager approval requires an active site',
        });
      }
      const site = await ensureTenantSite(criticalCtx.db, criticalCtx.tenantId, siteId);
      if (!site.isActive) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'MANAGER_APPROVAL_SITE_REQUIRED',
          message: 'Manager approval requires an active site',
        });
      }

      const nowMs = Date.now();
      const now = new Date(nowMs).toISOString();
      const expiresAt = new Date(nowMs + MANAGER_APPROVAL_REQUEST_TTL_MS).toISOString();
      const resourceIdCondition = input.resourceId
        ? eq(managerApprovalRequests.resourceId, input.resourceId)
        : isNull(managerApprovalRequests.resourceId);
      const existing = await criticalCtx.db
        .select()
        .from(managerApprovalRequests)
        .where(
          and(
            eq(managerApprovalRequests.tenantId, criticalCtx.tenantId),
            eq(managerApprovalRequests.siteId, site.id),
            eq(managerApprovalRequests.requesterId, criticalCtx.user.id),
            eq(managerApprovalRequests.action, input.action),
            eq(managerApprovalRequests.resourceType, input.resourceType),
            resourceIdCondition,
            eq(managerApprovalRequests.status, 'pending'),
            gt(managerApprovalRequests.expiresAt, now)
          )
        )
        .orderBy(desc(managerApprovalRequests.requestedAt))
        .get();
      if (existing) return presentRequest(existing, now);

      const id = nanoid();
      const row = {
        id,
        tenantId: criticalCtx.tenantId,
        siteId: site.id,
        requesterId: criticalCtx.user.id,
        action: input.action,
        status: 'pending' as const,
        reason: input.reason,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        summary: input.summary,
        requestedAt: now,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      };
      criticalCtx.db.transaction(tx => {
        tx.insert(managerApprovalRequests).values(row).run();
        writeAuditLog({
          tx,
          tenantId: criticalCtx.tenantId,
          actorId: criticalCtx.user.id,
          action: 'manager_approval.request',
          resourceType: 'manager_approval',
          resourceId: id,
          before: null,
          after: {
            action: input.action,
            status: 'pending',
            requesterId: criticalCtx.user.id,
            siteId: site.id,
            expiresAt,
          },
          metadata: {
            reason: input.reason,
            resourceType: input.resourceType,
            resourceId: input.resourceId ?? null,
            summary: input.summary,
            requiredApproverRole: requiredApproverLabel(input.action),
          },
        });
      });
      await enqueueSync(criticalCtx, {
        entityType: 'manager_approval_requests',
        entityId: id,
        operation: 'create',
        data: row,
        priority: 10,
      });
      const inserted = await criticalCtx.db
        .select()
        .from(managerApprovalRequests)
        .where(
          and(
            eq(managerApprovalRequests.id, id),
            eq(managerApprovalRequests.tenantId, criticalCtx.tenantId)
          )
        )
        .get();
      if (!inserted) throwApprovalNotFound();
      return presentRequest(inserted, now);
    }),

  decideWithPin: criticalCommandCashierManagerOrAdminProcedure
    .input(decideManagerApprovalWithPinInput)
    .mutation(async ({ ctx, input }) => {
      const criticalCtx = asCriticalCommandContext(ctx);
      const request = await criticalCtx.db
        .select()
        .from(managerApprovalRequests)
        .where(
          and(
            eq(managerApprovalRequests.id, input.requestId),
            eq(managerApprovalRequests.tenantId, criticalCtx.tenantId)
          )
        )
        .get();
      if (!request) throwApprovalNotFound();
      const checkedAt = new Date().toISOString();
      if (request.status !== 'pending') throwApprovalNotPending();
      if (request.expiresAt <= checkedAt) {
        criticalCtx.db
          .update(managerApprovalRequests)
          .set({ status: 'expired', updatedAt: checkedAt })
          .where(
            and(
              eq(managerApprovalRequests.id, request.id),
              eq(managerApprovalRequests.tenantId, criticalCtx.tenantId),
              eq(managerApprovalRequests.status, 'pending'),
              lte(managerApprovalRequests.expiresAt, checkedAt)
            )
          )
          .run();
        throwApprovalExpired();
      }

      const rateIdentity = {
        tenantId: criticalCtx.tenantId,
        actorUserId: criticalCtx.user.id,
        targetUserId: input.approverId,
      };
      checkStaffPin(criticalCtx.db, rateIdentity);
      const approver = await criticalCtx.db
        .select({
          id: users.id,
          name: users.name,
          role: users.role,
          staffPinHash: users.staffPinHash,
        })
        .from(users)
        .where(
          and(
            eq(users.id, input.approverId),
            eq(users.tenantId, criticalCtx.tenantId),
            eq(users.isActive, true)
          )
        )
        .get();
      const approverRole = approver?.role as UserRole | undefined;
      const actorCanPresentDecision =
        criticalCtx.user.id === request.requesterId ||
        criticalCtx.user.id === input.approverId;
      const eligible =
        actorCanPresentDecision &&
        approverRole !== undefined &&
        approver?.id !== request.requesterId &&
        canRoleApproveAction(approverRole, request.action);
      const verificationHash =
        eligible && approver?.staffPinHash
          ? approver.staffPinHash
          : await getDummyStaffPinHash();
      const pinMatches = await verifyStaffPin(verificationHash, input.pin);
      if (!eligible || !approver?.staffPinHash || !pinMatches) {
        registerStaffPinFailure(criticalCtx.db, rateIdentity);
        throwApprovalPinInvalid();
      }

      // PIN verification is deliberately expensive. Re-read the wall clock
      // after Argon2 so a request cannot cross its expiry boundary while the
      // credential is being checked and still receive a grant.
      const decidedNowMs = Date.now();
      const decidedAt = new Date(decidedNowMs).toISOString();
      if (request.expiresAt <= decidedAt) {
        criticalCtx.db
          .update(managerApprovalRequests)
          .set({ status: 'expired', updatedAt: decidedAt })
          .where(
            and(
              eq(managerApprovalRequests.id, request.id),
              eq(managerApprovalRequests.tenantId, criticalCtx.tenantId),
              eq(managerApprovalRequests.status, 'pending'),
              lte(managerApprovalRequests.expiresAt, decidedAt)
            )
          )
          .run();
        throwApprovalExpired();
      }

      const grantExpiresAt =
        input.decision === 'approved'
          ? new Date(decidedNowMs + MANAGER_APPROVAL_GRANT_TTL_MS).toISOString()
          : null;
      const decided = criticalCtx.db.transaction(tx => {
        const result = tx
          .update(managerApprovalRequests)
          .set({
            status: input.decision,
            decidedAt,
            decidedBy: approver.id,
            decisionReason: input.reason ?? null,
            grantExpiresAt,
            updatedAt: decidedAt,
          })
          .where(
            and(
              eq(managerApprovalRequests.id, request.id),
              eq(managerApprovalRequests.tenantId, criticalCtx.tenantId),
              eq(managerApprovalRequests.status, 'pending'),
              gt(managerApprovalRequests.expiresAt, decidedAt)
            )
          )
          .run();
        if (result.changes !== 1) return false;

        writeAuditLog({
          tx,
          tenantId: criticalCtx.tenantId,
          actorId: approver.id,
          action:
            input.decision === 'approved'
              ? 'manager_approval.approve'
              : 'manager_approval.reject',
          resourceType: 'manager_approval',
          resourceId: request.id,
          before: {
            status: 'pending',
            requesterId: request.requesterId,
            action: request.action,
          },
          after: {
            status: input.decision,
            decidedBy: approver.id,
            decidedAt,
            grantExpiresAt,
          },
          metadata: {
            decisionReason: input.reason ?? null,
            sessionActorId: criticalCtx.user.id,
            authMethod: 'staff_pin',
            pinFreshnessPolicy: 'per_decision',
          },
        });
        return true;
      });
      if (!decided) throwApprovalNotPending();
      // A valid PIN clears only this approver's target bucket, and only
      // after the decision + audit transaction commits.
      registerStaffPinSuccess(criticalCtx.db, rateIdentity);

      const updated = await criticalCtx.db
        .select()
        .from(managerApprovalRequests)
        .where(
          and(
            eq(managerApprovalRequests.id, request.id),
            eq(managerApprovalRequests.tenantId, criticalCtx.tenantId)
          )
        )
        .get();
      if (!updated) throwApprovalNotFound();
      await enqueueSync(criticalCtx, {
        entityType: 'manager_approval_requests',
        entityId: updated.id,
        operation: 'update',
        data: omitClaimState(updated),
        priority: 10,
      });
      return {
        ...presentRequest(updated, decidedAt),
        approverName: approver.name,
      };
    }),

  cancel: criticalCommandCashierManagerOrAdminProcedure
    .input(cancelManagerApprovalInput)
    .mutation(async ({ ctx, input }) => {
      const criticalCtx = asCriticalCommandContext(ctx);
      const request = await criticalCtx.db
        .select()
        .from(managerApprovalRequests)
        .where(
          and(
            eq(managerApprovalRequests.id, input.requestId),
            eq(managerApprovalRequests.tenantId, criticalCtx.tenantId),
            eq(managerApprovalRequests.requesterId, criticalCtx.user.id)
          )
        )
        .get();
      if (!request) throwApprovalNotFound();
      const now = new Date().toISOString();
      if (expireRequestIfNeeded(request, now)) {
        criticalCtx.db
          .update(managerApprovalRequests)
          .set({ status: 'expired', updatedAt: now })
          .where(
            and(
              eq(managerApprovalRequests.id, request.id),
              eq(managerApprovalRequests.tenantId, criticalCtx.tenantId),
              eq(managerApprovalRequests.status, 'pending')
            )
          )
          .run();
        throwApprovalExpired();
      }
      if (request.status !== 'pending') throwApprovalNotPending();

      const cancelled = criticalCtx.db.transaction(tx => {
        const result = tx
          .update(managerApprovalRequests)
          .set({ status: 'cancelled', updatedAt: now })
          .where(
            and(
              eq(managerApprovalRequests.id, request.id),
              eq(managerApprovalRequests.tenantId, criticalCtx.tenantId),
              eq(managerApprovalRequests.requesterId, criticalCtx.user.id),
              eq(managerApprovalRequests.status, 'pending')
            )
          )
          .run();
        if (result.changes !== 1) return false;
        writeAuditLog({
          tx,
          tenantId: criticalCtx.tenantId,
          actorId: criticalCtx.user.id,
          action: 'manager_approval.cancel',
          resourceType: 'manager_approval',
          resourceId: request.id,
          before: { status: 'pending', action: request.action },
          after: { status: 'cancelled' },
        });
        return true;
      });
      if (!cancelled) throwApprovalNotPending();
      const updated = await criticalCtx.db
        .select()
        .from(managerApprovalRequests)
        .where(
          and(
            eq(managerApprovalRequests.id, request.id),
            eq(managerApprovalRequests.tenantId, criticalCtx.tenantId)
          )
        )
        .get();
      if (!updated) throwApprovalNotFound();
      await enqueueSync(criticalCtx, {
        entityType: 'manager_approval_requests',
        entityId: updated.id,
        operation: 'update',
        data: omitClaimState(updated),
        priority: 10,
      });
      return presentRequest(updated, now);
    }),
});
