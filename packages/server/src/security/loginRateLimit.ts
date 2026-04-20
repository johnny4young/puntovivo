/**
 * ENG-008 — per-IP and per-username rate limiting for the `auth.login`
 * tRPC procedure.
 *
 * Two independent TTL buckets keyed by client IP and by (normalized) email.
 * The IP bucket blunts brute-force from a single origin; the username bucket
 * blunts credential-stuffing attacks that rotate IPs against one account.
 *
 * Buckets live in memory. That is sufficient for the embedded single-process
 * Electron server; a multi-tenant cloud deployment will want DB-backed
 * tracking — tracked as ENG-008b in docs/SECURITY.md.
 *
 * No `setInterval` sweeper — entries are lazy-evicted on next access, so
 * memory is bounded by (unique ips × unique emails seen inside one window)
 * and there are no timer handles to unwind at shutdown.
 *
 * Every public function accepts an optional `now` parameter that defaults to
 * `Date.now()`. Tests pass explicit timestamps and stay timer-free.
 */

import { throwServerError } from '../lib/errorCodes.js';

export const LOGIN_RATE_LIMIT_IP_MAX = 10;
export const LOGIN_RATE_LIMIT_IP_WINDOW_MS = 60_000; // 60 seconds
export const LOGIN_RATE_LIMIT_USERNAME_MAX = 5;
export const LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS = 15 * 60_000; // 15 minutes

interface Bucket {
  count: number;
  /** Wall-clock at which the bucket was first touched in the current window. */
  firstAt: number;
}

const ipBuckets = new Map<string, Bucket>();
const usernameBuckets = new Map<string, Bucket>();

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Returns the remaining count in the window after lazy-evicting stale entries. */
function currentCount(
  bucket: Bucket | undefined,
  windowMs: number,
  now: number
): number {
  if (!bucket) return 0;
  const elapsed = now - bucket.firstAt;
  if (elapsed >= windowMs) return 0;
  return bucket.count;
}

function incrementBucket(
  map: Map<string, Bucket>,
  key: string,
  windowMs: number,
  now: number
): void {
  const existing = map.get(key);
  if (!existing || now - existing.firstAt >= windowMs) {
    map.set(key, { count: 1, firstAt: now });
    return;
  }
  existing.count += 1;
}

function rejectOverCap(
  kind: 'ip' | 'username',
  key: string,
  now: number,
  bucket: Bucket,
  windowMs: number,
  max: number
): never {
  const elapsed = now - bucket.firstAt;
  const seconds = Math.max(1, Math.ceil((windowMs - elapsed) / 1000));
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
export function checkIp(ip: string, now: number = Date.now()): void {
  const bucket = ipBuckets.get(ip);
  if (!bucket) return;
  const count = currentCount(bucket, LOGIN_RATE_LIMIT_IP_WINDOW_MS, now);
  if (count === 0) {
    ipBuckets.delete(ip);
    return;
  }
  if (count >= LOGIN_RATE_LIMIT_IP_MAX) {
    rejectOverCap('ip', ip, now, bucket, LOGIN_RATE_LIMIT_IP_WINDOW_MS, LOGIN_RATE_LIMIT_IP_MAX);
  }
}

/**
 * Raises `TOO_MANY_REQUESTS` if the (normalized) email has exceeded the
 * per-username cap. Case-insensitive; trims leading/trailing whitespace.
 */
export function checkUsername(email: string, now: number = Date.now()): void {
  const key = normalizeEmail(email);
  const bucket = usernameBuckets.get(key);
  if (!bucket) return;
  const count = currentCount(bucket, LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS, now);
  if (count === 0) {
    usernameBuckets.delete(key);
    return;
  }
  if (count >= LOGIN_RATE_LIMIT_USERNAME_MAX) {
    rejectOverCap(
      'username',
      key,
      now,
      bucket,
      LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS,
      LOGIN_RATE_LIMIT_USERNAME_MAX
    );
  }
}

/**
 * Record a failed login attempt. Both buckets get incremented — even the
 * username bucket when the user did not exist (that prevents username
 * enumeration by timing + scraping 404-style responses).
 */
export function registerFailure(
  ip: string,
  email: string,
  now: number = Date.now()
): void {
  incrementBucket(ipBuckets, ip, LOGIN_RATE_LIMIT_IP_WINDOW_MS, now);
  incrementBucket(
    usernameBuckets,
    normalizeEmail(email),
    LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS,
    now
  );
}

/**
 * Clear the username bucket for a specific email after a successful login.
 *
 * The IP bucket is intentionally NOT cleared: one legitimate cashier login
 * should not amnesty an active credential-stuffing source hammering other
 * accounts from the same origin. The IP bucket decays on its own via the
 * 60-second TTL.
 */
export function registerSuccess(email: string): void {
  usernameBuckets.delete(normalizeEmail(email));
}

/**
 * Seconds remaining in the current window before the given bucket resets.
 * Returns 0 when the bucket is empty or the window has already elapsed.
 * Useful for callers that want to surface the exact retry-after value.
 */
export function secondsUntilReset(
  kind: 'ip' | 'username',
  key: string,
  now: number = Date.now()
): number {
  const map = kind === 'ip' ? ipBuckets : usernameBuckets;
  const resolvedKey = kind === 'ip' ? key : normalizeEmail(key);
  const windowMs =
    kind === 'ip' ? LOGIN_RATE_LIMIT_IP_WINDOW_MS : LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS;
  const bucket = map.get(resolvedKey);
  if (!bucket) return 0;
  const elapsed = now - bucket.firstAt;
  if (elapsed >= windowMs) return 0;
  return Math.max(1, Math.ceil((windowMs - elapsed) / 1000));
}

/**
 * Wipe both buckets. Exported for test setup only — the name is deliberately
 * conspicuous so the call site signals its intent, and production code never
 * imports it.
 */
export function __resetForTests(): void {
  ipBuckets.clear();
  usernameBuckets.clear();
}
