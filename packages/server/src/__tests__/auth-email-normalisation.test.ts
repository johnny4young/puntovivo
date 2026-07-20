/**
 * pins the email normalisation transform on every auth +
 * users mutation schema. Without this, two operators could register
 * `Admin@x.com` and `admin@x.com` as different accounts and SSO / IdP
 * mappings would break later.
 */

import { describe, expect, it } from 'vitest';
import { loginInput } from '../trpc/schemas/auth.js';
import { createUserInput, updateUserInput, listUsersInput } from '../trpc/schemas/users.js';

describe('email normalisation', () => {
  it('trims and lowercases the login email', () => {
    const parsed = loginInput.parse({
      email: '  Admin@X.COM  ',
      password: 'Sup3rSecret!1',
    });
    expect(parsed.email).toBe('admin@x.com');
  });

  it('trims and lowercases the createUser email', () => {
    const parsed = createUserInput.parse({
      email: 'New.User@COMPANY.IO',
      name: 'New User',
      password: 'AVeryLongP@ssw0rd!2025',
      role: 'cashier',
    });
    expect(parsed.email).toBe('new.user@company.io');
  });

  it('rejects a malformed email on createUserInput (login keeps loose validation for legacy `admin@localhost`)', () => {
    expect(() =>
      createUserInput.parse({
        email: 'not-an-email',
        name: 'X',
        password: 'AVeryLongP@ssw0rd!2025',
        role: 'cashier',
      })
    ).toThrow();
  });

  it('admits legacy `admin@localhost` on login (no TLD) but still trims and lowercases', () => {
    const parsed = loginInput.parse({
      email: '  Admin@LOCALHOST  ',
      password: 'whatever',
    });
    expect(parsed.email).toBe('admin@localhost');
  });
});

describe('schema strict() — extra keys', () => {
  it('rejects extra keys on loginInput', () => {
    expect(() =>
      loginInput.parse({
        email: 'admin@x.com',
        password: 'pwd',
        // @ts-expect-error intentional extra key for strict-mode assertion
        evil: 'payload',
      })
    ).toThrow();
  });

  it('rejects extra keys on createUserInput', () => {
    expect(() =>
      createUserInput.parse({
        email: 'a@b.com',
        name: 'Test',
        password: 'AVeryLongP@ssw0rd!2025',
        role: 'cashier',
        // @ts-expect-error — intentional extra key, asserts createUserInput.strict() rejects it
        bonusAdmin: true,
      })
    ).toThrow();
  });

  it('rejects extra keys on updateUserInput', () => {
    expect(() =>
      updateUserInput.parse({
        id: 'abc',
        name: 'Test',
        // @ts-expect-error — intentional extra key, asserts updateUserInput.strict() rejects it
        role: 'admin',
        injected: 'value',
      })
    ).toThrow();
  });

  it('rejects extra keys on listUsersInput', () => {
    expect(() =>
      listUsersInput.parse({
        page: 1,
        perPage: 10,
        // @ts-expect-error — intentional extra key, asserts listUsersInput.strict() rejects it
        tenantId: 'leak',
      })
    ).toThrow();
  });
});
