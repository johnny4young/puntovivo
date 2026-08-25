import { describe, expect, it } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { shouldUseSecureCookies } from '../security/cookies.js';
import { clearRefreshCookie } from '../security/authTokens.js';
import { ensureCsrfCookie } from '../security/csrf.js';
import { setRefreshCookie } from '../trpc/routers/auth/helpers.js';

// shouldUseSecureCookies must ride exclusively on Fastify's
// resolved protocol. Under trustProxy (site_hub) Fastify already folds a
// proxy-supplied X-Forwarded-Proto into request.protocol; on device_local
// the header is client-spoofable and must never influence the Secure
// attribute. The narrowed Pick<FastifyRequest, 'protocol'> signature makes
// consulting raw headers a compile error, and these cases pin the runtime
// behavior on both protocol values.
describe('shouldUseSecureCookies', () => {
  it('marks cookies Secure when Fastify resolved an https protocol', () => {
    expect(shouldUseSecureCookies({ protocol: 'https' })).toBe(true);
  });

  it('keeps cookies non-Secure on plain http', () => {
    expect(shouldUseSecureCookies({ protocol: 'http' })).toBe(false);
  });
});

interface CapturedCookie {
  name: string;
  options: Record<string, unknown>;
}

function makeRequest(protocol: 'http' | 'https'): FastifyRequest {
  return { protocol, cookies: {} } as unknown as FastifyRequest;
}

function makeReply(captured: CapturedCookie[]): FastifyReply {
  return {
    setCookie(name: string, _value: string, options: Record<string, unknown>) {
      captured.push({ name, options });
      return this;
    },
    clearCookie(name: string, options: Record<string, unknown>) {
      captured.push({ name, options });
      return this;
    },
  } as unknown as FastifyReply;
}

// the emit path itself: an https-resolved request must produce
// cookie options carrying secure: true at every call site that sets or
// clears an auth cookie. This is the regression barrier for a refactor
// that hardcodes secure: false or drops the option — the device_local
// integration test in auth.test.ts only proves the negative half.
describe('secure attribute reaches the emitted cookie options', () => {
  it.each([
    ['https', true],
    ['http', false],
  ] as const)('setRefreshCookie on %s emits secure: %s', (protocol, secure) => {
    const captured: CapturedCookie[] = [];
    setRefreshCookie(makeRequest(protocol), makeReply(captured), 'token-value');

    expect(captured).toHaveLength(1);
    expect(captured[0]?.options).toMatchObject({ secure, httpOnly: true, sameSite: 'strict' });
  });

  it.each([
    ['https', true],
    ['http', false],
  ] as const)('clearRefreshCookie on %s emits secure: %s', (protocol, secure) => {
    const captured: CapturedCookie[] = [];
    clearRefreshCookie(makeRequest(protocol), makeReply(captured));

    expect(captured).toHaveLength(1);
    expect(captured[0]?.options).toMatchObject({ secure, httpOnly: true });
  });

  it.each([
    ['https', true],
    ['http', false],
  ] as const)('ensureCsrfCookie on %s emits secure: %s', (protocol, secure) => {
    const captured: CapturedCookie[] = [];
    ensureCsrfCookie(makeRequest(protocol), makeReply(captured));

    expect(captured).toHaveLength(1);
    expect(captured[0]?.options).toMatchObject({ secure, sameSite: 'lax' });
  });
});
