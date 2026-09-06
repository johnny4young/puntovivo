import { describe, expect, it } from 'vitest';
import { TRPCClientError } from '@trpc/client';
import { authBootstrapRecovery, isUnauthorizedAuthFailure } from './authBootstrapFailure';

function throttle(retryAfter?: string) {
  return TRPCClientError.from(
    {
      error: {
        code: -32029,
        message: 'private diagnostic',
        data: { code: 'TOO_MANY_REQUESTS', httpStatus: 429 },
      },
    },
    {
      meta: {
        response: new Response('{}', {
          status: 429,
          ...(retryAfter === undefined ? {} : { headers: { 'retry-after': retryAfter } }),
        }),
      },
    }
  );
}

describe('bootstrap authority failures', () => {
  it('distinguishes revoked credentials from throttles and outages', () => {
    expect(isUnauthorizedAuthFailure({ data: { code: 'UNAUTHORIZED' } })).toBe(true);
    expect(isUnauthorizedAuthFailure({ data: { httpStatus: 401 } })).toBe(true);
    expect(isUnauthorizedAuthFailure(throttle())).toBe(false);
    expect(isUnauthorizedAuthFailure(new TypeError('Failed to fetch'))).toBe(false);
    expect(isUnauthorizedAuthFailure(new Error('UNAUTHORIZED'))).toBe(false);
  });
  it('honors delay-seconds and HTTP-date metadata without an automatic request', () => {
    expect(authBootstrapRecovery(throttle('30'), 100_000)).toEqual({
      kind: 'throttled',
      retryAt: 130_000,
    });
    const now = Date.parse('2026-09-06T00:00:00Z');
    expect(authBootstrapRecovery(throttle('Sun, 06 Sep 2026 00:01:30 GMT'), now).retryAt).toBe(
      now + 90_000
    );
    expect(authBootstrapRecovery(throttle('0'), now).retryAt).toBe(now);
  });
  it.each([undefined, '', 'invalid', '-1', 'Infinity'])(
    'uses a safe cooldown for invalid or unavailable header %s',
    header => {
      expect(authBootstrapRecovery(throttle(header), 100_000)).toEqual({
        kind: 'throttled',
        retryAt: 160_000,
      });
    }
  );
  it('keeps transient errors generic and serialized Hub throttles recoverable', () => {
    expect(authBootstrapRecovery(new TypeError('private path'), 100_000)).toEqual({
      kind: 'unavailable',
      retryAt: 100_000,
    });
    expect(authBootstrapRecovery({ data: { httpStatus: 429 } }, 100_000)).toEqual({
      kind: 'throttled',
      retryAt: 160_000,
    });
    expect(authBootstrapRecovery({ data: { httpStatus: 503 } }, 100_000).kind).toBe('unavailable');
  });
});
