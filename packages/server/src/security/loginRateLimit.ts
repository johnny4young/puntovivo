/**
 * ENG-008 / ENG-008b — per-IP and per-username rate limiting for the
 * `auth.login` tRPC procedure.
 *
 * Two independent TTL buckets keyed by client IP and by (normalized) email.
 * The IP bucket blunts brute-force from a single origin; the username bucket
 * blunts credential-stuffing attacks that rotate IPs against one account.
 *
 * ## Persistence (ENG-008b)
 *
 * Buckets are persisted to the `login_attempts` table so the 10/IP/60s and
 * 5-fail/username/15min caps survive a server restart. The in-memory Maps
 * from ENG-008 remain as a **write-through cache** keyed on `${kind}:${key}`
 * — reads consult the cache first and fall back to the DB, writes mutate
 * the DB first and then mirror the state into the cache.
 *
 * **NOT tenant-scoped**: one `login_attempts` row per (kind, key) across the
 * whole deployment. An attacker hammering multiple tenants from one IP must
 * still trip the global cap.
 *
 * No `setInterval` sweeper — expired rows are lazy-evicted on access, so
 * maintenance is free and shutdown has no timer handles to unwind.
 *
 * Every public function accepts an optional `now` parameter that defaults to
 * `Date.now()` so tests stay deterministic without `vi.useFakeTimers()`.
 *
 * ## Adopted-DB safety
 *
 * `ensureMigrationBaseline()` (see `db/index.ts`) can pin the full migration
 * journal on DBs adopted from before versioned migrations. That can leave a
 * `login_attempts` row marked applied without the table ever running. Every
 * public function calls `loginAttemptsTableExists()` and falls back to an
 * in-memory-only path when the table is absent, matching the `seedCatalogs`
 * pattern. A warn is emitted once per process so the operator can upgrade.
 */

import { and, eq, lte } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import { createModuleLogger } from '../logging/logger.js';
import { throwServerError } from '../lib/errorCodes.js';
import type { DatabaseInstance } from '../db/index.js';
import { loginAttempts, type LoginAttemptKind } from '../db/schema.js';

const log = createModuleLogger('security.loginRateLimit');

export const LOGIN_RATE_LIMIT_IP_MAX = 10;
export const LOGIN_RATE_LIMIT_IP_WINDOW_MS = 60_000; // 60 seconds
export const LOGIN_RATE_LIMIT_USERNAME_MAX = 5;
export const LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS = 15 * 60_000; // 15 minutes

interface Bucket {
  count: number;
  /** Epoch millis at which the bucket was first touched in the current window. */
  firstAt: number;
  /** Epoch millis at which the bucket expires (firstAt + windowMs). */
  expiresAt: number;
}

const ipBuckets = new Map<string, Bucket>();
const usernameBuckets = new Map<string, Bucket>();

/**
 * Tracks whether we have already warned about the table being absent so the
 * log does not spam per-request when an adopted DB skipped migration 0006.
 */
let tableMissingWarned = false;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function bucketMapFor(kind: LoginAttemptKind): Map<string, Bucket> {
  return kind === 'ip' ? ipBuckets : usernameBuckets;
}

function windowMsFor(kind: LoginAttemptKind): number {
  return kind === 'ip' ? LOGIN_RATE_LIMIT_IP_WINDOW_MS : LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS;
}

function maxFor(kind: LoginAttemptKind): number {
  return kind === 'ip' ? LOGIN_RATE_LIMIT_IP_MAX : LOGIN_RATE_LIMIT_USERNAME_MAX;
}

/**
 * Adopted-DB safety: the `login_attempts` table may be missing if
 * `ensureMigrationBaseline()` pinned the journal before migration 0006 was
 * applied. Check once per call against `sqlite_master`; drizzle's
 * query API would throw an opaque `no such table` error otherwise.
 */
function loginAttemptsTableExists(db: DatabaseInstance): boolean {
  const client = (db as unknown as { $client: Database.Database }).$client;
  const row = client
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = 'login_attempts' LIMIT 1"
    )
    .get();
  if (row) return true;
  if (!tableMissingWarned) {
    tableMissingWarned = true;
    log.warn(
      { reason: 'login_attempts_table_missing' },
      'login_attempts table is absent; rate limits fall back to in-memory-only (non-persistent). Verify drizzle migration 0006 ran against this DB.'
    );
  }
  return false;
}

/**
 * Read the current row for the given bucket from the DB, or return
 * `undefined` when the row is absent or already expired. Lazy-evicts
 * expired rows as a side effect so periodic cleanup is never needed.
 */
function readBucketFromDb(
  db: DatabaseInstance,
  kind: LoginAttemptKind,
  key: string,
  now: number
): Bucket | undefined {
  const row = db
    .select()
    .from(loginAttempts)
    .where(and(eq(loginAttempts.kind, kind), eq(loginAttempts.key, key)))
    .get();
  if (!row) return undefined;
  if (row.expiresAt <= now) {
    db.delete(loginAttempts)
      .where(and(eq(loginAttempts.kind, kind), eq(loginAttempts.key, key)))
      .run();
    return undefined;
  }
  return { count: row.count, firstAt: row.firstAt, expiresAt: row.expiresAt };
}

/**
 * Fetch the cached bucket or load it from the DB. Returns `undefined` when
 * no live row exists. Handles table-missing gracefully (returns cache-only).
 */
function loadBucket(
  db: DatabaseInstance,
  kind: LoginAttemptKind,
  key: string,
  now: number
): Bucket | undefined {
  const map = bucketMapFor(kind);
  const cached = map.get(key);
  if (cached && cached.expiresAt > now) {
    return cached;
  }
  if (cached) {
    map.delete(key);
  }
  if (!loginAttemptsTableExists(db)) {
    return undefined;
  }
  const fromDb = readBucketFromDb(db, kind, key, now);
  if (fromDb) {
    map.set(key, fromDb);
  }
  return fromDb;
}

/**
 * Persist (upsert) a bucket and mirror it into the in-memory cache. Used
 * on every increment. Uses drizzle's `onConflictDoUpdate` against the
 * `(kind, key)` unique index so both branches are a single round-trip.
 */
function persistBucket(
  db: DatabaseInstance,
  kind: LoginAttemptKind,
  key: string,
  bucket: Bucket,
  now: number
): void {
  const map = bucketMapFor(kind);
  if (!loginAttemptsTableExists(db)) {
    map.set(key, bucket);
    return;
  }
  const nowIso = new Date(now).toISOString();
  // `id` is synthetic (unique index drives upsert) — derive it from
  // the natural key so re-inserts stay idempotent if a cache flush
  // ever creates a second row.
  const syntheticId = `${kind}:${key}`;
  db.insert(loginAttempts)
    .values({
      id: syntheticId,
      kind,
      key,
      count: bucket.count,
      firstAt: bucket.firstAt,
      expiresAt: bucket.expiresAt,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: [loginAttempts.kind, loginAttempts.key],
      set: {
        count: bucket.count,
        firstAt: bucket.firstAt,
        expiresAt: bucket.expiresAt,
        updatedAt: nowIso,
      },
    })
    .run();
  map.set(key, bucket);
}

/**
 * Delete the bucket from both the cache and the DB. Used by
 * `registerSuccess()` and by the expired-row sweep inside `loadBucket()`.
 */
function deleteBucket(db: DatabaseInstance, kind: LoginAttemptKind, key: string): void {
  bucketMapFor(kind).delete(key);
  if (!loginAttemptsTableExists(db)) {
    return;
  }
  db.delete(loginAttempts)
    .where(and(eq(loginAttempts.kind, kind), eq(loginAttempts.key, key)))
    .run();
}

function rejectOverCap(kind: LoginAttemptKind, key: string, now: number, bucket: Bucket): never {
  const max = maxFor(kind);
  const seconds = Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000));
  throwServerError({
    trpcCode: 'TOO_MANY_REQUESTS',
    errorCode: 'AUTH_RATE_LIMIT_EXCEEDED',
    message: `Too many login attempts. Try again in ${seconds} seconds.`,
    details: { kind, key, max, secondsUntilReset: seconds },
  });
}

/**
 * Raises `TOO_MANY_REQUESTS` if the given IP has exceeded the per-IP cap
 * inside the current window. No-op when the bucket is empty or stale.
 */
export function checkIp(db: DatabaseInstance, ip: string, now: number = Date.now()): void {
  const bucket = loadBucket(db, 'ip', ip, now);
  if (!bucket) return;
  if (bucket.count >= LOGIN_RATE_LIMIT_IP_MAX) {
    rejectOverCap('ip', ip, now, bucket);
  }
}

/**
 * Raises `TOO_MANY_REQUESTS` if the (normalized) email has exceeded the
 * per-username cap. Case-insensitive; trims leading/trailing whitespace.
 */
export function checkUsername(
  db: DatabaseInstance,
  email: string,
  now: number = Date.now()
): void {
  const key = normalizeEmail(email);
  const bucket = loadBucket(db, 'username', key, now);
  if (!bucket) return;
  if (bucket.count >= LOGIN_RATE_LIMIT_USERNAME_MAX) {
    rejectOverCap('username', key, now, bucket);
  }
}

function incrementBucket(
  db: DatabaseInstance,
  kind: LoginAttemptKind,
  key: string,
  now: number
): void {
  const windowMs = windowMsFor(kind);
  const existing = loadBucket(db, kind, key, now);
  const next: Bucket = !existing
    ? { count: 1, firstAt: now, expiresAt: now + windowMs }
    : {
        count: existing.count + 1,
        firstAt: existing.firstAt,
        expiresAt: existing.expiresAt,
      };
  persistBucket(db, kind, key, next, now);
}

/**
 * Record a failed login attempt. Both buckets get incremented — even the
 * username bucket when the user did not exist (that prevents username
 * enumeration by timing + scraping 404-style responses).
 */
export function registerFailure(
  db: DatabaseInstance,
  ip: string,
  email: string,
  now: number = Date.now()
): void {
  incrementBucket(db, 'ip', ip, now);
  incrementBucket(db, 'username', normalizeEmail(email), now);
}

/**
 * Clear the username bucket for a specific email after a successful login.
 *
 * The IP bucket is intentionally NOT cleared: one legitimate cashier login
 * should not amnesty an active credential-stuffing source hammering other
 * accounts from the same origin. The IP bucket decays on its own via the
 * 60-second TTL.
 */
export function registerSuccess(db: DatabaseInstance, email: string): void {
  deleteBucket(db, 'username', normalizeEmail(email));
}

/**
 * Seconds remaining in the current window before the given bucket resets.
 * Returns 0 when the bucket is empty or the window has already elapsed.
 * Useful for callers that want to surface the exact retry-after value.
 */
export function secondsUntilReset(
  db: DatabaseInstance,
  kind: LoginAttemptKind,
  key: string,
  now: number = Date.now()
): number {
  const resolvedKey = kind === 'ip' ? key : normalizeEmail(key);
  const bucket = loadBucket(db, kind, resolvedKey, now);
  if (!bucket) return 0;
  if (bucket.expiresAt <= now) return 0;
  return Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000));
}

/**
 * Warm the in-memory cache from any live rows in `login_attempts`. Called
 * at server boot so the first post-restart `checkIp` / `checkUsername`
 * hits the cache instead of paying a DB round-trip. The lazy
 * `loadBucket()` fallback means omitting this call is only a cold-start
 * latency cost, not a correctness issue.
 */
export function warmCacheFromDb(db: DatabaseInstance, now: number = Date.now()): void {
  ipBuckets.clear();
  usernameBuckets.clear();
  if (!loginAttemptsTableExists(db)) {
    return;
  }
  // Evict anything already expired so the cache never carries stale rows.
  db.delete(loginAttempts).where(lte(loginAttempts.expiresAt, now)).run();
  const rows = db.select().from(loginAttempts).all();
  for (const row of rows) {
    const map = bucketMapFor(row.kind);
    map.set(row.key, {
      count: row.count,
      firstAt: row.firstAt,
      expiresAt: row.expiresAt,
    });
  }
}

/**
 * Wipe both the in-memory cache AND the `login_attempts` table. Exported
 * for test setup only — production code never imports it. The name is
 * deliberately conspicuous so the call site signals its intent.
 */
export function __resetForTests(db?: DatabaseInstance): void {
  ipBuckets.clear();
  usernameBuckets.clear();
  tableMissingWarned = false;
  if (!db) return;
  if (!loginAttemptsTableExists(db)) return;
  db.delete(loginAttempts).run();
}
