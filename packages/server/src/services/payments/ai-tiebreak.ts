/**
 * AI tie-break for ambiguous payment reconciliation matches.
 *
 * The deterministic matcher in `reconciliation.ts` covers exact + epsilon
 * matches across (reference, providerTransactionId, amount). When two or
 * more POS tenders remain plausible candidates for the same provider
 * statement row, this module hands the decision off to the configured
 * language provider via `generateObject` against a tight schema.
 *
 * Gating: every AI-side failure mode (disabled, over-budget, provider
 * outage) is caught and surfaced as `{ ok: false, reason }` so the matcher
 * keeps walking. The cron must never throw because of an AI tie-break —
 * a degraded mismatch with `suggestedAction='review_provider'` is the
 * deterministic floor.
 *
 * `recordCall` is invoked on both success and failure paths so the
 * operator's `currentMonthSpend` / `byBreakdown` aggregates account for
 * every attempt, mirroring the voice / vision wiring.
 *
 * @module services/payments/ai-tiebreak
 */
import { generateObject } from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import { z } from 'zod';

import type { DatabaseInstance } from '../../db/index.js';
import { createModuleLogger } from '../../logging/logger.js';
import { currentMonthSpend, recordCall } from '../ai/auditLog.js';
import { resolveAISettings, toBillableTokenUsage } from '../ai/client.js';
import { getProvider } from '../ai/providers/registry.js';

const log = createModuleLogger('services/payments/ai-tiebreak');

export interface TiebreakCandidate {
  /** Internal POS tender id; opaque to the model. */
  salePaymentId: string;
  /** Reference the operator entered when the tender was captured. */
  reference: string | null;
  /** Provider transaction id, when the rail returned one at capture. */
  providerTransactionId: string | null;
  /** POS-side tender amount. */
  amount: number;
  /** Currency the tender was captured in. */
  currencyCode: string;
  /** ISO timestamp of the tender. */
  createdAt: string;
}

export interface TiebreakInput {
  /** Reference on the provider statement row the matcher is trying to resolve. */
  statementReference: string;
  /** Amount the provider settled. */
  statementAmount: number;
  /** Currency on the provider statement (usually matches tenders). */
  statementCurrency: string;
  /** ISO timestamp on the provider statement row. */
  statementCreatedAt: string;
  /** The set of POS tenders the deterministic pass could not disambiguate. */
  candidates: TiebreakCandidate[];
}

export type TiebreakDegradationReason =
  'ai-disabled' | 'ai-budget-exceeded' | 'ai-provider-error' | 'ai-not-decisive';

export type TiebreakResult =
  | {
      ok: true;
      salePaymentId: string;
      confidence: 'high' | 'medium' | 'low';
      explanation: string;
      costUsd: number;
      auditLogId: string;
    }
  | {
      ok: false;
      reason: TiebreakDegradationReason;
      costUsd: number;
      auditLogId: string | null;
    };

export interface TiebreakContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string | null;
  userId: string | null;
}

const TiebreakSchema = z.object({
  pickedSalePaymentId: z
    .string()
    .min(1)
    .nullable()
    .describe('salePaymentId of the chosen candidate, or null when nothing is decisively a match.'),
  confidence: z.enum(['high', 'medium', 'low']).describe('Self-rated confidence in the pick.'),
  explanation: z
    .string()
    .max(400)
    .describe('One-sentence explanation operator-readable in Spanish or English.'),
});

const SYSTEM_PROMPT =
  'Eres un asistente que concilia transacciones de pago entre un POS LATAM y un estado de cuenta de un proveedor de pagos (Wompi, Bold, ePayco, Mercado Pago, Nequi, Daviplata). ' +
  'Recibes una fila del estado de cuenta y una lista corta de candidatos del POS. ' +
  'Elige el candidato cuya referencia, providerTransactionId, monto y fecha mejor coincidan con el estado de cuenta. ' +
  'Si NINGUNO es razonable (montos muy distintos, referencias incompatibles, fechas muy lejanas), devuelve pickedSalePaymentId=null con confidence="low". ' +
  'NO inventes ids. Devuelve solo ids presentes en la lista de candidatos.';

/**
 * Hand a still-ambiguous statement-row → candidates set to the configured
 * provider via `generateObject`. Never throws — failure modes collapse to
 * `{ ok: false, reason }` so the caller can keep walking and the matcher's
 * deterministic floor still produces a usable `suggestedAction`.
 */
export async function aiTiebreak(
  ctx: TiebreakContext,
  input: TiebreakInput
): Promise<TiebreakResult> {
  const settings = await resolveAISettings(ctx.db, ctx.tenantId);
  if (!settings.enabled) {
    return { ok: false, reason: 'ai-disabled', costUsd: 0, auditLogId: null };
  }
  if (settings.monthlyBudgetUsd <= 0) {
    return { ok: false, reason: 'ai-budget-exceeded', costUsd: 0, auditLogId: null };
  }
  const spent = await currentMonthSpend(ctx.db, ctx.tenantId);
  if (spent >= settings.monthlyBudgetUsd) {
    return { ok: false, reason: 'ai-budget-exceeded', costUsd: 0, auditLogId: null };
  }

  const provider = getProvider(settings.providerId);
  if (!provider.isConfigured()) {
    return { ok: false, reason: 'ai-provider-error', costUsd: 0, auditLogId: null };
  }

  const modelId = settings.modelId ?? provider.defaultModelId;
  const startedAt = Date.now();
  const providerOptions = provider.cacheControlForSystemPrompt();

  const userPrompt = buildUserPrompt(input);
  try {
    const result = await generateObject({
      model: provider.languageModel(modelId),
      instructions: SYSTEM_PROMPT,
      schema: TiebreakSchema,
      prompt: userPrompt,
      ...(providerOptions !== undefined
        ? { providerOptions: providerOptions as ProviderOptions }
        : {}),
    });

    const billable = toBillableTokenUsage(result.usage);
    const costUsd = provider.pricing.calculateCostUsd(modelId, billable);
    const durationMs = Date.now() - startedAt;

    const { id: auditLogId } = await recordCall(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      userId: ctx.userId,
      feature: 'paymentReconciliation',
      providerId: provider.id,
      modelId,
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      cacheReadTokens: result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
      cacheWriteTokens: result.usage.inputTokenDetails?.cacheWriteTokens ?? 0,
      costUsd,
      durationMs,
      errorCode: null,
    });

    const picked = result.object.pickedSalePaymentId;
    if (
      picked === null ||
      !input.candidates.some(candidate => candidate.salePaymentId === picked)
    ) {
      return {
        ok: false,
        reason: 'ai-not-decisive',
        costUsd,
        auditLogId,
      };
    }

    return {
      ok: true,
      salePaymentId: picked,
      confidence: result.object.confidence,
      explanation: result.object.explanation,
      costUsd,
      auditLogId,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    log.warn(
      { err: error, tenantId: ctx.tenantId, providerId: provider.id, modelId },
      'payment AI tie-break provider call failed'
    );
    let auditLogId: string | null = null;
    try {
      const recorded = await recordCall(ctx.db, {
        tenantId: ctx.tenantId,
        siteId: ctx.siteId,
        userId: ctx.userId,
        feature: 'paymentReconciliation',
        providerId: provider.id,
        modelId,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        durationMs,
        errorCode: 'PAYMENT_RECONCILIATION_AI_DEGRADED',
      });
      auditLogId = recorded.id;
    } catch (recordErr) {
      // ai_audit_log insert failed (e.g. degraded DB). The matcher's
      // deterministic floor still produces a suggestion; the secondary
      // failure must not mask the primary tie-break error.
      log.warn(
        { err: recordErr, tenantId: ctx.tenantId },
        'payment AI tie-break audit-log insert failed (non-blocking)'
      );
    }
    return { ok: false, reason: 'ai-provider-error', costUsd: 0, auditLogId };
  }
}

function buildUserPrompt(input: TiebreakInput): string {
  // Compact JSON keeps the prompt tight; the schema enforces the shape
  // even if the provider returns extra fields.
  const compact = {
    statement: {
      reference: input.statementReference,
      amount: input.statementAmount,
      currency: input.statementCurrency,
      createdAt: input.statementCreatedAt,
    },
    candidates: input.candidates.map(candidate => ({
      salePaymentId: candidate.salePaymentId,
      reference: candidate.reference,
      providerTransactionId: candidate.providerTransactionId,
      amount: candidate.amount,
      currencyCode: candidate.currencyCode,
      createdAt: candidate.createdAt,
    })),
  };
  return `Resuelve esta conciliación. Devuelve el resultado en el formato JSON definido por el esquema. Datos: ${JSON.stringify(compact)}`;
}

/**
 * Pure-function signature the matcher accepts as an optional override.
 * Tests pass a stub here to drive the AI path deterministically without
 * touching the provider registry.
 */
export type TiebreakFn = (ctx: TiebreakContext, input: TiebreakInput) => Promise<TiebreakResult>;
