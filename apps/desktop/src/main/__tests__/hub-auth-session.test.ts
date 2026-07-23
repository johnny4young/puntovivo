import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '@puntovivo/server';
import {
  createHubAuthSession,
  HUB_AUTH_STATE_FILE,
  normalizeHubAuthUrl,
} from '../session/hub-auth-session.ts';
import type { SafeStorageLike } from '../db-key-store.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

function tempStatePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'puntovivo-hub-auth-'));
  tempDirs.push(dir);
  return join(dir, HUB_AUTH_STATE_FILE);
}

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: plain => Buffer.from(`sealed:${Buffer.from(plain).toString('base64')}`),
  decryptString: sealed => {
    const value = sealed.toString();
    if (!value.startsWith('sealed:')) throw new Error('invalid test envelope');
    return Buffer.from(value.slice('sealed:'.length), 'base64').toString();
  },
  getSelectedStorageBackend: () => 'gnome_libsecret',
};

function accessToken(sessionVersion: number): string {
  return `header.${Buffer.from(
    JSON.stringify({
      userId: 'user-1',
      tenantId: 'tenant-1',
      email: 'admin@example.test',
      role: 'admin',
      sessionVersion,
    })
  ).toString('base64url')}.signature`;
}

function successResponse(data: unknown, cookies?: { refresh: string; csrf?: string }): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (cookies) {
    headers.append(
      'set-cookie',
      `puntovivo_refresh=${cookies.refresh}; Path=/; HttpOnly${
        cookies.csrf ? `, puntovivo_csrf=${cookies.csrf}; Path=/` : ''
      }`
    );
  }
  return new Response(JSON.stringify([{ result: { data } }]), { status: 200, headers });
}

function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify([
      {
        error: {
          json: {
            message: 'Refresh session is invalid or missing',
            data: {
              code: 'UNAUTHORIZED',
              errorCode: 'AUTH_REFRESH_INVALID',
              httpStatus: 401,
            },
          },
        },
      },
    ]),
    { status: 401, headers: { 'content-type': 'application/json' } }
  );
}

describe('Store Hub main-process auth custody', () => {
  it('requires HTTPS outside loopback development', () => {
    assert.equal(normalizeHubAuthUrl('https://hub.example.test/'), 'https://hub.example.test');
    assert.equal(normalizeHubAuthUrl('http://127.0.0.1:8090/', true), 'http://127.0.0.1:8090');
    assert.throws(() => normalizeHubAuthUrl('http://192.168.1.8:8090', true), /must use HTTPS/);
    assert.throws(() => normalizeHubAuthUrl('https://user:pass@hub.example.test'), /credentials/);
  });

  it('seals cookies, restores them after restart, and rotates through one main-process refresh', async () => {
    const statePath = tempStatePath();
    const loginToken = accessToken(4);
    const refreshToken = accessToken(5);
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      successResponse(
        {
          token: loginToken,
          user: {
            id: 'user-1',
            email: 'admin@example.test',
            role: 'admin',
            tenantId: 'tenant-1',
          },
        },
        { refresh: 'refresh-one', csrf: 'csrf-one' }
      ),
      successResponse({ token: refreshToken }, { refresh: 'refresh-two' }),
    ];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), ...(init ? { init } : {}) });
      const response = responses.shift();
      assert.ok(response);
      return response;
    }) as typeof fetch;

    const first = createHubAuthSession({
      hubUrl: 'https://hub.example.test',
      getStatePath: () => statePath,
      safeStorage,
      fetchImpl,
    });
    assert.equal(
      (await first.login({ email: 'admin@example.test', password: 'secret' })).token,
      loginToken
    );
    assert.equal((await first.verifyAccessToken(loginToken))?.tenantId, 'tenant-1');
    assert.equal(await first.verifyAccessToken('renderer-forged-token'), null);
    assert.equal(existsSync(statePath), true);
    assert.equal(readFileSync(statePath, 'utf8').includes('refresh-one'), false);
    if (process.platform !== 'win32') assert.equal(statSync(statePath).mode & 0o777, 0o600);

    const restarted = createHubAuthSession({
      hubUrl: 'https://hub.example.test',
      getStatePath: () => statePath,
      safeStorage,
      fetchImpl,
    });
    assert.equal((await restarted.refresh()).token, refreshToken);
    assert.equal((await restarted.verifyAccessToken(refreshToken))?.sessionVersion, 5);
    const refreshHeaders = new Headers(requests[1]?.init?.headers);
    assert.equal(
      refreshHeaders.get('cookie'),
      'puntovivo_refresh=refresh-one; puntovivo_csrf=csrf-one'
    );
    assert.equal(refreshHeaders.get('x-csrf-token'), 'csrf-one');
    assert.equal(readFileSync(statePath, 'utf8').includes('refresh-two'), false);
  });

  it('deletes a rejected renewable session instead of retrying a dead credential', async () => {
    const statePath = tempStatePath();
    const token = accessToken(1);
    const responses = [
      successResponse(
        {
          token,
          user: {
            id: 'user-1',
            email: 'admin@example.test',
            role: 'admin',
            tenantId: 'tenant-1',
          },
        },
        { refresh: 'refresh-one', csrf: 'csrf-one' }
      ),
      unauthorizedResponse(),
    ];
    const auth = createHubAuthSession({
      hubUrl: 'https://hub.example.test',
      getStatePath: () => statePath,
      safeStorage,
      fetchImpl: (async () => responses.shift()!) as typeof fetch,
    });
    await auth.login({ email: 'admin@example.test', password: 'secret' });
    await assert.rejects(auth.refresh(), /Refresh session is invalid or missing/);
    assert.equal(existsSync(statePath), false);
    assert.equal(await auth.verifyAccessToken(token), null);
  });

  it('replaces an existing sealed state through the Windows-safe rotation path', async () => {
    const statePath = tempStatePath();
    const responses = [
      successResponse(
        {
          token: accessToken(1),
          user: {
            id: 'user-1',
            email: 'admin@example.test',
            role: 'admin',
            tenantId: 'tenant-1',
          },
        },
        { refresh: 'refresh-one', csrf: 'csrf-one' }
      ),
      successResponse({ token: accessToken(2) }, { refresh: 'refresh-two' }),
    ];
    const auth = createHubAuthSession({
      hubUrl: 'https://hub.example.test',
      getStatePath: () => statePath,
      safeStorage,
      platform: 'win32',
      fetchImpl: (async () => responses.shift()!) as typeof fetch,
    });

    await auth.login({ email: 'admin@example.test', password: 'secret' });
    await auth.refresh();

    const state = JSON.parse(safeStorage.decryptString(readFileSync(statePath))) as {
      refreshToken: string;
    };
    assert.equal(state.refreshToken, 'refresh-two');
    assert.equal(existsSync(`${statePath}.tmp`), false);
    assert.equal(existsSync(`${statePath}.bak`), false);
  });

  it('removes unreadable sealed state when logout cannot decrypt it', async () => {
    const statePath = tempStatePath();
    const auth = createHubAuthSession({
      hubUrl: 'https://hub.example.test',
      getStatePath: () => statePath,
      safeStorage,
      fetchImpl: (async () =>
        successResponse(
          {
            token: accessToken(1),
            user: {
              id: 'user-1',
              email: 'admin@example.test',
              role: 'admin',
              tenantId: 'tenant-1',
            },
          },
          { refresh: 'refresh-one', csrf: 'csrf-one' }
        )) as typeof fetch,
    });
    await auth.login({ email: 'admin@example.test', password: 'secret' });
    const unreadable = createHubAuthSession({
      hubUrl: 'https://hub.example.test',
      getStatePath: () => statePath,
      safeStorage: {
        ...safeStorage,
        decryptString: () => {
          throw new Error('keychain reset');
        },
      },
      fetchImpl: (async () => assert.fail('logout must not call the hub')) as typeof fetch,
    });

    await assert.rejects(unreadable.logout(), /failed to decrypt/);
    assert.equal(existsSync(statePath), false);
  });

  it('fails closed when secure storage is unavailable', async () => {
    const auth = createHubAuthSession({
      hubUrl: 'https://hub.example.test',
      getStatePath: tempStatePath,
      safeStorage: { ...safeStorage, isEncryptionAvailable: () => false },
      fetchImpl: (async () =>
        successResponse(
          {
            token: accessToken(1),
            user: {
              id: 'user-1',
              email: 'admin@example.test',
              role: 'admin',
              tenantId: 'tenant-1',
            },
          },
          { refresh: 'refresh-one', csrf: 'csrf-one' }
        )) as typeof fetch,
    });
    await assert.rejects(
      auth.login({ email: 'admin@example.test', password: 'secret' }),
      /OS keychain is unavailable/
    );
  });

  it('renews against the real Fastify tRPC and rotating-cookie contract', async () => {
    const server = await createServer({ dbPath: ':memory:', verbose: false });
    const statePath = tempStatePath();
    let lastRequestHeaders: Record<string, string> = {};
    const injectFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const requestHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      lastRequestHeaders = requestHeaders;
      const response = await server.app.inject({
        method: (init?.method ?? 'GET') as 'GET' | 'POST',
        url: `${url.pathname}${url.search}`,
        headers: requestHeaders,
        ...(typeof init?.body === 'string' ? { payload: init.body } : {}),
      });
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) headers.append(name, item);
        } else if (value !== undefined) {
          headers.append(name, String(value));
        }
      }
      return new Response(response.body, { status: response.statusCode, headers });
    }) as typeof fetch;

    try {
      const first = createHubAuthSession({
        hubUrl: 'https://hub.example.test',
        getStatePath: () => statePath,
        safeStorage,
        fetchImpl: injectFetch,
      });
      const login = await first.login({
        email: 'admin@localhost',
        password: 'Admin123!Dev',
      });
      assert.match(login.token, /^[^.]+\.[^.]+\.[^.]+$/);
      const firstRefreshCredential = JSON.parse(safeStorage.decryptString(readFileSync(statePath)))
        .refreshToken as string;

      const restarted = createHubAuthSession({
        hubUrl: 'https://hub.example.test',
        getStatePath: () => statePath,
        safeStorage,
        fetchImpl: injectFetch,
      });
      const renewed = await restarted.refresh();
      const rotatedRefreshCredential = JSON.parse(
        safeStorage.decryptString(readFileSync(statePath))
      ).refreshToken as string;
      assert.notEqual(rotatedRefreshCredential, firstRefreshCredential);
      assert.equal((await restarted.verifyAccessToken(renewed.token))?.email, 'admin@localhost');
      const proxied = await restarted.request({
        path: '/api/trpc/auth.me?batch=1&input=%7B%7D',
        method: 'GET',
        headers: {
          authorization: `Bearer ${renewed.token}`,
          cookie: 'renderer-cookie-must-not-cross',
          'x-correlation-id': 'hub-proxy-test',
        },
      });
      assert.equal(proxied.status, 200);
      assert.equal(lastRequestHeaders.cookie, undefined);
      assert.equal(lastRequestHeaders['x-correlation-id'], 'hub-proxy-test');
      await assert.rejects(
        restarted.request({ path: '/api/../admin', method: 'GET', headers: {} }),
        /escaped the configured hub/
      );
    } finally {
      await server.close();
    }
  });
});
