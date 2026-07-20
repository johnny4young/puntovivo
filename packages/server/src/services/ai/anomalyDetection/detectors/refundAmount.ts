/**
 * Pattern 3 / Refunds fraudulentos detector.
 *
 * extracted verbatim from the former flat
 * `services/ai/anomalyDetection.ts` (SUB-DETECTORS section) during the
 * megafile decomposition.
 *
 * @module services/ai/anomalyDetection/detectors/refundAmount
 */
import { and, eq, gte, lte } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../../../db/index.js';
import { saleReturns, users } from '../../../../db/schema.js';
import {
  MIN_SAMPLE_SIZE,
  REFUND_TOP_K,
  type AnomalyAlert,
  type AnomalyDetectionInput,
} from '../types.js';
import { mean, severityFromDistance, stdDev, zScore } from '../stats.js';

/**
 * **Pattern 3 / Refunds fraudulentos individuales**: scan every
 * refund in the window and flag those whose `refundAmount` is far
 * above the tenant-wide refund mean.
 *
 * Why refunds individually (not aggregated per cashier): a single
 * fraudulent $5000 refund stands out even when the cashier is
 * otherwise clean. Aggregating would dilute that signal.
 *
 * Returns at most `REFUND_TOP_K` results so the dashboard never
 * floods. Sorted internally by descending z-score.
 *
 * Example: tenant mean refund = $50, stddev = $30. A single $5000
 * refund has z = 165σ — clearly real fraud or a legitimate
 * high-ticket return that the manager should still verify.
 */
export async function detectRefundAmountOutliers(
  db: DatabaseInstance,
  input: AnomalyDetectionInput
): Promise<AnomalyAlert[]> {
  const { tenantId, from, to } = input;
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const rows = await db
    .select({
      refundId: saleReturns.id,
      saleId: saleReturns.saleId,
      cashierId: saleReturns.createdBy,
      cashierName: users.name,
      refundAmount: saleReturns.refundAmount,
      createdAt: saleReturns.createdAt,
    })
    .from(saleReturns)
    .leftJoin(users, eq(saleReturns.createdBy, users.id))
    .where(
      and(
        eq(saleReturns.tenantId, tenantId),
        gte(saleReturns.createdAt, fromIso),
        lte(saleReturns.createdAt, toIso)
      )
    )
    .all();

  if (rows.length < MIN_SAMPLE_SIZE) return [];

  const amounts = rows.map(r => Number(r.refundAmount));
  const amountMean = mean(amounts);
  const amountStdDev = stdDev(amounts, amountMean);

  const alerts: AnomalyAlert[] = [];
  for (const row of rows) {
    const amount = Number(row.refundAmount);
    const z = zScore(amount, amountMean, amountStdDev);
    const severity = severityFromDistance(z);
    if (severity === null || z < 0) continue;
    alerts.push({
      id: nanoid(),
      kind: 'refundAmount',
      cashierId: row.cashierId,
      cashierName: row.cashierName,
      severity,
      observed: amount,
      baselineMean: amountMean,
      baselineStdDev: amountStdDev,
      distance: z,
      occurredAt: row.createdAt,
      evidenceRef: row.saleId,
    });
  }

  alerts.sort((a, b) => b.distance - a.distance);
  return alerts.slice(0, REFUND_TOP_K);
}
