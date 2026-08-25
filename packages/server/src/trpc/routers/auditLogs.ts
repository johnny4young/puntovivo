/**
 * Audit Logs tRPC Router ().
 *
 * Read-only surface for the admin-facing audit viewer. There is no write
 * procedure because audit rows are persisted by the sensitive actions
 * themselves (transfers.void, quotations.delete, quotations.updateStatus
 * when moving to `converted`), each inside its own transaction so the
 * audit and the operation are atomic.
 *
 * @module trpc/routers/auditLogs
 */

import { router } from '../init.js';
import { adminProcedure } from '../middleware/roles.js';
import { listAuditLogs, verifyAuditChain } from '../../services/audit-logs.js';
import { getSensitiveAuditSummary } from '../../services/audit-review.js';
import { listAuditLogsInput, sensitiveAuditSummaryInput } from '../schemas/auditLogs.js';

export const auditLogsRouter = router({
  /**
   * walk the tenant's audit hash chain and report
   * whether every link and content digest still holds. Read-only and
   * tenant-scoped; legacy rows from before the chain shipped are
   * counted separately, never failed.
   */
  verifyChain: adminProcedure.query(({ ctx }) => {
    return verifyAuditChain(ctx.db, ctx.tenantId);
  }),

  list: adminProcedure.input(listAuditLogsInput).query(({ ctx, input }) => {
    const items = listAuditLogs(ctx.db, ctx.tenantId, {
      limit: input?.limit,
      action: input?.action,
      resourceType: input?.resourceType,
      resourceId: input?.resourceId,
      actorId: input?.actorId,
      createdAfter: input?.createdAfter,
      createdBefore: input?.createdBefore,
      sensitiveCategory: input?.sensitiveCategory,
    });
    return { items };
  }),
  sensitiveSummary: adminProcedure.input(sensitiveAuditSummaryInput).query(({ ctx, input }) =>
    getSensitiveAuditSummary(ctx.db, ctx.tenantId, {
      createdAfter: input?.createdAfter,
      createdBefore: input?.createdBefore,
    })
  ),
});
