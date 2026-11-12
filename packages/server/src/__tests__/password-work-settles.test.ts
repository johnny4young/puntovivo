import { describe, expect, it } from 'vitest';
import {
  hashPasswordSecurely,
  verifyPasswordSecurely,
  whenPasswordWorkSettles,
} from '../security/passwords.js';

describe('whenPasswordWorkSettles', () => {
  it('resolves only after every running Argon2 call has settled', async () => {
    let settled = 0;
    const hashing = hashPasswordSecurely('Aa!settle-test-1').then(hash => {
      settled += 1;
      return hash;
    });
    const verifying = verifyPasswordSecurely('not-a-hash', 'x').then(() => (settled += 1));

    await whenPasswordWorkSettles();

    expect(settled).toBe(2);
    await Promise.all([hashing, verifying]);
    await expect(whenPasswordWorkSettles()).resolves.toBeUndefined();
  });
});
