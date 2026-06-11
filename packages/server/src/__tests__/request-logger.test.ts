/**
 * ENG-052b — Request-scoped logger bindings.
 *
 * Verifies the helper that backs the Fastify `onRequest` hook:
 * every request log line should carry `requestId` (Fastify reqId)
 * and, when present, the `x-device-id` header. The downstream
 * `commandEnvelope` middleware chains its own `operationId` /
 * `tenantId` / `userId` bindings off this child, so the helper here
 * is the single source of truth for request-level provenance.
 */

import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { buildRequestScopedLoggerBindings } from '../index.js';

function makeStubRequest(
  id: string,
  headers: Record<string, string | string[] | undefined>
): Pick<FastifyRequest, 'id' | 'headers'> {
  return {
    id,
    headers: headers as FastifyRequest['headers'],
  };
}

describe('buildRequestScopedLoggerBindings', () => {
  it('emits requestId only when no device header is set', () => {
    const bindings = buildRequestScopedLoggerBindings(
      makeStubRequest('req-001', {})
    );
    expect(bindings).toEqual({ requestId: 'req-001' });
    expect(bindings.deviceId).toBeUndefined();
  });

  it('attaches the deviceId header when a single string is present', () => {
    const bindings = buildRequestScopedLoggerBindings(
      makeStubRequest('req-002', { 'x-device-id': 'dev-aaa-111' })
    );
    expect(bindings).toEqual({
      requestId: 'req-002',
      deviceId: 'dev-aaa-111',
    });
  });

  it('uses the first value when the device header arrives as an array', () => {
    const bindings = buildRequestScopedLoggerBindings(
      makeStubRequest('req-003', {
        'x-device-id': ['dev-first', 'dev-shadow'],
      })
    );
    expect(bindings.deviceId).toBe('dev-first');
  });

  it('drops the deviceId binding when the header is an empty string', () => {
    const bindings = buildRequestScopedLoggerBindings(
      makeStubRequest('req-004', { 'x-device-id': '' })
    );
    expect(bindings).toEqual({ requestId: 'req-004' });
  });

  it('produces a stable shape that pino.child() can consume', () => {
    const bindings = buildRequestScopedLoggerBindings(
      makeStubRequest('req-005', { 'x-device-id': 'dev-xyz' })
    );
    // pino.child() accepts plain objects with serializable string
    // values. Verify every value is a string (no nested arrays /
    // objects sneak through) so downstream serializers stay simple.
    for (const [key, value] of Object.entries(bindings)) {
      expect(typeof key).toBe('string');
      expect(typeof value).toBe('string');
    }
  });

  // ENG-135c — renderer-minted correlation id intake.
  it('adopts a valid x-correlation-id header alongside the requestId', () => {
    const bindings = buildRequestScopedLoggerBindings(
      makeStubRequest('req-006', {
        'x-correlation-id': '6f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b',
      })
    );
    expect(bindings).toEqual({
      requestId: 'req-006',
      correlationId: '6f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b',
    });
  });

  it('drops an invalid correlation id (the requestId binding survives)', () => {
    const bindings = buildRequestScopedLoggerBindings(
      makeStubRequest('req-007', {
        'x-correlation-id': 'spaces and <chars> are rejected',
      })
    );
    expect(bindings).toEqual({ requestId: 'req-007' });
  });

  it('takes the first entry when the correlation header arrives as an array', () => {
    const bindings = buildRequestScopedLoggerBindings(
      makeStubRequest('req-008', {
        'x-correlation-id': ['client-id-first', 'client-id-shadow'],
      })
    );
    expect(bindings.correlationId).toBe('client-id-first');
  });
});
