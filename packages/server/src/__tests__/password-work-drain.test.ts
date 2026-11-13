import { afterEach, describe, expect, it } from 'vitest';
import {
  __reopenPasswordWorkForTests,
  drainPasswordWork,
  hashPasswordSecurely,
  verifyPasswordSecurely,
} from '../security/passwords.js';

afterEach(() => __reopenPasswordWorkForTests());

describe('drainPasswordWork', () => {
  it('waits for running Argon2 calls and refuses new ones', async () => {
    let settled = 0;
    const hashing = hashPasswordSecurely('Aa!settle-test-1').then(hash => {
      settled += 1;
      return hash;
    });

    await drainPasswordWork();

    expect(settled).toBe(1);
    await hashing;
    await expect(hashPasswordSecurely('Aa!settle-test-2')).rejects.toThrow('PASSWORD_WORK_CLOSED');
    // Verification keeps its contract: a refused call reads as a failed match.
    await expect(verifyPasswordSecurely('not-a-hash', 'x')).resolves.toBe(false);
  });

  it('gives up after its bound instead of holding a dying thread', async () => {
    const hashing = hashPasswordSecurely('Aa!settle-test-3');
    const startedAt = Date.now();
    await drainPasswordWork(1);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    await hashing;
  });
});
