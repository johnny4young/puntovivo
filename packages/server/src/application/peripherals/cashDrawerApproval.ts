import type { UserRole } from '@puntovivo/shared/roles';
import type { DatabaseInstance } from '../../db/index.js';
import type { CompleteSaleLogger } from '../sales/types.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  consumeManagerApprovalGrant,
  enqueueConsumedManagerApprovalBestEffort,
  releaseManagerApprovalClaim,
  type ManagerApprovalClaim,
} from '../../services/manager-approvals.js';
import {
  claimShiftLossPreventionApproval,
  evaluateShiftLossPrevention,
  recordShiftLossPreventionTrigger,
} from '../../services/loss-prevention/index.js';

export interface CashDrawerApprovalContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
  user: { id: string; role: UserRole };
  envelope?: { operationId: string; idempotencyKey?: string } | null;
  deviceId?: string | null;
  log?: CompleteSaleLogger;
}

export function claimCashDrawerApproval(
  ctx: CashDrawerApprovalContext,
  requestId: string | undefined
): ManagerApprovalClaim | null {
  const evaluation = evaluateShiftLossPrevention({
    db: ctx.db,
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    actorId: ctx.user.id,
    role: ctx.user.role,
    action: 'cash_drawer_open',
  });
  recordShiftLossPreventionTrigger({
    db: ctx.db,
    tenantId: ctx.tenantId,
    actorId: ctx.user.id,
    siteId: ctx.siteId,
    resourceType: 'site',
    resourceId: ctx.siteId,
    evaluation,
    approvalRequestId: requestId,
    operationId: ctx.envelope?.operationId,
  });
  return claimShiftLossPreventionApproval({
    db: ctx.db,
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    requesterId: ctx.user.id,
    requesterRole: ctx.user.role,
    action: 'cash_drawer_open',
    resourceType: 'site',
    resourceId: ctx.siteId,
    requestId,
    evaluation,
  });
}

export function releaseCashDrawerApproval(
  ctx: CashDrawerApprovalContext,
  claim: ManagerApprovalClaim | null
): void {
  if (claim) releaseManagerApprovalClaim(ctx.db, ctx.tenantId, claim);
}

/** Persist dispatch evidence and consume the one-time grant before hardware I/O. */
export async function recordCashDrawerDispatch(
  ctx: CashDrawerApprovalContext,
  input: {
    claim: ManagerApprovalClaim | null;
    peripheralId: string;
    dispatchMode: 'server' | 'hub_client';
  }
): Promise<void> {
  ctx.db.transaction(tx => {
    writeAuditLog({
      tx,
      tenantId: ctx.tenantId,
      actorId: ctx.user.id,
      action: 'cash_drawer.open',
      resourceType: 'site',
      resourceId: ctx.siteId,
      before: null,
      after: {
        peripheralId: input.peripheralId,
        dispatchMode: input.dispatchMode,
      },
      metadata: {
        requesterId: ctx.user.id,
        ...(input.claim
          ? {
              approvalRequestId: input.claim.requestId,
              approverId: input.claim.approverId,
            }
          : {}),
      },
    });
    if (input.claim) {
      consumeManagerApprovalGrant({
        tx,
        tenantId: ctx.tenantId,
        requesterId: ctx.user.id,
        claim: input.claim,
        consumedResourceType: 'site',
        consumedResourceId: ctx.siteId,
        metadata: {
          peripheralId: input.peripheralId,
          dispatchMode: input.dispatchMode,
        },
      });
    }
  });

  if (input.claim) {
    await enqueueConsumedManagerApprovalBestEffort(ctx, input.claim);
  }
}
