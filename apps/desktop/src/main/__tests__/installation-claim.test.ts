import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInstallationClaimHandler } from '../session/installation-claim.ts';

type Dependencies = Parameters<typeof createInstallationClaimHandler>[0];
function fixture(overrides: Partial<Dependencies> = {}) {
  const frame = { url: 'puntovivo-app://app/index.html#/login' };
  const sender = { isDestroyed: () => false, mainFrame: frame };
  const window = { isDestroyed: () => false, webContents: sender };
  const event = { sender, senderFrame: frame };
  const calls: unknown[] = [];
  const server = {
    getSetupToken: () => 'b'.repeat(64),
    app: {
      inject: async (input: unknown) => {
        calls.push(input);
        return { statusCode: 200, json: () => [{ result: { data: { created: true } } }] };
      },
    },
  };
  const deps: Dependencies = {
    getMainWindow: () => window,
    getServer: () => server as unknown as ReturnType<Dependencies['getServer']>,
    isHubClient: false,
    isDev: false,
    webDevServerUrl: 'http://localhost:3000',
    ...overrides,
  };
  return {
    frame,
    sender,
    window,
    event,
    calls,
    server,
    handler: createInstallationClaimHandler(deps),
  };
}

test('dispatches only the fixed tRPC claim, with main-owned token and matched CSRF', async () => {
  const f = fixture();
  assert.deepEqual(await f.handler(f.event, { ownerName: 'Owner', token: 'spoof' }), { ok: true });
  assert.equal(f.calls.length, 1);
  const request = f.calls[0] as {
    url: string;
    payload: { '0': { token: string; ownerName: string } };
    headers: Record<string, string>;
    cookies: Record<string, string>;
  };
  assert.equal(request.url, '/api/trpc/auth.completeSetup?batch=1');
  assert.equal(request.payload['0'].token, 'b'.repeat(64));
  assert.equal(request.payload['0'].ownerName, 'Owner');
  assert.equal(request.headers['x-csrf-token'], request.cookies.puntovivo_csrf);
  assert.match(request.headers['x-csrf-token']!, /^[a-z0-9_-]{43}$/i);
});

for (const mode of [
  'hub',
  'no window',
  'destroyed window',
  'destroyed sender',
  'auxiliary',
  'subframe',
  'navigated',
  'foreign packaged host',
  'packaged auxiliary path',
] as const) {
  test(`denies ${mode} before looking up a server or dispatching`, async () => {
    const f = fixture({
      ...(mode === 'hub' ? { isHubClient: true } : {}),
      ...(mode === 'no window' ? { getMainWindow: () => null } : {}),
      getServer: () => {
        throw new Error('must not access server');
      },
    });
    if (mode === 'destroyed window') f.window.isDestroyed = () => true;
    if (mode === 'destroyed sender') f.sender.isDestroyed = () => true;
    if (mode === 'auxiliary') f.event.sender = { ...f.sender };
    if (mode === 'subframe') f.event.senderFrame = { ...f.frame };
    if (mode === 'navigated') f.frame.url = 'https://attacker.example/';
    if (mode === 'foreign packaged host') f.frame.url = 'puntovivo-app://other/index.html';
    if (mode === 'packaged auxiliary path') f.frame.url = 'puntovivo-app://app/customer.html';
    assert.deepEqual(await f.handler(f.event, {}), {
      ok: false,
      errorCode: 'SETUP_LOCAL_ACCESS_REQUIRED',
    });
    assert.equal(f.calls.length, 0);
  });
}

test('development accepts only its configured loopback origin', async () => {
  const f = fixture({ isDev: true });
  f.frame.url = 'http://localhost:3000/login';
  assert.deepEqual(await f.handler(f.event, {}), { ok: true });
  f.frame.url = 'http://localhost:3001/login';
  assert.deepEqual(await f.handler(f.event, {}), {
    ok: false,
    errorCode: 'SETUP_LOCAL_ACCESS_REQUIRED',
  });
});

test('missing server, completed claim and invalid input return safe errors', async () => {
  const f = fixture({ getServer: () => null });
  assert.deepEqual(await f.handler(f.event, {}), {
    ok: false,
    errorCode: 'SETUP_ALREADY_COMPLETED',
  });
  const live = fixture();
  for (const invalid of [null, [], 'string'])
    assert.deepEqual(await live.handler(live.event, invalid), {
      ok: false,
      errorCode: 'VALIDATION_ERROR',
    });
  live.server.getSetupToken = () => null as unknown as string;
  assert.deepEqual(await live.handler(live.event, {}), {
    ok: false,
    errorCode: 'SETUP_ALREADY_COMPLETED',
  });
});

test('catches dispatch and parse failures without leaking native invoke details', async () => {
  const f = fixture();
  f.server.app.inject = async () => {
    throw new Error('SECRET /Users/owner/database.db');
  };
  assert.deepEqual(await f.handler(f.event, {}), { ok: false, errorCode: 'INTERNAL_SERVER_ERROR' });
  f.server.app.inject = async () => ({
    statusCode: 200,
    json: () => {
      throw new Error('SECRET');
    },
  });
  assert.deepEqual(await f.handler(f.event, {}), { ok: false, errorCode: 'INTERNAL_SERVER_ERROR' });
});

test('forwards only safe setup codes, not HTTP messages or stacks', async () => {
  const f = fixture();
  f.server.app.inject = async () =>
    ({
      statusCode: 429,
      json: () => [{ error: { message: 'SECRET', data: { errorCode: 'SETUP_BUSY' } } }],
    }) as never;
  assert.deepEqual(await f.handler(f.event, {}), { ok: false, errorCode: 'SETUP_BUSY' });
  f.server.app.inject = async () =>
    ({
      statusCode: 500,
      json: () => [{ error: { message: 'SECRET', data: { errorCode: 'SECRET' } } }],
    }) as never;
  assert.deepEqual(await f.handler(f.event, {}), { ok: false, errorCode: 'INTERNAL_SERVER_ERROR' });
});

test('contains structured-clone cyclic input when JSON transport cannot serialize it', async () => {
  const f = fixture();
  f.server.app.inject = async input => {
    JSON.stringify((input as { payload: unknown }).payload);
    return { statusCode: 200, json: () => [{ result: { data: { created: true } } }] };
  };
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.deepEqual(await f.handler(f.event, cyclic), {
    ok: false,
    errorCode: 'INTERNAL_SERVER_ERROR',
  });
});

test('contains capability lookup failure during database teardown', async () => {
  const f = fixture();
  f.server.getSetupToken = () => {
    throw new Error('database connection is closed: private path');
  };
  assert.deepEqual(await f.handler(f.event, {}), { ok: false, errorCode: 'INTERNAL_SERVER_ERROR' });
  assert.equal(f.calls.length, 0);
});
