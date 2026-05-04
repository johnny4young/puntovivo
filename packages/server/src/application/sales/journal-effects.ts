/**
 * ENG-054 — Best-effort journal effect emission for the `completeSale`
 * use-case.
 *
 * Per `architecture/patterns/operation-journal.md`, services emit one
 * `operation_effects` row per meaningful side-effect AFTER the primary
 * transaction commits. The journal is observability, not a correctness
 * gate: a write failure here MUST NEVER roll back the sale.
 *
 * The helper:
 *
 * - Skips silently when `eventId` is null (the call did not carry an
 *   envelope, e.g. an internal worker or a hand-built test ctx).
 * - Wraps each `recordEffect` in `try/catch` so a single failure does
 *   not block the rest of the batch.
 * - Logs failures at warn level with the affected `kind` and
 *   `resourceId` so operators can correlate against the
 *   `operation_events` row they're inspecting.
 *
 * @module application/sales/journal-effects
 */

import type { DatabaseInstance } from '../../db/index.js';
import { recordEffect } from '../../services/operation-journal/journal.js';
import type { CompleteSaleLogger } from './types.js';

export interface JournalEffectInput {
  kind: string;
  resourceType: string;
  resourceId: string;
  effectData?: Record<string, unknown> | null;
}

/**
 * Emit one journal effect row per entry. Calls are sequential so the
 * `operation_effects` rows land in the order the caller provided —
 * the Operations Center (ENG-065) renders effects ordered by
 * `created_at`, so a stable order keeps the trail readable.
 */
export async function emitCompleteSaleEffects(
  db: DatabaseInstance,
  log: CompleteSaleLogger,
  eventId: string | null,
  effects: JournalEffectInput[]
): Promise<void> {
  if (!eventId || effects.length === 0) {
    return;
  }

  for (const effect of effects) {
    try {
      await recordEffect(db, {
        operationEventId: eventId,
        kind: effect.kind,
        resourceType: effect.resourceType,
        resourceId: effect.resourceId,
        effectData: effect.effectData ?? null,
      });
    } catch (err) {
      log.warn(
        {
          err,
          eventId,
          effectKind: effect.kind,
          resourceType: effect.resourceType,
          resourceId: effect.resourceId,
        },
        'completeSale journal effect emission failed (non-blocking)'
      );
    }
  }
}
