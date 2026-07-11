/**
 * ENG-030 — Provider-agnostic AI completion pipeline.
 *
 * Reads tenant settings → enforces enabled / budget gates → calls the
 * configured provider → records cost + tokens to `ai_audit_log`.
 *
 * The renderer never invokes this module directly; the tRPC layer
 * (`ai.completeTest` in this ticket; `ai.copilot.chat` in ENG-031;
 * `ai.embedProducts` in ENG-033) is the single entry point.
 *
 * @module services/ai/client
 */
import { generateText } from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import { eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { tenants } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';

import { currentMonthSpend, recordCall } from './auditLog.js';
import { getProvider, isNotImplemented } from './providers/registry.js';
import type { AIProvider, TokenUsage } from './providers/types.js';
import type { AICompletionInput, AICompletionResult, AISettings } from './types.js';
import { DEFAULT_AI_FEATURE_FLAGS, DEFAULT_AI_SETTINGS } from './types.js';
import type { AIFeatureFlags } from './types.js';

export interface AIInvocationContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string | null;
  userId: string | null;
}

/**
 * Read `tenants.settings.ai` for a tenant, falling back to
 * `DEFAULT_AI_SETTINGS` for any field the row hasn't set yet. Returned
 * value is type-safe even when the JSON blob contains garbage.
 */
export async function resolveAISettings(
  db: DatabaseInstance,
  tenantId: string
): Promise<AISettings> {
  const tenant = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const blob = (tenant?.settings ?? {}) as Record<string, unknown>;
  const ai = (blob.ai ?? {}) as Partial<AISettings>;
  return {
    enabled: typeof ai.enabled === 'boolean' ? ai.enabled : DEFAULT_AI_SETTINGS.enabled,
    monthlyBudgetUsd:
      typeof ai.monthlyBudgetUsd === 'number' && ai.monthlyBudgetUsd >= 0
        ? ai.monthlyBudgetUsd
        : DEFAULT_AI_SETTINGS.monthlyBudgetUsd,
    providerId:
      ai.providerId === 'anthropic' ||
      ai.providerId === 'openai' ||
      ai.providerId === 'ollama'
        ? ai.providerId
        : DEFAULT_AI_SETTINGS.providerId,
    modelId: typeof ai.modelId === 'string' && ai.modelId.length > 0 ? ai.modelId : null,
    features: mergeFeatureFlags(ai.features),
  };
}

function mergeFeatureFlags(raw: unknown): AIFeatureFlags {
  const incoming = (raw && typeof raw === 'object' ? raw : {}) as Partial<AIFeatureFlags>;
  return {
    copilot: {
      enabled:
        typeof incoming.copilot?.enabled === 'boolean'
          ? incoming.copilot.enabled
          : DEFAULT_AI_FEATURE_FLAGS.copilot.enabled,
    },
    anomalies: {
      enabled:
        typeof incoming.anomalies?.enabled === 'boolean'
          ? incoming.anomalies.enabled
          : DEFAULT_AI_FEATURE_FLAGS.anomalies.enabled,
      alertSeverityThreshold:
        incoming.anomalies?.alertSeverityThreshold === 'alta' ||
        incoming.anomalies?.alertSeverityThreshold === 'media'
          ? incoming.anomalies.alertSeverityThreshold
          : DEFAULT_AI_FEATURE_FLAGS.anomalies.alertSeverityThreshold,
    },
    semanticSearch: {
      enabled:
        typeof incoming.semanticSearch?.enabled === 'boolean'
          ? incoming.semanticSearch.enabled
          : DEFAULT_AI_FEATURE_FLAGS.semanticSearch.enabled,
    },
    invoiceOcr: {
      enabled:
        typeof incoming.invoiceOcr?.enabled === 'boolean'
          ? incoming.invoiceOcr.enabled
          : DEFAULT_AI_FEATURE_FLAGS.invoiceOcr.enabled,
      provider:
        incoming.invoiceOcr?.provider === 'textract' ||
        incoming.invoiceOcr?.provider === 'docai' ||
        incoming.invoiceOcr?.provider === 'azure'
          ? incoming.invoiceOcr.provider
          : DEFAULT_AI_FEATURE_FLAGS.invoiceOcr.provider,
    },
    privacy: {
      piiRedaction: true,
      modelLocation:
        incoming.privacy?.modelLocation === 'on-prem' || incoming.privacy?.modelLocation === 'us'
          ? incoming.privacy.modelLocation
          : DEFAULT_AI_FEATURE_FLAGS.privacy.modelLocation,
    },
  };
}

function mergePatchFeatures(
  current: AIFeatureFlags | undefined,
  patch: PartialAIFeatureFlags | undefined
): AIFeatureFlags {
  const base = current ?? DEFAULT_AI_FEATURE_FLAGS;
  if (!patch) return base;
  // ENG-179b — patch fields are `T | undefined` under
  // `exactOptionalPropertyTypes`; `stripUndefined` drops the
  // explicit-undefined keys so the spread merges only defined values
  // (matching the historical pre-flag runtime behavior).
  const stripUndefined = <T extends Record<string, unknown>>(value: T | undefined): Partial<T> => {
    if (!value) return {};
    const out: Partial<T> = {};
    for (const key of Object.keys(value) as Array<keyof T>) {
      if (value[key] !== undefined) {
        out[key] = value[key];
      }
    }
    return out;
  };
  // The spread of a `Partial<T>` includes optional `| undefined` fields
  // at the type level even after `stripUndefined` removes them at
  // runtime. The structural compatibility check is satisfied because
  // every potentially-undefined slot is backed by the corresponding
  // `base.*` value, so the merged shape is always complete; the
  // assertion captures that runtime invariant for the type-checker.
  return {
    copilot: { ...base.copilot, ...stripUndefined(patch.copilot) } as AIFeatureFlags['copilot'],
    anomalies: { ...base.anomalies, ...stripUndefined(patch.anomalies) } as AIFeatureFlags['anomalies'],
    semanticSearch: { ...base.semanticSearch, ...stripUndefined(patch.semanticSearch) } as AIFeatureFlags['semanticSearch'],
    invoiceOcr: { ...base.invoiceOcr, ...stripUndefined(patch.invoiceOcr) } as AIFeatureFlags['invoiceOcr'],
    privacy: { ...base.privacy, ...stripUndefined(patch.privacy), piiRedaction: true } as AIFeatureFlags['privacy'],
  };
}

// ENG-179b — explicit `| undefined` on every optional field, including
// inside the nested feature partials, so Zod-decoded payloads (which
// carry explicit-undefined fields) assign under
// `exactOptionalPropertyTypes`. Plain `Partial<T>` makes fields
// `T | undefined` only at the type-system level; the assignability
// rules under exactOptional require the explicit annotation here.
type PartialWithExplicitUndefined<T> = {
  [K in keyof T]?: T[K] | undefined;
};

type PartialAIFeatureFlags = {
  copilot?: PartialWithExplicitUndefined<AIFeatureFlags['copilot']> | undefined;
  anomalies?: PartialWithExplicitUndefined<AIFeatureFlags['anomalies']> | undefined;
  semanticSearch?: PartialWithExplicitUndefined<AIFeatureFlags['semanticSearch']> | undefined;
  invoiceOcr?: PartialWithExplicitUndefined<AIFeatureFlags['invoiceOcr']> | undefined;
  privacy?: PartialWithExplicitUndefined<AIFeatureFlags['privacy']> | undefined;
};

/**
 * Persist (a partial patch of) `tenants.settings.ai`.
 *
 * The `features` patch may be partial-of-partial — AiConfigPage only
 * sends the leaves that the operator touched. `mergePatchFeatures`
 * merges shallowly while preserving the rest of the resolved shape.
 */
// ENG-179b — explicit `| undefined` on each optional field so the
// tRPC router can forward Zod-optional fields (which decode to
// `T | null | undefined` for `.nullable().optional()` schemas).
export type WriteAISettingsPatch = {
  enabled?: boolean | undefined;
  monthlyBudgetUsd?: number | undefined;
  providerId?: AISettings['providerId'] | undefined;
  modelId?: AISettings['modelId'] | undefined;
  features?: PartialAIFeatureFlags | undefined;
};

export async function writeAISettings(
  db: DatabaseInstance,
  tenantId: string,
  patch: WriteAISettingsPatch
): Promise<AISettings> {
  const current = await resolveAISettings(db, tenantId);
  const next: AISettings = {
    enabled: patch.enabled ?? current.enabled,
    monthlyBudgetUsd:
      patch.monthlyBudgetUsd !== undefined
        ? patch.monthlyBudgetUsd
        : current.monthlyBudgetUsd,
    providerId:
      patch.providerId !== undefined ? patch.providerId : current.providerId,
    modelId: patch.modelId !== undefined ? patch.modelId : current.modelId,
    features: mergePatchFeatures(current.features, patch.features),
  };

  const tenant = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
  settings.ai = next;
  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date().toISOString() })
    .where(eq(tenants.id, tenantId));
  return next;
}

/**
 * Test-only injection point. The default factory delegates to the
 * registry; tests pass a stub provider to bypass the network call
 * without touching env vars or the SDK internals.
 */
export type ProviderFactory = (id: AISettings['providerId']) => AIProvider;

const defaultFactory: ProviderFactory = id => {
  const provider = getProvider(id);
  if (isNotImplemented(provider)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_PROVIDER_ERROR',
      message: `${provider.id} provider lands with ${provider.availableInTicket}`,
    });
  }
  return provider;
};

// ENG-179b — explicit `| undefined` on all optionals so the Vercel AI
// SDK's `LanguageModelUsage` shape (which carries explicit-undefined
// fields) assigns cleanly under `exactOptionalPropertyTypes`.
interface UsageForPricing {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  inputTokenDetails?:
    | {
        noCacheTokens?: number | undefined;
        cacheReadTokens?: number | undefined;
        cacheWriteTokens?: number | undefined;
      }
    | undefined;
}

function tokenCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function toBillableTokenUsage(usage: UsageForPricing): TokenUsage {
  const totalInputTokens = tokenCount(usage.inputTokens);
  const cacheReadTokens = tokenCount(usage.inputTokenDetails?.cacheReadTokens);
  const cacheWriteTokens = tokenCount(usage.inputTokenDetails?.cacheWriteTokens);
  const noCacheTokens =
    usage.inputTokenDetails?.noCacheTokens ??
    Math.max(totalInputTokens - cacheReadTokens - cacheWriteTokens, 0);

  return {
    inputTokens: tokenCount(noCacheTokens),
    outputTokens: tokenCount(usage.outputTokens),
    cacheReadTokens,
    cacheWriteTokens,
  };
}

/**
 * Run a single completion against the configured provider. Throws via
 * `throwServerError` for every gating failure (`AI_DISABLED`,
 * `AI_BUDGET_EXCEEDED`, `AI_PROVIDER_ERROR`); successful calls return
 * the model output plus the audit-log row id.
 */
export async function completeAI(
  ctx: AIInvocationContext,
  input: AICompletionInput,
  factory: ProviderFactory = defaultFactory
): Promise<AICompletionResult> {
  const settings = await resolveAISettings(ctx.db, ctx.tenantId);
  if (!settings.enabled) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_DISABLED',
      message: 'AI features are disabled for this tenant',
    });
  }

  const provider = factory(settings.providerId);

  if (!provider.isConfigured()) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_PROVIDER_ERROR',
      message: `Provider ${provider.id} is not configured (set the API key env var)`,
    });
  }

  if (settings.monthlyBudgetUsd <= 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_BUDGET_EXCEEDED',
      message: 'AI monthly budget is zero',
    });
  }

  const spent = await currentMonthSpend(ctx.db, ctx.tenantId);
  if (spent >= settings.monthlyBudgetUsd) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_BUDGET_EXCEEDED',
      message: `AI monthly budget exhausted ($${spent.toFixed(4)} of $${settings.monthlyBudgetUsd.toFixed(2)})`,
    });
  }

  const modelId = input.modelId ?? settings.modelId ?? provider.defaultModelId;
  const startedAt = Date.now();

  try {
    const providerOptions = provider.cacheControlForSystemPrompt();
    const result = await generateText({
      model: provider.languageModel(modelId),
      ...(input.system !== undefined ? { instructions: input.system } : {}),
      prompt: input.prompt,
      ...(input.maxOutputTokens !== undefined
        ? { maxOutputTokens: input.maxOutputTokens }
        : {}),
      ...(providerOptions !== undefined
        ? { providerOptions: providerOptions as ProviderOptions }
        : {}),
    });

    const inputTokens = result.usage.inputTokens ?? 0;
    const outputTokens = result.usage.outputTokens ?? 0;
    const cacheReadTokens = result.usage.inputTokenDetails?.cacheReadTokens ?? 0;
    const cacheWriteTokens = result.usage.inputTokenDetails?.cacheWriteTokens ?? 0;
    const costUsd = provider.pricing.calculateCostUsd(
      modelId,
      toBillableTokenUsage(result.usage)
    );
    const durationMs = Date.now() - startedAt;

    const { id: auditLogId } = await recordCall(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      userId: ctx.userId,
      feature: input.feature,
      providerId: provider.id,
      modelId,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      costUsd,
      durationMs,
      errorCode: null,
    });

    return {
      text: result.text,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      costUsd,
      durationMs,
      provider: provider.id,
      model: modelId,
      auditLogId,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    // Persist the failure so dashboards count it. Cost is zero — the
    // call never billed against the tenant's spend.
    await recordCall(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      userId: ctx.userId,
      feature: input.feature,
      providerId: provider.id,
      modelId,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      durationMs,
      errorCode: 'AI_PROVIDER_ERROR',
    });
    throwServerError({
      trpcCode: 'BAD_GATEWAY',
      errorCode: 'AI_PROVIDER_ERROR',
      message:
        error instanceof Error ? error.message : 'AI provider call failed',
      details: { cause: String(error) },
    });
  }
}
