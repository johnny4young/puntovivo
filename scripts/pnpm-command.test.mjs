import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePnpmInvocation } from './lib/pnpm-command.mjs';

test('runs JavaScript pnpm entries through the active Node runtime', () => {
  assert.deepEqual(
    resolvePnpmInvocation('/store/pnpm.cjs', {
      execPath: '/runtime/node',
      platform: 'linux',
    }),
    {
      command: '/runtime/node',
      argsPrefix: ['/store/pnpm.cjs'],
      shell: false,
    }
  );
});

test('runs standalone pnpm binaries directly instead of parsing them as JavaScript', () => {
  assert.deepEqual(
    resolvePnpmInvocation('/home/runner/setup-pnpm/pnpm', {
      execPath: '/runtime/node',
      platform: 'linux',
    }),
    {
      command: '/home/runner/setup-pnpm/pnpm',
      argsPrefix: [],
      shell: false,
    }
  );
  assert.deepEqual(
    resolvePnpmInvocation('C:\\pnpm\\pnpm.exe', {
      execPath: 'C:\\node\\node.exe',
      platform: 'win32',
    }),
    {
      command: 'C:\\pnpm\\pnpm.exe',
      argsPrefix: [],
      shell: false,
    }
  );
});

test('uses the Windows command shell only for command wrappers', () => {
  assert.deepEqual(
    resolvePnpmInvocation('C:\\pnpm\\pnpm.cmd', {
      execPath: 'C:\\node\\node.exe',
      platform: 'win32',
    }),
    {
      command: 'C:\\pnpm\\pnpm.cmd',
      argsPrefix: [],
      shell: true,
    }
  );
});

test('rejects a missing package-manager entry', () => {
  assert.throws(() => resolvePnpmInvocation(''), /pnpm executable entry is required/);
});
