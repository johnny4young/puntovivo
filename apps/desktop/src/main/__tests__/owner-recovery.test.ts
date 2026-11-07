import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PuntovivoServer } from '@puntovivo/server';
import { createServerOperations } from '../server-host/operations.ts';
import { createOwnerRecoveryHandlers } from '../session/owner-recovery.ts';

type Dependencies = Parameters<typeof createOwnerRecoveryHandlers>[0];

function fixture(overrides: Partial<Dependencies> = {}, recover?: (input: unknown) => unknown) {
  const frame = { url: 'puntovivo-app://app/index.html#/login' };
  const sender = { isDestroyed: () => false, mainFrame: frame };
  const window = { isDestroyed: () => false, webContents: sender };
  const event = { sender, senderFrame: frame };
  const calls: unknown[] = [];
  const server = {
    localOwnerRecovery: {
      isAvailable: () => true,
      recover: async (input: unknown) => {
        calls.push(input);
        if (recover) return recover(input);
        return { recovered: true };
      },
    },
  };
  const deps: Dependencies = {
    getMainWindow: () => window,
    // The real operations map recovery errors to stable codes.
    getServerHost: () => createServerOperations(server as unknown as PuntovivoServer),
    isHubClient: false,
    isDev: false,
    webDevServerUrl: 'http://localhost:3000',
    ...overrides,
  };
  return { event, sender, calls, handlers: createOwnerRecoveryHandlers(deps) };
}

test('forwards the request from the local main window to the embedded server', async () => {
  const f = fixture();
  assert.deepEqual(await f.handlers.status(f.event), { available: true });
  const input = { email: 'owner@example.com', newPassword: 'FreshOwnerPassword42!' };
  assert.deepEqual(await f.handlers.recover(f.event, input), { ok: true });
  assert.deepEqual(f.calls, [input]);
});

test('refuses hub clients, foreign frames and untrusted origins without calling the server', async () => {
  const cases: Array<[string, ReturnType<typeof fixture>]> = [
    ['hub client', fixture({ isHubClient: true })],
    ['no window', fixture({ getMainWindow: () => null })],
  ];
  const foreignOrigin = fixture();
  foreignOrigin.sender.mainFrame.url = 'https://example.com/';
  cases.push(['foreign origin', foreignOrigin]);
  const subframe = fixture();
  cases.push(['subframe', subframe]);

  for (const [label, f] of cases) {
    const event =
      label === 'subframe'
        ? { ...f.event, senderFrame: { url: f.event.senderFrame.url } }
        : f.event;
    assert.deepEqual(await f.handlers.status(event), { available: false }, label);
    assert.deepEqual(
      await f.handlers.recover(event, {}),
      { ok: false, errorCode: 'AUTH_LOCAL_RECOVERY_UNAVAILABLE' },
      label
    );
    assert.equal(f.calls.length, 0, label);
  }
});

test('returns only stable auth error codes', async () => {
  const known = fixture({}, () => {
    throw Object.assign(new Error('mismatch'), {
      cause: { errorCode: 'AUTH_LOCAL_RECOVERY_EMAIL_MISMATCH' },
    });
  });
  assert.deepEqual(await known.handlers.recover(known.event, {}), {
    ok: false,
    errorCode: 'AUTH_LOCAL_RECOVERY_EMAIL_MISMATCH',
  });

  const leaky = fixture({}, () => {
    throw new Error('SQLITE_BUSY: /Users/owner/Library/Application Support/Puntovivo/data');
  });
  assert.deepEqual(await leaky.handlers.recover(leaky.event, {}), {
    ok: false,
    errorCode: 'INTERNAL_SERVER_ERROR',
  });
});
