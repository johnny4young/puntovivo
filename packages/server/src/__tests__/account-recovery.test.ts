import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import {
  accountRecoveryCodes,
  auditLogs,
  authRefreshFamilies,
  tenants,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { hashPasswordSecurely, verifyPasswordSecurely } from '../security/passwords.js';
import { generateRecoveryCode, normalizeRecoveryCode } from '../security/accountRecovery.js';
import { __resetForTests as resetLoginRateLimit } from '../security/loginRateLimit.js';

const OLD_PASSWORD = 'OldOwnerPassword42!';
const NEW_PASSWORD = 'FreshOwnerPassword42!';

let server: PuntovivoServer;
let tenantId: string;

type TestUser = { id: string; email: string; role: NonNullable<Context['user']>['role'] };

function context(user?: TestUser): Context {
  const sessionUser = user ? { ...user, tenantId } : null;
  return {
    req: {
      server: server.app,
      headers: {},
      ip: '127.0.0.1',
      user: sessionUser && { ...sessionUser, userId: sessionUser.id },
      jwtVerify: async () => {
        if (!sessionUser) throw new Error('No token');
      },
    } as unknown as Context['req'],
    res: {} as unknown as Context['res'],
    db: server.db,
    user: sessionUser,
    tenantId: sessionUser?.tenantId ?? null,
    siteId: null,
  };
}

async function insertUser(overrides: { role?: TestUser['role'] } = {}): Promise<TestUser> {
  const id = nanoid();
  const row = {
    id,
    tenantId,
    email: `${id.toLowerCase()}@example.com`,
    name: 'Store Owner',
    passwordHash: await hashPasswordSecurely(OLD_PASSWORD),
    role: overrides.role ?? 'admin',
    isActive: true,
  };
  server.db.insert(users).values(row).run();
  return { id, email: row.email, role: row.role };
}

function clearIdentities() {
  server.db.delete(accountRecoveryCodes).run();
  server.db.delete(authRefreshFamilies).run();
  server.db.delete(auditLogs).run();
  server.db.delete(users).run();
}

async function passwordIs(userId: string, password: string): Promise<boolean> {
  const row = server.db.select().from(users).where(eq(users.id, userId)).get()!;
  return verifyPasswordSecurely(row.passwordHash, password);
}

function auditActions(): string[] {
  return server.db
    .select({ action: auditLogs.action })
    .from(auditLogs)
    .all()
    .map(row => row.action);
}

async function expectErrorCode(promise: Promise<unknown>, errorCode: string) {
  await expect(promise).rejects.toMatchObject({ cause: { errorCode } });
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', seedData: false, verbose: false });
  tenantId = nanoid();
  server.db
    .insert(tenants)
    .values({ id: tenantId, name: 'Recovery Store', slug: `recovery-${tenantId}`, settings: {} })
    .run();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  resetLoginRateLimit(server.db);
  clearIdentities();
});

describe('recovery code format', () => {
  it('prints four groups of five unambiguous characters', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
    expect(generateRecoveryCode()).not.toBe(code);
  });

  it('folds separators, case and look-alike letters into one canonical form', () => {
    expect(normalizeRecoveryCode(' ab0o1-il2c3 ')).toBe('AB001112C3');
  });
});

describe('auth.generateRecoveryCode', () => {
  it('stores only a hash and reports the code as configured', async () => {
    const owner = await insertUser();
    const caller = appRouter.createCaller(context(owner));

    expect(await caller.auth.recoveryCodeStatus()).toEqual({ configured: false, createdAt: null });
    const { code } = await caller.auth.generateRecoveryCode({ currentPassword: OLD_PASSWORD });

    const stored = server.db.select().from(accountRecoveryCodes).get()!;
    expect(stored.codeHash).not.toContain(normalizeRecoveryCode(code));
    expect(await verifyPasswordSecurely(stored.codeHash, normalizeRecoveryCode(code))).toBe(true);
    expect((await caller.auth.recoveryCodeStatus()).configured).toBe(true);
    expect(auditActions()).toEqual(['auth.recovery_code.generated']);
  });

  it('replaces the previous code when regenerated', async () => {
    const owner = await insertUser();
    const caller = appRouter.createCaller(context(owner));
    const first = await caller.auth.generateRecoveryCode({ currentPassword: OLD_PASSWORD });
    await caller.auth.generateRecoveryCode({ currentPassword: OLD_PASSWORD });

    expect(server.db.select().from(accountRecoveryCodes).all()).toHaveLength(1);
    await expectErrorCode(
      appRouter.createCaller(context()).auth.recoverWithCode({
        email: owner.email,
        recoveryCode: first.code,
        newPassword: NEW_PASSWORD,
      }),
      'AUTH_RECOVERY_INVALID'
    );
  });

  it('requires the current password', async () => {
    const owner = await insertUser();
    await expectErrorCode(
      appRouter
        .createCaller(context(owner))
        .auth.generateRecoveryCode({ currentPassword: 'WrongPassword42!' }),
      'AUTH_CURRENT_PASSWORD_INCORRECT'
    );
    expect(server.db.select().from(accountRecoveryCodes).all()).toHaveLength(0);
  });

  it('is limited to admins', async () => {
    const cashier = await insertUser({ role: 'cashier' });
    await expect(
      appRouter
        .createCaller(context(cashier))
        .auth.generateRecoveryCode({ currentPassword: OLD_PASSWORD })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('auth.recoverWithCode', () => {
  async function ownerWithCode() {
    const owner = await insertUser();
    const { code } = await appRouter
      .createCaller(context(owner))
      .auth.generateRecoveryCode({ currentPassword: OLD_PASSWORD });
    server.db
      .insert(authRefreshFamilies)
      .values({
        id: nanoid(),
        tenantId,
        userId: owner.id,
        currentJti: nanoid(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
      .run();
    return { owner, code };
  }

  it('sets the new password, consumes the code and ends old sessions', async () => {
    const { owner, code } = await ownerWithCode();
    const before = server.db.select().from(users).where(eq(users.id, owner.id)).get()!;

    await appRouter.createCaller(context()).auth.recoverWithCode({
      email: owner.email.toUpperCase(),
      recoveryCode: code.toLowerCase().replaceAll('-', ' '),
      newPassword: NEW_PASSWORD,
    });

    expect(await passwordIs(owner.id, NEW_PASSWORD)).toBe(true);
    expect(await passwordIs(owner.id, OLD_PASSWORD)).toBe(false);
    const after = server.db.select().from(users).where(eq(users.id, owner.id)).get()!;
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    expect(server.db.select().from(accountRecoveryCodes).all()).toHaveLength(0);
    expect(server.db.select().from(authRefreshFamilies).all()).toHaveLength(0);
    expect(auditActions()).toContain('auth.recovered_with_code');

    const login = await appRouter
      .createCaller(context())
      .auth.login({ email: owner.email, password: NEW_PASSWORD });
    expect(login.user.id).toBe(owner.id);
  });

  it('answers wrong codes, unknown emails and codeless accounts identically', async () => {
    const { owner } = await ownerWithCode();
    const codeless = await insertUser();
    const caller = appRouter.createCaller(context());
    for (const attempt of [
      { email: owner.email, recoveryCode: generateRecoveryCode() },
      { email: 'nobody@example.com', recoveryCode: generateRecoveryCode() },
      { email: codeless.email, recoveryCode: generateRecoveryCode() },
    ]) {
      await expectErrorCode(
        caller.auth.recoverWithCode({ ...attempt, newPassword: NEW_PASSWORD }),
        'AUTH_RECOVERY_INVALID'
      );
    }
    expect(await passwordIs(owner.id, OLD_PASSWORD)).toBe(true);
  });

  it('refuses a deactivated or demoted account even with the right code', async () => {
    const { owner, code } = await ownerWithCode();
    server.db.update(users).set({ role: 'cashier' }).where(eq(users.id, owner.id)).run();
    await expectErrorCode(
      appRouter.createCaller(context()).auth.recoverWithCode({
        email: owner.email,
        recoveryCode: code,
        newPassword: NEW_PASSWORD,
      }),
      'AUTH_RECOVERY_INVALID'
    );
    server.db
      .update(users)
      .set({ role: 'admin', isActive: false })
      .where(eq(users.id, owner.id))
      .run();
    await expectErrorCode(
      appRouter.createCaller(context()).auth.recoverWithCode({
        email: owner.email,
        recoveryCode: code,
        newPassword: NEW_PASSWORD,
      }),
      'AUTH_RECOVERY_INVALID'
    );
  });

  it('enforces the password policy before spending an attempt', async () => {
    const { owner, code } = await ownerWithCode();
    await expect(
      appRouter.createCaller(context()).auth.recoverWithCode({
        email: owner.email,
        recoveryCode: code,
        newPassword: 'short',
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(server.db.select().from(accountRecoveryCodes).all()).toHaveLength(1);
  });

  it('locks the email after repeated wrong codes without touching login attempts', async () => {
    const { owner, code } = await ownerWithCode();
    const caller = appRouter.createCaller(context());
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectErrorCode(
        caller.auth.recoverWithCode({
          email: owner.email,
          recoveryCode: generateRecoveryCode(),
          newPassword: NEW_PASSWORD,
        }),
        'AUTH_RECOVERY_INVALID'
      );
    }
    await expect(
      caller.auth.recoverWithCode({
        email: owner.email,
        recoveryCode: code,
        newPassword: NEW_PASSWORD,
      })
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    const login = await caller.auth.login({ email: owner.email, password: OLD_PASSWORD });
    expect(login.user.id).toBe(owner.id);
  });

  it('is reachable over HTTP before any session exists', async () => {
    const { owner, code } = await ownerWithCode();
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/trpc/auth.recoverWithCode?batch=1',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        '0': { email: owner.email, recoveryCode: code, newPassword: NEW_PASSWORD },
      }),
    });
    expect(response.statusCode).toBe(200);
    expect(await passwordIs(owner.id, NEW_PASSWORD)).toBe(true);
  });
});

describe('local owner recovery', () => {
  it('is available only to a sole active admin without a recovery code', async () => {
    expect(server.localOwnerRecovery.isAvailable()).toBe(false);
    const owner = await insertUser();
    expect(server.localOwnerRecovery.isAvailable()).toBe(true);

    const cashier = await insertUser({ role: 'cashier' });
    expect(server.localOwnerRecovery.isAvailable()).toBe(false);
    server.db.update(users).set({ isActive: false }).where(eq(users.id, cashier.id)).run();
    expect(server.localOwnerRecovery.isAvailable()).toBe(true);

    await appRouter
      .createCaller(context(owner))
      .auth.generateRecoveryCode({ currentPassword: OLD_PASSWORD });
    expect(server.localOwnerRecovery.isAvailable()).toBe(false);
  });

  it('is unavailable when the only active user is not an admin', async () => {
    await insertUser({ role: 'manager' });
    expect(server.localOwnerRecovery.isAvailable()).toBe(false);
  });

  it('resets the owner password and records the audit row', async () => {
    const owner = await insertUser();
    await expect(
      server.localOwnerRecovery.recover({ email: owner.email, newPassword: NEW_PASSWORD })
    ).resolves.toEqual({ recovered: true });

    expect(await passwordIs(owner.id, NEW_PASSWORD)).toBe(true);
    const audit = server.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'auth.owner_recovered_locally')))
      .get();
    expect(audit).toMatchObject({ actorId: owner.id, resourceId: owner.id, tenantId });
  });

  it('rejects another email, a weak password and ineligible installations', async () => {
    const owner = await insertUser();
    await expectErrorCode(
      server.localOwnerRecovery.recover({
        email: 'someone@example.com',
        newPassword: NEW_PASSWORD,
      }),
      'AUTH_LOCAL_RECOVERY_EMAIL_MISMATCH'
    );
    await expectErrorCode(
      server.localOwnerRecovery.recover({ email: owner.email, newPassword: 'weak' }),
      'AUTH_PASSWORD_POLICY'
    );
    await insertUser({ role: 'cashier' });
    await expectErrorCode(
      server.localOwnerRecovery.recover({ email: owner.email, newPassword: NEW_PASSWORD }),
      'AUTH_LOCAL_RECOVERY_UNAVAILABLE'
    );
    expect(await passwordIs(owner.id, OLD_PASSWORD)).toBe(true);
  });
});
