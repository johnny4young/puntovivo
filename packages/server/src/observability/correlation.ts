/**
 * ENG-135c — client-supplied correlation id intake.
 *
 * The renderer mints a correlation id per tRPC request and ships it
 * in the `x-correlation-id` header so the client-side error event
 * and the server-side trace of the request that caused it share ONE
 * identifier (before this, the correlationId was just the Fastify
 * reqId — born server-side, invisible to the renderer).
 *
 * The header is attacker-controlled input. The sanitizer enforces a
 * strict shape (URL-safe charset, bounded length) and the value is
 * used EXCLUSIVELY for log/telemetry correlation — never for
 * authorization, scoping, or any business logic. The non-spoofable
 * Fastify `requestId` stays as an independent binding on every log
 * line, so a forged correlation id can never erase the server-side
 * identity of a request.
 */

/** Canonical header name, shared by the logger bindings and the tRPC tracing middleware. */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * URL-safe charset, 8..64 chars. Covers UUID v4 (36 chars with
 * hyphens), nanoid, and hex ids; rejects whitespace, separators, and
 * anything long enough to be log-injection noise.
 */
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Validate a client-supplied correlation id candidate. Accepts the
 * raw Fastify header value shape (string, string[], or undefined —
 * arrays take the first entry, mirroring the x-device-id intake).
 * Returns the id when it matches the strict pattern, null otherwise
 * — callers fall back to the Fastify reqId on null, so an invalid
 * header degrades to today's behaviour instead of failing.
 */
export function sanitizeCorrelationId(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== 'string') {
    return null;
  }
  return CORRELATION_ID_PATTERN.test(candidate) ? candidate : null;
}
