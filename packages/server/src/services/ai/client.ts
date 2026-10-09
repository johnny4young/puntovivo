/**
 * Provider-agnostic AI completion pipeline.
 *
 * Reads tenant settings → enforces enabled / budget gates → calls the
 * configured provider → records cost + tokens to `ai_audit_log`.
 *
 * The renderer never invokes this module directly; the tRPC layer is
 * the single entry point for connection tests, copilot, and embeddings.
 *
 * @module services/ai/client
 */
import { generateText } from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { tenants } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { createModuleLogger } from '../../logging/logger.js';
import { writeAuditLog } from '../audit-logs.js';

import { reserveAiBudget, settleAiBudget } from './budget.js';
import { isDefinitiveProviderRejection } from './provider-rejection.js';
import { logProviderFailure } from './provider-error.js';
import { getProvider } from './providers/registry.js';
import type { AIProvider, TokenUsage } from './providers/types.js';
import type {
  AICompletionInput,
  AICompletionResult,
  AISettings,
  CopilotResponseMode,
} from './types.js';
import { DEFAULT_AI_FEATURE_FLAGS, DEFAULT_AI_SETTINGS } from './types.js';
import type { AIFeatureFlags } from './types.js';

export interface AIInvocationContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string | null;
  userId: string | null;
  /**
   * Request cancellation (e.g. the HTTP client disconnected). It cancels only
   * work that has not been dispatched: once a provider request is sent, it
   * runs to its own bounded deadline and settles with its known cost, because
   * aborting it would turn a priced call into an unknown-cost liability that
   * holds the tenant's AI budget.
   */
  abortSignal?: AbortSignal;
}

/**
 * Read `tenants.settings.ai` for a tenant, falling back to
 * `DEFAULT_AI_SETTINGS` for any field the row hasn't set yet. Returned
 * value is type-safe even when the JSON blob contains garbage.
 */
export function resolveAISettingsInTransaction(db: DatabaseInstance, tenantId: string): AISettings {
  const tenant = db
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
      ai.providerId === 'anthropic' || ai.providerId === 'openai' || ai.providerId === 'ollama'
        ? ai.providerId
        : DEFAULT_AI_SETTINGS.providerId,
    modelId: typeof ai.modelId === 'string' && ai.modelId.length > 0 ? ai.modelId : null,
    features: mergeFeatureFlags(ai.features),
  };
}

// Preserve the existing Promise API for callers outside a SQLite writer.
export async function resolveAISettings(
  db: DatabaseInstance,
  tenantId: string
): Promise<AISettings> {
  return resolveAISettingsInTransaction(db, tenantId);
}

function mergeFeatureFlags(raw: unknown): AIFeatureFlags {
  const incoming = (raw && typeof raw === 'object' ? raw : {}) as Partial<AIFeatureFlags>;
  return {
    copilot: {
      enabled:
        typeof incoming.copilot?.enabled === 'boolean'
          ? incoming.copilot.enabled
          : DEFAULT_AI_FEATURE_FLAGS.copilot.enabled,
      responseMode:
        incoming.copilot?.responseMode === 'verified' || incoming.copilot?.responseMode === 'guided'
          ? incoming.copilot.responseMode
          : DEFAULT_AI_FEATURE_FLAGS.copilot.responseMode,
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
      piiRedaction: false,
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
  // patch fields are `T | undefined` under
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
    anomalies: {
      ...base.anomalies,
      ...stripUndefined(patch.anomalies),
    } as AIFeatureFlags['anomalies'],
    semanticSearch: {
      ...base.semanticSearch,
      ...stripUndefined(patch.semanticSearch),
    } as AIFeatureFlags['semanticSearch'],
    invoiceOcr: {
      ...base.invoiceOcr,
      ...stripUndefined(patch.invoiceOcr),
    } as AIFeatureFlags['invoiceOcr'],
    privacy: {
      ...base.privacy,
      ...stripUndefined(patch.privacy),
      piiRedaction: false,
    } as AIFeatureFlags['privacy'],
  };
}

// explicit `| undefined` on every optional field, including
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
// explicit `| undefined` on each optional field so the
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
      patch.monthlyBudgetUsd !== undefined ? patch.monthlyBudgetUsd : current.monthlyBudgetUsd,
    providerId: patch.providerId !== undefined ? patch.providerId : current.providerId,
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
 * Change the tenant-wide Co-pilot response contract and record the admin
 * decision in the immutable audit log inside the same SQLite transaction.
 * The dedicated path intentionally keeps `responseMode` out of the generic
 * AI settings patch so only this audited mutation can change it.
 */
export async function setCopilotResponseMode(
  db: DatabaseInstance,
  tenantId: string,
  actorId: string,
  responseMode: CopilotResponseMode
): Promise<{ responseMode: CopilotResponseMode; changed: boolean }> {
  return db.transaction(tx => {
    const tenant = tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();
    if (!tenant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    const settings =
      tenant.settings && typeof tenant.settings === 'object'
        ? (tenant.settings as Record<string, unknown>)
        : {};
    const rawAi =
      settings.ai && typeof settings.ai === 'object'
        ? (settings.ai as Record<string, unknown>)
        : {};
    const rawFeatures =
      rawAi.features && typeof rawAi.features === 'object' ? rawAi.features : undefined;
    const features = mergeFeatureFlags(rawFeatures);
    const previousMode = features.copilot.responseMode;
    if (previousMode === responseMode) {
      return { responseMode, changed: false };
    }

    const nextFeatures: AIFeatureFlags = {
      ...features,
      copilot: { ...features.copilot, responseMode },
    };
    const now = new Date().toISOString();
    tx.update(tenants)
      .set({
        settings: {
          ...settings,
          ai: { ...rawAi, features: nextFeatures },
        },
        updatedAt: now,
      })
      .where(eq(tenants.id, tenantId))
      .run();

    writeAuditLog({
      tx,
      tenantId,
      actorId,
      action: 'ai.copilot.response_mode.updated',
      resourceType: 'ai_feature',
      resourceId: 'copilot',
      before: { responseMode: previousMode },
      after: { responseMode },
    });

    return { responseMode, changed: true };
  });
}

/**
 * Test-only injection point. The default factory delegates to the
 * registry; tests pass a stub provider to bypass the network call
 * without touching env vars or the SDK internals.
 */
export type ProviderFactory = (id: AISettings['providerId']) => AIProvider;

const defaultFactory: ProviderFactory = id => getProvider(id);

// explicit `| undefined` on all optionals so the Vercel AI
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

const log = createModuleLogger('services/ai/client');

/**
 * Settle an admission and sanitize a persistence failure. Shared by every
 * reservation entry point (generic completions and Co-pilot chat).
 */
export function settleCompletion(...args: Parameters<typeof settleAiBudget>): { id: string } {
  try {
    return settleAiBudget(...args);
  } catch (error) {
    // The kernel rolls back audit and settlement together. Keep its durable
    // hold, but never expose a private persistence diagnostic to the caller.
    // Operators still need a signal: the hold stays pending until orphan
    // recovery, so log the failure class (never the raw error or SQL).
    log.error(
      {
        tenantId: args[1].tenantId,
        reservationId: args[1].id,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      },
      'AI budget settlement failed'
    );
    return throwServerError({
      trpcCode: 'BAD_GATEWAY',
      errorCode: 'AI_PROVIDER_ERROR',
      message: 'AI call could not be recorded',
    });
  }
}

function isKnownTokenCount(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** A valid provider counter, or zero for a missing or malformed one. */
export function tokenCount(value: number | undefined): number {
  return isKnownTokenCount(value) ? value : 0;
}

/**
 * Whether remote usage is complete and non-empty enough to price. Any
 * malformed counter keeps the call's cost unknown instead of free.
 */
export function hasUsableRemoteUsage(usage: UsageForPricing): boolean {
  return (
    isKnownTokenCount(usage.inputTokens) &&
    isKnownTokenCount(usage.outputTokens) &&
    [
      usage.inputTokenDetails?.noCacheTokens,
      usage.inputTokenDetails?.cacheReadTokens,
      usage.inputTokenDetails?.cacheWriteTokens,
    ].every(value => value === undefined || isKnownTokenCount(value)) &&
    tokenCount(usage.inputTokens) +
      tokenCount(usage.outputTokens) +
      tokenCount(usage.inputTokenDetails?.cacheReadTokens) +
      tokenCount(usage.inputTokenDetails?.cacheWriteTokens) >
      0
  );
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

  // Preparation hooks have not dispatched a request: sanitize their errors,
  // but do not manufacture an unknown bill or reserve the tenant's budget.
  let provider: AIProvider;
  let configured: boolean;
  try {
    provider = factory(settings.providerId);
    configured = provider.isConfigured();
  } catch {
    throwServerError({
      trpcCode: 'BAD_GATEWAY',
      errorCode: 'AI_PROVIDER_ERROR',
      message: 'AI provider call failed',
    });
  }

  if (!configured) {
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

  const modelId = input.modelId ?? settings.modelId ?? provider.defaultModelId;
  let model: ReturnType<AIProvider['languageModel']>;
  let providerOptions: ReturnType<AIProvider['cacheControlForSystemPrompt']>;
  try {
    model = provider.languageModel(modelId);
    providerOptions = provider.cacheControlForSystemPrompt();
  } catch (error) {
    logProviderFailure(error, {
      tenantId: ctx.tenantId,
      feature: input.feature,
      providerId: provider.id,
      modelId,
      errorCode: 'AI_PROVIDER_ERROR',
    });
    throwServerError({
      trpcCode: 'BAD_GATEWAY',
      errorCode: 'AI_PROVIDER_ERROR',
      message: 'AI provider call failed',
    });
  }
  ctx.abortSignal?.throwIfAborted();
  const reservation = reserveAiBudget(ctx.db, ctx.tenantId);
  const startedAt = Date.now();
  const auditBase = {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    userId: ctx.userId,
    feature: input.feature,
    providerId: provider.id,
    modelId,
  };

  let result;
  try {
    result = await generateText({
      model,
      ...(input.system !== undefined ? { instructions: input.system } : {}),
      prompt: input.prompt,
      ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {}),
      // No client abort signal here (see AIInvocationContext.abortSignal).
      timeout: { totalMs: 60_000 },
      maxRetries: 0,
      ...(providerOptions !== undefined
        ? { providerOptions: providerOptions as ProviderOptions }
        : {}),
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    logProviderFailure(error, {
      tenantId: ctx.tenantId,
      feature: input.feature,
      providerId: provider.id,
      modelId,
      errorCode: 'AI_PROVIDER_ERROR',
    });
    // The SDK may have sent this request before failure or our deadline;
    // zero is not evidence of a free provider call. A definitive provider
    // rejection (pre-inference 4xx answer) or a connection that was never
    // established proves no billable work and releases the hold.
    const notIncurred = isDefinitiveProviderRejection(error);
    const uncertainRemoteCost = provider.id !== 'ollama' && !notIncurred;
    settleCompletion(
      ctx.db,
      reservation,
      {
        ...auditBase,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        costState:
          provider.id === 'ollama' ? 'local_zero' : notIncurred ? 'not_incurred' : 'unknown',
        durationMs,
        errorCode: 'AI_PROVIDER_ERROR',
      },
      uncertainRemoteCost
    );
    throwServerError({
      trpcCode: 'BAD_GATEWAY',
      errorCode: 'AI_PROVIDER_ERROR',
      message: 'AI provider call failed',
    });
  }

  // Invalid counters cannot be persisted as NaN/Infinity (SQLite maps NaN
  // to NULL), nor may normalization turn them into a known free call.
  // Retain each valid counter and keep the cost unknown if any is malformed.
  const inputTokens = tokenCount(result.usage.inputTokens);
  const outputTokens = tokenCount(result.usage.outputTokens);
  const cacheReadTokens = tokenCount(result.usage.inputTokenDetails?.cacheReadTokens);
  const cacheWriteTokens = tokenCount(result.usage.inputTokenDetails?.cacheWriteTokens);
  const durationMs = Date.now() - startedAt;
  const markUnpriceable = () => {
    settleCompletion(
      ctx.db,
      reservation,
      {
        ...auditBase,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        costUsd: 0,
        costState: 'unknown',
        durationMs,
        errorCode: 'AI_PROVIDER_ERROR',
      },
      true
    );
  };
  if (provider.id !== 'ollama' && !hasUsableRemoteUsage(result.usage)) {
    markUnpriceable();
    throwServerError({
      trpcCode: 'BAD_GATEWAY',
      errorCode: 'AI_PROVIDER_ERROR',
      message: 'AI provider returned no billable usage',
    });
  }

  let costUsd: number;
  try {
    costUsd = provider.pricing.calculateCostUsd(modelId, toBillableTokenUsage(result.usage));
  } catch {
    markUnpriceable();
    throwServerError({
      trpcCode: 'BAD_GATEWAY',
      errorCode: 'AI_PROVIDER_ERROR',
      message: 'AI provider usage could not be priced',
    });
  }
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    markUnpriceable();
    throwServerError({
      trpcCode: 'BAD_GATEWAY',
      errorCode: 'AI_PROVIDER_ERROR',
      message: 'AI provider returned unpriceable usage',
    });
  }

  const { id: auditLogId } = settleCompletion(
    ctx.db,
    reservation,
    {
      ...auditBase,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      costUsd,
      costState: provider.id === 'ollama' ? 'local_zero' : 'estimated',
      durationMs,
      errorCode: null,
    },
    false
  );

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
}
