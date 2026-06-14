/**
 * ENG-047 — snooze lookup for the anomaly detector.
 *
 * ENG-178 — extracted verbatim from the former flat
 * `services/ai/anomalyDetection.ts` during the megafile decomposition.
 *
 * @module services/ai/anomalyDetection/snooze
 */
import { and, eq, gt } from 'drizzle-orm';

import type { DatabaseInstance } from '../../../db/index.js';
import { aiAnomalySnoozes } from '../../../db/schema.js';

/**
 * Build the snooze lookup key for an alert. Aggregate detectors
 * (`voidRate`, `noSaleSessions`) emit `evidenceRef = null`, so the
 * snooze that silences them is keyed on `(kind, cashierId)` only and
 * applies across all alerts of that kind for that cashier. Specific
 * detectors (`refundAmount`) carry the saleId in `evidenceRef` so
 * silencing one $5000 refund does not silence a different one.
 */
export function snoozeKey(
  kind: string,
  cashierId: string | null,
  evidenceRef: string | null
): string {
  return `${kind}|${cashierId ?? ''}|${evidenceRef ?? ''}`;
}

/**
 * ENG-047 — load the active snoozes for a tenant and return a Set of
 * lookup keys the orchestrator uses to filter alerts. Active means
 * `snoozed_until > now`; expired rows linger on disk (cheap) and are
 * pruned by a future cron (BACKLOG follow-up).
 */
export async function loadActiveSnoozeKeys(
  db: DatabaseInstance,
  tenantId: string,
  now: Date
): Promise<Set<string>> {
  const rows = await db
    .select({
      kind: aiAnomalySnoozes.kind,
      cashierId: aiAnomalySnoozes.cashierId,
      evidenceRef: aiAnomalySnoozes.evidenceRef,
    })
    .from(aiAnomalySnoozes)
    .where(
      and(
        eq(aiAnomalySnoozes.tenantId, tenantId),
        gt(aiAnomalySnoozes.snoozedUntil, now.toISOString())
      )
    )
    .all();
  const keys = new Set<string>();
  for (const r of rows) keys.add(snoozeKey(r.kind, r.cashierId, r.evidenceRef));
  return keys;
}
