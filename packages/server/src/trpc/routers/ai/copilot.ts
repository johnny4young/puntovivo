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
import { adminProcedure } from '../../middleware/roles.js';
import {
  resolveAISettings,
  runCopilotChat,
  setCopilotResponseMode,
} from '../../../services/ai/index.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { requireCopilotQuotasForSites } from '../../../services/ai/quotas.js';
import { resolveCopilotQuotaSites } from '../../../services/ai/copilot/scope.js';
import { copilotChatInput, copilotResponseModeInput } from '../../schemas/ai.js';
import { withClientAbortSignal } from '../../request-abort.js';

export const copilotRouter = router({
  setResponseMode: adminProcedure
    .input(copilotResponseModeInput)
    .mutation(({ ctx, input }) =>
      setCopilotResponseMode(ctx.db, ctx.tenantId, ctx.user!.id, input.responseMode)
    ),

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
      // The body selects the analytics data scope; the header only gives the
      // model a UI focus site. A tenant-wide snapshot consumes the quota of
      // every site it can read, rather than bypassing per-site quotas.
      const quotaSiteIds = await resolveCopilotQuotaSites(
        ctx.db,
        ctx.tenantId,
        input.context?.siteId
      );
      await requireCopilotQuotasForSites({
        db: ctx.db,
        tenantId: ctx.tenantId,
        siteIds: quotaSiteIds,
      });
      const userId = ctx.user?.id ?? null;
      return withClientAbortSignal(ctx.res, abortSignal =>
        runCopilotChat(
          {
            db: ctx.db,
            tenantId: ctx.tenantId,
            siteId: ctx.siteId,
            userId,
            ...(abortSignal ? { abortSignal } : {}),
          },
          input,
          { scopeSiteIds: quotaSiteIds }
        )
      );
    }),
});
