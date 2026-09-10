import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  configureExternalOrderSecretKey,
  hasExternalOrderSecretKey,
  openExternalOrderSecret,
  sealExternalOrderSecret,
} from './secret-box.js';
describe('external connector credential envelope', () => {
  const ctx = { tenantId: 'tenant-a', connectorId: 'connector-a' };
  afterEach(() => configureExternalOrderSecretKey(undefined));
  it('fails closed without a key and clears configured key material', () => {
    configureExternalOrderSecretKey(undefined);
    expect(hasExternalOrderSecretKey()).toBe(false);
    expect(() => sealExternalOrderSecret(randomBytes(32).toString('base64url'), ctx)).toThrow(
      'KEY_UNAVAILABLE'
    );
    configureExternalOrderSecretKey('test-key');
    expect(hasExternalOrderSecretKey()).toBe(true);
    configureExternalOrderSecretKey(undefined);
    expect(() => openExternalOrderSecret('v1.invalid', ctx)).toThrow('KEY_UNAVAILABLE');
  });
  it('round-trips with random IVs, without retaining plaintext in the envelope', () => {
    configureExternalOrderSecretKey('test-key');
    const secret = randomBytes(32).toString('base64url');
    const first = sealExternalOrderSecret(secret, ctx),
      second = sealExternalOrderSecret(secret, ctx);
    expect(first).not.toBe(second);
    expect(first).not.toContain(secret);
    expect(openExternalOrderSecret(first, ctx)).toBe(secret);
  });
  it('rejects moving credentials between connectors or tenants and rejects wrong master keys', () => {
    configureExternalOrderSecretKey('test-key');
    const sealed = sealExternalOrderSecret(randomBytes(32).toString('base64url'), ctx);
    for (const changed of [
      { ...ctx, tenantId: 'tenant-b' },
      { ...ctx, connectorId: 'connector-b' },
    ])
      expect(() => openExternalOrderSecret(sealed, changed)).toThrow();
    configureExternalOrderSecretKey('different-key');
    expect(() => openExternalOrderSecret(sealed, ctx)).toThrow();
  });
  it('rejects malformed, truncated, extra-field and noncanonical envelopes or weak secrets', () => {
    configureExternalOrderSecretKey('test-key');
    const sealed = sealExternalOrderSecret(randomBytes(32).toString('base64url'), ctx);
    for (const value of [
      sealed + '.extra',
      sealed.slice(0, -3),
      sealed.replace('v1.', 'v2.'),
      'v1.a.b.c',
    ])
      expect(() => openExternalOrderSecret(value, ctx)).toThrow();
    expect(() => sealExternalOrderSecret('short', ctx)).toThrow();
    expect(() => sealExternalOrderSecret(randomBytes(32).toString('base64'), ctx)).toThrow();
    expect(() =>
      sealExternalOrderSecret(randomBytes(32).toString('base64url'), { ...ctx, tenantId: '' })
    ).toThrow();
  });
});
