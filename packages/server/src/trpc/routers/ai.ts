/**
 * ENG-030/031 — AI router.
 *
 * Six procedure groups:
 * - `ai.settings.get` — current AI configuration + provider availability
 *   + this-month spend.
 * - `ai.settings.update` — partial patch on `tenants.settings.ai`.
 *   Rejects setting `providerId` to a notImplemented stub.
 * - `ai.usage` — paginated audit-log read.
 * - `ai.usageByBreakdown` — group-by report (site / user / feature /
 *   provider) for multi-site cost governance.
 * - `ai.completeTest` — fixed "ping" prompt that exercises the full
 *   pipeline so the operator can validate the env var + provider
 *   round-trip without waiting for ENG-031.
 * - `ai.copilot.chat` — manager/admin conversational analytics over a
 *   bounded tenant-scoped snapshot.
 *
 * @module trpc/routers/ai
 */
import { router } from '../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import {
  byBreakdown,
  completeAI,
  currentMonthSpend,
  isNotImplemented,
  listProviders,
  listUsage,
  resolveAISettings,
  runCopilotChat,
  writeAISettings,
} from '../../services/ai/index.js';
import { getProvider } from '../../services/ai/providers/registry.js';
import { throwServerError } from '../../lib/errorCodes.js';
import {
  aiBreakdownInput,
  copilotChatInput,
  aiUsageInput,
  updateAISettingsInput,
} from '../schemas/ai.js';

const settingsRouter = router({
  get: adminProcedure.query(async ({ ctx }) => {
    const settings = await resolveAISettings(ctx.db, ctx.tenantId);
    const provider = getProvider(settings.providerId);
    const spend = await currentMonthSpend(ctx.db, ctx.tenantId);
    return {
      enabled: settings.enabled,
      monthlyBudgetUsd: settings.monthlyBudgetUsd,
      providerId: provider.id,
      modelId: settings.modelId,
      defaultModelId: provider.defaultModelId,
      effectiveModelId: settings.modelId ?? provider.defaultModelId,
      providerConfigured: provider.isConfigured(),
      currentMonthSpendUsd: spend,
      availableProviders: listProviders(),
    };
  }),

  update: adminProcedure
    .input(updateAISettingsInput)
    .mutation(async ({ ctx, input }) => {
      // Reject before-the-fact selection of a notImplemented provider
      // so the admin sees a meaningful error rather than a confusing
      // "looks fine" → "first call fails" UX.
      if (input.providerId) {
        const candidate = getProvider(input.providerId);
        if (isNotImplemented(candidate)) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'AI_PROVIDER_ERROR',
            message: `${candidate.id} provider lands with ${candidate.availableInTicket}`,
          });
        }
      }
      await writeAISettings(ctx.db, ctx.tenantId, input);
      return { ok: true as const };
    }),
});

const copilotRouter = router({
  chat: managerOrAdminProcedure
    .input(copilotChatInput)
    .mutation(async ({ ctx, input }) => {
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

export const aiRouter = router({
  settings: settingsRouter,
  copilot: copilotRouter,

  usage: adminProcedure.input(aiUsageInput).query(async ({ ctx, input }) => {
    return listUsage(ctx.db, ctx.tenantId, {
      limit: input.limit ?? 50,
      cursor: input.cursor,
    });
  }),

  usageByBreakdown: adminProcedure
    .input(aiBreakdownInput)
    .query(async ({ ctx, input }) => {
      return byBreakdown(ctx.db, ctx.tenantId, input.scope, {
        from: input.from ? new Date(input.from) : undefined,
        to: input.to ? new Date(input.to) : undefined,
      });
    }),

  /**
   * End-to-end smoke. Sends a fixed prompt, persists the audit log
   * row, returns the model output. Backs the AI Settings card's
   * "Test connection" button.
   */
  completeTest: adminProcedure.mutation(async ({ ctx }) => {
    // adminProcedure → tenantProcedure → protectedProcedure rejects
    // unauthenticated callers, but the middleware-chain narrowing
    // does not propagate to this handler's ctx type. Defensive guard
    // keeps TypeScript happy and produces a clearer 500 if the chain
    // is ever rewired.
    const userId = ctx.user?.id ?? null;
    const result = await completeAI(
      {
        db: ctx.db,
        tenantId: ctx.tenantId,
        siteId: ctx.siteId,
        userId,
      },
      {
        feature: 'completeTest',
        system:
          'You are the connection-test endpoint of the Puntovivo POS. Reply with a one-line confirmation.',
        prompt: 'Reply with the single word: pong',
        maxOutputTokens: 32,
      }
    );
    return {
      text: result.text,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
      provider: result.provider,
      model: result.model,
    };
  }),
});
