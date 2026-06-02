/**
 * ENG-052b — Time helpers for the MEGA seed.
 *
 * Every timestamp in the MEGA dataset is computed RELATIVE to the
 * moment the seed runs. Hard-coded ISO strings would freeze the seed
 * — historical depth would shrink each day until the dashboard ran
 * out of "last 30 days" data. By anchoring on `Date.now()` at seed
 * time, the dataset always carries 90+ days of historical depth from
 * whenever the operator ran `npm run seed:dev`.
 *
 * @module db/seed-mega/time-helpers
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Anchor for every helper in this module. Captured ONCE at seed
 * start so different helpers agree on "now" even if the seed runs
 * for a few seconds.
 */
export interface SeedClock {
  /** Epoch millis at seed start. */
  readonly nowMs: number;
  /** ISO-8601 string at seed start. */
  readonly nowIso: string;
}

export function makeSeedClock(): SeedClock {
  const nowMs = Date.now();
  return {
    nowMs,
    nowIso: new Date(nowMs).toISOString(),
  };
}

/**
 * ISO-8601 timestamp `daysAgo` days before the clock anchor, with an
 * optional time-of-day. Default time = noon-ish (12:00:00) so the
 * timestamp is unambiguously in the right local-day bucket regardless
 * of the operator's timezone.
 */
export function daysAgoIso(
  clock: SeedClock,
  daysAgo: number,
  hour = 12,
  minute = 0,
  second = 0
): string {
  const d = new Date(clock.nowMs);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, second, 0);
  return d.toISOString();
}

/**
 * ISO timestamp `daysAgo` days before now with a randomized
 * business-hours time-of-day (06:00-21:00) so a day's worth of seeded
 * sales scatters across the shift instead of clumping at noon.
 *
 * The randomization is deterministic per `(daysAgo, sequence)` so the
 * seed stays reproducible — call sites that need stable ordering
 * pass an incrementing `sequence` index.
 */
export function businessHourIso(
  clock: SeedClock,
  daysAgo: number,
  sequence: number
): string {
  // 06:00 to 21:00 = 15 hours of business window
  const hour = 6 + (sequence * 7) % 15;
  const minute = (sequence * 17) % 60;
  const second = (sequence * 31) % 60;
  return daysAgoIso(clock, daysAgo, hour, minute, second);
}

/**
 * Random epoch-millis timestamp inside a (daysAgo, daysAgo-spread)
 * window. Used by helpers that distribute events across a multi-day
 * range (e.g. "transfers spread across the last 90 days").
 */
export function randomDaysAgoIso(
  clock: SeedClock,
  daysAgoMin: number,
  daysAgoMax: number,
  sequence: number
): string {
  const span = daysAgoMax - daysAgoMin;
  const daysAgo = daysAgoMin + Math.abs((sequence * 0.6180339887) % 1) * span;
  const ms = clock.nowMs - daysAgo * DAY_MS;
  return new Date(ms).toISOString();
}

/**
 * Subtract a small random offset (in millis) so `createdAt` differs
 * from `updatedAt` for rows that get amended after creation. Useful
 * for refunds, voids, transfer receipts.
 */
export function laterIso(baseIso: string, offsetMs: number): string {
  return new Date(new Date(baseIso).getTime() + offsetMs).toISOString();
}
