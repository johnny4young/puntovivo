import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// First-owner web/Electron journeys prove the behavior. This portable copy
// contract prevents the helper from recommending a nonexistent default login.
test('setup guidance distinguishes first ownership from an explicitly seeded demo', () => {
  const script = readFileSync(new URL('./check-setup.sh', import.meta.url), 'utf8');
  assert.match(script, /A new installation has no default administrator or password/);
  assert.match(script, /create the business and its owner/);
  assert.match(script, /private installation code from the local server startup output/);
  assert.match(script, /Electron: complete setup in the main application window/);
  assert.match(script, /Existing installations: sign in with an account already created/);
  assert.match(script, /Explicit demo\/test seeds are separate/);
  assert.doesNotMatch(script, /admin@localhost|Admin123!Dev|Default Login:/);
});

const repoRoot = new URL('..', import.meta.url);
const scriptPath = new URL('./check-setup.sh', import.meta.url).pathname;

// Runs the diagnostic in a scratch checkout with pnpm and curl stubbed out, so
// the outcome depends only on the files each case lays down.
function runCheckSetup({ electron, nativeOk = true }) {
  const dir = mkdtempSync(join(tmpdir(), 'check-setup-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'node_modules', 'electron', 'dist'), { recursive: true });
    const stub = (name, body) => {
      writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    stub('pnpm', '[ "$1" = "-v" ] && echo 11.7.0; exit 0');
    stub('curl', 'exit 7');
    writeFileSync(
      join(dir, 'scripts', 'ensure-native-runtime.mjs'),
      `process.exit(${nativeOk ? 0 : 1});\n`
    );
    if (electron !== 'absent') {
      writeFileSync(join(dir, 'node_modules', 'electron', 'path.txt'), 'electron');
    }
    if (electron === 'installed') {
      writeFileSync(join(dir, 'node_modules', 'electron', 'dist', 'electron'), '');
    }
    const result = spawnSync('bash', [scriptPath], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    return {
      status: result.status,
      failures: result.stdout.match(/^✗.*$/gm) ?? [],
      stdout: result.stdout,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const posixOnly = { skip: process.platform === 'win32' && 'bash diagnostic' };

test('a fresh install with nothing launched yet passes with informational notes', posixOnly, () => {
  const run = runCheckSetup({ electron: 'absent' });
  assert.deepEqual(run.failures, []);
  assert.equal(run.status, 0);
  assert.match(run.stdout, /ℹ Electron runtime not prepared yet/);
  assert.match(run.stdout, /ℹ Backend server not running/);
  assert.match(run.stdout, /ℹ Frontend server not running/);
});

test('a prepared Electron runtime is reported as installed', posixOnly, () => {
  const run = runCheckSetup({ electron: 'installed' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /✓ Electron runtime installed/);
});

test('path.txt without its executable is a failure', posixOnly, () => {
  const run = runCheckSetup({ electron: 'broken' });
  assert.equal(run.status, 1);
  assert.match(run.failures.join('\n'), /Electron runtime incomplete/);
});

test('an unusable SQLite binding fails the diagnostic', posixOnly, () => {
  const run = runCheckSetup({ electron: 'absent', nativeOk: false });
  assert.equal(run.status, 1);
  assert.match(run.failures.join('\n'), /better-sqlite3/);
});

test('setup guides name the pnpm version pinned in packageManager', () => {
  const read = path => readFileSync(new URL(path, repoRoot), 'utf8');
  const version = JSON.parse(read('package.json')).packageManager.replace(/^pnpm@/, '');
  for (const doc of ['README.md', 'README.es.md', 'CONTRIBUTING.md', 'CONTRIBUTING.es.md']) {
    assert.ok(read(doc).includes(`pnpm \`${version}\``), `${doc} must name pnpm ${version}`);
  }
});
