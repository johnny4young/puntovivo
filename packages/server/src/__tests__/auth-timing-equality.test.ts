/**
 * pins the login timing equaliser. The not-found branch must
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
import * as staffPins from '../security/staffPins.js';
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
    const seededAdmin = await server.db.select().from(users).where(eq(users.role, 'admin')).get();
    if (!seededAdmin) throw new Error('expected a seeded admin user');
    await server.db.update(users).set({ isActive: false }).where(eq(users.id, seededAdmin.id));

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

  it('boots without waiting for the equalizers and warms both once listening', async () => {
    let releasePasswords!: () => void;
    const warmPasswords = vi.spyOn(passwords, 'warmUpPasswordSecurity').mockReturnValue(
      new Promise<void>(resolve => {
        releasePasswords = resolve;
      })
    );
    const warmPins = vi.spyOn(staffPins, 'warmUpStaffPinSecurity').mockResolvedValue();

    server = await createServer({
      dbPath: ':memory:',
      verbose: false,
      runtime: {
        authorityMode: 'device_local',
        bindHost: '127.0.0.1',
        bindPort: 0,
        hubUrl: null,
        siteId: 'timing-equalizer-warmup',
        deviceId: null,
        allowedLanOrigins: [],
      },
    });
    expect(warmPasswords).not.toHaveBeenCalled();

    await server.listen();
    expect(warmPasswords).toHaveBeenCalledOnce();
    expect(warmPins).not.toHaveBeenCalled();
    releasePasswords();
    await vi.waitFor(() => expect(warmPins).toHaveBeenCalledOnce());
  });

  it('lets close wait for a running warm-up and skips the one after it', async () => {
    const settled: string[] = [];
    let releasePasswords!: () => void;
    vi.spyOn(passwords, 'warmUpPasswordSecurity').mockReturnValue(
      new Promise<void>(resolve => {
        releasePasswords = resolve;
      }).then(() => {
        settled.push('warm-up');
      })
    );
    const warmPins = vi.spyOn(staffPins, 'warmUpStaffPinSecurity').mockResolvedValue();

    server = await createServer({
      dbPath: ':memory:',
      verbose: false,
      runtime: {
        authorityMode: 'device_local',
        bindHost: '127.0.0.1',
        bindPort: 0,
        hubUrl: null,
        siteId: 'timing-equalizer-shutdown',
        deviceId: null,
        allowedLanOrigins: [],
      },
    });
    await server.listen();
    const closing = server.close().then(() => {
      settled.push('close');
    });
    try {
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(settled).toEqual([]);
    } finally {
      releasePasswords();
    }
    await closing;
    server = null;
    expect(settled).toEqual(['warm-up', 'close']);
    expect(warmPins).not.toHaveBeenCalled();
  });

  it('makes a known email wait for the same equalizer as an unknown one', async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const seededAdmin = await server.db.select().from(users).where(eq(users.role, 'admin')).get();
    if (!seededAdmin) throw new Error('expected a seeded admin user');
    const dummyHash = await passwords.getDummyPasswordHash();
    let releaseEqualizer!: (hash: string) => void;
    vi.spyOn(passwords, 'getDummyPasswordHash').mockReturnValue(
      new Promise(resolve => {
        releaseEqualizer = resolve;
      })
    );
    const verifySpy = vi.spyOn(passwords, 'verifyPasswordSecurely');

    const caller = appRouter.createCaller(loginContext(server));
    const login = caller.auth.login({ email: seededAdmin.email, password: 'AnythingP@ss1' });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(verifySpy).not.toHaveBeenCalled();

    releaseEqualizer(dummyHash);
    await expect(login).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(verifySpy).toHaveBeenCalledWith(seededAdmin.passwordHash, 'AnythingP@ss1');
  });

  it('retries an equalizer hash that failed instead of caching the failure', async () => {
    vi.resetModules();
    const real = await vi.importActual<typeof import('argon2')>('argon2');
    let failures = 2;
    vi.doMock('argon2', () => ({
      ...real,
      hash: (...args: Parameters<typeof real.hash>) =>
        failures-- > 0 ? Promise.reject(new Error('out of memory')) : real.hash(...args),
    }));
    const freshPasswords = await import('../security/passwords.js');
    const freshPins = await import('../security/staffPins.js');

    await expect(freshPasswords.getDummyPasswordHash()).rejects.toThrow('out of memory');
    await expect(freshPins.getDummyStaffPinHash()).rejects.toThrow('out of memory');
    vi.doUnmock('argon2');
    await expect(freshPasswords.getDummyPasswordHash()).resolves.toMatch(/^\$argon2id\$/);
    await expect(freshPins.getDummyStaffPinHash()).resolves.toMatch(/^\$argon2id\$/);
  });
});
