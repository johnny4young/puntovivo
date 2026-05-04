/**
 * ENG-056 — Best-effort journal effect emission for the cash-session
 * use-cases.
 *
 * Mirror of `application/sales/journal-effects.ts` (ENG-054). Kept as a
 * sibling module instead of cross-importing so each aggregate boundary
 * stays self-contained and discoverable: a future reader looking at
 * `application/cash-sessions/closeCashSession.ts` finds its effect
 * emitter next to it.
 *
 * Per `architecture/patterns/operation-journal.md`, services emit one
 * `operation_effects` row per meaningful side-effect AFTER the primary
 * transaction commits. The journal is observability, not a correctness
 * gate: a write failure here MUST NEVER roll back the cash-session
 * mutation.
 *
 * @module application/cash-sessions/journal-effects
 */

import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { operationEvents } from '../../db/schema.js';
import { recordEffect } from '../../services/operation-journal/journal.js';
import type { CashSessionLogger } from './types.js';

export interface CashSessionJournalEffectInput {
  kind: string;
  resourceType: string;
  resourceId: string;
  effectData?: Record<string, unknown> | null;
}

/**
 * Resolve the `operation_events` row id for the envelope's
 * `operationId`. Returns `null` when the call did not carry an envelope
 * (tests, future internal workers) — callers MUST treat `null` as
 * "skip effect emission" instead of throwing.
 */
export async function lookupCashSessionJournalEventId(
  db: DatabaseInstance,
  tenantId: string,
  operationId: string | undefined
): Promise<string | null> {
  if (!operationId) {
    return null;
  }
  const row = await db
    .select({ id: operationEvents.id })
    .from(operationEvents)
    .where(
      and(
        eq(operationEvents.tenantId, tenantId),
        eq(operationEvents.operationId, operationId)
      )
    )
    .get();
  return row?.id ?? null;
}

/**
 * Emit one journal effect row per entry, sequentially, swallowing
 * per-row failures so one bad write does not block the rest of the
 * batch.
 */
export async function emitCashSessionEffects(
  db: DatabaseInstance,
  log: CashSessionLogger,
  eventId: string | null,
  effects: CashSessionJournalEffectInput[]
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
        'cash-session journal effect emission failed (non-blocking)'
      );
    }
  }
}
