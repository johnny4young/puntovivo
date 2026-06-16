/**
 * ENG-178 — Post-commit best-effort external hooks for the `completeSale`
 * use-case, extracted from the former monolithic `completeSale.ts`.
 *
 * Both hooks run AFTER the sale transaction has already committed and
 * NEVER roll the sale back:
 *
 * - `emitSaleFiscalDocument` — ENG-020 DIAN DEE emission via
 *   `safelyEmitFiscalDocument` (itself best-effort / outbox-backed).
 * - `enqueueSaleKdsOrder` (+ `buildKdsHookContextFromAppCtx`) — ENG-098
 *   kitchen-display enqueue, idempotent against the suspend → complete
 *   progression.
 *
 * The fresh-vs-draft differences (the fresh-only `status === 'completed'`
 * gate, the saleId / tableId source) are carried as parameters so each
 * call site reproduces its original behavior exactly.
 *
 * @module application/sales/fiscalPostHook
 */

import type { DatabaseInstance } from '../../db/index.js';
import { safelyEmitFiscalDocument } from '../../services/fiscal/orchestrator.js';
import { enqueueKdsOrder } from '../../services/kds/enqueue.js';
import type { KdsHookContext } from '../../services/kds/types.js';
import type { CompleteSaleContext, CompleteSaleLogger } from './types.js';

/**
 * ENG-020 — emit the DIAN DEE for a completed sale. Runs post-tx,
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
 * ENG-098 — adapt the application-layer context shape to the KDS
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
 * ENG-098 — push to the kitchen display when the sale carries a
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
