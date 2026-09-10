import { describe, expect, it } from 'vitest';
import { resolveExternalOrderWrappingKey } from './external-order-key.js';
import { resolveStandaloneEncryptionKey } from './standalone-database.js';
describe('external-order wrapping key', () => {
  it('uses a separate explicit key without changing database encryption policy', () => {
    const dedicated = 'ab'.repeat(32);
    expect(resolveExternalOrderWrappingKey({ dedicated })).toBe(dedicated);
    expect(
      resolveStandaloneEncryptionKey({
        NODE_ENV: 'development',
        PUNTOVIVO_EXTERNAL_ORDER_KEY: dedicated,
      })
    ).toBeUndefined();
    expect(() =>
      resolveStandaloneEncryptionKey({
        NODE_ENV: 'production',
        PUNTOVIVO_EXTERNAL_ORDER_KEY: dedicated,
      })
    ).toThrow('PUNTOVIVO_DB_KEY is required');
  });
  it('retains encrypted desktop and existing server configuration fallback', () => {
    expect(resolveExternalOrderWrappingKey({ databaseKey: 'db', webhookKey: 'webhook' })).toBe(
      'webhook'
    );
    expect(resolveExternalOrderWrappingKey({ databaseKey: 'db' })).toBe('db');
    expect(resolveExternalOrderWrappingKey({})).toBeUndefined();
  });
  it.each(['', 'password', 'ab'.repeat(31), 'gg'.repeat(32), 'ab'.repeat(32) + '\n'])(
    'rejects malformed explicit keys instead of silently falling back (%s)',
    dedicated => {
      expect(() => resolveExternalOrderWrappingKey({ dedicated, databaseKey: 'db' })).toThrow(
        'PUNTOVIVO_EXTERNAL_ORDER_KEY'
      );
    }
  );
});
