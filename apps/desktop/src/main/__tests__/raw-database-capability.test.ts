import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import ts from 'typescript';

const legacyMethods = [
  'getAll',
  'getById',
  'insert',
  'update',
  'delete',
  'getByField',
  'deleteByTenant',
  'countByTenant',
  'addToSyncQueue',
  'getPendingSyncItems',
];

// Execute the real preload bundle with only Electron mocked. An absent type
// declaration alone cannot prove that a capability is gone at runtime.
function loadPreload() {
  const exposed = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  const result = buildSync({
    entryPoints: [fileURLToPath(new URL('../../preload/index.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    write: false,
  });
  runInNewContext(result.outputFiles[0]!.text, {
    module: { exports: {} },
    require: (name: string) => {
      assert.equal(name, 'electron', 'preload must not require another native capability');
      return {
        contextBridge: {
          exposeInMainWorld: (key: string, value: Record<string, unknown>) =>
            exposed.set(key, value),
        },
        ipcRenderer: {
          invoke: async (channel: string) => {
            calls.push(channel);
            return { ok: true, value: { pendingItems: 0 } };
          },
        },
      };
    },
  });
  return { exposed, calls };
}

test('preload exposes no raw database aliases or generic CRUD methods', () => {
  const { exposed } = loadPreload();
  assert.equal(exposed.has('db'), false);
  const api = exposed.get('api');
  assert.ok(api);
  assert.equal('db' in api, false);
  for (const method of legacyMethods) assert.equal(method in api, false, method);
});

test('retained sync, session, backup and hardware capabilities remain callable', async () => {
  const { exposed, calls } = loadPreload();
  const api = exposed.get('api')!;
  const sync = api.sync as { getStatus: () => Promise<unknown> };
  assert.deepEqual(await sync.getStatus(), { pendingItems: 0 });
  assert.deepEqual(calls, ['sync:getStatus']);
  assert.equal(exposed.get('sync'), api.sync);
  assert.equal(exposed.get('session'), api.session);
  assert.equal(typeof api.createDatabaseBackup, 'function');
  assert.equal(typeof api.openCustomerDisplay, 'function');
  assert.equal(typeof (api.peripherals as Record<string, unknown>).dispatchLocalEscpos, 'function');
});

test('main registers only retained sync channels, not raw database operations', () => {
  const source = readFileSync(new URL('../ipc/register.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const registrations = new Map<string, (...args: unknown[]) => unknown>();
  const exports: { registerDataBridgeIpc?: (deps: { log: object }) => void } = {};
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      switch (name) {
        case 'electron':
          return {
            ipcMain: {
              handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
                registrations.set(channel, handler),
            },
          };
        case '../session/desktopSession.js':
        case './sync.js':
          return {};
        case './data-bridge-handlers.js':
          return {
            createDataBridgeHandlers: () => ({
              getSyncStatus: () => 'status',
              triggerSync: () => 'trigger',
              setSyncConfig: () => 'config',
            }),
          };
        case './session-authorization.js':
          return { captureDesktopIpcSessionResult: (operation: () => unknown) => operation() };
        default:
          throw new Error(`Unexpected main registration dependency: ${name}`);
      }
    },
  });
  assert.ok(exports.registerDataBridgeIpc);
  exports.registerDataBridgeIpc({ log: {} });
  assert.deepEqual([...registrations.keys()].sort(), [
    'sync:getStatus',
    'sync:setConfig',
    'sync:triggerSync',
  ]);
  assert.equal(registrations.get('sync:getStatus')!(undefined), 'status');
  assert.equal(registrations.get('sync:triggerSync')!(undefined), 'trigger');
  assert.equal(registrations.get('sync:setConfig')!(undefined, {}), 'config');
});
