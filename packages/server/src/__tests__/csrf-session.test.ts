import { describe, expect, it } from 'vitest';
import {
  createSessionCsrfToken,
  createLegacySessionCsrfToken,
  csrfTokensMatchLegacySession,
  csrfTokensMatchSession,
  type SessionCsrfIdentity,
} from '../security/csrf.js';

const secret = 'test-only-jwt-signing-secret-never-used-in-production';
const session: SessionCsrfIdentity = {
  familyId: 'family-one',
  tenantId: 'tenant-one',
  userId: 'user-one',
  sessionVersion: 0,
};

describe('session-bound CSRF token', () => {
  it('converges for one login family without exposing its identifiers', () => {
    const first = createSessionCsrfToken(secret, session);
    const second = createSessionCsrfToken(secret, session);

    expect(first === second).toBe(true);
    expect(/^v1\.[A-Za-z0-9_-]{43}$/.test(first)).toBe(true);
    expect(first.includes(session.familyId)).toBe(false);
    expect(first.includes(session.userId)).toBe(false);
    expect(first.includes(session.tenantId)).toBe(false);
    expect(csrfTokensMatchSession(secret, session, first, first)).toBe(true);
  });

  it.each([
    ['family', { familyId: 'family-two' }],
    ['tenant', { tenantId: 'tenant-two' }],
    ['user', { userId: 'user-two' }],
    ['session version', { sessionVersion: 1 }],
  ] as const)('changes when %s changes', (_name, change) => {
    const first = createSessionCsrfToken(secret, session);
    const next = createSessionCsrfToken(secret, { ...session, ...change });

    expect(first === next).toBe(false);
    expect(csrfTokensMatchSession(secret, { ...session, ...change }, first, first)).toBe(false);
  });

  it('rejects arbitrary matched pairs, tampering and missing client submission', () => {
    const valid = createSessionCsrfToken(secret, session);
    const arbitrary = `v1.${'z'.repeat(43)}`;
    const tampered = `${valid.slice(0, -1)}${valid.endsWith('a') ? 'b' : 'a'}`;

    expect(csrfTokensMatchSession(secret, session, arbitrary, arbitrary)).toBe(false);
    expect(csrfTokensMatchSession(secret, session, tampered, tampered)).toBe(false);
    expect(csrfTokensMatchSession(secret, session, valid, null)).toBe(false);
    expect(csrfTokensMatchSession(secret, session, null, valid)).toBe(false);
    expect(csrfTokensMatchSession('another-secret', session, valid, valid)).toBe(false);
  });

  it('refuses missing key material or an incomplete family identity', () => {
    expect(() => createSessionCsrfToken('', session)).toThrow();
    expect(() => createSessionCsrfToken(secret, { ...session, familyId: '' })).toThrow();
    expect(() => createSessionCsrfToken(secret, { ...session, sessionVersion: -1 })).toThrow();
  });
});

describe('verified legacy upgrade proof', () => {
  it('binds the opaque proof to one token and one purpose without exposing either', () => {
    const token = 'verified-legacy-refresh-test-token';
    const proof = createLegacySessionCsrfToken(secret, token);
    expect(proof).toBe(createLegacySessionCsrfToken(secret, token));
    expect(proof.includes(token)).toBe(false);
    expect(csrfTokensMatchLegacySession(secret, token, proof, proof)).toBe(true);
    expect(csrfTokensMatchLegacySession(secret, `${token}-other`, proof, proof)).toBe(false);
    expect(csrfTokensMatchLegacySession('other-secret', token, proof, proof)).toBe(false);
    expect(csrfTokensMatchSession(secret, session, proof, proof)).toBe(false);
    const modern = createSessionCsrfToken(secret, session);
    expect(csrfTokensMatchLegacySession(secret, token, modern, modern)).toBe(false);
  });

  it('rejects guessed pairs, absent submission and invalid key material', () => {
    const token = 'verified-legacy-refresh-test-token';
    const proof = createLegacySessionCsrfToken(secret, token);
    const guessed = `v1.${'x'.repeat(43)}`;
    expect(csrfTokensMatchLegacySession(secret, token, guessed, guessed)).toBe(false);
    expect(csrfTokensMatchLegacySession(secret, token, proof, null)).toBe(false);
    expect(csrfTokensMatchLegacySession(secret, token, null, proof)).toBe(false);
    expect(() => createLegacySessionCsrfToken('', token)).toThrow();
    expect(() => createLegacySessionCsrfToken(secret, '')).toThrow();
  });
});
