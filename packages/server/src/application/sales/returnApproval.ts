import type { UserRole } from '@puntovivo/shared/roles';
import type { DatabaseInstance } from '../../db/index.js';
import {
  evaluateShiftLossPrevention,
  summarizeShiftApproval,
  type ShiftApprovalSummary,
} from '../../services/loss-prevention/index.js';

/** The approval a return of this amount will need at commit, read without claiming anything. */
export function previewReturnApproval(
  db: DatabaseInstance,
  scope: { tenantId: string; siteId: string; actorId: string; role: UserRole },
  refundAmount: number
): ShiftApprovalSummary {
  return summarizeShiftApproval(
    evaluateShiftLossPrevention({ db, ...scope, action: 'sale_refund', amount: refundAmount })
  );
}
