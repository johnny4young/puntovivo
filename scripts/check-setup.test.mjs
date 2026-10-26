import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// Right after a fresh install the Electron runtime and dev servers are absent
// by design, so the diagnostic must not report them as failures.
test('pre-launch states are informational, not failures', () => {
  const script = readFileSync(new URL('./check-setup.sh', import.meta.url), 'utf8');
  assert.match(script, /ℹ Electron runtime not prepared yet/);
  assert.match(script, /ℹ Backend server not running/);
  assert.match(script, /ℹ Frontend server not running/);
  assert.doesNotMatch(script, /✗ (Electron runtime|Backend server|Frontend server)/);
});
