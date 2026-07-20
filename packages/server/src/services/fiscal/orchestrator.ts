/**
 * Fiscal document orchestrator ().
 *
 * The model never re-queries buyer or line data after emission: an emitted
 * document freezes its buyer + line snapshot (Resolución DIAN 165/2023 CUFE
 * rule). Two emission paths exist — the legacy synchronous `emitFiscalDocument`
 * and the  outbox `enqueueFiscalEmission` (adapter out-of-band) — both
 * advancing the consecutive numbering inside one write transaction guarded by
 * the FISCAL_SEQUENTIAL_NOT_ADVANCED TOCTOU check.
 *
 * decomposed into per-concern modules under `./orchestrator/`
 * (types / helpers / snapshots / emit / enqueue / safely). This file stays at
 * the original path as a thin re-export barrel so the fiscal-critical importers
 * (fiscalPostHook / voidSale / returnSale + the orchestrator tests) resolve
 * `./orchestrator.js` unchanged.
 *
 * @module services/fiscal/orchestrator
 */
export type { EmitFiscalDocumentArgs, EmitFiscalDocumentResult } from './orchestrator/types.js';
export { emitFiscalDocument } from './orchestrator/emit.js';
export { enqueueFiscalEmission } from './orchestrator/enqueue.js';
export { safelyEmitFiscalDocument } from './orchestrator/safely.js';
