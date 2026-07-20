/**
 * pins the login_attempts cleanup worker.
 *
 * The worker sweeps rate-limit buckets whose `expires_at` is older
 * than 24 h. These tests drive the sweep synchronously via
 * `.tickOnce()` with an injected clock so they are deterministic and
 * fast (no setInterval timing).
 *
 * Scenarios:
 * 1. Rows whose `expires_at` is well beyond the 24 h cutoff are
 * deleted and a system audit row is written.
 * 2. Rows whose `expires_at` is recent (or in the future) survive.
 * 3. `tickOnce` is idempotent — calling twice deletes once but
 * still records one audit row per run.
 * 4. Failed sweeps write a global error audit row.
 * 5. The factory's `stop()` releases the interval without throwing
 * even if `start()` was never invoked.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import { loginAttempts, systemAuditLogs, type SystemAuditLog } from '../db/schema.js';
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

interface LiveDatabase {
  $client: Database.Database;
}

function liveClient(): Database.Database {
  return (getDatabase() as unknown as LiveDatabase).$client;
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

function listSystemAuditRows(): SystemAuditLog[] {
  return getDatabase().select().from(systemAuditLogs).all();
}

function auditMetadata(row: SystemAuditLog): Record<string, unknown> {
  return (row.metadata ?? {}) as Record<string, unknown>;
}

describe('login_attempts cleanup worker', () => {
  it('deletes rows whose expires_at is older than the 24 h cutoff', () => {
    const fakeNow = 1_780_000_000_000;
    seedAttempts([
      {
        id: 'stale-1',
        expiresAt: fakeNow - DAY_MS - HOUR_MS,
        firstAt: fakeNow - DAY_MS - 2 * HOUR_MS,
      },
      { id: 'stale-2', expiresAt: fakeNow - 2 * DAY_MS, firstAt: fakeNow - 3 * DAY_MS },
      { id: 'recent', expiresAt: fakeNow - HOUR_MS, firstAt: fakeNow - 2 * HOUR_MS },
      { id: 'future', expiresAt: fakeNow + HOUR_MS, firstAt: fakeNow - HOUR_MS },
    ]);

    const worker = createLoginAttemptsCleanup({ db: getDatabase(), now: () => fakeNow });
    const deleted = worker.tickOnce();

    expect(deleted).toBe(2);

    const surviving = getDatabase().select({ id: loginAttempts.id }).from(loginAttempts).all();
    const ids = surviving.map(r => r.id).sort();
    expect(ids).toEqual(['future', 'recent']);

    const auditRows = listSystemAuditRows();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: 'login_attempts.cleanup',
      resourceType: 'login_attempts',
      resourceId: 'global',
      status: 'ok',
      createdAt: new Date(fakeNow).toISOString(),
    });
    expect(auditMetadata(auditRows[0]!)).toMatchObject({
      cutoff: fakeNow - DAY_MS,
      cutoffIso: new Date(fakeNow - DAY_MS).toISOString(),
      deleted: 2,
      staleAgeMs: DAY_MS,
    });
  });

  it('is idempotent — a second tick on the same clock deletes nothing', () => {
    const fakeNow = 1_780_000_000_000;
    seedAttempts([
      { id: 'stale-only', expiresAt: fakeNow - 2 * DAY_MS, firstAt: fakeNow - 3 * DAY_MS },
    ]);

    const worker = createLoginAttemptsCleanup({ db: getDatabase(), now: () => fakeNow });
    expect(worker.tickOnce()).toBe(1);
    expect(worker.tickOnce()).toBe(0);

    const deletedCounts = listSystemAuditRows()
      .map(row => auditMetadata(row).deleted)
      .sort();
    expect(deletedCounts).toEqual([0, 1]);
  });

  it('writes an error audit row when the sweep fails', () => {
    const fakeNow = 1_780_000_000_000;
    liveClient().prepare('DROP TABLE login_attempts').run();

    const worker = createLoginAttemptsCleanup({ db: getDatabase(), now: () => fakeNow });
    expect(() => worker.tickOnce()).toThrow(/login_attempts/);

    const auditRows = listSystemAuditRows();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: 'login_attempts.cleanup',
      resourceType: 'login_attempts',
      resourceId: 'global',
      status: 'error',
      createdAt: new Date(fakeNow).toISOString(),
    });
    expect(auditMetadata(auditRows[0]!)).toMatchObject({
      cutoff: fakeNow - DAY_MS,
      cutoffIso: new Date(fakeNow - DAY_MS).toISOString(),
      staleAgeMs: DAY_MS,
      error: expect.objectContaining({
        message: expect.stringContaining('login_attempts'),
      }),
    });
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
    expect(auditMetadata(listSystemAuditRows()[0]!)).toMatchObject({
      deleted: 1,
      staleAgeMs: 60 * 60 * 1000,
    });
    const surviving = getDatabase().select({ id: loginAttempts.id }).from(loginAttempts).all();
    expect(surviving.map(r => r.id)).toEqual(['newer']);
  });
});
