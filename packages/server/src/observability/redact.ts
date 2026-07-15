/**
 * ENG-135 — Attribute redaction for the telemetry sink path.
 *
 * The pino root logger already applies `REDACT_PATHS` (ENG-006) to
 * every NDJSON record. That redaction lives on the pino instance —
 * it does not run for objects we hand to an external sink. This
 * helper applies the same spirit on a plain attrs bag before the
 * sink ever sees it.
 *
 * The list intentionally tracks the production REDACT_PATHS in
 * `logging/logger.ts`. When the policy expands (ENG-128 will
 * formalize the diagnostic-bundle redaction surface), the two lists
 * grow together — `assertRedactionPolicyParity` in the test file
 * pins the relationship.
 *
 * Tolerant: unknown shapes (Map, Set, BigInt, custom class
 * instances) pass through untouched; we only walk plain objects and
 * arrays. Cycles are detected via a WeakSet so a payload that
 * accidentally references itself does not stack-overflow the
 * telemetry hot path.
 *
 * @module observability/redact
 */

/**
 * Lowercase field names that get masked anywhere they appear in the
 * attrs tree. Mirrors the bare paths in
 * `logging/logger.ts::REDACT_PATHS` (without the `headers.*` and
 * `*.field` pino-specific path syntax — the walker does deep
 * traversal so per-level matchers are not needed).
 */
const REDACT_FIELD_NAMES: readonly string[] = [
  'password',
  'passwordhash',
  'pin',
  'staffpinhash',
  'token',
  'refreshtoken',
  'jwtsecret',
  'authorization',
  'cookie',
  // `email` is included on the local logger; we keep it here too so
  // a misconfigured adapter cannot leak operator-identifying email
  // to a third-party service.
  'email',
];

const REDACTED_MARKER = '[Redacted]';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function shouldRedactField(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[_-]/g, '');
  return REDACT_FIELD_NAMES.includes(normalized);
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return value;
    seen.add(value);
    return value.map(item => redactValue(item, seen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return value;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (shouldRedactField(key)) {
        out[key] = REDACTED_MARKER;
      } else {
        out[key] = redactValue(val, seen);
      }
    }
    return out;
  }
  return value;
}

/**
 * Return a shallow-cloned copy of `attrs` with sensitive fields
 * replaced by `[Redacted]`. Original input is not mutated — the
 * caller can keep the unredacted object for local-only logging.
 *
 * @example
 *   const safe = redactErrorAttrs({ tenantId: 't', token: 'abc' });
 *   //  safe.token === '[Redacted]'
 *   //  safe.tenantId === 't'
 */
export function redactErrorAttrs<T extends Record<string, unknown>>(
  attrs: T
): Record<string, unknown> {
  const seen = new WeakSet<object>();
  return redactValue(attrs, seen) as Record<string, unknown>;
}

/**
 * Exposed for tests. Production code must not mutate the redact
 * list.
 */
export const __REDACT_FIELD_NAMES_FOR_TESTS: readonly string[] = REDACT_FIELD_NAMES;
