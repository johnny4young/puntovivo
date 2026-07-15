import type { UserRole } from '@puntovivo/shared/roles';
import {
  getRequiredCheckoutApprovalActions,
  type CheckoutApprovalAction,
  type CheckoutApprovalContext,
} from '@puntovivo/shared/checkout-approval';
import type { DatabaseInstance } from '../../db/index.js';
import { throwServerError } from '../../lib/errorCodes.js';
import {
  checkoutApprovalResourceId,
  claimManagerApprovalGrant,
  consumeManagerApprovalGrant,
  enqueueConsumedManagerApproval,
  releaseManagerApprovalClaim,
  type ManagerApprovalClaim,
} from '../../services/manager-approvals.js';
import type { CompleteSaleContext, CompleteSaleApprovalReference } from './types.js';

export interface CheckoutApprovalPolicyInput {
  role: UserRole;
  isCompletion: boolean;
  hasDiscount: boolean;
  hasCreditTender: boolean;
  creditOverride: boolean;
}

/** Direct manager/admin permissions remain intact; cashier actions escalate. */
export function requiredCheckoutApprovalActions(
  input: CheckoutApprovalPolicyInput
): CheckoutApprovalAction[] {
  return getRequiredCheckoutApprovalActions(input);
}

interface ClaimCheckoutApprovalsArgs {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
  requesterId: string;
  requiredActions: CheckoutApprovalAction[];
  references: CompleteSaleApprovalReference[] | undefined;
  context: CheckoutApprovalContext;
}

export function claimCheckoutApprovals(args: ClaimCheckoutApprovalsArgs): ManagerApprovalClaim[] {
  if (args.requiredActions.length === 0) return [];
  const resourceId = checkoutApprovalResourceId(args.context);
  const referenceByAction = new Map(
    (args.references ?? []).map(reference => [reference.action, reference.requestId])
  );
  const claims: ManagerApprovalClaim[] = [];
  try {
    for (const action of args.requiredActions) {
      const requestId = referenceByAction.get(action);
      if (!requestId) {
        throwServerError({
          trpcCode: 'FORBIDDEN',
          errorCode: 'MANAGER_APPROVAL_REQUIRED',
          message: `Manager approval is required for ${action}`,
        });
      }
      claims.push(
        claimManagerApprovalGrant({
          db: args.db,
          tenantId: args.tenantId,
          siteId: args.siteId,
          requesterId: args.requesterId,
          requestId,
          action,
          resourceId,
        })
      );
    }
    return claims;
  } catch (error) {
    for (const claim of claims) {
      releaseManagerApprovalClaim(args.db, args.tenantId, claim);
    }
    throw error;
  }
}

export function consumeCheckoutApprovals(args: {
  tx: DatabaseInstance;
  tenantId: string;
  requesterId: string;
  claims: ManagerApprovalClaim[];
  saleId: string;
  saleNumber: string;
}): void {
  for (const claim of args.claims) {
    consumeManagerApprovalGrant({
      tx: args.tx,
      tenantId: args.tenantId,
      requesterId: args.requesterId,
      claim,
      saleId: args.saleId,
      saleNumber: args.saleNumber,
    });
  }
}

export function releaseCheckoutApprovals(
  db: DatabaseInstance,
  tenantId: string,
  claims: ManagerApprovalClaim[]
): void {
  for (const claim of claims) {
    releaseManagerApprovalClaim(db, tenantId, claim);
  }
}

export async function enqueueCheckoutApprovalConsumptions(
  ctx: CompleteSaleContext,
  claims: ManagerApprovalClaim[]
): Promise<void> {
  for (const claim of claims) {
    try {
      await enqueueConsumedManagerApproval(ctx, claim.requestId);
    } catch (error) {
      // The sale and grant are already committed. Replication is repairable;
      // surfacing this as a command failure would release the idempotency key
      // and make a retry collide with the already-consumed one-time grant.
      ctx.log?.warn(
        { err: error, requestId: claim.requestId },
        'manager approval consumption sync enqueue failed after sale commit'
      );
    }
  }
}
