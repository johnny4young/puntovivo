/**
 * ENG-166 — pins the login timing equaliser. The not-found branch must
 * call `verifyPasswordSecurely` against the dummy hash so an attacker
 * cannot enumerate accounts via response timing. Asserting a wall-clock
 * delta would be flaky in CI; instead we hook into `verifyPasswordSecurely`
 * via a spy and verify both branches exercise the same code path.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import * as passwords from '../security/passwords.js';
import { users } from '../db/schema.js';

let server: PuntovivoServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  vi.restoreAllMocks();
});

function loginContext(s: PuntovivoServer): Context {
  return {
    req: {
      server: s.app,
      headers: {},
      ip: '127.0.0.1',
      user: null,
      jwtVerify: async () => {
        throw new Error('no token');
      },
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db: s.db,
    user: null,
    tenantId: null,
    siteId: null,
  };
}

describe('auth.login timing equality', () => {
  it('invokes verifyPasswordSecurely with the dummy hash when the email does not match any user', async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const verifySpy = vi.spyOn(passwords, 'verifyPasswordSecurely');
    const caller = appRouter.createCaller(loginContext(server));

    const dummyHash = await passwords.getDummyPasswordHash();
    verifySpy.mockClear();

    await expect(
      caller.auth.login({ email: 'nobody@nowhere.invalid', password: 'whatever' })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(verifySpy).toHaveBeenCalledWith(dummyHash, 'whatever');
  });

  it('invokes verifyPasswordSecurely on the disabled-user branch with the stored hash, not the dummy', async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    // Disable the seeded admin to exercise the isActive=false branch.
    const seededAdmin = await server.db
      .select()
      .from(users)
      .where(eq(users.role, 'admin'))
      .get();
    if (!seededAdmin) throw new Error('expected a seeded admin user');
    await server.db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, seededAdmin.id));

    const verifySpy = vi.spyOn(passwords, 'verifyPasswordSecurely');
    const dummyHash = await passwords.getDummyPasswordHash();
    verifySpy.mockClear();

    const caller = appRouter.createCaller(loginContext(server));
    await expect(
      caller.auth.login({ email: seededAdmin.email, password: 'AnythingP@ss1' })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    // The disabled branch must still pay the Argon2 cost — and it must
    // do so against the user's real stored hash (which is what an
    // attacker would observe as a uniform delay), not the dummy hash.
    expect(verifySpy).toHaveBeenCalledTimes(1);
    const [storedHashArg] = verifySpy.mock.calls[0]!;
    expect(storedHashArg).toBe(seededAdmin.passwordHash);
    expect(storedHashArg).not.toBe(dummyHash);
  });
});
