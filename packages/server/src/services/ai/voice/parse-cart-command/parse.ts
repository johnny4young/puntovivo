/**
 * slice 3 — Voice cart-command parser orchestrator.
 *
 * Takes a transcript produced by `ai.transcribeAudio` (Whisper) and
 * extracts a bounded ADD-only set of cart actions via `generateObject`
 * against the tenant's configured language provider. Each parsed
 * `productHint` is then resolved to a real catalog row via the same
 * embeddings stack semantic search uses () — top-1 above the
 * shared cosine floor, or `null` when the hint is too vague.
 *
 * One `generateObject` call covers the parse step; one `embedTexts`
 * batch call covers all hints; one audit-log row covers the whole
 * pipeline. Both `mode='unrecognized'` (parser returned zero items)
 * and `mode='parsed'` paths still write an audit row so the operator
 * can see voice-cost telemetry per tenant regardless of outcome.
 *
 * @module services/ai/voice/parse-cart-command/parse
 */
import { generateObject } from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';

import { throwServerError } from '../../../../lib/errorCodes.js';

import { currentMonthSpend, recordCall } from '../../auditLog.js';
import { toBillableTokenUsage } from '../../client.js';
import { resolveAISettings } from '../../client.js';
import { getProvider } from '../../providers/registry.js';
import {
  SEMANTIC_SIMILARITY_FLOOR,
  cosineSimilarity,
  embedTexts,
  loadTenantProductEmbeddings,
} from '../../embeddings.js';
import { hydrateCartProducts } from './hydrate.js';
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } from './prompts.js';
import {
  VOICE_CART_COMMAND_MAX_TRANSCRIPT_CHARS,
  VoiceCartCommandSchema,
  type VoiceCartCommand,
} from './schema.js';
import type {
  CartCommandContext,
  CartCommandInput,
  CartCommandMatch,
  CartCommandResult,
  MatchedCartProduct,
} from './types.js';

/**
 * Parse a voice transcript into a structured cart-add command + match
 * each productHint to a real catalog row. Throws via
 * `throwServerError` for the gating failures (`AI_DISABLED`,
 * `AI_BUDGET_EXCEEDED`, `AI_PROVIDER_ERROR`) so the modal can surface
 * the localized error; the empty-items path returns
 * `mode='unrecognized'` (NOT a throw) so the modal can render the
 * parser's reason inline.
 */
export async function parseVoiceCartCommand(
  ctx: CartCommandContext,
  input: CartCommandInput
): Promise<CartCommandResult> {
  const transcript = input.transcript.trim();
  if (transcript.length === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_VOICE_COMMAND_UNRECOGNIZED',
      message: 'Transcript is empty',
    });
  }
  if (transcript.length > VOICE_CART_COMMAND_MAX_TRANSCRIPT_CHARS) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_VOICE_COMMAND_UNRECOGNIZED',
      message: `Transcript exceeds the ${VOICE_CART_COMMAND_MAX_TRANSCRIPT_CHARS}-char limit`,
    });
  }

  const settings = await resolveAISettings(ctx.db, ctx.tenantId);
  if (!settings.enabled) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_DISABLED',
      message: 'AI features are disabled for this tenant',
    });
  }

  const provider = getProvider(settings.providerId);
  if (!provider.isConfigured()) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_PROVIDER_ERROR',
      message: `Provider ${provider.id} is not configured`,
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

  const modelId = settings.modelId ?? provider.defaultModelId;
  const startedAt = Date.now();
  const providerOptions = provider.cacheControlForSystemPrompt();

  let parsed: VoiceCartCommand;
  let costUsd = 0;
  try {
    const result = await generateObject({
      model: provider.languageModel(modelId),
      instructions: SYSTEM_PROMPT,
      schema: VoiceCartCommandSchema,
      prompt: `${USER_PROMPT_TEMPLATE}${JSON.stringify(transcript)}`,
      ...(providerOptions !== undefined
        ? { providerOptions: providerOptions as ProviderOptions }
        : {}),
    });
    parsed = result.object;
    const billable = toBillableTokenUsage(result.usage);
    costUsd = provider.pricing.calculateCostUsd(modelId, billable);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : 'Voice parser call failed';
    await recordCall(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      userId: ctx.userId,
      feature: 'voiceCartCommand',
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
      message,
      details: { cause: String(error) },
    });
  }

  // Unrecognized path: parser returned zero items. Persist an audit
  // row so the operator can see the (small) parser cost even when the
  // cashier said something that wasn't a command.
  if (parsed.items.length === 0) {
    const durationMs = Date.now() - startedAt;
    const { id: auditLogId } = await recordCall(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      userId: ctx.userId,
      feature: 'voiceCartCommand',
      providerId: provider.id,
      modelId,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd,
      durationMs,
      errorCode: null,
    });
    return {
      mode: 'unrecognized',
      transcript,
      reason: parsed.reason ?? 'No identifiqué productos',
      costUsd,
      durationMs,
      provider: provider.id,
      model: modelId,
      auditLogId,
    };
  }

  // Parsed path: resolve every productHint via the embedding stack.
  // If the tenant has no embedded products (catalog never indexed),
  // all matches resolve to null — the modal renders "manual pick"
  // hints inline.
  const embedded = await loadTenantProductEmbeddings(ctx.db, ctx.tenantId);
  const winners: Array<{ productId: string; similarity: number } | null> = new Array(
    parsed.items.length
  ).fill(null);

  if (embedded.length > 0) {
    const hintEmbeds = await embedTexts(
      ctx.db,
      ctx.tenantId,
      parsed.items.map(item => item.productHint)
    );
    if (hintEmbeds !== null) {
      for (let i = 0; i < hintEmbeds.embeddings.length; i += 1) {
        const queryVec = hintEmbeds.embeddings[i]!;
        let best: { productId: string; similarity: number } | null = null;
        for (const row of embedded) {
          const sim = cosineSimilarity(queryVec, row.embedding);
          if (sim < SEMANTIC_SIMILARITY_FLOOR) continue;
          if (best === null || sim > best.similarity) {
            best = { productId: row.productId, similarity: sim };
          }
        }
        winners[i] = best;
      }
    }
  }

  const matchedIds = Array.from(
    new Set(
      winners
        .filter((w): w is { productId: string; similarity: number } => w !== null)
        .map(w => w.productId)
    )
  );
  const summaries =
    matchedIds.length === 0
      ? new Map<string, MatchedCartProduct>()
      : await hydrateCartProducts(ctx.db, ctx.tenantId, matchedIds);

  const matches: CartCommandMatch[] = parsed.items.map((item, idx) => {
    // normalize whitespace-only notes to null (the
    // schema accepts any string, but a row that only carries
    // padding is the same as no modifier for cart purposes).
    const normalizedNote =
      item.note === null || item.note.trim().length === 0 ? null : item.note.trim();
    const winner = winners[idx];
    if (!winner) {
      return {
        productHint: item.productHint,
        quantity: item.quantity,
        note: normalizedNote,
        product: null,
      };
    }
    const summary = summaries.get(winner.productId);
    if (!summary) {
      return {
        productHint: item.productHint,
        quantity: item.quantity,
        note: normalizedNote,
        product: null,
      };
    }
    return {
      productHint: item.productHint,
      quantity: item.quantity,
      note: normalizedNote,
      product: { ...summary, similarity: winner.similarity },
    };
  });

  const durationMs = Date.now() - startedAt;
  const { id: auditLogId } = await recordCall(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    userId: ctx.userId,
    feature: 'voiceCartCommand',
    providerId: provider.id,
    modelId,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd,
    durationMs,
    errorCode: null,
  });

  return {
    mode: 'parsed',
    transcript,
    matches,
    confidence: parsed.confidence,
    costUsd,
    durationMs,
    provider: provider.id,
    model: modelId,
    auditLogId,
  };
}
