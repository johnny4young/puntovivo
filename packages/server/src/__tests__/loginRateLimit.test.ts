/**
 * /  — unit tests for
 * `packages/server/src/security/loginRateLimit.ts`.
 *
 * Every test passes an explicit `now` parameter so the suite is deterministic
 * without `vi.useFakeTimers()`. `__resetForTests(db)` runs in `afterEach` so
 * module-level cache state AND the DB table are wiped between cases.
 *
 * The service is DB-backed after ; the tests therefore boot an
 * in-memory SQLite via `initDatabase({ dbPath: ':memory:' })` so migration
 * 0006 runs and the `login_attempts` table is live for the full suite.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  LOGIN_RATE_LIMIT_IP_MAX,
  LOGIN_RATE_LIMIT_IP_WINDOW_MS,
  LOGIN_RATE_LIMIT_USERNAME_MAX,
  LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS,
  STAFF_PIN_RATE_LIMIT_ACTOR_MAX,
  STAFF_PIN_RATE_LIMIT_TARGET_MAX,
  __resetForTests,
  checkIp,
  checkStaffPin,
  checkUsername,
  registerFailure,
  registerStaffPinFailure,
  registerStaffPinSuccess,
  registerSuccess,
  secondsUntilReset,
  warmCacheFromDb,
} from '../security/loginRateLimit.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { closeDatabase, initDatabase, type DatabaseInstance } from '../db/index.js';
import { loginAttempts } from '../db/schema.js';

interface RawSqlClient {
  exec(sql: string): void;
}

function rawSqlClient(db: DatabaseInstance): RawSqlClient {
  return (db as unknown as { $client: RawSqlClient }).$client;
}

function recreateLoginAttemptsTable(db: DatabaseInstance): void {
  rawSqlClient(db).exec(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      key text NOT NULL,
      count integer DEFAULT 0 NOT NULL,
      first_at integer NOT NULL,
      expires_at integer NOT NULL,
      created_at text DEFAULT (datetime('now')) NOT NULL,
      updated_at text DEFAULT (datetime('now')) NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_login_attempts_kind_key
      ON login_attempts (kind, key);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_expires_at
      ON login_attempts (expires_at);
  `);
}

function expectTooManyRequests(fn: () => void): TRPCError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(TRPCError);
    const trpcErr = err as TRPCError;
    expect(trpcErr.code).toBe('TOO_MANY_REQUESTS');
    expect(trpcErr.cause).toBeInstanceOf(ServerErrorWithCode);
    expect((trpcErr.cause as ServerErrorWithCode).errorCode).toBe('AUTH_RATE_LIMIT_EXCEEDED');
    return trpcErr;
  }
  throw new Error('Expected TOO_MANY_REQUESTS TRPCError, none thrown');
}

describe('loginRateLimit ( / )', () => {
  let db: DatabaseInstance;

  beforeAll(async () => {
    // Fresh in-memory DB so migration 0006 materialises `login_attempts`.
    // `seedData: false` skips the default tenant/user seed; this suite only
    // touches the rate-limit table.
    db = await initDatabase({ dbPath: ':memory:', seedData: false, verbose: false });
  });

  afterEach(() => {
    __resetForTests(db);
  });

  afterAll(() => {
    closeDatabase();
  });

  it('permits exactly IP_MAX failures inside the window and rejects the next one', () => {
    const ip = '1.1.1.1';
    const t = 1_000;
    for (let i = 0; i < LOGIN_RATE_LIMIT_IP_MAX; i += 1) {
      expect(() => checkIp(db, ip, t)).not.toThrow();
      registerFailure(db, ip, `user${i}@test.com`, t);
    }
    const err = expectTooManyRequests(() => checkIp(db, ip, t));
    const details = (err.cause as ServerErrorWithCode).details;
    expect(details).toMatchObject({ kind: 'ip', key: ip, max: LOGIN_RATE_LIMIT_IP_MAX });

    // DB row mirrors the saturated bucket.
    const row = db
      .select()
      .from(loginAttempts)
      .where(and(eq(loginAttempts.kind, 'ip'), eq(loginAttempts.key, ip)))
      .get();
    expect(row).toBeDefined();
    expect(row!.count).toBe(LOGIN_RATE_LIMIT_IP_MAX);
    expect(row!.firstAt).toBe(t);
    expect(row!.expiresAt).toBe(t + LOGIN_RATE_LIMIT_IP_WINDOW_MS);
  });

  it('IP bucket decays after the window elapses', () => {
    const ip = '2.2.2.2';
    const t0 = 0;
    for (let i = 0; i < LOGIN_RATE_LIMIT_IP_MAX; i += 1) {
      registerFailure(db, ip, `user${i}@test.com`, t0);
    }
    expectTooManyRequests(() => checkIp(db, ip, t0));

    // One ms past the window → bucket considered empty, no throw, DB row
    // lazy-evicted as a side effect.
    const tAfter = t0 + LOGIN_RATE_LIMIT_IP_WINDOW_MS + 1;
    expect(() => checkIp(db, ip, tAfter)).not.toThrow();

    // A fresh failure starts a brand-new window.
    registerFailure(db, ip, 'fresh@test.com', tAfter);
    expect(secondsUntilReset(db, 'ip', ip, tAfter)).toBe(
      Math.ceil(LOGIN_RATE_LIMIT_IP_WINDOW_MS / 1000)
    );
  });

  it('permits exactly USERNAME_MAX failures and rejects the next one', () => {
    const email = 'locked@test.com';
    const t = 500;
    for (let i = 0; i < LOGIN_RATE_LIMIT_USERNAME_MAX; i += 1) {
      expect(() => checkUsername(db, email, t)).not.toThrow();
      // Use a different IP each time so the IP bucket does not fire first.
      registerFailure(db, `10.0.0.${i}`, email, t);
    }
    const err = expectTooManyRequests(() => checkUsername(db, email, t));
    const details = (err.cause as ServerErrorWithCode).details;
    expect(details).toMatchObject({
      kind: 'username',
      key: email,
      max: LOGIN_RATE_LIMIT_USERNAME_MAX,
    });

    const row = db
      .select()
      .from(loginAttempts)
      .where(and(eq(loginAttempts.kind, 'username'), eq(loginAttempts.key, email)))
      .get();
    expect(row).toBeDefined();
    expect(row!.count).toBe(LOGIN_RATE_LIMIT_USERNAME_MAX);
  });

  it('username bucket decays after the 15-minute window elapses', () => {
    const email = 'decay@test.com';
    const t0 = 0;
    for (let i = 0; i < LOGIN_RATE_LIMIT_USERNAME_MAX; i += 1) {
      registerFailure(db, `10.0.1.${i}`, email, t0);
    }
    expectTooManyRequests(() => checkUsername(db, email, t0));

    const tAfter = t0 + LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS + 1;
    expect(() => checkUsername(db, email, tAfter)).not.toThrow();
  });

  it('registerSuccess clears only the target username bucket', () => {
    const target = 'alice@test.com';
    const other = 'bob@test.com';
    const t = 100;
    for (let i = 0; i < LOGIN_RATE_LIMIT_USERNAME_MAX; i += 1) {
      registerFailure(db, '3.3.3.3', target, t);
      registerFailure(db, '3.3.3.3', other, t);
    }
    // Both buckets saturated.
    expectTooManyRequests(() => checkUsername(db, target, t));
    expectTooManyRequests(() => checkUsername(db, other, t));

    registerSuccess(db, target);

    // Target cleared; other still locked.
    expect(() => checkUsername(db, target, t)).not.toThrow();
    expectTooManyRequests(() => checkUsername(db, other, t));

    // target row is removed from the DB as well as the cache.
    const targetRow = db
      .select()
      .from(loginAttempts)
      .where(and(eq(loginAttempts.kind, 'username'), eq(loginAttempts.key, target)))
      .get();
    expect(targetRow).toBeUndefined();
  });

  it('registerSuccess does NOT clear the IP bucket (stops single-source stuffing)', () => {
    const ip = '4.4.4.4';
    const t = 200;
    for (let i = 0; i < LOGIN_RATE_LIMIT_IP_MAX; i += 1) {
      registerFailure(db, ip, `acct${i}@test.com`, t);
    }
    expectTooManyRequests(() => checkIp(db, ip, t));

    // A "successful" login on one of those accounts should NOT release the IP
    // bucket — the attacker is still pounding the rest from the same origin.
    registerSuccess(db, 'acct0@test.com');

    expectTooManyRequests(() => checkIp(db, ip, t));
  });

  it('IP buckets are independent across different IPs', () => {
    const t = 300;
    for (let i = 0; i < LOGIN_RATE_LIMIT_IP_MAX; i += 1) {
      registerFailure(db, '5.5.5.5', `u${i}@test.com`, t);
    }
    expectTooManyRequests(() => checkIp(db, '5.5.5.5', t));
    // Fresh IP starts clean.
    expect(() => checkIp(db, '6.6.6.6', t)).not.toThrow();
  });

  it('username buckets are independent across different emails', () => {
    const t = 400;
    for (let i = 0; i < LOGIN_RATE_LIMIT_USERNAME_MAX; i += 1) {
      registerFailure(db, `7.7.7.${i}`, 'charlie@test.com', t);
    }
    expectTooManyRequests(() => checkUsername(db, 'charlie@test.com', t));
    expect(() => checkUsername(db, 'dave@test.com', t)).not.toThrow();
  });

  it('normalizes email case and whitespace so casing cannot bypass the cap', () => {
    const t = 500;
    for (let i = 0; i < LOGIN_RATE_LIMIT_USERNAME_MAX; i += 1) {
      registerFailure(db, `8.8.8.${i}`, 'ALICE@Test.com', t);
    }
    // Different case + leading whitespace must hit the same bucket.
    expectTooManyRequests(() => checkUsername(db, '  alice@test.COM  ', t));
  });

  it('locks a staff PIN target after five failures and persists the opaque bucket', () => {
    const identity = {
      tenantId: 'tenant-a',
      actorUserId: 'actor-a',
      targetUserId: 'cashier-a',
    };
    const now = 700;
    for (let i = 0; i < STAFF_PIN_RATE_LIMIT_TARGET_MAX; i += 1) {
      checkStaffPin(db, identity, now);
      registerStaffPinFailure(db, identity, now);
    }
    const err = expectTooManyRequests(() => checkStaffPin(db, identity, now));
    expect((err.cause as ServerErrorWithCode).details).toMatchObject({
      kind: 'staff_pin_target',
      max: STAFF_PIN_RATE_LIMIT_TARGET_MAX,
    });
    expect((err.cause as ServerErrorWithCode).details).not.toHaveProperty('key');

    const row = db
      .select()
      .from(loginAttempts)
      .where(
        and(eq(loginAttempts.kind, 'staff_pin_target'), eq(loginAttempts.key, 'tenant-a:cashier-a'))
      )
      .get();
    expect(row?.count).toBe(STAFF_PIN_RATE_LIMIT_TARGET_MAX);
  });

  it('successful PIN clears only target failures, not the actor aggregate', () => {
    const identity = {
      tenantId: 'tenant-b',
      actorUserId: 'actor-b',
      targetUserId: 'cashier-b',
    };
    const now = 800;
    for (let i = 0; i < STAFF_PIN_RATE_LIMIT_ACTOR_MAX; i += 1) {
      registerStaffPinFailure(
        db,
        {
          ...identity,
          targetUserId: `cashier-${i}`,
        },
        now
      );
    }
    registerStaffPinSuccess(db, identity);

    const err = expectTooManyRequests(() => checkStaffPin(db, identity, now));
    expect((err.cause as ServerErrorWithCode).details).toMatchObject({
      kind: 'staff_pin_actor',
      max: STAFF_PIN_RATE_LIMIT_ACTOR_MAX,
    });
  });

  it('secondsUntilReset returns a positive integer inside the window and 0 after', () => {
    const ip = '9.9.9.9';
    const t0 = 10_000;
    registerFailure(db, ip, 'x@test.com', t0);

    const inside = secondsUntilReset(db, 'ip', ip, t0 + 1_000);
    expect(inside).toBeGreaterThan(0);
    expect(inside).toBeLessThanOrEqual(60);

    const after = secondsUntilReset(db, 'ip', ip, t0 + LOGIN_RATE_LIMIT_IP_WINDOW_MS + 1);
    expect(after).toBe(0);

    // Unknown key returns 0.
    expect(secondsUntilReset(db, 'username', 'never@seen.com')).toBe(0);
  });

  // warmCacheFromDb loads live rows at boot so the first post-restart
  // check hits the cache. The lazy `loadBucket()` path also tolerates a cold
  // cache, so this is an optimisation test, not a correctness gate.
  it('warmCacheFromDb rehydrates live rows and drops expired ones', () => {
    const t0 = 100_000;
    // Saturate an IP bucket.
    for (let i = 0; i < LOGIN_RATE_LIMIT_IP_MAX; i += 1) {
      registerFailure(db, '11.11.11.11', `stale${i}@test.com`, t0);
    }

    // Clear in-memory caches only — the DB row survives.
    // (Doing a manual cache clear via warmCacheFromDb with a far-future `now`
    // below would also sweep the row, so we exercise the cold-cache path
    // through readBucketFromDb + warmCacheFromDb separately.)
    __resetForTests(); // no db arg → cache-only reset
    warmCacheFromDb(db, t0);

    // Inside the IP window — the warmed cache now has the row, so the next
    // check trips without touching the DB.
    expectTooManyRequests(() => checkIp(db, '11.11.11.11', t0));

    // Past the window — warmCacheFromDb evicts expired rows on its way in.
    const tExpired = t0 + LOGIN_RATE_LIMIT_IP_WINDOW_MS + 1;
    warmCacheFromDb(db, tExpired);
    expect(() => checkIp(db, '11.11.11.11', tExpired)).not.toThrow();

    // And the DB row is gone.
    const row = db
      .select()
      .from(loginAttempts)
      .where(and(eq(loginAttempts.kind, 'ip'), eq(loginAttempts.key, '11.11.11.11')))
      .get();
    expect(row).toBeUndefined();
  });

  it('falls back to in-memory buckets when login_attempts table is absent', () => {
    const client = rawSqlClient(db);
    client.exec('DROP TABLE IF EXISTS login_attempts;');

    try {
      const ip = '12.12.12.12';
      const t = 700;
      for (let i = 0; i < LOGIN_RATE_LIMIT_IP_MAX; i += 1) {
        expect(() => checkIp(db, ip, t)).not.toThrow();
        registerFailure(db, ip, `missing-table-${i}@test.com`, t);
      }

      expectTooManyRequests(() => checkIp(db, ip, t));
    } finally {
      recreateLoginAttemptsTable(db);
    }
  });
});
