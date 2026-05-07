/**
 * ENG-030/031 — AI router.
 *
 * Seven procedure groups:
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
 * - `ai.anomalies.list` — manager/admin local-only anomaly detection
 *   for the dashboard tile.
 *
 * @module trpc/routers/ai
 */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { router } from '../init.js';
import { adminProcedure } from '../middleware/roles.js';
import { managerOrAdminProcedureWithModule } from '../middleware/modules.js';
import {
  ANALYSIS_WINDOW_DAYS,
  byBreakdown,
  completeAI,
  currentMonthSpend,
  detectAnomalies,
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
  anomalyListInput,
  anomalySnoozeInput,
  copilotChatInput,
  aiUsageInput,
  updateAISettingsInput,
} from '../schemas/ai.js';
import { aiAnomalySnoozes, users } from '../../db/schema.js';

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
  // ENG-068 — gated behind the `copilot` module. The role check
  // (managerOrAdmin) still applies; a manager whose tenant has the
  // module deactivated sees FORBIDDEN with `MODULE_NOT_ACTIVATED`.
  chat: managerOrAdminProcedureWithModule('copilot')
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

/**
 * ENG-032 — anomalies sub-router.
 *
 * `list` returns the four-detector aggregate. `managerOrAdminProcedure`
 * gates out cashiers (already excluded from `/dashboard` at the
 * sidebar level; this is defense-in-depth at the API layer).
 *
 * Behavior contract:
 *   - When `tenants.settings.ai.enabled === false`, return an empty
 *     result without running the detector queries. UX consistency
 *     with `ai.copilot.chat` and `ai.completeTest`: the operator can
 *     flip the master toggle off and every AI surface short-circuits
 *     in the same way.
 *   - When `from > to`, throw BAD_REQUEST. No errorCode (plain Zod
 *     input shape error).
 *   - When `from` / `to` omitted, default window is the last
 *     `ANALYSIS_WINDOW_DAYS` (30) days ending at `now`.
 */
const anomaliesRouter = router({
  // ENG-068 — gated behind the `anomaly-detection` module. Tenant
  // can hide the dashboard tile + drill-down modal without disabling
  // the broader `ai.enabled` flag (e.g. AI Wave 1 chat stays on, but
  // anomaly tile hides for tenants on a basic plan).
  list: managerOrAdminProcedureWithModule('anomaly-detection')
    .input(anomalyListInput)
    .query(async ({ ctx, input }) => {
      const settings = await resolveAISettings(ctx.db, ctx.tenantId);
      const now = new Date();
      const computedAt = now.toISOString();

      if (!settings.enabled) {
        return {
          enabled: false,
          alerts: [],
          totalCount: 0,
          severityCounts: { medium: 0, high: 0 } as const,
          kindCounts: {
            ticketsPerHourSpike: 0,
            voidRate: 0,
            refundAmount: 0,
            noSaleSessions: 0,
          } as const,
          computedAt,
        };
      }

      const to = input.to ? new Date(input.to) : now;
      const from = input.from
        ? new Date(input.from)
        : new Date(to.getTime() - ANALYSIS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

      if (from.getTime() > to.getTime()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'from must be earlier than or equal to to',
        });
      }

      const result = await detectAnomalies(ctx.db, {
        tenantId: ctx.tenantId,
        from,
        to,
      });

      return { ...result, enabled: true, computedAt };
    }),

  /**
   * ENG-047 — silence an anomaly for a chosen window. The dashboard
   * tile + modal call this when the manager has investigated and
   * confirmed an alert is legitimate. Future runs of the detector
   * filter alerts whose `(kind, cashierId, evidenceRef)` matches an
   * unexpired row in `ai_anomaly_snoozes`.
   */
  // ENG-068 — same module gate as `list`. Snooze is meaningless when
  // the surface that would surface the alerts is hidden.
  snooze: managerOrAdminProcedureWithModule('anomaly-detection')
    .input(anomalySnoozeInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Snoozing an anomaly requires an authenticated manager',
        });
      }
      const now = new Date();
      const snoozedUntil = new Date(now.getTime() + input.durationDays * 24 * 60 * 60 * 1000);
      if (input.cashierId !== null) {
        const cashier = await ctx.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, input.cashierId), eq(users.tenantId, ctx.tenantId)))
          .get();
        if (!cashier) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot snooze an anomaly for a cashier outside the active tenant',
          });
        }
      }
      await ctx.db.insert(aiAnomalySnoozes).values({
        id: nanoid(),
        tenantId: ctx.tenantId,
        kind: input.kind,
        cashierId: input.cashierId,
        evidenceRef: input.evidenceRef ?? null,
        snoozedUntil: snoozedUntil.toISOString(),
        snoozedBy: userId,
        reason: input.reason ?? null,
        createdAt: now.toISOString(),
      });
      return { ok: true as const, snoozedUntil: snoozedUntil.toISOString() };
    }),
});

export const aiRouter = router({
  settings: settingsRouter,
  copilot: copilotRouter,
  anomalies: anomaliesRouter,

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
