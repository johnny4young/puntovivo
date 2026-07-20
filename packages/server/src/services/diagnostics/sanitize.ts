/**
 * Diagnostic export payload sanitizer.
 *
 * Recursive walker that scrubs known-sensitive keys from arbitrary
 * JSON-shaped values before they ship in a `reports.diagnostics.export`
 * bundle. Closes the leak vector that  left open: any future
 * code path that lands a JWT, an OpenAI API key, a fiscal certificate
 * path, or a card authorization code in an outbox payload would have
 * shipped that secret to a support ticket via the diagnostic ZIP.
 *
 * **Design**: deny-by-pattern (anchored regex). A key matches when its
 * normalized name (lowercased, with `_` and `-` collapsed out) equals
 * any pattern. Anchored matching is critical: `pan` matches `pan`
 * exactly but NOT `pancake_count` or `panel_layout`. Word-substring
 * matching would false-positive on legit business keys.
 *
 * **Idempotent**: running the sanitizer twice on the same value yields
 * the same output. The replacement literal `[REDACTED]` does not match
 * any sensitive key pattern, so re-application is a no-op.
 *
 * **Conservative on non-objects**: primitives (string, number, boolean,
 * null, undefined) pass through untouched. Arrays are walked; the
 * element type drives the recursion.
 *
 * Add new keys to `SENSITIVE_KEYS` when (a) a customer-site reports a
 * leak via a non-listed key OR (b) a new payload writer lands a field
 * that the threat model classifies as sensitive. ADR-0006 documents
 * the extension protocol.
 *
 * @module services/diagnostics/sanitize
 */

/**
 * Anchored, lowercase key list. Each entry MUST normalize to a key
 * the sanitizer would compare against (no separators, all lowercase).
 * Order doesn't matter; matching is set-based.
 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  // Auth + tokens
  'password',
  'passwordhash',
  'passwords',
  'pin',
  'staffpinhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'jwt',
  'authorization',
  'authheader',
  'sessiontoken',
  // NOTE: `sessionid` is intentionally NOT redacted. In Puntovivo's
  // schema `sessionId` is the FK to `cash_sessions.id` (a business
  // primary key) used in operation_effects payloads to trace which
  // cash session a movement affected. It carries no auth state and
  // operators need it for support tickets. Auth-style session
  // tokens use the `sessiontoken` key, which IS redacted.
  'cookie',
  'cookies',
  // Provider credentials
  'apikey',
  'apisecret',
  'clientsecret',
  'clientid',
  'secret',
  'secrets',
  'privatekey',
  'publickey',
  'signingkey',
  // Card data — defense in depth even though the schema bans the columns
  'pan',
  'cvv',
  'cvc',
  'cardnumber',
  'cardnumbers',
  'primaryaccountnumber',
  // Fiscal / certificate paths + identifiers that bleed credentials
  'certificatepath',
  'certpath',
  'certificate',
  'pfx',
  'p12',
  // OAuth / payment tokens
  'oauthtoken',
  'paymenttoken',
  'capturetoken',
  'authorizationcode',
  // slice 2 — payment provider credential fields. The
  // descriptor in services/payments/manifest.ts::CREDENTIAL_FIELDS_BY_RAIL
  // marks all of these `sensitive: true`. Anchored matching keeps
  // `merchantid` from colliding with legit business keys like
  // `customerid` (already covered by `clientid` semantically but
  // listed verbatim for grep-friendliness).
  'merchantid',
  'customerid',
  'pkey',
]);

/**
 * Replacement value the sanitizer writes in place of a sensitive
 * field. The literal does not match any pattern in `SENSITIVE_KEYS`
 * so re-running the sanitizer is idempotent.
 */
export const REDACTED_PLACEHOLDER = '[REDACTED]';

/**
 * Normalize a key for comparison: lowercase + strip `_` / `-`.
 * Matches `password_hash`, `password-hash`, `passwordHash`,
 * `PASSWORDHASH` to the same canonical form `passwordhash`.
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

/**
 * Public predicate used by tests to lock the matching contract.
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

export interface SanitizeResult<T = unknown> {
  /** Sanitized clone of the input. Original is never mutated. */
  clean: T;
  /**
   * The set of ORIGINAL key names (preserving the writer's casing /
   * separators) that were replaced by `REDACTED_PLACEHOLDER`. Used by
   * the export manifest's `redactedKeysByTable` so the operator can
   * see which fields got stripped.
   */
  redactedKeys: Set<string>;
}

/**
 * Recursively sanitize an arbitrary JSON-shaped value. See module
 * docstring for the matching contract + idempotency guarantee.
 *
 * @param value Any JSON-serializable value (plus undefined).
 * @returns The sanitized clone + the set of redacted original key names.
 */
export function sanitizePayload<T = unknown>(value: T): SanitizeResult<T> {
  const redactedKeys = new Set<string>();
  const clean = walk(value, redactedKeys) as T;
  return { clean, redactedKeys };
}

function walk(value: unknown, redactedKeys: Set<string>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map(item => walk(item, redactedKeys));
  }

  // Object — walk keys, redact sensitive ones, recurse into the rest.
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      out[key] = REDACTED_PLACEHOLDER;
      redactedKeys.add(key);
    } else {
      out[key] = walk(child, redactedKeys);
    }
  }
  return out;
}

/**
 * Convenience helper that sanitizes a list of `{<jsonField>: ...}`
 * rows AND aggregates the union of redacted keys observed across the
 * batch. The export bundle uses this so its manifest's
 * `redactedKeysByTable` reports the per-source union.
 *
 * @param rows Database rows (or any record array).
 * @param fields Names of fields whose values are JSON-shaped and need
 * sanitization. Other columns pass through untouched.
 */
export function sanitizeRows<TRow extends Record<string, unknown>>(
  rows: readonly TRow[],
  fields: readonly (keyof TRow & string)[]
): { rows: TRow[]; redactedKeys: Set<string> } {
  const aggregated = new Set<string>();
  const cleanRows = rows.map(row => {
    const cloned: Record<string, unknown> = { ...row };
    for (const field of fields) {
      const value = row[field];
      const { clean, redactedKeys } = sanitizePayload(value);
      cloned[field] = clean;
      for (const key of redactedKeys) aggregated.add(key);
    }
    return cloned as TRow;
  });
  return { rows: cleanRows, redactedKeys: aggregated };
}

/**
 * Test-only export so the lock list is auditable from a regression
 * test without exposing it as a runtime API.
 */
export const __TEST_SENSITIVE_KEYS = SENSITIVE_KEYS;
