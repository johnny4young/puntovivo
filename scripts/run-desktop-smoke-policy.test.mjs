import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const smoke = readFileSync(new URL('./run-desktop-smoke.mjs', import.meta.url), 'utf8');

test('packaged runtime smoke waits for Electron before cleaning its profile', () => {
  assert.match(smoke, /child\.once\('exit', \(\) => \{/);
  assert.match(smoke, /child\.kill\('SIGTERM'\)/);
  assert.match(smoke, /child\.kill\('SIGKILL'\)/);
  assert.match(smoke, /maxRetries: 10/);
  assert.match(smoke, /retryDelay: 100/);
  assert.match(smoke, /WARN: could not remove temporary profile/);
});

test('packaged renderer smoke proves the preload bridge and a data-backed login', () => {
  assert.match(smoke, /--renderer/);
  assert.match(smoke, /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(smoke, /chromium\.connectOverCDP/);
  assert.match(smoke, /AbortSignal\.timeout\(500\)/);
  assert.match(smoke, /PUNTOVIVO_E2E: '1'/);
  assert.match(smoke, /PUNTOVIVO_DB_KEY: randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(smoke, /--use-mock-keychain/);
  assert.match(smoke, /--password-store=basic/);
  assert.match(smoke, /Boolean\(window\.electron\)/);
  assert.match(smoke, /Boolean\(window\.api\)/);
  assert.match(smoke, /admin@localhost/);
  assert.match(smoke, /today's sales\|ventas de hoy/);
  assert.match(smoke, /company-tab-readiness/);
  assert.match(smoke, /aria-current/);
  assert.match(smoke, /\\\[Database\\\] Password:/);
  assert.match(smoke, /\[Redacted\]/);
});
