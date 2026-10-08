import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  DEFAULT_ELECTRON_E2E_API_PORT,
  ELECTRON_E2E_API_HOST,
  devElectronSandboxArgs,
  resolveElectronE2eApiPort,
} from './electron-e2e-runtime.mjs';

describe('Electron E2E runtime isolation', () => {
  it('uses a loopback IP and a dedicated API port by default', () => {
    assert.equal(ELECTRON_E2E_API_HOST, '127.0.0.1');
    assert.equal(resolveElectronE2eApiPort({}), DEFAULT_ELECTRON_E2E_API_PORT);
    assert.notEqual(DEFAULT_ELECTRON_E2E_API_PORT, 8090);
  });

  it('proves the packaged runtime version matches the external candidate', () => {
    const fixture = readFileSync('e2e/electron/fixtures.ts', 'utf8');
    assert.match(fixture, /assertObservedPackagedVersion\(/);
    assert.match(fixture, /process\.env\.PUNTOVIVO_EXPECTED_APP_VERSION/);
  });

  it('isolates the development credential store before either Electron launch', () => {
    const fixture = readFileSync('e2e/electron/fixtures.ts', 'utf8');
    const target = fixture.slice(
      fixture.indexOf('function resolveDevLaunchTarget()'),
      fixture.indexOf('export async function launchUpdaterSmokeElectron(')
    );
    assert.match(
      target,
      /args:\s*\[DESKTOP_APP_DIR,\s*\.\.\.devElectronSandboxArgs\(\),\s*\.\.\.credentialStoreArgs\(\)\]/
    );
    assert.equal((fixture.match(/const target = resolveDevLaunchTarget\(\);/g) ?? []).length, 2);
    // Reuse the packaged harness policy; do not change production safeStorage.
    assert.match(fixture, /process\.platform === 'darwin'\) return \['--use-mock-keychain'\]/);
    assert.match(fixture, /process\.platform === 'linux'\) return \['--password-store=basic'\]/);
  });

  it('uses desktop package metadata and verifies both development launches', () => {
    const fixture = readFileSync('e2e/electron/fixtures.ts', 'utf8');
    assert.match(fixture, /const DESKTOP_APP_DIR = resolve\(process\.cwd\(\), 'apps\/desktop'\)/);
    assert.match(fixture, /readFileSync\(join\(DESKTOP_APP_DIR, 'package\.json'\), 'utf8'\)/);
    assert.match(fixture, /observed !== DESKTOP_APP_VERSION/);
    assert.equal((fixture.match(/await assertDevAppVersion\(electronApp\);/g) ?? []).length, 2);
    assert.doesNotMatch(fixture, /const ELECTRON_MAIN_ENTRY/);
  });

  it('accepts an explicit valid test port', () => {
    assert.equal(resolveElectronE2eApiPort({ PUNTOVIVO_E2E_API_PORT: '19091' }), 19091);
  });

  it('rejects malformed or unsafe ports', () => {
    for (const value of ['0', '65536', '18091x', '-1', '1.5']) {
      assert.throws(
        () => resolveElectronE2eApiPort({ PUNTOVIVO_E2E_API_PORT: value }),
        /must be an integer from 1 to 65535/
      );
    }
  });

  it('uses the test-only Linux sandbox exception without changing other platforms', () => {
    assert.deepEqual(devElectronSandboxArgs('linux'), ['--no-sandbox']);
    assert.deepEqual(devElectronSandboxArgs('darwin'), []);
    assert.deepEqual(devElectronSandboxArgs('win32'), []);
  });
  it('waits for Electron auth bootstrap before filling fresh login credentials', () => {
    const source = readFileSync('e2e/electron/support/journey.ts', 'utf8');
    const signIn = source.slice(
      source.indexOf('export async function signIn('),
      source.indexOf('export async function pinPrimarySite(')
    );
    const ready = signIn.indexOf('await expect(submit).toBeEnabled(');
    const credentials = signIn.indexOf('await emailInput.fill(email)');
    assert.ok(ready > 0 && credentials > ready, 'a visible form is not a settled auth bootstrap');
    assert.match(signIn, /await submit\.click\(\)/);
  });

  it('requires the PIN confirmation phase before the second removal click', () => {
    const source = readFileSync('e2e/electron/staff-switch.spec.ts', 'utf8');
    const remove = source.slice(
      source.indexOf('async function removeCashierPin('),
      source.indexOf('async function switchToCashier(')
    );
    const first = remove.indexOf("getByRole('button', { name: 'Remove PIN' }).click()");
    const phase = remove.indexOf('Remove the staff PIN for');
    const second = remove.lastIndexOf("getByRole('button', { name: 'Remove PIN' }).click()");
    assert.ok(
      first >= 0 && phase > first && second > phase,
      'same-titled dialogs must not erase the confirmation boundary'
    );
  });
});
