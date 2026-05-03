/**
 * ENG-052b — MEGA seed: historical cash sessions + movements.
 *
 * Bulk-inserts (cashier × site × day) cash sessions across the
 * historical window. Each closed session emits 1-2 cash movements
 * (paid_in / paid_out / skim / replenishment) so the report page +
 * over/short surfaces have real data.
 *
 * Bulk SQL bypasses the tRPC envelope path; for ENG-052 verification
 * the recent-via-tRPC pass exercises that flow on the last 3 days.
 *
 * @module db/seed-mega/historical-cash
 */

import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import { cashSessions, cashMovements } from '../schema.js';
import { businessHourIso, daysAgoIso } from './time-helpers.js';
import type { MegaContext, MegaTarget } from './types.js';

interface CreatedHistoricalSessions {
  /** Closed sessions — keyed by (siteId, daysAgo, cashierId). */
  closed: Array<{
    id: string;
    siteId: string;
    cashierId: string;
    daysAgo: number;
    openedAtIso: string;
    closedAtIso: string;
    openingFloat: number;
  }>;
  /** One open session per active cashier — created at the end so the UI shows live shifts. */
  open: Array<{ id: string; siteId: string; cashierId: string; openedAtIso: string }>;
  cashMovementsCount: number;
}

const MOVEMENT_TYPES = ['paid_in', 'paid_out', 'skim', 'replenishment'] as const;

export async function seedHistoricalCash(
  ctx: MegaContext,
  target: MegaTarget
): Promise<CreatedHistoricalSessions> {
  const { db, clock, tenantId, sites, cashiers } = ctx;
  const closed: CreatedHistoricalSessions['closed'] = [];
  const open: CreatedHistoricalSessions['open'] = [];
  let movementsCount = 0;

  // Distribute cashiers across sites in a stable cycle so each site
  // has predictable activity. Cashier 0 → Site 0, Cashier 1 → Site 1,
  // Cashier 2 → Site 2, Cashier 3 → Site 0, ...
  const cashierAssignments = cashiers.map((c, idx) => ({
    cashier: c,
    site: sites[idx % sites.length]!,
  }));

  // Walk backwards from `historicalDays - 1` down to 1 (today=0 stays
  // for the recent-via-tRPC pass). For each (cashier, day) pair, roll
  // a deterministic dice on the activity rate to decide if a session
  // opened that day.
  const rowsToInsertSessions: Array<typeof cashSessions.$inferInsert> = [];
  const rowsToInsertMovements: Array<typeof cashMovements.$inferInsert> = [];

  for (let daysAgo = target.historicalDays - 1; daysAgo >= 1; daysAgo -= 1) {
    cashierAssignments.forEach(({ cashier, site }, assignmentIdx) => {
      // Deterministic activity dice
      const seed = (daysAgo * 31 + assignmentIdx * 17) % 100;
      const active = seed < target.cashierActivityRate * 100;
      if (!active) return;

      const openedAtIso = daysAgoIso(clock, daysAgo, 8, 0, 0);
      const closedAtIso = daysAgoIso(clock, daysAgo, 19, 30, 0);
      const openingFloat = 100_000 + (seed % 5) * 50_000;
      const denominations = [
        { value: 50_000, count: 2 },
        { value: 10_000, count: 5 },
      ];

      const id = nanoid();
      // Expected balance ≈ opening + sales cash + paid_in - paid_out;
      // for the seed we compute a realistic synthetic delta and an
      // over/short between -3000 and +3000 so the reports page has
      // variance.
      const expected = openingFloat + 200_000 + (seed % 7) * 10_000;
      const overShortDelta = ((seed % 7) - 3) * 1_000;
      const actual = expected + overShortDelta;

      rowsToInsertSessions.push({
        id,
        tenantId,
        siteId: site.id,
        cashierId: cashier.id,
        registerName: `Caja ${cashier.email.split('@')[0]}`,
        openingFloat,
        openingCountDenominations: denominations,
        expectedBalance: expected,
        actualCount: actual,
        actualCountDenominations: denominations,
        overShort: overShortDelta,
        status: 'closed',
        openedAt: openedAtIso,
        closedAt: closedAtIso,
        createdAt: openedAtIso,
        updatedAt: closedAtIso,
      });

      // 1-2 cash movements per session
      const movementCount = (seed % 3 === 0) ? 2 : 1;
      for (let m = 0; m < movementCount; m += 1) {
        const movementType = MOVEMENT_TYPES[(seed + m) % MOVEMENT_TYPES.length]!;
        const amount = (movementType === 'paid_out' || movementType === 'skim')
          ? -((seed % 5 + 1) * 5_000)
          : (seed % 5 + 1) * 5_000;
        const movementIso = businessHourIso(clock, daysAgo, m + assignmentIdx);
        rowsToInsertMovements.push({
          id: nanoid(),
          tenantId,
          sessionId: id,
          type: movementType,
          amount,
          note: `${movementType.replace('_', ' ')} demo seed`,
          createdBy: cashier.id,
          createdAt: movementIso,
        });
      }

      closed.push({
        id,
        siteId: site.id,
        cashierId: cashier.id,
        daysAgo,
        openedAtIso,
        closedAtIso,
        openingFloat,
      });
      movementsCount += movementCount;
    });
  }

  // Bulk insert in chunks to avoid a single oversized SQL statement
  await chunkedInsert(db, cashSessions, rowsToInsertSessions);
  await chunkedInsert(db, cashMovements, rowsToInsertMovements);

  // The default seed (`seedSales` in `seed-dev.ts`) already opens
  // ONE live session per cashier via `cashSessions.open` through
  // tRPC — we don't duplicate it here, otherwise each cashier would
  // end up with two open sessions on the same register and the
  // /sales page can't decide which one to bind. We DO surface the
  // already-open sessions as `open` for downstream helpers (drafts +
  // recent-via-tRPC) by querying them.
  const openSessionsRows = await db
    .select({
      id: cashSessions.id,
      siteId: cashSessions.siteId,
      cashierId: cashSessions.cashierId,
      openedAt: cashSessions.openedAt,
    })
    .from(cashSessions)
    .where(and(eq(cashSessions.tenantId, tenantId), eq(cashSessions.status, 'open')))
    .all();
  for (const row of openSessionsRows) {
    if (row.siteId && row.cashierId) {
      open.push({
        id: row.id,
        siteId: row.siteId,
        cashierId: row.cashierId,
        openedAtIso: row.openedAt,
      });
    }
  }

  return { closed, open, cashMovementsCount: movementsCount };
}

/**
 * better-sqlite3 has a hard limit on bound parameters per statement
 * (default 999 in the upstream build, ~32k in the puntovivo build,
 * but the safe ceiling stays low to keep the SQL planner happy).
 * Splitting bulk inserts into chunks of ~500 rows keeps every
 * statement well under any limit.
 */
async function chunkedInsert<T extends Record<string, unknown>>(
  db: MegaContext['db'],
  table: Parameters<typeof db.insert>[0],
  rows: T[]
): Promise<void> {
  if (rows.length === 0) return;
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.insert(table) as any).values(chunk).run();
  }
}
