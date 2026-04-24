/**
 * ENG-008b acceptance — login rate-limit state persists across a
 * server restart.
 *
 * ROADMAP AC (docs/ROADMAP.md §3b, ENG-008b):
 *
 *   "Attacker tripping the username cap, server restart, next attempt
 *    still 429."
 *
 * Setup:
 *
 *   1. Open a fresh SQLite file in a tmpdir (NOT `:memory:` — the whole
 *      point is that state survives closing the connection).
 *   2. Saturate the username bucket with LOGIN_RATE_LIMIT_USERNAME_MAX
 *      failures for one email.
 *   3. Close the DB (simulates server shutdown).
 *   4. Re-open the same file (simulates server restart). The freshly
 *      booted service has NO in-memory cache yet.
 *   5. Call `checkUsername` for the same email. It must still throw
 *      `TOO_MANY_REQUESTS` / `AUTH_RATE_LIMIT_EXCEEDED` because the
 *      DB row is the source of truth.
 *
 * Paired scenario: once the 15-minute window elapses, the lazy-evict
 * path must also work across a restart — the re-opened service sweeps
 * the stale row on first access and lets the attempt through.
 *
 * @module __tests__/loginRateLimit-persistence
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import {
  LOGIN_RATE_LIMIT_USERNAME_MAX,
  LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS,
  __resetForTests,
  checkUsername,
  registerFailure,
  warmCacheFromDb,
} from '../security/loginRateLimit.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { closeDatabase, initDatabase } from '../db/index.js';

describe('loginRateLimit persistence (ENG-008b acceptance)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'puntovivo-login-rate-limit-'));
    dbPath = join(tmpDir, 'local.db');
  });

  afterEach(() => {
    // Close any still-open handle, then wipe the tmpdir. The test never
    // expects an open DB at this point, but double-closing is safe.
    try {
      closeDatabase();
    } catch {
      // already closed
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ROADMAP AC: username cap trips across a server restart', async () => {
    // === Phase 1 — first boot. Trip the username cap. ===
    let db = await initDatabase({ dbPath, seedData: false, verbose: false });

    // Clear any residual state (other tests in the same worker can share
    // the module-level cache even though the DB file is per-tmpdir).
    __resetForTests(db);

    const email = 'attacker@e2e.local';
    const attackerIp = '203.0.113.7';
    const now = Date.now();

    for (let i = 0; i < LOGIN_RATE_LIMIT_USERNAME_MAX; i += 1) {
      registerFailure(db, attackerIp, email, now);
    }

    // Sanity check — inside the same process the bucket is saturated.
    expect(() => checkUsername(db, email, now)).toThrow(TRPCError);

    // === Phase 2 — "server restart". Close the DB handle and wipe the
    // in-memory cache. The DB file on disk retains the saturated bucket. ===
    closeDatabase();
    __resetForTests(); // no db arg → cache-only reset, mirrors a cold boot

    // === Phase 3 — second boot. Re-open the same DB file. ===
    db = await initDatabase({ dbPath, seedData: false, verbose: false });

    // Warm the cache (optional, exercises both code paths). Use the
    // original timestamp so the window is still live.
    warmCacheFromDb(db, now);

    // AC: the next attempt must still trip TOO_MANY_REQUESTS even though
    // this is a brand-new service instance with no in-memory state of its own.
    let caught: unknown;
    try {
      checkUsername(db, email, now);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const trpcErr = caught as TRPCError;
    expect(trpcErr.code).toBe('TOO_MANY_REQUESTS');
    expect(trpcErr.cause).toBeInstanceOf(ServerErrorWithCode);
    expect((trpcErr.cause as ServerErrorWithCode).errorCode).toBe('AUTH_RATE_LIMIT_EXCEEDED');
  });

  it('bucket expires naturally across a restart: 15 minutes + 1ms later the attempt passes', async () => {
    let db = await initDatabase({ dbPath, seedData: false, verbose: false });
    __resetForTests(db);

    const email = 'patience@e2e.local';
    const t0 = 1_000_000;
    for (let i = 0; i < LOGIN_RATE_LIMIT_USERNAME_MAX; i += 1) {
      registerFailure(db, `198.51.100.${i}`, email, t0);
    }
    expect(() => checkUsername(db, email, t0)).toThrow(TRPCError);

    closeDatabase();
    __resetForTests();

    db = await initDatabase({ dbPath, seedData: false, verbose: false });

    // Just past the 15-minute window — the cold-cache load path must see
    // the stale row, evict it, and let the attempt through.
    const tAfter = t0 + LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS + 1;
    expect(() => checkUsername(db, email, tAfter)).not.toThrow();
  });
});
