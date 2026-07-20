/**
 * anomaly detection orchestrator.
 *
 * extracted verbatim from the former flat
 * `services/ai/anomalyDetection.ts` (PUBLIC ORCHESTRATOR section)
 * during the megafile decomposition. Wires the four sub-detectors
 * together with the snooze filter and the best-effort audit write.
 *
 * @module services/ai/anomalyDetection/detectAnomalies
 */
import type { DatabaseInstance } from '../../../db/index.js';
import { persistAnomalyAuditLogs } from './audit.js';
import { detectNoSaleSessionsOutliers } from './detectors/noSaleSessions.js';
import { detectRefundAmountOutliers } from './detectors/refundAmount.js';
import { detectTicketsPerHourSpikes } from './detectors/ticketsPerHourSpike.js';
import { detectVoidRateOutliers } from './detectors/voidRate.js';
import { loadActiveSnoozeKeys, snoozeKey } from './snooze.js';
import type {
  AnomalyDetectionInput,
  AnomalyDetectionResult,
  AnomalyKind,
  AnomalySeverity,
} from './types.js';

/**
 * Run all four detectors and aggregate their output. Detector queries
 * execute concurrently and fail as a unit: a data-access failure in
 * any detector rejects the request so the dashboard never shows a
 * misleading partial risk picture. Multi-tenant isolation is enforced
 * inside every query via `eq(*.tenantId, tenantId)`.
 *
 * alerts whose `(kind, cashierId, evidenceRef)` matches an
 * active snooze are filtered out, AND non-snoozed alerts are persisted
 * to `audit_logs` for historical traceability + cross-reference from
 * `/audit-logs`. The audit-log write is best-effort fire-and-forget:
 * a failure there does not poison the response.
 *
 * @returns Sorted by descending severity then descending distance,
 * so the most extreme alerts appear first in the dashboard.
 */
export async function detectAnomalies(
  db: DatabaseInstance,
  input: AnomalyDetectionInput
): Promise<AnomalyDetectionResult> {
  const now = new Date();
  const [ticketsPerHour, voidRates, refundAmounts, noSale, snoozeKeys] = await Promise.all([
    detectTicketsPerHourSpikes(db, input),
    detectVoidRateOutliers(db, input),
    detectRefundAmountOutliers(db, input),
    detectNoSaleSessionsOutliers(db, input),
    loadActiveSnoozeKeys(db, input.tenantId, now),
  ]);

  const allAlerts = [...ticketsPerHour, ...voidRates, ...refundAmounts, ...noSale];
  // Filter snoozed alerts. We compare against `null` evidenceRef in
  // the snooze key so a kind+cashier-level snooze suppresses every
  // alert of that kind for that cashier regardless of evidenceRef.
  const alerts = allAlerts.filter(alert => {
    if (snoozeKeys.has(snoozeKey(alert.kind, alert.cashierId, alert.evidenceRef))) return false;
    if (snoozeKeys.has(snoozeKey(alert.kind, alert.cashierId, null))) return false;
    return true;
  });
  alerts.sort((a, b) => {
    // High before medium; within the same severity, larger distance first.
    if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1;
    return b.distance - a.distance;
  });

  const severityCounts: Record<AnomalySeverity, number> = { medium: 0, high: 0 };
  const kindCounts: Record<AnomalyKind, number> = {
    ticketsPerHourSpike: 0,
    voidRate: 0,
    refundAmount: 0,
    noSaleSessions: 0,
  };
  for (const alert of alerts) {
    severityCounts[alert.severity] += 1;
    kindCounts[alert.kind] += 1;
  }

  // Best-effort persistence — failure here logs but does not poison
  // the response. The dedup key on `id` absorbs concurrent re-runs.
  try {
    await persistAnomalyAuditLogs(db, input.tenantId, alerts);
  } catch {
    // Intentional swallow: dashboard render must not block on audit write.
  }

  return { alerts, totalCount: alerts.length, severityCounts, kindCounts };
}
