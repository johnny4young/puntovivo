/**
 * Manager approval policy shared by the queue and sensitive action adapters.
 *
 * Requests last ten minutes. An approved grant is deliberately shorter: the
 * cashier must use it within two minutes, and every decision requires a fresh
 * manager/admin PIN. No elevated session is minted or cached.
 */
import type { UserRole } from '@puntovivo/shared/roles';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, lte, or } from 'drizzle-orm';
import {
  CHECKOUT_APPROVAL_RESOURCE_TYPE,
  serializeCheckoutApprovalContext,
  type CheckoutApprovalAction,
  type CheckoutApprovalContext,
} from '@puntovivo/shared/checkout-approval';
import type {
  ManagerApprovalAction,
  ManagerApprovalRequest,
  ManagerApprovalStatus,
} from '../db/schema.js';
import { managerApprovalRequests } from '../db/schema.js';
import type { DatabaseInstance } from '../db/index.js';
import { throwServerError } from '../lib/errorCodes.js';
import { writeAuditLog } from './audit-logs.js';
import { enqueueSync, type EnqueueSyncContext } from './sync/enqueue.js';

export const MANAGER_APPROVAL_REQUEST_TTL_MS = 10 * 60_000;
export const MANAGER_APPROVAL_GRANT_TTL_MS = 2 * 60_000;
export const MANAGER_APPROVAL_CLAIM_TTL_MS = 30_000;

const ADMIN_ONLY_APPROVALS = new Set<ManagerApprovalAction>([
  'credit_override',
  'sale_void',
]);

export function canRoleApproveAction(
  role: UserRole,
  action: ManagerApprovalAction
): boolean {
  if (role === 'admin') return true;
  return role === 'manager' && !ADMIN_ONLY_APPROVALS.has(action);
}

export function requiredApproverLabel(action: ManagerApprovalAction): 'admin' | 'manager' {
  return ADMIN_ONLY_APPROVALS.has(action) ? 'admin' : 'manager';
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

export function checkoutApprovalResourceId(
  context: CheckoutApprovalContext
): string {
  const digest = createHash('sha256')
    .update(serializeCheckoutApprovalContext(context))
    .digest('hex');
  return `checkout:sha256:${digest}`;
}

export interface ManagerApprovalClaim {
  requestId: string;
  action: CheckoutApprovalAction;
  token: string;
  claimExpiresAt: string;
  approverId: string;
  approvedResourceId: string;
}

interface ClaimManagerApprovalArgs {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
  requesterId: string;
  requestId: string;
  action: CheckoutApprovalAction;
  resourceId: string;
  nowMs?: number | undefined;
}

function throwApprovalRequired(): never {
  throwServerError({
    trpcCode: 'FORBIDDEN',
    errorCode: 'MANAGER_APPROVAL_REQUIRED',
    message: 'An approved manager request is required for this checkout',
  });
}

function throwApprovalMismatch(): never {
  throwServerError({
    trpcCode: 'FORBIDDEN',
    errorCode: 'MANAGER_APPROVAL_MISMATCH',
    message: 'The approval request does not match this checkout',
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
export function claimManagerApprovalGrant(
  args: ClaimManagerApprovalArgs
): ManagerApprovalClaim {
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
    request.resourceType !== CHECKOUT_APPROVAL_RESOURCE_TYPE ||
    request.resourceId !== args.resourceId
  ) {
    throwApprovalMismatch();
  }
  if (!request.decidedBy) throwApprovalRequired();

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
    approvedResourceId: args.resourceId,
  };
}

interface ConsumeManagerApprovalArgs {
  tx: DatabaseInstance;
  tenantId: string;
  requesterId: string;
  claim: ManagerApprovalClaim;
  saleId: string;
  saleNumber: string;
}

/** Consumes one claim inside the same transaction as its approved sale. */
export function consumeManagerApprovalGrant(
  args: ConsumeManagerApprovalArgs
): void {
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
      resourceType: 'sale',
      resourceId: args.saleId,
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
      resourceType: CHECKOUT_APPROVAL_RESOURCE_TYPE,
      resourceId: args.claim.approvedResourceId,
    },
    after: {
      status: 'consumed',
      resourceType: 'sale',
      resourceId: args.saleId,
      consumedAt: now,
    },
    metadata: {
      requesterId: args.requesterId,
      approverId: args.claim.approverId,
      saleNumber: args.saleNumber,
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
