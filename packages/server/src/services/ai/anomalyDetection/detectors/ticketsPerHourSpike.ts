/**
 * Pattern 5 / Hours raras detector.
 *
 * extracted verbatim from the former flat
 * `services/ai/anomalyDetection.ts` (SUB-DETECTORS section) during the
 * megafile decomposition.
 *
 * @module services/ai/anomalyDetection/detectors/ticketsPerHourSpike
 */
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../../../db/index.js';
import { sales, users } from '../../../../db/schema.js';
import { MIN_PERSONAL_HOURS, type AnomalyAlert, type AnomalyDetectionInput } from '../types.js';
import { mean, severityFromDistance, stdDev, zScore } from '../stats.js';

/**
 * **Pattern 5 / Hours raras**: each cashier is compared against THEIR
 * OWN 30-day hourly mean. Hours where the count is far above their
 * personal baseline are flagged.
 *
 * Example: cashier "María" usually rings 22 tickets/hour during
 * Friday 6-8pm. One Friday she rings 90 in a single hour — z-score
 * around 7σ vs her personal mean. Likely covering a void burst, or
 * processing legitimate transactions while a partner pockets cash.
 *
 * Uses substr(createdAt, 0, 14) to bucket by hour ('YYYY-MM-DDTHH').
 * No composite index for this aggregation — embedded SQLite handles
 * up to ~50k sales / month before this exceeds 100ms; mitigation is
 * dashboard cache (`staleTime: 5 * 60_000`).
 */
export async function detectTicketsPerHourSpikes(
  db: DatabaseInstance,
  input: AnomalyDetectionInput
): Promise<AnomalyAlert[]> {
  const { tenantId, from, to } = input;
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const rows = await db
    .select({
      cashierId: sales.createdBy,
      cashierName: users.name,
      hourBucket: sql<string>`substr(${sales.createdAt}, 1, 13)`,
      count: sql<number>`count(*)`,
    })
    .from(sales)
    .leftJoin(users, eq(sales.createdBy, users.id))
    .where(
      and(
        eq(sales.tenantId, tenantId),
        eq(sales.status, 'completed'),
        gte(sales.createdAt, fromIso),
        lte(sales.createdAt, toIso)
      )
    )
    .groupBy(sales.createdBy, users.name, sql`substr(${sales.createdAt}, 1, 13)`)
    .all();

  // Group by cashier so we can compute personal baselines.
  const byCashier = new Map<
    string,
    { name: string | null; counts: { hourBucket: string; count: number }[] }
  >();
  for (const row of rows) {
    if (!row.cashierId) continue;
    const entry = byCashier.get(row.cashierId);
    if (entry) {
      entry.counts.push({ hourBucket: row.hourBucket, count: Number(row.count) });
    } else {
      byCashier.set(row.cashierId, {
        name: row.cashierName,
        counts: [{ hourBucket: row.hourBucket, count: Number(row.count) }],
      });
    }
  }

  const alerts: AnomalyAlert[] = [];
  for (const [cashierId, { name, counts }] of byCashier) {
    if (counts.length < MIN_PERSONAL_HOURS) continue;
    const values = counts.map(c => c.count);
    const personalMean = mean(values);
    const personalStdDev = stdDev(values, personalMean);
    if (personalStdDev === 0) continue; // perfectly flat cashier — nothing to flag

    for (const { hourBucket, count } of counts) {
      const z = zScore(count, personalMean, personalStdDev);
      const severity = severityFromDistance(z);
      // Only flag UPWARD spikes (high count). Downward dips are the
      // sweethearting signal but require traffic correlation we do
      // not have in v1; captured as follow-up work.
      if (severity === null || z < 0) continue;
      alerts.push({
        id: nanoid(),
        kind: 'ticketsPerHourSpike',
        cashierId,
        cashierName: name,
        severity,
        observed: count,
        baselineMean: personalMean,
        baselineStdDev: personalStdDev,
        distance: z,
        // hourBucket is 'YYYY-MM-DDTHH' — append ':00:00.000Z' to make
        // it round-trip as an ISO timestamp.
        occurredAt: `${hourBucket}:00:00.000Z`,
        evidenceRef: null,
      });
    }
  }
  return alerts;
}
