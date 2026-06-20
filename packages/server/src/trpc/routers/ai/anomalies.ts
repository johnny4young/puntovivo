/**
 * AI router — anomalies sub-router (ENG-178 split).
 *
 * ENG-032 — `ai.anomalies.list` (manager/admin) returns the four-detector
 * aggregate; ENG-047 — `ai.anomalies.snooze` silences an alert for a window.
 * Both ENG-068 gated behind the `anomaly-detection` module.
 *
 * @module trpc/routers/ai/anomalies
 */

import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { router } from '../../init.js';
import { managerOrAdminProcedureWithModule } from '../../middleware/modules.js';
import {
  ANALYSIS_WINDOW_DAYS,
  detectAnomalies,
  resolveAISettings,
} from '../../../services/ai/index.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { writeAuditLog } from '../../../services/audit-logs.js';
import { anomalyListInput, anomalySnoozeInput } from '../../schemas/ai.js';
import { aiAnomalySnoozes, users } from '../../../db/schema.js';

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
export const anomaliesRouter = router({
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

      if (!settings.enabled || settings.features?.anomalies.enabled !== true) {
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
      const settings = await resolveAISettings(ctx.db, ctx.tenantId);
      if (!settings.enabled || settings.features?.anomalies.enabled !== true) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'AI_DISABLED',
          message: 'AI anomaly detection is disabled for this tenant',
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
      const snoozeId = nanoid();
      await ctx.db.insert(aiAnomalySnoozes).values({
        id: snoozeId,
        tenantId: ctx.tenantId,
        kind: input.kind,
        cashierId: input.cashierId,
        evidenceRef: input.evidenceRef ?? null,
        snoozedUntil: snoozedUntil.toISOString(),
        snoozedBy: userId,
        reason: input.reason ?? null,
        createdAt: now.toISOString(),
      });
      // ENG-095 / AI Núcleo 2026-05-15 — surface anomaly silence on
      // AiConfigPage's audit table so the operator sees who muted what.
      writeAuditLog({
        tx: ctx.db,
        tenantId: ctx.tenantId,
        actorId: userId,
        action: 'ai.anomaly.silenced',
        resourceType: 'ai_feature',
        resourceId: snoozeId,
        metadata: {
          kind: input.kind,
          cashierId: input.cashierId,
          evidenceRef: input.evidenceRef ?? null,
          durationDays: input.durationDays,
          snoozedUntil: snoozedUntil.toISOString(),
          reason: input.reason ?? null,
        },
      });
      return { ok: true as const, snoozedUntil: snoozedUntil.toISOString() };
    }),
});
