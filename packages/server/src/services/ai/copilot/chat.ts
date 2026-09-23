/**
 * co-pilot chat orchestration.
 *
 * The public `runCopilotChat` entrypoint (called from `routers/ai/copilot.ts`)
 * plus the provider/budget resolution, the AI-SDK usage parsing (Anthropic
 * nests cache tokens; OpenAI flattens them), and the error-code mapping. Wires
 * the prompt builders + the tenant-scoped `runReadOnlySQL` tool into a single
 * `generateText` call, then records one audit-log row per call. Split out of
 * `copilot.ts` ().
 *
 * @module services/ai/copilot/chat
 */
import { generateText, hasToolCall, isStepCount, tool } from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  ServerErrorWithCode,
  throwServerError,
  type ServerErrorCode,
} from '../../../lib/errorCodes.js';

import { recordCall } from '../auditLog.js';
import { reserveAiBudget, settleAiBudget } from '../budget.js';
import type { AiBudgetReservation } from '../budget.js';
import { resolveAISettings, toBillableTokenUsage } from '../client.js';
import type { AIInvocationContext, ProviderFactory } from '../client.js';
import { getProvider } from '../providers/registry.js';
import type { AIProvider } from '../providers/types.js';
import type { AISettings } from '../types.js';

import { ALLOWED_TABLES, RESULT_ROW_LIMIT, SQL_MAX_LENGTH } from './constants.js';
import { resolveWindow, validateModelAnalyticsSQL } from './sql.js';
import { createCopilotSnapshot } from './snapshot.js';
import { resolveCopilotQuotaSites } from './scope.js';
import {
  buildContextBlock,
  buildPrompt,
  buildSystemPrompt,
  injectContextIntoMessages,
} from './prompts.js';
import type {
  CopilotChatInput,
  CopilotChatResult,
  CopilotRunOptions,
  CopilotSQLResult,
  UsageShape,
} from './types.js';

const defaultFactory: ProviderFactory = (id: AISettings['providerId']) => getProvider(id);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function usageNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const record = asRecord(value);
  if (record) {
    const total = record.total;
    return typeof total === 'number' && Number.isFinite(total) ? total : 0;
  }
  return 0;
}

function usageNestedNumber(value: unknown, key: string): number {
  const record = asRecord(value);
  if (!record) {
    return 0;
  }
  const nested = record[key];
  return typeof nested === 'number' && Number.isFinite(nested) ? nested : 0;
}

function serverErrorCodeFrom(error: unknown): ServerErrorCode {
  if (error instanceof TRPCError && error.cause instanceof ServerErrorWithCode) {
    return error.cause.errorCode;
  }
  if (error instanceof Error && error.cause instanceof ServerErrorWithCode) {
    return error.cause.errorCode;
  }
  return 'AI_PROVIDER_ERROR';
}

async function resolveConfiguredProvider(
  ctx: AIInvocationContext,
  factory: ProviderFactory
): Promise<{ provider: AIProvider; modelId: string; settings: AISettings }> {
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
  return {
    provider,
    modelId: settings.modelId ?? provider.defaultModelId,
    settings,
  };
}

export async function runCopilotChat(
  ctx: AIInvocationContext,
  input: CopilotChatInput,
  options: CopilotRunOptions = {}
): Promise<CopilotChatResult> {
  const now = options.now ?? new Date();
  const window = resolveWindow(input.context, now);
  const factory = options.factory ?? defaultFactory;
  const { provider, modelId, settings } = await resolveConfiguredProvider(ctx, factory);
  const responseMode = settings.features?.copilot.responseMode ?? 'guided';
  // An explicit body site filters the snapshot. A missing/null body site is
  // tenant-wide even when the UI has a selected site in the request header.
  const auditSiteId = input.context?.siteId ?? null;
  const promptSiteId = auditSiteId ?? ctx.siteId;
  const scopeSiteIds =
    options.scopeSiteIds ??
    (await resolveCopilotQuotaSites(ctx.db, ctx.tenantId, input.context?.siteId));
  const startedAt = Date.now();
  const sqlCapture: { results: CopilotSQLResult[]; attempts: number; overLimit: boolean } = {
    results: [],
    attempts: 0,
    overLimit: false,
  };
  let consumedUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
  } | null = null;
  let reservation: AiBudgetReservation | null = null;

  let snapshot: Awaited<ReturnType<typeof createCopilotSnapshot>> | undefined;
  try {
    snapshot = await createCopilotSnapshot(ctx.db, ctx.tenantId, input.context, now, scopeSiteIds);
    const protectedSnapshot = snapshot;
    const providerOptions = provider.cacheControlForSystemPrompt();
    const contextBlock = buildContextBlock(window, promptSiteId);
    const messagesWithContext = injectContextIntoMessages(
      input.messages.map(message => ({
        ...message,
        content: protectedSnapshot.redact(message.content),
      })),
      contextBlock
    );
    const model = provider.languageModel(modelId);
    const prompt = buildPrompt(messagesWithContext);
    reservation = reserveAiBudget(ctx.db, ctx.tenantId, now, { copilotSiteIds: scopeSiteIds });
    const result = await generateText({
      model,
      instructions: buildSystemPrompt(responseMode),
      prompt,
      ...(ctx.abortSignal !== undefined ? { abortSignal: ctx.abortSignal } : {}),
      timeout: { totalMs: 60_000 },
      maxRetries: 0,
      tools: {
        getCurrentSiteContext: tool({
          description: 'Return the active site and bounded analytics window for this chat.',
          inputSchema: z.object({}),
          execute: async () => ({
            siteId: promptSiteId,
            window,
            allowedTables: Array.from(ALLOWED_TABLES),
            resultRowLimit: RESULT_ROW_LIMIT,
          }),
        }),
        runReadOnlySQL: tool({
          description:
            'Run one read-only SELECT query against tenant-scoped sales analytics snapshot tables. CTEs are unsupported.',
          inputSchema: z.object({
            query: z.string().min(1).max(SQL_MAX_LENGTH),
          }),
          execute: async ({ query }) => {
            sqlCapture.attempts += 1;
            if (sqlCapture.attempts > 5) {
              sqlCapture.overLimit = true;
              return { error: 'At most five analytics queries are supported per response' };
            }
            const sqlResult = protectedSnapshot.query(validateModelAnalyticsSQL(query));
            sqlCapture.results.push(sqlResult);
            return sqlResult;
          },
        }),
      },
      stopWhen:
        responseMode === 'verified'
          ? [hasToolCall('runReadOnlySQL'), isStepCount(5)]
          : isStepCount(5),
      maxOutputTokens: 700,
      ...(providerOptions !== undefined
        ? { providerOptions: providerOptions as ProviderOptions }
        : {}),
    });

    const usage = result.usage as UsageShape;
    const inputTokens = usageNumber(usage.inputTokens);
    const outputTokens = usageNumber(usage.outputTokens);
    const inputRecord = asRecord(usage.inputTokens);
    const detailsRecord = asRecord(usage.inputTokenDetails);
    const cacheReadTokens =
      usageNestedNumber(inputRecord, 'cacheRead') ||
      usageNestedNumber(detailsRecord, 'cacheReadTokens');
    const cacheWriteTokens =
      usageNestedNumber(inputRecord, 'cacheWrite') ||
      usageNestedNumber(detailsRecord, 'cacheWriteTokens');
    const noCacheTokens =
      usageNestedNumber(inputRecord, 'noCache') ||
      usageNestedNumber(detailsRecord, 'noCacheTokens') ||
      Math.max(inputTokens - cacheReadTokens - cacheWriteTokens, 0);
    if (
      provider.id !== 'ollama' &&
      inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens <= 0
    ) {
      throwServerError({
        trpcCode: 'BAD_GATEWAY',
        errorCode: 'AI_PROVIDER_ERROR',
        message: 'Co-pilot provider returned no billable usage',
      });
    }
    const costUsd = provider.pricing.calculateCostUsd(
      modelId,
      toBillableTokenUsage({
        inputTokens,
        outputTokens,
        inputTokenDetails: {
          noCacheTokens,
          cacheReadTokens,
          cacheWriteTokens,
        },
      })
    );
    if (!Number.isFinite(costUsd) || costUsd < 0) {
      throwServerError({
        trpcCode: 'BAD_GATEWAY',
        errorCode: 'AI_PROVIDER_ERROR',
        message: 'Co-pilot provider usage could not be priced',
      });
    }
    consumedUsage = { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd };

    if (sqlCapture.overLimit) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'AI_COPILOT_SQL_REJECTED',
        message: 'The request needs too many queries; narrow the analytics question',
      });
    }

    const sqlResult = sqlCapture.results.at(-1);
    if (!sqlResult) {
      throwServerError({
        trpcCode: 'BAD_GATEWAY',
        errorCode: 'AI_PROVIDER_ERROR',
        message: 'Copilot requires a validated SQL result',
      });
    }
    const durationMs = Date.now() - startedAt;

    const { id: auditLogId } = settleAiBudget(
      ctx.db,
      reservation,
      {
        tenantId: ctx.tenantId,
        siteId: auditSiteId,
        scopeSiteIds: auditSiteId === null ? scopeSiteIds : null,
        userId: ctx.userId,
        feature: 'copilot',
        responseMode,
        providerId: provider.id,
        modelId,
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
      ...sqlResult,
      answer: '',
      queries: sqlCapture.results,
      responseMode,
      costUsd,
      durationMs,
      provider: provider.id,
      model: modelId,
      auditLogId,
    };
  } catch (error) {
    const errorCode = serverErrorCodeFrom(error);
    const uncertainRemoteCost =
      reservation !== null && consumedUsage === null && provider.id !== 'ollama';
    const costState: 'local_zero' | 'estimated' | 'unknown' = consumedUsage
      ? provider.id === 'ollama'
        ? 'local_zero'
        : 'estimated'
      : provider.id === 'ollama'
        ? 'local_zero'
        : 'unknown';
    const audit = {
      tenantId: ctx.tenantId,
      siteId: auditSiteId,
      scopeSiteIds: auditSiteId === null ? scopeSiteIds : null,
      userId: ctx.userId,
      feature: 'copilot',
      responseMode,
      providerId: provider.id,
      modelId,
      inputTokens: consumedUsage?.inputTokens ?? 0,
      outputTokens: consumedUsage?.outputTokens ?? 0,
      cacheReadTokens: consumedUsage?.cacheReadTokens ?? 0,
      cacheWriteTokens: consumedUsage?.cacheWriteTokens ?? 0,
      costUsd: consumedUsage?.costUsd ?? 0,
      costState,
      durationMs: Date.now() - startedAt,
      errorCode,
    };
    if (reservation) {
      settleAiBudget(ctx.db, reservation, audit, uncertainRemoteCost);
    } else if (errorCode !== 'AI_BUDGET_EXCEEDED' && errorCode !== 'AI_QUOTA_EXCEEDED') {
      await recordCall(ctx.db, { ...audit, costState: 'not_incurred' });
    }

    if (error instanceof TRPCError) {
      throw error;
    }

    return throwServerError({
      trpcCode: 'BAD_GATEWAY',
      errorCode: 'AI_PROVIDER_ERROR',
      message: error instanceof Error ? error.message : 'AI provider call failed',
      details: { cause: String(error) },
    });
  } finally {
    snapshot?.close();
  }
}
