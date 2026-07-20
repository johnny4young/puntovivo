/**
 * Canonical input hashing for the idempotency cache.
 *
 * The Command Envelope (ADR-0002) caches procedure results in
 * `idempotency_keys` keyed by `(tenantId, deviceId, idempotencyKey,
 * operationKind)`. Hash collisions on the same key with different
 * payloads must raise `IDEMPOTENCY_KEY_CONFLICT` instead of silently
 * returning the wrong cached result, so the hash function MUST be:
 *
 * - Deterministic across object key reordering (`{a:1,b:2}` and
 * `{b:2,a:1}` produce the same hash).
 * - Stable for the same input across processes (no `Date.now()` or
 * nondeterministic content in the canonical form).
 * - Safe for nested arrays / objects.
 *
 * Implementation: stable JSON serialization with sorted keys, then
 * SHA-256 over the UTF-8 bytes. SHA-256 is overkill for a 24h cache
 * but the operator-facing error report shows the hash, so collision
 * resistance + uniformity are nice to have.
 *
 * @module services/idempotency/keyHasher
 */

import { createHash } from 'node:crypto';

/**
 * Canonicalize an arbitrary JSON-shaped value: sort object keys
 * alphabetically (recursively) and stringify with no whitespace.
 *
 * Arrays preserve their order — that is semantic in most procedures
 * (line items in a sale).
 */
function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'null';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  }
  if (typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const entries = keys.map(k => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
    return `{${entries.join(',')}}`;
  }
  return 'null';
}

/**
 * Hash a procedure input into a stable hex string (sha256). Same
 * input shape → same hash regardless of key order or nested object
 * structure variation.
 */
export function hashCanonicalInput(input: unknown): string {
  const canonical = canonicalize(input);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Exposed only for unit tests so the canonicalization step can be
 * asserted without going through the hash. Production callers should
 * use `hashCanonicalInput`.
 */
export function __test_canonicalize(value: unknown): string {
  return canonicalize(value);
}
