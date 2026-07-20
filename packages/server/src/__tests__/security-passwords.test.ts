/**
 * pins the password hashing helpers in `security/passwords.ts`
 * so a future library bump cannot silently weaken Argon2 parameters or
 * collapse the `needsRehash` upgrade path.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as argon2 from 'argon2';
import {
  ARGON2_PINNED_OPTIONS,
  getDummyPasswordHash,
  hashPasswordSecurely,
  needsRehash,
  verifyPasswordSecurely,
  warmUpPasswordSecurity,
} from '../security/passwords.js';

describe('hashPasswordSecurely', () => {
  it('produces an argon2id hash with the pinned cost factors', async () => {
    const encoded = await hashPasswordSecurely('Sup3rSecret!Password');
    expect(encoded).toMatch(/^\$argon2id\$/);
    expect(encoded).toContain('m=65536');
    expect(encoded).toContain('t=3');
    expect(encoded).toContain('p=4');
  });

  it('verifies the plaintext that produced it', async () => {
    const encoded = await hashPasswordSecurely('correct horse battery staple');
    expect(await verifyPasswordSecurely(encoded, 'correct horse battery staple')).toBe(true);
    expect(await verifyPasswordSecurely(encoded, 'wrong password')).toBe(false);
  });

  it('exports a frozen options object so callers cannot mutate the floor', () => {
    expect(Object.isFrozen(ARGON2_PINNED_OPTIONS)).toBe(true);
    expect(ARGON2_PINNED_OPTIONS.memoryCost).toBe(65_536);
    expect(ARGON2_PINNED_OPTIONS.timeCost).toBe(3);
    expect(ARGON2_PINNED_OPTIONS.parallelism).toBe(4);
  });
});

describe('verifyPasswordSecurely', () => {
  it('returns false (instead of throwing) on a malformed hash', async () => {
    expect(await verifyPasswordSecurely('not-a-real-hash', 'pwd')).toBe(false);
    expect(await verifyPasswordSecurely('', 'pwd')).toBe(false);
  });
});

describe('needsRehash', () => {
  it('returns false for a fresh hash from the pinned helper', async () => {
    const encoded = await hashPasswordSecurely('matches-the-floor');
    expect(needsRehash(encoded)).toBe(false);
  });

  it('returns true for a hash produced with a weaker memoryCost', async () => {
    const weak = await argon2.hash('legacy', {
      type: argon2.argon2id,
      memoryCost: 4096,
      timeCost: 2,
      parallelism: 1,
    });
    expect(needsRehash(weak)).toBe(true);
  });

  it('returns true on a malformed hash so callers default to upgrade', () => {
    expect(needsRehash('garbage')).toBe(true);
  });
});

describe('dummy password hash (login timing equaliser)', () => {
  it('memoises the same hash across calls', async () => {
    const first = await getDummyPasswordHash();
    const second = await getDummyPasswordHash();
    expect(first).toBe(second);
    expect(first).toMatch(/^\$argon2id\$/);
  });

  it('verifies false against any real-world password candidate', async () => {
    const dummy = await getDummyPasswordHash();
    expect(await verifyPasswordSecurely(dummy, 'admin')).toBe(false);
    expect(await verifyPasswordSecurely(dummy, '')).toBe(false);
    expect(await verifyPasswordSecurely(dummy, 'correct horse battery staple')).toBe(false);
  });

  it('warmUpPasswordSecurity() pre-seeds the dummy hash without throwing', async () => {
    await expect(warmUpPasswordSecurity()).resolves.toBeUndefined();
  });
});

// Stay safe on long runs: argon2 ops can leave native handles in a state
// that confuses Vitest's worker-pool. No-op cleanup here just pins the
// shape so a future maintainer notices the convention.
afterEach(() => {});
