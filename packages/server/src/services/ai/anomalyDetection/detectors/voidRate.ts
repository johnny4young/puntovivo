/**
 * Pattern 2 / Voids fantasma detector.
 *
 * extracted verbatim from the former flat
 * `services/ai/anomalyDetection.ts` (SUB-DETECTORS section) during the
 * megafile decomposition.
 *
 * @module services/ai/anomalyDetection/detectors/voidRate
 */
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../../../db/index.js';
import { auditLogs, sales, users } from '../../../../db/schema.js';
import { MIN_SAMPLE_SIZE, type AnomalyAlert, type AnomalyDetectionInput } from '../types.js';
import { leaveOneOutZScore, mean, severityFromDistance, stdDev } from '../stats.js';

/**
 * **Pattern 2 / Voids fantasma**: per cashier, compute the ratio of
 * voided sales to completed sales over the window. Flag cashiers
 * whose ratio is far above the tenant population mean.
 *
 * Why ratio and not count: a busy cashier will naturally void more
 * absolute sales than a slow one; ratio normalizes for shift volume.
 *
 * Example: cashier "Carlos" voids 15 sales out of 100 (15%) while
 * the tenant population averages 2% with stddev 1%. z-score = 13σ.
 * That is impossible by chance — investigate immediately.
 *
 * Source of voids: `audit_logs.action = 'sale.void'` (richer
 * metadata than `sales.status='voided'` flags), grouped by
 * `actorId`. Source of denominator: completed sales per cashier.
 */
export async function detectVoidRateOutliers(
  db: DatabaseInstance,
  input: AnomalyDetectionInput
): Promise<AnomalyAlert[]> {
  const { tenantId, from, to } = input;
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  // Voids per cashier from audit_logs.
  const voidRows = await db
    .select({
      cashierId: auditLogs.actorId,
      cashierName: users.name,
      voidCount: sql<number>`count(*)`,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorId, users.id))
    .where(
      and(
        eq(auditLogs.tenantId, tenantId),
        eq(auditLogs.action, 'sale.void'),
        gte(auditLogs.createdAt, fromIso),
        lte(auditLogs.createdAt, toIso)
      )
    )
    .groupBy(auditLogs.actorId, users.name)
    .all();

  // Completed sales per cashier in the same window.
  const saleRows = await db
    .select({
      cashierId: sales.createdBy,
      saleCount: sql<number>`count(*)`,
    })
    .from(sales)
    .where(
      and(
        eq(sales.tenantId, tenantId),
        eq(sales.status, 'completed'),
        gte(sales.createdAt, fromIso),
        lte(sales.createdAt, toIso)
      )
    )
    .groupBy(sales.createdBy)
    .all();

  const saleByCashier = new Map<string, number>();
  for (const row of saleRows) saleByCashier.set(row.cashierId, Number(row.saleCount));

  // Build the per-cashier ratio universe (every cashier with at least
  // one completed sale in the window). Cashiers with zero completed
  // sales but with voids are very suspicious; emit a synthetic ratio
  // of 1.0 (100% voids) for them.
  type Row = { cashierId: string; cashierName: string | null; voidCount: number; ratio: number };
  const universe: Row[] = [];
  const voidByCashier = new Map<string, { cashierName: string | null; voidCount: number }>();
  for (const row of voidRows) {
    voidByCashier.set(row.cashierId, {
      cashierName: row.cashierName,
      voidCount: Number(row.voidCount),
    });
  }
  // Ensure every cashier present in either set is represented.
  const allCashiers = new Set<string>([...saleByCashier.keys(), ...voidByCashier.keys()]);
  for (const cashierId of allCashiers) {
    const voidEntry = voidByCashier.get(cashierId);
    const saleCount = saleByCashier.get(cashierId) ?? 0;
    const voidCount = voidEntry?.voidCount ?? 0;
    const ratio = saleCount > 0 ? voidCount / saleCount : voidCount > 0 ? 1 : 0;
    universe.push({
      cashierId,
      cashierName: voidEntry?.cashierName ?? null,
      voidCount,
      ratio,
    });
  }

  if (universe.length < MIN_SAMPLE_SIZE) return [];

  // Leave-one-out z-score: per-cashier baseline excludes that
  // cashier so a single outlier does not inflate its own stddev. See
  // `leaveOneOutZScore` JSDoc for the small-N rationale.
  const ratios = universe.map(r => r.ratio);
  const populationMean = mean(ratios);
  const populationStdDev = stdDev(ratios, populationMean);

  const alerts: AnomalyAlert[] = [];
  universe.forEach((row, idx) => {
    const z = leaveOneOutZScore(idx, ratios);
    const severity = severityFromDistance(z);
    if (severity === null || z < 0) return;
    alerts.push({
      id: nanoid(),
      kind: 'voidRate',
      cashierId: row.cashierId,
      cashierName: row.cashierName,
      severity,
      observed: row.ratio,
      // Reported baseline is the population mean+stddev (more
      // intuitive for the operator than the LOO baseline that
      // excludes the candidate).
      baselineMean: populationMean,
      baselineStdDev: populationStdDev,
      distance: z,
      occurredAt: toIso,
      evidenceRef: null,
    });
  });
  return alerts;
}
