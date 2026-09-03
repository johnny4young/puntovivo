/**
 * Post-commit best-effort external hooks for the `completeSale`
 * use-case, extracted from the former monolithic `completeSale.ts`.
 *
 * External hooks run AFTER the sale transaction has already committed and
 * NEVER roll the sale back:
 *
 * - `emitSaleFiscalDocument` — materializes the sale's transactional fiscal
 * intent and wakes the provider worker; the legacy wrapper is only a
 * compatibility fallback for internal callers without an intent.
 *
 * @module application/sales/fiscalPostHook
 */

import type { DatabaseInstance } from '../../db/index.js';
import { broadcastCompanionInvalidation } from '../../services/companion/invalidation.js';
import { safelyEmitFiscalDocument } from '../../services/fiscal/orchestrator.js';
import type { EmitFiscalDocumentResult } from '../../services/fiscal/orchestrator.js';
import {
  findSaleFiscalIntentId,
  materializeFiscalEmissionIntent,
} from '../../services/fiscal/orchestrator/intents.js';
import { tickDefaultFiscalWorker } from '../../services/fiscal/fiscal-worker.js';
import type { CompleteSaleContext, CompleteSaleLogger } from './types.js';

/** Best-effort acceleration for an obligation already committed with its domain row. */
export async function materializeCommittedFiscalIntent(args: {
  db: DatabaseInstance;
  tenantId: string;
  intentId: string;
  log: CompleteSaleLogger;
}): Promise<EmitFiscalDocumentResult | null> {
  try {
    const result = await materializeFiscalEmissionIntent(args);
    if (result) {
      void tickDefaultFiscalWorker(args.tenantId).catch(error => {
        args.log.debug(
          { err: error, tenantId: args.tenantId, intentId: args.intentId },
          'immediate fiscal outbox tick failed (non-blocking)'
        );
      });
    }
    return result;
  } catch (error) {
    args.log.warn(
      { err: error, tenantId: args.tenantId, intentId: args.intentId },
      'fiscal intent materialization failed (non-blocking)'
    );
    return null;
  }
}

/**
 * emit the DIAN DEE for a completed sale. Runs post-tx,
 * best-effort: a fiscal failure never rolls the sale back. Returns the
 * emitted `fiscal_documents` row id (for the journal `fiscal_emit`
 * effect) or null.
 *
 * `enabled` carries the fresh-only `input.status === 'completed'` gate —
 * drafts never emit, and a fresh sale persisted as a draft does not
 * either. The draft-completion path always emits, so it passes `true`.
 */
export async function emitSaleFiscalDocument(args: {
  db: DatabaseInstance;
  tenantId: string;
  userId: string;
  log: CompleteSaleLogger;
  saleId: string;
  enabled: boolean;
}): Promise<string | null> {
  const { db, tenantId, userId, log, saleId, enabled } = args;
  if (!enabled) {
    return null;
  }
  try {
    const intentId = await findSaleFiscalIntentId(db, tenantId, saleId);
    if (intentId) {
      const result = await materializeCommittedFiscalIntent({ db, tenantId, intentId, log });
      return result?.id ?? null;
    }
  } catch (error) {
    log.warn({ err: error, tenantId, saleId }, 'fiscal intent lookup failed (non-blocking)');
    return null;
  }

  // Compatibility for internal/legacy callers that completed a sale without
  // the modern transactional intent seam. New sale paths always take the
  // branch above; this fallback does not participate in replay recovery.
  const fiscalResult = await safelyEmitFiscalDocument({
    db,
    tenantId,
    userId,
    log,
    source: 'sale',
    sourceId: saleId,
    saleId,
    kind: 'DEE',
  });
  return fiscalResult?.id ?? null;
}

/**
 * Broadcast the legacy manager sale payload plus a payload-free Companion
 * invalidation. New Companion clients only consume the latter.
 *
 * Best-effort and post-commit, exactly like the KDS enqueue above: the
 * sale is already durable, so a missing SSE manager (unit tests,
 * internal callers) or a broadcast failure must never surface to the
 * cashier. The payload carries only what a ticker renders — never
 * customer identity, line detail, or site topology, because every
 * connected client of the tenant receives it. A field no consumer reads
 * is not free here: it is tenant data on the wire for nothing.
 */
export function broadcastSaleCompleted(
  ctx: CompleteSaleContext,
  sale: { id: string; saleNumber: string; total: number }
): void {
  try {
    ctx.sse?.broadcast(
      'sales.completed',
      {
        saleId: sale.id,
        saleNumber: sale.saleNumber,
        total: sale.total,
        // The moment of completion, NOT `sales.createdAt`: a table
        // order created at 11:40 and paid at 15:20 would otherwise
        // show on the ticker as an 11:40 sale. This runs post-commit,
        // so it is the commit instant within milliseconds.
        completedAt: new Date().toISOString(),
      },
      ctx.tenantId
    );
  } catch (err) {
    ctx.log?.warn({ err, saleId: sale.id }, 'sale realtime broadcast failed (non-blocking)');
  }
  try {
    broadcastCompanionInvalidation({
      sse: ctx.sse,
      tenantId: ctx.tenantId,
      scope: 'sales',
    });
  } catch (err) {
    ctx.log?.warn({ err, saleId: sale.id }, 'companion invalidation failed (non-blocking)');
  }
}

/**
 * Broadcast that a previously completed sale no longer counts, so the
 * companion ticker can retract it. Without this the owner keeps
 * seeing a mis-rung sale on the phone forever: the ticker only ever
 * learned about completions.
 *
 * Same best-effort, post-commit posture as the completion broadcast.
 */
export function broadcastSaleRetracted(
  ctx: CompleteSaleContext,
  sale: { id: string; saleNumber: string },
  reason: 'voided' | 'returned'
): void {
  try {
    ctx.sse?.broadcast(
      'sales.retracted',
      {
        saleId: sale.id,
        saleNumber: sale.saleNumber,
        reason,
        retractedAt: new Date().toISOString(),
      },
      ctx.tenantId
    );
  } catch (err) {
    ctx.log?.warn({ err, saleId: sale.id }, 'sale retraction broadcast failed (non-blocking)');
  }
  try {
    broadcastCompanionInvalidation({
      sse: ctx.sse,
      tenantId: ctx.tenantId,
      scope: 'sales',
    });
  } catch (err) {
    ctx.log?.warn({ err, saleId: sale.id }, 'companion invalidation failed (non-blocking)');
  }
}
