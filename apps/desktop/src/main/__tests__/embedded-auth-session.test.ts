import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { createServer, verifyTokenWithServer, type PuntovivoServer } from '@puntovivo/server';
import { createHubAuthSession, HubAuthRemoteError } from '../session/hub-auth-session.ts';
import { createEmbeddedAuthFetch, EMBEDDED_AUTH_ORIGIN } from '../session/embedded-auth-fetch.ts';

describe('embedded main-memory auth custody', () => {
  it('refuses arbitrary targets, procedures and methods before touching an authority', async () => {
    const fetchAuth = createEmbeddedAuthFetch(() => {
      throw new Error('must not access server');
    });
    for (const target of [
      'https://other.example/api/trpc/auth.login',
      `${EMBEDDED_AUTH_ORIGIN}/api/trpc/sales.create`,
      `${EMBEDDED_AUTH_ORIGIN}/api/trpc/auth.login,sales.create`,
    ]) {
      await assert.rejects(fetchAuth(target, { method: 'POST' }), /not allowed/);
    }
    await assert.rejects(
      fetchAuth(`${EMBEDDED_AUTH_ORIGIN}/api/trpc/auth.login`, { method: 'DELETE' }),
      /not allowed/
    );
    assert.equal(
      (
        await createEmbeddedAuthFetch(() => null)(`${EMBEDDED_AUTH_ORIGIN}/api/trpc/auth.refresh`, {
          method: 'POST',
        })
      ).status,
      503
    );
  });

  it('returns null-body statuses without a body', async () => {
    const server = {
      app: { inject: async () => ({ statusCode: 204, body: '', headers: {} }) },
    } as unknown as PuntovivoServer;
    const response = await createEmbeddedAuthFetch(() => server)(
      `${EMBEDDED_AUTH_ORIGIN}/api/trpc/auth.logout`,
      { method: 'POST' }
    );
    assert.equal(response.status, 204);
    assert.equal(response.body, null);
  });

  it('renews after the unchanged access TTL, shares rotation and rejects revocation', async t => {
    const fixturePassword = `Aa!${randomUUID()}`;
    const previous = process.env.PUNTOVIVO_DEV_ADMIN_PASSWORD;
    process.env.PUNTOVIVO_DEV_ADMIN_PASSWORD = fixturePassword;
    const server = await (async () => {
      try {
        return await createServer({ dbPath: ':memory:', verbose: false });
      } finally {
        if (previous === undefined) delete process.env.PUNTOVIVO_DEV_ADMIN_PASSWORD;
        else process.env.PUNTOVIVO_DEV_ADMIN_PASSWORD = previous;
      }
    })();
    let refreshCalls = 0;
    const injectAuth = createEmbeddedAuthFetch(() => server);
    const auth = createHubAuthSession({
      hubUrl: EMBEDDED_AUTH_ORIGIN,
      credentialPersistence: 'memory',
      fetchImpl: async (input, init) => {
        if (String(input).includes('/auth.refresh')) refreshCalls++;
        return injectAuth(input, init);
      },
    });
    try {
      const login = await auth.login({ email: 'admin@localhost', password: fixturePassword });
      const claims = JSON.parse(Buffer.from(login.token.split('.')[1]!, 'base64url').toString());
      assert.equal(claims.exp - claims.iat, 15 * 60);
      assert.ok(await verifyTokenWithServer(server.app, login.token, 'access'));
      t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
      t.mock.timers.tick(15 * 60 * 1000 + 1000);
      assert.equal(await verifyTokenWithServer(server.app, login.token, 'access'), null);
      const grants = await Promise.all([auth.refresh(), auth.refresh(), auth.refresh()]);
      assert.equal(refreshCalls, 1);
      assert.equal(grants[0]!.token, grants[1]!.token);
      assert.ok(await verifyTokenWithServer(server.app, grants[0]!.token, 'access'));
      // An app restart cannot restore a memory-only renewable credential.
      const restarted = createHubAuthSession({
        hubUrl: EMBEDDED_AUTH_ORIGIN,
        credentialPersistence: 'memory',
        fetchImpl: injectAuth,
      });
      await assert.rejects(restarted.refresh(), /session is missing/);
      (server.db as typeof server.db & { $client: import('better-sqlite3').Database }).$client
        .prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?')
        .run(claims.userId);
      await assert.rejects(auth.refresh(), /invalid|expired|revoked|session/i);
      await assert.rejects(auth.refresh(), /session is missing/);
      // Native logout does not pass through the renderer's automatic HTTP retry.
      // It must still commit server revocation after an idle access-token expiry.
      await auth.login({ email: 'admin@localhost', password: fixturePassword });
      t.mock.timers.tick(15 * 60 * 1000 + 1000);
      await assert.rejects(
        auth.switchStaff({ targetUserId: 'missing-cashier', pin: '000000' }),
        error => error instanceof HubAuthRemoteError && error.errorCode === 'AUTH_STAFF_PIN_INVALID'
      );
      t.mock.timers.tick(15 * 60 * 1000 + 1000);
      await auth.logout();
      const families = (
        server.db as typeof server.db & { $client: import('better-sqlite3').Database }
      ).$client
        .prepare('SELECT count(*) AS count FROM auth_refresh_families WHERE user_id = ?')
        .get(claims.userId) as { count: number };
      assert.equal(families.count, 0);
      await assert.rejects(auth.refresh(), /session is missing/);
    } finally {
      t.mock.timers.reset();
      auth.clear();
      await server.close();
    }
  });
});
