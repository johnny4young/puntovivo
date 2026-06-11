/**
 * ENG-135c — sanitizeCorrelationId contract.
 *
 * The header is attacker-controlled; the sanitizer is the single
 * gate between the wire and every log/telemetry consumer. These
 * cases pin: accepted id shapes (UUID v4, nanoid, hex), the length
 * bounds, charset rejection (log-injection candidates), the Fastify
 * header-shape tolerance (string[], undefined, numbers), and the
 * null contract that makes callers fall back to the Fastify reqId.
 *
 * @module __tests__/observability-correlation.test
 */

import { describe, expect, it } from 'vitest';
import {
  CORRELATION_ID_HEADER,
  sanitizeCorrelationId,
} from '../observability/index.js';

describe('sanitizeCorrelationId (ENG-135c)', () => {
  it('accepts a UUID v4 (the web client default)', () => {
    const id = '6f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b';
    expect(sanitizeCorrelationId(id)).toBe(id);
  });

  it('accepts nanoid-style and hex ids', () => {
    expect(sanitizeCorrelationId('V1StGXR8_Z5jdHi6B-myT')).toBe(
      'V1StGXR8_Z5jdHi6B-myT'
    );
    expect(sanitizeCorrelationId('deadbeefcafe1234')).toBe('deadbeefcafe1234');
  });

  it('enforces the length bounds (8..64)', () => {
    expect(sanitizeCorrelationId('a'.repeat(7))).toBeNull();
    expect(sanitizeCorrelationId('a'.repeat(8))).toBe('a'.repeat(8));
    expect(sanitizeCorrelationId('a'.repeat(64))).toBe('a'.repeat(64));
    expect(sanitizeCorrelationId('a'.repeat(65))).toBeNull();
  });

  it('rejects charset violations (log-injection candidates)', () => {
    expect(sanitizeCorrelationId('id with spaces')).toBeNull();
    expect(sanitizeCorrelationId('<script>alert(1)</script>')).toBeNull();
    expect(sanitizeCorrelationId('id:with:colons')).toBeNull();
    expect(sanitizeCorrelationId('id\nnewline-injected')).toBeNull();
    expect(sanitizeCorrelationId('café-no-ascii-1234')).toBeNull();
  });

  it('takes the first entry of a header array (Fastify multi-value shape)', () => {
    expect(
      sanitizeCorrelationId(['client-id-first', 'client-id-shadow'])
    ).toBe('client-id-first');
    expect(sanitizeCorrelationId(['bad id', 'valid-id-12345'])).toBeNull();
  });

  it('returns null for non-string inputs', () => {
    expect(sanitizeCorrelationId(undefined)).toBeNull();
    expect(sanitizeCorrelationId(null)).toBeNull();
    expect(sanitizeCorrelationId(12345678)).toBeNull();
    expect(sanitizeCorrelationId({})).toBeNull();
    expect(sanitizeCorrelationId([])).toBeNull();
  });

  it('exposes the canonical header name shared with the web client', () => {
    expect(CORRELATION_ID_HEADER).toBe('x-correlation-id');
  });
});
