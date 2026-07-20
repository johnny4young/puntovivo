/**
 * Pattern 4 / No-sale opens detector.
 *
 * extracted verbatim from the former flat
 * `services/ai/anomalyDetection.ts` (SUB-DETECTORS section) during the
 * megafile decomposition.
 *
 * @module services/ai/anomalyDetection/detectors/noSaleSessions
 */
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../../../db/index.js';
import { cashSessions, sales, users } from '../../../../db/schema.js';
import {
  MIN_NOSALE_DURATION_MS,
  MIN_SAMPLE_SIZE,
  type AnomalyAlert,
  type AnomalyDetectionInput,
} from '../types.js';
import { leaveOneOutZScore, mean, severityFromDistance, stdDev } from '../stats.js';

/**
 * **Pattern 4 / No-sale opens**: count cash sessions where the
 * cashier kept the drawer open for at least `MIN_NOSALE_DURATION_MS`
 * but recorded zero completed sales. A session legitimately ends
 * with zero sales sometimes (training, equipment check, drawer
 * audit), but the count over 30 days should be low and consistent
 * across the team.
 *
 * Cross-cashier detection: per cashier, count of qualifying sessions;
 * z-score that count against the tenant population.
 *
 * Example: cashier "Andrés" has 18 zero-sale sessions over 30 min in
 * a month. Population mean: 2.5, stddev: 1.5. z = 10σ — Andrés is
 * very likely opening the drawer to extract cash.
 */
export async function detectNoSaleSessionsOutliers(
  db: DatabaseInstance,
  input: AnomalyDetectionInput
): Promise<AnomalyAlert[]> {
  const { tenantId, from, to } = input;
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  // For each closed session in the window, compute duration and
  // count of completed sales tied to it. SQLite supports
  // strftime('%s', ...) for ISO-string-to-epoch conversion in
  // seconds; multiply by 1000 to get ms.
  const rows = await db
    .select({
      sessionId: cashSessions.id,
      cashierId: cashSessions.cashierId,
      cashierName: users.name,
      openedAt: cashSessions.openedAt,
      closedAt: cashSessions.closedAt,
      durationMs: sql<number>`(strftime('%s', ${cashSessions.closedAt}) - strftime('%s', ${cashSessions.openedAt})) * 1000`,
      completedSaleCount: sql<number>`(
        SELECT count(*) FROM ${sales}
        WHERE ${sales.cashSessionId} = ${cashSessions.id}
          AND ${sales.tenantId} = ${tenantId}
          AND ${sales.status} = 'completed'
      )`,
    })
    .from(cashSessions)
    .leftJoin(users, eq(cashSessions.cashierId, users.id))
    .where(
      and(
        eq(cashSessions.tenantId, tenantId),
        eq(cashSessions.status, 'closed'),
        gte(cashSessions.openedAt, fromIso),
        lte(cashSessions.openedAt, toIso)
      )
    )
    .all();

  // Build per-cashier no-sale counts.
  const noSaleByCashier = new Map<string, { name: string | null; noSaleCount: number }>();
  const knownCashiers = new Set<string>();
  for (const row of rows) {
    knownCashiers.add(row.cashierId);
    const isLong = Number(row.durationMs) >= MIN_NOSALE_DURATION_MS;
    const isEmpty = Number(row.completedSaleCount) === 0;
    const entry = noSaleByCashier.get(row.cashierId);
    if (!entry) {
      noSaleByCashier.set(row.cashierId, {
        name: row.cashierName,
        noSaleCount: isLong && isEmpty ? 1 : 0,
      });
    } else if (isLong && isEmpty) {
      entry.noSaleCount += 1;
    }
  }

  if (knownCashiers.size < MIN_SAMPLE_SIZE) return [];

  // Leave-one-out z-score (same rationale as voidRate detector).
  const entries = Array.from(noSaleByCashier.entries());
  const counts = entries.map(([, v]) => v.noSaleCount);
  const populationMean = mean(counts);
  const populationStdDev = stdDev(counts, populationMean);

  const alerts: AnomalyAlert[] = [];
  entries.forEach(([cashierId, { name, noSaleCount }], idx) => {
    const z = leaveOneOutZScore(idx, counts);
    const severity = severityFromDistance(z);
    if (severity === null || z < 0) return;
    alerts.push({
      id: nanoid(),
      kind: 'noSaleSessions',
      cashierId,
      cashierName: name,
      severity,
      observed: noSaleCount,
      baselineMean: populationMean,
      baselineStdDev: populationStdDev,
      distance: z,
      occurredAt: toIso,
      evidenceRef: null,
    });
  });
  return alerts;
}
