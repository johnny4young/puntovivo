/**
 * ENG-168 — pins the login_attempts cleanup worker.
 *
 * The worker sweeps rate-limit buckets whose `expires_at` is older
 * than 24 h. These tests drive the sweep synchronously via
 * `.tickOnce()` with an injected clock so they are deterministic and
 * fast (no setInterval timing).
 *
 * Scenarios:
 *  1. Rows whose `expires_at` is well beyond the 24 h cutoff are
 *     deleted.
 *  2. Rows whose `expires_at` is recent (or in the future) survive.
 *  3. `tickOnce` is idempotent — calling twice deletes once.
 *  4. The factory's `stop()` releases the interval without throwing
 *     even if `start()` was never invoked.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import { loginAttempts } from '../db/schema.js';
import { createLoginAttemptsCleanup } from '../services/cleanup/loginAttemptsCleanup.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

beforeEach(async () => {
  await initDatabase({ dbPath: ':memory:', seedData: false });
});

afterEach(() => {
  closeDatabase();
});

interface SeedRow {
  id: string;
  expiresAt: number;
  firstAt: number;
}

function seedAttempts(rows: SeedRow[]): void {
  const db = getDatabase();
  for (const row of rows) {
    db.insert(loginAttempts)
      .values({
        id: row.id,
        kind: 'ip',
        key: `seed-${row.id}`,
        count: 1,
        firstAt: row.firstAt,
        expiresAt: row.expiresAt,
        createdAt: new Date(row.firstAt).toISOString(),
        updatedAt: new Date(row.firstAt).toISOString(),
      })
      .run();
  }
}

describe('login_attempts cleanup worker (ENG-168)', () => {
  it('deletes rows whose expires_at is older than the 24 h cutoff', () => {
    const fakeNow = 1_780_000_000_000;
    seedAttempts([
      { id: 'stale-1', expiresAt: fakeNow - DAY_MS - HOUR_MS, firstAt: fakeNow - DAY_MS - 2 * HOUR_MS },
      { id: 'stale-2', expiresAt: fakeNow - 2 * DAY_MS, firstAt: fakeNow - 3 * DAY_MS },
      { id: 'recent', expiresAt: fakeNow - HOUR_MS, firstAt: fakeNow - 2 * HOUR_MS },
      { id: 'future', expiresAt: fakeNow + HOUR_MS, firstAt: fakeNow - HOUR_MS },
    ]);

    const worker = createLoginAttemptsCleanup({ db: getDatabase(), now: () => fakeNow });
    const deleted = worker.tickOnce();

    expect(deleted).toBe(2);

    const surviving = getDatabase()
      .select({ id: loginAttempts.id })
      .from(loginAttempts)
      .all();
    const ids = surviving.map(r => r.id).sort();
    expect(ids).toEqual(['future', 'recent']);
  });

  it('is idempotent — a second tick on the same clock deletes nothing', () => {
    const fakeNow = 1_780_000_000_000;
    seedAttempts([
      { id: 'stale-only', expiresAt: fakeNow - 2 * DAY_MS, firstAt: fakeNow - 3 * DAY_MS },
    ]);

    const worker = createLoginAttemptsCleanup({ db: getDatabase(), now: () => fakeNow });
    expect(worker.tickOnce()).toBe(1);
    expect(worker.tickOnce()).toBe(0);
  });

  it('survives a stop() without a prior start() — defensive cleanup', () => {
    const worker = createLoginAttemptsCleanup({ db: getDatabase(), now: () => Date.now() });
    expect(() => worker.stop()).not.toThrow();
  });

  it('respects a custom staleAgeMs override (test-only hook)', () => {
    const fakeNow = 1_780_000_000_000;
    seedAttempts([
      { id: 'old', expiresAt: fakeNow - 2 * HOUR_MS, firstAt: fakeNow - 3 * HOUR_MS },
      { id: 'newer', expiresAt: fakeNow - 30 * 60 * 1000, firstAt: fakeNow - 60 * 60 * 1000 },
    ]);

    const worker = createLoginAttemptsCleanup({
      db: getDatabase(),
      now: () => fakeNow,
      staleAgeMs: 60 * 60 * 1000, // 1 hour
    });
    const deleted = worker.tickOnce();

    expect(deleted).toBe(1);
    const surviving = getDatabase()
      .select({ id: loginAttempts.id })
      .from(loginAttempts)
      .all();
    expect(surviving.map(r => r.id)).toEqual(['newer']);
  });
});
