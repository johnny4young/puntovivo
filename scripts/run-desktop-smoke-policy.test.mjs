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
