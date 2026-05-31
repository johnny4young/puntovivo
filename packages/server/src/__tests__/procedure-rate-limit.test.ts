/**
 * ENG-166 — pins the per-procedure rate-limit middleware. The middleware
 * short-circuits under Vitest so existing test suites do
 * not start tripping caps; this file opts the pure helper into enforcement
 * per call instead of mutating global process env.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetProcedureRateLimitForTest,
  checkProcedureRateLimit,
} from '../trpc/middleware/procedureRateLimit.js';

describe('checkProcedureRateLimit', () => {
  afterEach(() => {
    __resetProcedureRateLimitForTest();
    delete process.env.PUNTOVIVO_E2E;
  });

  it('allows up to the cap and denies further calls in the same window', () => {
    const opts = {
      name: 'test.proc',
      max: 3,
      windowMs: 60_000,
      keyBy: ['ip' as const],
      ip: '1.1.1.1',
      userId: null as string | null,
      enforceInTest: true,
    };

    expect(checkProcedureRateLimit(opts)).toBe('allowed');
    expect(checkProcedureRateLimit(opts)).toBe('allowed');
    expect(checkProcedureRateLimit(opts)).toBe('allowed');
    expect(checkProcedureRateLimit(opts)).toBe('denied');
  });

  it('isolates buckets per IP when keyed by ip', () => {
    const base = {
      name: 'test.proc',
      max: 1,
      windowMs: 60_000,
      keyBy: ['ip' as const],
      userId: null as string | null,
      enforceInTest: true,
    };

    expect(checkProcedureRateLimit({ ...base, ip: '1.1.1.1' })).toBe('allowed');
    expect(checkProcedureRateLimit({ ...base, ip: '2.2.2.2' })).toBe('allowed');
    expect(checkProcedureRateLimit({ ...base, ip: '1.1.1.1' })).toBe('denied');
  });

  it('isolates buckets per userId when keyed by userId', () => {
    const base = {
      name: 'test.proc',
      max: 1,
      windowMs: 60_000,
      keyBy: ['userId' as const],
      ip: null as string | null,
      enforceInTest: true,
    };

    expect(checkProcedureRateLimit({ ...base, userId: 'alice' })).toBe('allowed');
    expect(checkProcedureRateLimit({ ...base, userId: 'bob' })).toBe('allowed');
    expect(checkProcedureRateLimit({ ...base, userId: 'alice' })).toBe('denied');
  });

  it('rolls the window over once windowMs has elapsed', () => {
    const opts = {
      name: 'test.proc',
      max: 1,
      windowMs: 1_000,
      keyBy: ['ip' as const],
      ip: '1.1.1.1',
      userId: null as string | null,
      enforceInTest: true,
    };

    expect(checkProcedureRateLimit({ ...opts, now: 1_000 })).toBe('allowed');
    expect(checkProcedureRateLimit({ ...opts, now: 1_500 })).toBe('denied');
    // window expires at 1_000 + 1_000 = 2_000; anything after that is fresh.
    expect(checkProcedureRateLimit({ ...opts, now: 2_001 })).toBe('allowed');
  });

  it('bypasses entirely under Vitest (so live test suites do not trip)', () => {
    const opts = {
      name: 'test.proc',
      max: 1,
      windowMs: 60_000,
      keyBy: ['ip' as const],
      ip: '1.1.1.1',
      userId: null as string | null,
    };
    for (let i = 0; i < 5; i++) {
      expect(checkProcedureRateLimit(opts)).toBe('allowed');
    }
  });

  it('bypasses entirely under the Playwright E2E runtime', () => {
    process.env.PUNTOVIVO_E2E = '1';
    const opts = {
      name: 'test.proc',
      max: 1,
      windowMs: 60_000,
      keyBy: ['ip' as const],
      ip: '1.1.1.1',
      userId: null as string | null,
      enforceInTest: true,
    };

    for (let i = 0; i < 5; i += 1) {
      expect(checkProcedureRateLimit(opts)).toBe('allowed');
    }
  });

  it('does not honor the Playwright E2E bypass in production', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalRuntimeEnv = process.env.PUNTOVIVO_RUNTIME_ENV;

    process.env.PUNTOVIVO_E2E = '1';
    process.env.NODE_ENV = 'production';
    process.env.PUNTOVIVO_RUNTIME_ENV = 'production';

    try {
      const opts = {
        name: 'test.proc',
        max: 1,
        windowMs: 60_000,
        keyBy: ['ip' as const],
        ip: '1.1.1.1',
        userId: null as string | null,
        enforceInTest: true,
      };

      expect(checkProcedureRateLimit(opts)).toBe('allowed');
      expect(checkProcedureRateLimit(opts)).toBe('denied');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalRuntimeEnv === undefined) {
        delete process.env.PUNTOVIVO_RUNTIME_ENV;
      } else {
        process.env.PUNTOVIVO_RUNTIME_ENV = originalRuntimeEnv;
      }
    }
  });
});
