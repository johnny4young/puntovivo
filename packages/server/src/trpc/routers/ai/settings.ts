/**
 * AI settings sub-router.
 *
 * `ai.settings.get` (manager/admin) — current AI configuration + provider
 * availability, current-month spend, and per-site quotas.
 * `ai.settings.update` (admin) — partial patch on `tenants.settings.ai`;
 * accepts any provider registered by the server.
 *
 * @module trpc/routers/ai/settings
 */

import { router } from '../../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../../middleware/roles.js';
import {
  currentMonthSpend,
  listProviders,
  resolveAISettings,
  writeAISettings,
} from '../../../services/ai/index.js';
import { getProvider } from '../../../services/ai/providers/registry.js';
import { projectEmptyAiQuotas, projectAiQuotas } from '../../../services/ai/quotas.js';
import { updateAISettingsInput } from '../../schemas/ai.js';

export const settingsRouter = router({
  get: managerOrAdminProcedure.query(async ({ ctx }) => {
    const settings = await resolveAISettings(ctx.db, ctx.tenantId);
    const provider = getProvider(settings.providerId);
    const spend = await currentMonthSpend(ctx.db, ctx.tenantId);
    // per-site quota projection. When the request has no
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
      // Capability hint for the AI settings UI.
      // True when the active provider implements Whisper-style audio
      // transcription (OpenAI today). The "Probar transcripción"
      // button reads this so it can disable + tooltip on Anthropic /
      // Ollama tenants without firing a server round-trip.
      transcriptionAvailable: typeof provider.transcriptionModel === 'function',
      // Per-feature opt-in flags
      // consumed by `useAiFeatureFlag` on the web.
      features: settings.features,
      // monthly per-site quotas for the features that the
      // website draft makes a numeric promise about. The UI renders
      // a progress bar per feature using `used / limit` and surfaces
      // `resetsAt` so the cashier knows when the counter rolls over.
      quotas,
    };
  }),

  update: adminProcedure.input(updateAISettingsInput).mutation(async ({ ctx, input }) => {
    await writeAISettings(ctx.db, ctx.tenantId, input);
    return { ok: true as const };
  }),
});
