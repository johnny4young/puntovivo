/**
 * Post-commit best-effort external hooks for the `completeSale`
 * use-case, extracted from the former monolithic `completeSale.ts`.
 *
 * Both hooks run AFTER the sale transaction has already committed and
 * NEVER roll the sale back:
 *
 * - `emitSaleFiscalDocument` —  DIAN DEE emission via
 * `safelyEmitFiscalDocument` (itself best-effort / outbox-backed).
 * - `enqueueSaleKdsOrder` (+ `buildKdsHookContextFromAppCtx`) —
 * kitchen-display enqueue, idempotent against the suspend → complete
 * progression.
 *
 * The fresh-vs-draft differences (the fresh-only `status === 'completed'`
 * gate, the saleId / tableId source) are carried as parameters so each
 * call site reproduces its original behavior exactly.
 *
 * @module application/sales/fiscalPostHook
 */

import type { DatabaseInstance } from '../../db/index.js';
import { broadcastCompanionInvalidation } from '../../services/companion/invalidation.js';
import { safelyEmitFiscalDocument } from '../../services/fiscal/orchestrator.js';
import { enqueueKdsOrder } from '../../services/kds/enqueue.js';
import type { KdsHookContext } from '../../services/kds/types.js';
import type { CompleteSaleContext, CompleteSaleLogger } from './types.js';

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
 * adapt the application-layer context shape to the KDS
 * hook helper input. `siteId` is widened to `string | null` here
 * because the application context types it as `string` (defaulting
 * to ''); the helper short-circuits on falsy site ids.
 */
export function buildKdsHookContextFromAppCtx(ctx: CompleteSaleContext): KdsHookContext {
  return {
    db: ctx.db,
    tenantId: ctx.tenantId,
    siteId: ctx.siteId || null,
    user: { id: ctx.user.id },
    sse: ctx.sse ?? null,
    log: ctx.log,
  };
}

/**
 * push to the kitchen display when the sale carries a
 * tableId. Idempotent against the suspend → complete progression via
 * UNIQUE(tenant_id, sale_id, station); a second fire is a no-op at the
 * DB layer. `tableId` is sourced per-path (fresh: `input.tableId`;
 * draft: `existing.tableId`).
 */
export async function enqueueSaleKdsOrder(
  ctx: CompleteSaleContext,
  tableId: string | null | undefined,
  saleId: string
): Promise<void> {
  if (tableId) {
    await enqueueKdsOrder({
      ctx: buildKdsHookContextFromAppCtx(ctx),
      saleId,
    });
  }
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
