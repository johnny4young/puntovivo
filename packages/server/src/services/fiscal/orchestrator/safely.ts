/**
 * Fiscal orchestrator — best-effort wrapper (ENG-020/054).
 *
 * `safelyEmitFiscalDocument` wraps `enqueueFiscalEmission`, catches ALL throws
 * (returns null), and fires the worker tick on success — never blocking or
 * rolling back the sale lifecycle. Consumed by the sale post-commit hooks.
 *
 * @module services/fiscal/orchestrator/safely
 */
import type { DatabaseInstance } from '../../../db/index.js';
import { type FiscalDocumentKind, type FiscalDocumentSource } from '../../../db/schema.js';
import type { PuntovivoLogger } from '../../../logging/logger.js';
import { tickDefaultFiscalWorker } from '../fiscal-worker.js';
import type { EmitFiscalDocumentResult } from './types.js';
import { enqueueFiscalEmission } from './enqueue.js';


/**
 * ENG-020 / ENG-054 / ENG-057 — best-effort fiscal emission entry point
 * used by sale-lifecycle services (`completeSale`, `voidSale`,
 * `returnSale`). Backwards-compatible wrapper around `enqueueFiscalEmission`.
 *
 * Invariants:
 * - Best-effort, NON-BLOCKING relative to the sale. The sale-lifecycle
 *   transaction has already committed by the time this runs; an emission
 *   failure (provider outage, missing resolution, malformed input) MUST NOT
 *   roll back the sale. This wrapper catches every throw from
 *   `enqueueFiscalEmission` and returns `null` — it NEVER throws.
 * - Idempotent for retry: because `enqueueFiscalEmission` is keyed on
 *   `(tenantId, source, sourceId, kind)`, a later replay (the fiscal worker
 *   re-tick, or a contingency retry) picks a dropped emission back up
 *   without duplicating the document.
 * - The shape of the returned object is preserved so existing callers read
 *   `result.id` for `fiscal_emit` journal-effect emission without edits.
 *
 * Preconditions: the sale lifecycle has already committed the source sale,
 * and the caller provides the tenant/user/source tuple needed to enqueue or
 * idempotently find the fiscal document.
 *
 * Postconditions:
 * - On a produced document: fires a fire-and-forget worker tick to drain the
 *   new outbox row immediately (the worker's claim_token guards against
 *   double-processing) and returns the `{ id, cufe, documentNumber, status }`
 *   summary.
 * - On a non-DIAN tenant / missing prerequisite / swallowed error: returns
 *   `null`. A `null` return is the NORMAL flow for a non-DIAN tenant — the
 *   caller may emit a journal effect off the return but MUST NOT make a
 *   business-critical decision on it.
 */
export async function safelyEmitFiscalDocument(args: {
  db: DatabaseInstance;
  tenantId: string;
  userId: string;
  log: Pick<PuntovivoLogger, 'warn' | 'info' | 'debug' | 'error'>;
  source: FiscalDocumentSource;
  sourceId: string;
  saleId: string;
  kind: FiscalDocumentKind;
  // ENG-179b — explicit `| undefined` per the optional-args pattern.
  originalCufe?: string | undefined;
  reasonCode?: string | undefined;
}): Promise<EmitFiscalDocumentResult | null> {
  try {
    const result = await enqueueFiscalEmission({
      db: args.db,
      tenantId: args.tenantId,
      userId: args.userId,
      log: args.log,
      source: args.source,
      sourceId: args.sourceId,
      saleId: args.saleId,
      kind: args.kind,
      originalCufe: args.originalCufe,
      reasonCode: args.reasonCode,
    });
    if (result) {
      // Fire-and-forget: ask the fiscal worker to drain the new
      // outbox row immediately so the happy-path latency stays
      // close to the synchronous status quo. The worker's
      // claim_token guards against double-processing if the
      // periodic tick fires concurrently.
      tickDefaultFiscalWorker(args.tenantId).catch(err => {
        args.log.debug(
          { err, tenantId: args.tenantId },
          'immediate fiscal worker tick failed (non-blocking)'
        );
      });
    }
    return result;
  } catch (err) {
    args.log.warn(
      {
        err,
        tenantId: args.tenantId,
        saleId: args.saleId,
        source: args.source,
        kind: args.kind,
      },
      'fiscal emission failed (non-blocking)'
    );
    return null;
  }
}
