/**
 * AI router — copilot sub-router ( split).
 *
 * `ai.copilot.chat` (manager/admin) — conversational analytics over a bounded
 * tenant-scoped snapshot.  gated behind the `copilot` module;
 * per-site quota check fires before the provider call.
 *
 * @module trpc/routers/ai/copilot
 */

import { router } from '../../init.js';
import { managerOrAdminProcedureWithModule } from '../../middleware/modules.js';
import { resolveAISettings, runCopilotChat } from '../../../services/ai/index.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { requireAiQuotaAvailable } from '../../../services/ai/quotas.js';
import { copilotChatInput } from '../../schemas/ai.js';

export const copilotRouter = router({
  // gated behind the `copilot` module. The role check
  // (managerOrAdmin) still applies; a manager whose tenant has the
  // module deactivated sees FORBIDDEN with `MODULE_NOT_ACTIVATED`.
  chat: managerOrAdminProcedureWithModule('copilot')
    .input(copilotChatInput)
    .mutation(async ({ ctx, input }) => {
      const settings = await resolveAISettings(ctx.db, ctx.tenantId);
      if (!settings.enabled || settings.features?.copilot.enabled !== true) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'AI_DISABLED',
          message: 'Co-pilot is disabled for this tenant',
        });
      }
      // per-site monthly quota check fires BEFORE the
      // provider call so a blocked request never writes an audit
      // row. Bypass when the request has no site context (admin
      // without a selected site); the quota is "per site" by
      // definition, so a site-less call has no bucket to charge.
      if (ctx.siteId) {
        await requireAiQuotaAvailable({
          db: ctx.db,
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          feature: 'copilot',
        });
      }
      const userId = ctx.user?.id ?? null;
      return runCopilotChat(
        {
          db: ctx.db,
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          userId,
        },
        input
      );
    }),
});
