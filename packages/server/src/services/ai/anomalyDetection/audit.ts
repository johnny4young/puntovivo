/**
 * audit-log persistence for surfaced anomalies.
 *
 * extracted verbatim from the former flat
 * `services/ai/anomalyDetection.ts` during the megafile decomposition.
 *
 * @module services/ai/anomalyDetection/audit
 */
import type { DatabaseInstance } from '../../../db/index.js';
import { writeAuditLog } from '../../audit-logs.js';
import type { AnomalyAlert } from './types.js';

/**
 * persist newly-surfaced alerts to `audit_logs`. The
 * deterministic dedup key `kind:cashierId:occurredAt[date]:evidenceRef`
 * means re-running the detector inside the same 24h window does not
 * write the same row twice; a fresh outlier on the next day creates a
 * new audit row even if the cashier and kind repeat. The rows go
 * through `writeAuditLog` with the deterministic id so they join the
 * tamper-evidence hash chain; the service applies INSERT OR IGNORE
 * per row, so a duplicate id is absorbed without aborting the batch
 * transaction (the pre-chain concurrency behavior preserved).
 *
 * `actor_id` is required by `audit_logs`, but the detector has no
 * operator context, so we attribute the row to the cashier whose
 * behavior was flagged. Cashier-less alerts are skipped because there
 * is no valid user id for the NOT NULL + FK-constrained actor column.
 * `metadata.detectedBy = 'ai.anomaly.detector'` keeps the source
 * machine-readable for downstream filters.
 */
export async function persistAnomalyAuditLogs(
  db: DatabaseInstance,
  tenantId: string,
  alerts: AnomalyAlert[]
): Promise<void> {
  if (alerts.length === 0) return;
  const rows = alerts.map(alert => {
    const day = alert.occurredAt.slice(0, 10); // YYYY-MM-DD bucket
    const id = `anomaly:${alert.kind}:${alert.cashierId ?? ''}:${day}:${alert.evidenceRef ?? ''}`;
    return {
      id,
      tenantId,
      // The cashier whose behavior was flagged — when null we fall
      // back to the snoozed_by/system column convention by using the
      // tenant id; the audit_logs.actor_id FK to users would fail in
      // that path, so we skip the row entirely (a cashier-less alert
      // means an aggregate detector with no clear individual subject).
      actorId: alert.cashierId,
      action: 'ai.anomaly.detected',
      resourceType: 'user',
      resourceId: alert.cashierId ?? `tenant:${tenantId}`,
      before: null,
      after: null,
      metadata: {
        detectedBy: 'ai.anomaly.detector',
        kind: alert.kind,
        severity: alert.severity,
        observed: alert.observed,
        baselineMean: alert.baselineMean,
        baselineStdDev: alert.baselineStdDev,
        distance: alert.distance,
        evidenceRef: alert.evidenceRef,
      } as Record<string, unknown>,
      createdAt: alert.occurredAt,
    };
  });
  // Skip rows with null actorId — auditLogs.actor_id is NOT NULL.
  const insertable = rows.filter(r => r.actorId !== null) as Array<
    (typeof rows)[number] & { actorId: string }
  >;
  if (insertable.length === 0) return;
  // routed through writeAuditLog inside ONE transaction so
  // the rows join the tenant hash chain; the deterministic id keeps the
  // 24h dedup (writeAuditLog skips ids that already exist instead of
  // the old INSERT OR IGNORE, which would have burned chain links).
  db.transaction(tx => {
    for (const row of insertable) {
      writeAuditLog({
        tx,
        id: row.id,
        tenantId: row.tenantId,
        actorId: row.actorId,
        action: 'ai.anomaly.detected',
        resourceType: 'user',
        resourceId: row.resourceId,
        before: null,
        after: null,
        metadata: row.metadata,
        createdAt: row.createdAt,
      });
    }
  });
}
