/**
 * Manager approval policy shared by the queue and sensitive action adapters.
 *
 * Requests last ten minutes. An approved grant is deliberately shorter: the
 * cashier must use it within two minutes, and every decision requires a fresh
 * manager/admin PIN. No elevated session is minted or cached.
 */
import type { UserRole } from '@puntovivo/shared/roles';
import {
  canRolePerformApprovalActionDirectly,
  requiredApprovalRole,
  type ManagerApprovalAction,
} from '@puntovivo/shared/manager-approval';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, lte, or } from 'drizzle-orm';
import {
  serializeCheckoutApprovalContext,
  type CheckoutApprovalContext,
} from '@puntovivo/shared/checkout-approval';
import type { ManagerApprovalRequest, ManagerApprovalStatus } from '../db/schema.js';
import { managerApprovalRequests } from '../db/schema.js';
import type { DatabaseInstance } from '../db/index.js';
import { throwServerError } from '../lib/errorCodes.js';
import { writeAuditLog } from './audit-logs.js';
import { enqueueSync, type EnqueueSyncContext } from './sync/enqueue.js';

export const MANAGER_APPROVAL_REQUEST_TTL_MS = 10 * 60_000;
export const MANAGER_APPROVAL_GRANT_TTL_MS = 2 * 60_000;
export const MANAGER_APPROVAL_CLAIM_TTL_MS = 30_000;

export function canRoleApproveAction(role: UserRole, action: ManagerApprovalAction): boolean {
  return canRolePerformApprovalActionDirectly(role, action);
}

export function requiredApproverLabel(action: ManagerApprovalAction): 'admin' | 'manager' {
  return requiredApprovalRole(action);
}

export function effectiveManagerApprovalStatus(
  request: Pick<
    ManagerApprovalRequest,
    'status' | 'expiresAt' | 'grantExpiresAt' | 'claimExpiresAt'
  >,
  nowIso: string = new Date().toISOString()
): ManagerApprovalStatus {
  if (request.status === 'pending' && request.expiresAt <= nowIso) return 'expired';
  if (
    request.status === 'approved' &&
    (!request.grantExpiresAt || request.grantExpiresAt <= nowIso)
  ) {
    return 'expired';
  }
  if (
    request.status === 'executing' &&
    (!request.grantExpiresAt || request.grantExpiresAt <= nowIso)
  ) {
    return 'expired';
  }
  if (
    request.status === 'executing' &&
    (!request.claimExpiresAt || request.claimExpiresAt <= nowIso)
  ) {
    return 'approved';
  }
  return request.status;
}

export function publicManagerApprovalRequest(request: ManagerApprovalRequest) {
  const { claimToken, claimExpiresAt, ...publicRequest } = request;
  void claimToken;
  void claimExpiresAt;
  return publicRequest;
}

/** Legacy approved rows predate  evidence; decidedBy proves their single decision. */
export function managerApprovalCount(
  request: Pick<ManagerApprovalRequest, 'approvalEvidence' | 'decidedBy' | 'status'>
): number {
  const distinctApprovers = new Set(
    request.approvalEvidence
      .map(evidence => evidence.approverId)
      .filter(approverId => typeof approverId === 'string' && approverId.length > 0)
  ).size;
  if (distinctApprovers > 0) return distinctApprovers;
  const legacyApprovedStatus = ['approved', 'executing', 'consumed', 'expired'].includes(
    request.status
  );
  return request.decidedBy && legacyApprovedStatus ? 1 : 0;
}

export function checkoutApprovalResourceId(context: CheckoutApprovalContext): string {
  const digest = createHash('sha256')
    .update(serializeCheckoutApprovalContext(context))
    .digest('hex');
  return `checkout:sha256:${digest}`;
}

export interface ManagerApprovalClaim {
  requestId: string;
  action: ManagerApprovalAction;
  token: string;
  claimExpiresAt: string;
  approverId: string;
  approvedResourceType: string;
  approvedResourceId: string;
}

interface ClaimManagerApprovalArgs {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
  requesterId: string;
  requestId: string;
  action: ManagerApprovalAction;
  resourceType: string;
  resourceId: string;
  nowMs?: number | undefined;
}

interface ClaimActionApprovalArgs {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
  requesterId: string;
  requesterRole: UserRole;
  action: ManagerApprovalAction;
  resourceType: string;
  resourceId: string;
  requestId?: string | undefined;
}

function throwApprovalRequired(): never {
  throwServerError({
    trpcCode: 'FORBIDDEN',
    errorCode: 'MANAGER_APPROVAL_REQUIRED',
    message: 'An approved manager request is required for this action',
  });
}

function throwApprovalMismatch(): never {
  throwServerError({
    trpcCode: 'FORBIDDEN',
    errorCode: 'MANAGER_APPROVAL_MISMATCH',
    message: 'The approval request does not match this action',
  });
}

function throwApprovalUnavailable(): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'MANAGER_APPROVAL_UNAVAILABLE',
    message: 'The approval grant is no longer available',
  });
}

function throwApprovalExpired(): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'MANAGER_APPROVAL_EXPIRED',
    message: 'Manager approval request has expired',
  });
}

/**
 * Claims an approved grant without returning its bearer token to a renderer.
 * Expired executing claims may be reclaimed; a live claim is single-owner.
 */
export function claimManagerApprovalGrant(args: ClaimManagerApprovalArgs): ManagerApprovalClaim {
  const request = args.db
    .select()
    .from(managerApprovalRequests)
    .where(
      and(
        eq(managerApprovalRequests.id, args.requestId),
        eq(managerApprovalRequests.tenantId, args.tenantId),
        eq(managerApprovalRequests.requesterId, args.requesterId)
      )
    )
    .get();
  if (!request) throwApprovalRequired();
  if (
    request.siteId !== args.siteId ||
    request.action !== args.action ||
    request.resourceType !== args.resourceType ||
    request.resourceId !== args.resourceId
  ) {
    throwApprovalMismatch();
  }
  if (request.status !== 'approved' && request.status !== 'executing') {
    throwApprovalRequired();
  }
  if (!request.decidedBy) throwApprovalRequired();
  if (managerApprovalCount(request) < request.requiredApprovals) throwApprovalRequired();

  const nowMs = args.nowMs ?? Date.now();
  const now = new Date(nowMs).toISOString();
  if (!request.grantExpiresAt || request.grantExpiresAt <= now) {
    args.db
      .update(managerApprovalRequests)
      .set({
        status: 'expired',
        claimToken: null,
        claimExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(managerApprovalRequests.id, request.id),
          eq(managerApprovalRequests.tenantId, args.tenantId),
          or(
            eq(managerApprovalRequests.status, 'approved'),
            eq(managerApprovalRequests.status, 'executing')
          ),
          lte(managerApprovalRequests.grantExpiresAt, now)
        )
      )
      .run();
    throwApprovalExpired();
  }

  const claimToken = randomBytes(32).toString('hex');
  const claimExpiresAt = new Date(
    Math.min(nowMs + MANAGER_APPROVAL_CLAIM_TTL_MS, Date.parse(request.grantExpiresAt))
  ).toISOString();
  const claimed = args.db
    .update(managerApprovalRequests)
    .set({
      status: 'executing',
      claimToken,
      claimExpiresAt,
      updatedAt: now,
    })
    .where(
      and(
        eq(managerApprovalRequests.id, request.id),
        eq(managerApprovalRequests.tenantId, args.tenantId),
        eq(managerApprovalRequests.requesterId, args.requesterId),
        gt(managerApprovalRequests.grantExpiresAt, now),
        or(
          eq(managerApprovalRequests.status, 'approved'),
          and(
            eq(managerApprovalRequests.status, 'executing'),
            lte(managerApprovalRequests.claimExpiresAt, now)
          )
        )
      )
    )
    .run();
  if (claimed.changes !== 1) throwApprovalUnavailable();

  return {
    requestId: request.id,
    action: args.action,
    token: claimToken,
    claimExpiresAt,
    approverId: request.decidedBy,
    approvedResourceType: args.resourceType,
    approvedResourceId: args.resourceId,
  };
}

/** Direct-authority roles skip grants; every other sales role must claim one. */
export function claimActionApproval(args: ClaimActionApprovalArgs): ManagerApprovalClaim | null {
  if (canRolePerformApprovalActionDirectly(args.requesterRole, args.action)) return null;
  if (!args.requestId) throwApprovalRequired();
  return claimManagerApprovalGrant({
    db: args.db,
    tenantId: args.tenantId,
    siteId: args.siteId,
    requesterId: args.requesterId,
    requestId: args.requestId,
    action: args.action,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
  });
}

interface ConsumeManagerApprovalArgs {
  tx: DatabaseInstance;
  tenantId: string;
  requesterId: string;
  claim: ManagerApprovalClaim;
  consumedResourceType: string;
  consumedResourceId: string;
  metadata?: Record<string, unknown> | undefined;
}

/** Consumes one claim inside the same transaction as its approved action. */
export function consumeManagerApprovalGrant(args: ConsumeManagerApprovalArgs): void {
  // Read the clock at the consumption boundary. A timestamp captured before
  // checkout prework or at claim time could outlive the two-minute grant while
  // a slow transaction is still running, incorrectly accepting an expired
  // approval.
  const now = new Date().toISOString();
  const request = args.tx
    .select()
    .from(managerApprovalRequests)
    .where(
      and(
        eq(managerApprovalRequests.id, args.claim.requestId),
        eq(managerApprovalRequests.tenantId, args.tenantId),
        eq(managerApprovalRequests.requesterId, args.requesterId),
        eq(managerApprovalRequests.status, 'executing')
      )
    )
    .get();
  if (
    !request?.claimToken ||
    !request.claimExpiresAt ||
    !request.grantExpiresAt ||
    request.claimExpiresAt <= now ||
    request.grantExpiresAt <= now
  ) {
    throwApprovalUnavailable();
  }
  const expected = Buffer.from(args.claim.token, 'hex');
  const actual = Buffer.from(request.claimToken, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throwApprovalUnavailable();
  }

  const consumed = args.tx
    .update(managerApprovalRequests)
    .set({
      status: 'consumed',
      resourceType: args.consumedResourceType,
      resourceId: args.consumedResourceId,
      consumedAt: now,
      claimToken: null,
      claimExpiresAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(managerApprovalRequests.id, request.id),
        eq(managerApprovalRequests.tenantId, args.tenantId),
        eq(managerApprovalRequests.requesterId, args.requesterId),
        eq(managerApprovalRequests.status, 'executing'),
        eq(managerApprovalRequests.claimToken, request.claimToken),
        gt(managerApprovalRequests.claimExpiresAt, now),
        gt(managerApprovalRequests.grantExpiresAt, now)
      )
    )
    .run();
  if (consumed.changes !== 1) throwApprovalUnavailable();

  writeAuditLog({
    tx: args.tx,
    tenantId: args.tenantId,
    actorId: args.requesterId,
    action: 'manager_approval.consume',
    resourceType: 'manager_approval',
    resourceId: request.id,
    before: {
      status: 'approved',
      action: request.action,
      resourceType: args.claim.approvedResourceType,
      resourceId: args.claim.approvedResourceId,
    },
    after: {
      status: 'consumed',
      resourceType: args.consumedResourceType,
      resourceId: args.consumedResourceId,
      consumedAt: now,
    },
    metadata: {
      requesterId: args.requesterId,
      approverId: args.claim.approverId,
      ...(args.metadata ?? {}),
    },
  });
}

/** Releases only the caller's live token; a different claimant is untouched. */
export function releaseManagerApprovalClaim(
  db: DatabaseInstance,
  tenantId: string,
  claim: ManagerApprovalClaim
): void {
  const now = new Date().toISOString();
  db.update(managerApprovalRequests)
    .set({
      status: 'approved',
      claimToken: null,
      claimExpiresAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(managerApprovalRequests.id, claim.requestId),
        eq(managerApprovalRequests.tenantId, tenantId),
        eq(managerApprovalRequests.status, 'executing'),
        eq(managerApprovalRequests.claimToken, claim.token),
        gt(managerApprovalRequests.grantExpiresAt, now)
      )
    )
    .run();
}

export async function enqueueConsumedManagerApproval(
  ctx: EnqueueSyncContext,
  requestId: string
): Promise<void> {
  const row = await ctx.db
    .select()
    .from(managerApprovalRequests)
    .where(
      and(
        eq(managerApprovalRequests.id, requestId),
        eq(managerApprovalRequests.tenantId, ctx.tenantId),
        eq(managerApprovalRequests.status, 'consumed')
      )
    )
    .get();
  if (!row) return;
  await enqueueSync(ctx, {
    entityType: 'manager_approval_requests',
    entityId: row.id,
    operation: 'update',
    data: publicManagerApprovalRequest(row),
    priority: 10,
  });
}

export async function enqueueConsumedManagerApprovalBestEffort(
  ctx: EnqueueSyncContext & {
    log?: { warn: (bindings: object, message: string) => void } | undefined;
  },
  claim: ManagerApprovalClaim
): Promise<void> {
  try {
    await enqueueConsumedManagerApproval(ctx, claim.requestId);
  } catch (error) {
    // The approved action is already durable. Replication is repairable;
    // turning this into a command failure would weaken idempotency.
    ctx.log?.warn(
      { err: error, requestId: claim.requestId },
      'manager approval consumption sync enqueue failed after action commit'
    );
  }
}
