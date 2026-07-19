import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  register,
  clear,
  peek,
  requireTenantId,
  requireUserId,
  requireRole,
  requireOneOfRoles,
  matchesTenant,
  describe as describeSession,
  __resetForTests,
  SESSION_NOT_REGISTERED,
  SESSION_REGISTER_REJECTED,
  SESSION_ROLE_FORBIDDEN,
  type AccessTokenVerifier,
} from '../session/desktopSession.ts';

type VerifiedPayload = NonNullable<Awaited<ReturnType<AccessTokenVerifier>>>;

// ENG-025 vector 1 regression pin. These assertions encode the
// multi-tenant boundary at the IPC layer: until `register()` succeeds
// with a token whose JWT verifies, the session singleton MUST refuse
// to surface a tenantId / userId / role to the IPC handlers. Any edit
// that weakens these contracts is a security regression.

const sampleAdminPayload = {
  userId: 'user-admin-1',
  tenantId: 'tenant-default',
  email: 'admin@puntovivo.test',
  role: 'admin' as const,
  sessionVersion: 7,
  tokenType: 'access' as const,
} satisfies VerifiedPayload;

const sampleCashierPayload = {
  userId: 'user-cashier-9',
  tenantId: 'tenant-other',
  email: 'cashier@puntovivo.test',
  role: 'cashier' as const,
  sessionVersion: 1,
  tokenType: 'access' as const,
} satisfies VerifiedPayload;

const acceptVerifier =
  (payload: VerifiedPayload): AccessTokenVerifier =>
  async () =>
    payload;

const rejectVerifier: AccessTokenVerifier = async () => null;

describe('desktopSession (ENG-025 vector 1)', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('starts unregistered and rejects requireTenantId', () => {
    assert.equal(peek(), null);
    assert.deepEqual(describeSession(), { registered: false });
    assert.throws(() => requireTenantId(), { message: SESSION_NOT_REGISTERED });
    assert.throws(() => requireUserId(), { message: SESSION_NOT_REGISTERED });
    assert.throws(() => requireRole(), { message: SESSION_NOT_REGISTERED });
  });

  it('register() with an empty token throws SESSION_REGISTER_REJECTED', async () => {
    await assert.rejects(register('', acceptVerifier(sampleAdminPayload)), {
      message: SESSION_REGISTER_REJECTED,
    });
    assert.equal(peek(), null);
  });

  it('register() with a verifier that returns null throws SESSION_REGISTER_REJECTED', async () => {
    await assert.rejects(register('any-non-empty-token', rejectVerifier), {
      message: SESSION_REGISTER_REJECTED,
    });
    assert.equal(peek(), null);
  });

  it('register() with a valid payload stores the identity and exposes it via require*', async () => {
    await register('valid-token', acceptVerifier(sampleAdminPayload));
    assert.equal(requireTenantId(), 'tenant-default');
    assert.equal(requireUserId(), 'user-admin-1');
    assert.equal(requireRole(), 'admin');
    assert.equal(requireOneOfRoles(['admin']), 'admin');
    assert.equal(matchesTenant('tenant-default'), true);
    assert.equal(matchesTenant('tenant-other'), false);
    assert.equal(matchesTenant(null), false);
    assert.equal(matchesTenant(''), false);
    const summary = describeSession();
    assert.equal(summary.registered, true);
    assert.equal(summary.tenantId, 'tenant-default');
    assert.equal(summary.role, 'admin');
  });

  it('clear() drops the identity and require* throws again', async () => {
    await register('valid-token', acceptVerifier(sampleAdminPayload));
    clear();
    assert.equal(peek(), null);
    assert.throws(() => requireTenantId(), { message: SESSION_NOT_REGISTERED });
  });

  it('register() can swap identities (re-login as a different user)', async () => {
    await register('valid-token-admin', acceptVerifier(sampleAdminPayload));
    assert.equal(requireUserId(), 'user-admin-1');
    await register('valid-token-cashier', acceptVerifier(sampleCashierPayload));
    assert.equal(requireUserId(), 'user-cashier-9');
    assert.equal(requireTenantId(), 'tenant-other');
    assert.equal(requireRole(), 'cashier');
    assert.throws(() => requireOneOfRoles(['admin', 'manager']), {
      message: SESSION_ROLE_FORBIDDEN,
    });
  });

  it('peek() returns a defensive copy — mutating it does not leak into the singleton', async () => {
    await register('valid-token', acceptVerifier(sampleAdminPayload));
    const snapshot = peek();
    assert.ok(snapshot);
    // Mutating the snapshot must not affect subsequent peek() / require* calls.
    (snapshot as { tenantId: string }).tenantId = 'tampered';
    assert.equal(requireTenantId(), 'tenant-default');
    const fresh = peek();
    assert.equal(fresh?.tenantId, 'tenant-default');
  });

  it('matchesTenant() correctly distinguishes the active tenant', async () => {
    assert.equal(matchesTenant('anything'), false); // no session yet
    await register('valid-token', acceptVerifier(sampleAdminPayload));
    assert.equal(matchesTenant('tenant-default'), true);
    assert.equal(matchesTenant('tenant-default-2'), false);
    assert.equal(matchesTenant(undefined), false);
  });

  it('describe() never returns the raw token, only identity claims', async () => {
    await register('a-very-secret-token-string', acceptVerifier(sampleAdminPayload));
    const summary = describeSession();
    assert.equal(summary.registered, true);
    assert.equal(summary.userId, 'user-admin-1');
    assert.equal(summary.tenantId, 'tenant-default');
    assert.equal(summary.role, 'admin');
    // No raw token / sessionVersion in the audit summary.
    assert.equal((summary as Record<string, unknown>).accessToken, undefined);
    assert.equal((summary as Record<string, unknown>).sessionVersion, undefined);
  });

  it('register() invokes the verifier with the supplied access token verbatim', async () => {
    let seen: string | null = null;
    const captureVerifier: AccessTokenVerifier = async token => {
      seen = token;
      return sampleAdminPayload;
    };
    await register('exact-token-value', captureVerifier);
    assert.equal(seen, 'exact-token-value');
  });
});
