/**
 * Recognize provider failures that prove no billable work was performed.
 *
 * The reservation kernel keeps an unknown-cost hold whenever a dispatched
 * remote call fails, because a lost response may still be billed. Two
 * failure families are definitive instead, and release the hold so an
 * ordinary rate limit or bad credential cannot disable AI for the whole
 * tenant until the month rolls over:
 *
 * - The provider answered with a pre-inference rejection: 400 (invalid
 *   request), 401/403 (credentials, permissions), 404 (unknown model or
 *   route), 422 (unprocessable input) or 429 (rate limit). Providers do not
 *   bill these.
 * - The connection was never established (refused, DNS failure, connect
 *   timeout, TLS handshake rejection), so no request body reached the
 *   provider.
 *
 * Everything else stays uncertain and fail-closed: 5xx answers, 408/409 and
 * other statuses, resets after the request was sent, our own deadline or
 * abort after dispatch, and malformed responses.
 *
 * @module services/ai/provider-rejection
 */

const NOT_BILLED_STATUSES = new Set([400, 401, 403, 404, 422, 429]);

const NOT_SENT_CODES = new Set([
  // Connection never established.
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  // TLS handshake rejected before any request bytes were written.
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/**
 * Walk the error, its AI SDK `lastError` and its `cause` chain. The first
 * level that carries an HTTP status decides; an abort or timeout anywhere
 * before that is never definitive.
 */
export function isDefinitiveProviderRejection(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const record = current as Record<string, unknown>;
    if (record.name === 'AbortError' || record.name === 'TimeoutError') return false;
    const status = record.statusCode;
    if (typeof status === 'number') return NOT_BILLED_STATUSES.has(status);
    if (typeof record.code === 'string' && NOT_SENT_CODES.has(record.code)) return true;
    // AI SDK RetryError keeps the decisive failure in lastError.
    current = record.lastError ?? record.cause;
  }
  return false;
}
