/**
 * AI router — settings sub-router (ENG-178 split).
 *
 * `ai.settings.get` (manager/admin) — current AI configuration + provider
 * availability + this-month spend + ENG-102 per-site quotas.
 * `ai.settings.update` (admin) — partial patch on `tenants.settings.ai`;
 * rejects setting `providerId` to a notImplemented stub.
 *
 * @module trpc/routers/ai/settings
 */

import { router } from '../../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../../middleware/roles.js';
import {
  currentMonthSpend,
  isNotImplemented,
  listProviders,
  resolveAISettings,
  writeAISettings,
} from '../../../services/ai/index.js';
import { getProvider } from '../../../services/ai/providers/registry.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import {
  projectEmptyAiQuotas,
  projectAiQuotas,
} from '../../../services/ai/quotas.js';
import { updateAISettingsInput } from '../../schemas/ai.js';

export const settingsRouter = router({
  get: managerOrAdminProcedure.query(async ({ ctx }) => {
    const settings = await resolveAISettings(ctx.db, ctx.tenantId);
    const provider = getProvider(settings.providerId);
    const spend = await currentMonthSpend(ctx.db, ctx.tenantId);
    // ENG-102 — per-site quota projection. When the request has no
    // siteId (admin without an active site) we still return the
    // shape so the UI never branches on undefined; the numbers
    // surface as zero / limit / next-month boundary.
    const quotas = ctx.siteId
      ? await projectAiQuotas({
          db: ctx.db,
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
        })
      : projectEmptyAiQuotas();
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
      // ENG-040c slice 2 — capability hint for the AI settings UI.
      // True when the active provider implements Whisper-style audio
      // transcription (OpenAI today). The "Probar transcripción"
      // button reads this so it can disable + tooltip on Anthropic /
      // Ollama tenants without firing a server round-trip.
      transcriptionAvailable: typeof provider.transcriptionModel === 'function',
      // ENG-095 / AI Núcleo 2026-05-15 — per-feature opt-in flags
      // consumed by `useAiFeatureFlag` on the web.
      features: settings.features,
      // ENG-102 — monthly per-site quotas for the features that the
      // website draft makes a numeric promise about. The UI renders
      // a progress bar per feature using `used / limit` and surfaces
      // `resetsAt` so the cashier knows when the counter rolls over.
      quotas,
    };
  }),

  update: adminProcedure
    .input(updateAISettingsInput)
    .mutation(async ({ ctx, input }) => {
      // Reject before-the-fact selection of a notImplemented provider
      // so the admin sees a meaningful error rather than a confusing
      // "looks fine" → "first call fails" UX.
      //
      // ENG-040b slice 1 — currently every registered provider is
      // implemented (Anthropic + OpenAI + Ollama), so this branch is
      // dead in CI. Keep the guard in place because the registry
      // contract still permits `NotImplementedProvider` entries; the
      // next provider that lands as a stub (e.g. a future Google /
      // Mistral integration) gets a regression-coverage assertion
      // re-added in `ai-router.test.ts` at the same time as it lands.
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
