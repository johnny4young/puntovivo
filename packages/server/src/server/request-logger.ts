/**
 * Request-scoped child-logger bindings.
 *
 * ENG-052b — every log line emitted during a request carries the
 * Fastify requestId plus the best-effort Command-Envelope deviceId and
 * the ENG-135c renderer-minted correlationId. Extracted to module scope
 * so the unit test can drive `buildRequestScopedLoggerBindings` with a
 * stub request without spinning up the full Fastify server.
 *
 * @module server/request-logger
 */

import type { FastifyRequest } from 'fastify';
import { CORRELATION_ID_HEADER, sanitizeCorrelationId } from '../observability/index.js';

/**
 * ENG-052b — Build the request-scoped child logger bindings used by
 * the `onRequest` hook below. Extracted so unit tests can call it
 * with a stub request without spinning up the full Fastify server.
 *
 * Pulled into module scope (not a closure inside `createServer`) so
 * the test file can import it directly without hitting the full
 * server lifecycle.
 */
export function buildRequestScopedLoggerBindings(
  request: Pick<FastifyRequest, 'id' | 'headers'>
): Record<string, string> {
  const headerValue = request.headers['x-device-id'];
  const deviceId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const bindings: Record<string, string> = { requestId: request.id };
  if (typeof deviceId === 'string' && deviceId.length > 0) {
    bindings.deviceId = deviceId;
  }
  // ENG-135c — adopt the renderer-minted correlation id (strictly
  // sanitized; correlation-only) so every log line of this request —
  // including the DB-adjacent work it triggers — carries the same id
  // the client attached to its own error events. The Fastify
  // requestId binding above stays as the non-spoofable identity.
  const correlationId = sanitizeCorrelationId(request.headers[CORRELATION_ID_HEADER]);
  if (correlationId) {
    bindings.correlationId = correlationId;
  }
  return bindings;
}

export function buildRequestScopedLogger(request: FastifyRequest): FastifyRequest['log'] {
  return request.log.child(buildRequestScopedLoggerBindings(request));
}
