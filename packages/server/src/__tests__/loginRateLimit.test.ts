/**
 * ENG-008 — unit tests for `packages/server/src/security/loginRateLimit.ts`.
 *
 * Every test passes an explicit `now` parameter so the suite is
 * deterministic without `vi.useFakeTimers()`. `__resetForTests()` runs in
 * `afterEach` so module-level bucket state never leaks between cases.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import {
  LOGIN_RATE_LIMIT_IP_MAX,
  LOGIN_RATE_LIMIT_IP_WINDOW_MS,
  LOGIN_RATE_LIMIT_USERNAME_MAX,
  LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS,
  __resetForTests,
  checkIp,
  checkUsername,
  registerFailure,
  registerSuccess,
  secondsUntilReset,
} from '../security/loginRateLimit.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';

function expectTooManyRequests(fn: () => void): TRPCError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(TRPCError);
    const trpcErr = err as TRPCError;
    expect(trpcErr.code).toBe('TOO_MANY_REQUESTS');
    expect(trpcErr.cause).toBeInstanceOf(ServerErrorWithCode);
    expect((trpcErr.cause as ServerErrorWithCode).errorCode).toBe('AUTH_RATE_LIMIT_EXCEEDED');
    return trpcErr;
  }
  throw new Error('Expected TOO_MANY_REQUESTS TRPCError, none thrown');
}

describe('loginRateLimit (ENG-008)', () => {
  afterEach(() => {
    __resetForTests();
  });

  it('permits exactly IP_MAX failures inside the window and rejects the next one', () => {
    const ip = '1.1.1.1';
    const t = 1_000;
    for (let i = 0; i < LOGIN_RATE_LIMIT_IP_MAX; i += 1) {
      expect(() => checkIp(ip, t)).not.toThrow();
      registerFailure(ip, `user${i}@test.com`, t);
    }
    const err = expectTooManyRequests(() => checkIp(ip, t));
    const details = (err.cause as ServerErrorWithCode).details;
    expect(details).toMatchObject({ kind: 'ip', key: ip, max: LOGIN_RATE_LIMIT_IP_MAX });
  });

  it('IP bucket decays after the window elapses', () => {
    const ip = '2.2.2.2';
    const t0 = 0;
    for (let i = 0; i < LOGIN_RATE_LIMIT_IP_MAX; i += 1) {
      registerFailure(ip, `user${i}@test.com`, t0);
    }
    expectTooManyRequests(() => checkIp(ip, t0));

    // One ms past the window → bucket considered empty, no throw.
    const tAfter = t0 + LOGIN_RATE_LIMIT_IP_WINDOW_MS + 1;
    expect(() => checkIp(ip, tAfter)).not.toThrow();

    // A fresh failure starts a brand-new window.
    registerFailure(ip, 'fresh@test.com', tAfter);
    expect(secondsUntilReset('ip', ip, tAfter)).toBe(
      Math.ceil(LOGIN_RATE_LIMIT_IP_WINDOW_MS / 1000)
    );
  });

  it('permits exactly USERNAME_MAX failures and rejects the next one', () => {
    const email = 'locked@test.com';
    const t = 500;
    for (let i = 0; i < LOGIN_RATE_LIMIT_USERNAME_MAX; i += 1) {
      expect(() => checkUsername(email, t)).not.toThrow();
      // Use a different IP each time so the IP bucket does not fire first.
      registerFailure(`10.0.0.${i}`, email, t);
    }
    const err = expectTooManyRequests(() => checkUsername(email, t));
    const details = (err.cause as ServerErrorWithCode).details;
    expect(details).toMatchObject({
      kind: 'username',
      key: email,
      max: LOGIN_RATE_LIMIT_USERNAME_MAX,
    });
  });

  it('username bucket decays after the 15-minute window elapses', () => {
    const email = 'decay@test.com';
    const t0 = 0;
    for (let i = 0; i < LOGIN_RATE_LIMIT_USERNAME_MAX; i += 1) {
      registerFailure(`10.0.1.${i}`, email, t0);
    }
    expectTooManyRequests(() => checkUsername(email, t0));

    const tAfter = t0 + LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS + 1;
    expect(() => checkUsername(email, tAfter)).not.toThrow();
  });

  it('registerSuccess clears only the target username bucket', () => {
    const target = 'alice@test.com';
    const other = 'bob@test.com';
    const t = 100;
    for (let i = 0; i < LOGIN_RATE_LIMIT_USERNAME_MAX; i += 1) {
      registerFailure('3.3.3.3', target, t);
      registerFailure('3.3.3.3', other, t);
    }
    // Both buckets saturated.
    expectTooManyRequests(() => checkUsername(target, t));
    expectTooManyRequests(() => checkUsername(other, t));

    registerSuccess(target);

    // Target cleared; other still locked.
    expect(() => checkUsername(target, t)).not.toThrow();
    expectTooManyRequests(() => checkUsername(other, t));
  });

  it('registerSuccess does NOT clear the IP bucket (stops single-source stuffing)', () => {
    const ip = '4.4.4.4';
    const t = 200;
    for (let i = 0; i < LOGIN_RATE_LIMIT_IP_MAX; i += 1) {
      registerFailure(ip, `acct${i}@test.com`, t);
    }
    expectTooManyRequests(() => checkIp(ip, t));

    // A "successful" login on one of those accounts should NOT release the IP
    // bucket — the attacker is still pounding the rest from the same origin.
    registerSuccess('acct0@test.com');

    expectTooManyRequests(() => checkIp(ip, t));
  });

  it('IP buckets are independent across different IPs', () => {
    const t = 300;
    for (let i = 0; i < LOGIN_RATE_LIMIT_IP_MAX; i += 1) {
      registerFailure('5.5.5.5', `u${i}@test.com`, t);
    }
    expectTooManyRequests(() => checkIp('5.5.5.5', t));
    // Fresh IP starts clean.
    expect(() => checkIp('6.6.6.6', t)).not.toThrow();
  });

  it('username buckets are independent across different emails', () => {
    const t = 400;
    for (let i = 0; i < LOGIN_RATE_LIMIT_USERNAME_MAX; i += 1) {
      registerFailure(`7.7.7.${i}`, 'charlie@test.com', t);
    }
    expectTooManyRequests(() => checkUsername('charlie@test.com', t));
    expect(() => checkUsername('dave@test.com', t)).not.toThrow();
  });

  it('normalizes email case and whitespace so casing cannot bypass the cap', () => {
    const t = 500;
    for (let i = 0; i < LOGIN_RATE_LIMIT_USERNAME_MAX; i += 1) {
      registerFailure(`8.8.8.${i}`, 'ALICE@Test.com', t);
    }
    // Different case + leading whitespace must hit the same bucket.
    expectTooManyRequests(() => checkUsername('  alice@test.COM  ', t));
  });

  it('secondsUntilReset returns a positive integer inside the window and 0 after', () => {
    const ip = '9.9.9.9';
    const t0 = 10_000;
    registerFailure(ip, 'x@test.com', t0);

    const inside = secondsUntilReset('ip', ip, t0 + 1_000);
    expect(inside).toBeGreaterThan(0);
    expect(inside).toBeLessThanOrEqual(60);

    const after = secondsUntilReset('ip', ip, t0 + LOGIN_RATE_LIMIT_IP_WINDOW_MS + 1);
    expect(after).toBe(0);

    // Unknown key returns 0.
    expect(secondsUntilReset('username', 'never@seen.com')).toBe(0);
  });
});
