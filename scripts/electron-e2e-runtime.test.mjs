import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  DEFAULT_ELECTRON_E2E_API_PORT,
  ELECTRON_E2E_API_HOST,
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
    assert.match(target, /args:\s*\[ELECTRON_MAIN_ENTRY,\s*\.\.\.credentialStoreArgs\(\)\]/);
    assert.equal((fixture.match(/const target = resolveDevLaunchTarget\(\);/g) ?? []).length, 2);
    // Reuse the packaged harness policy; do not change production safeStorage.
    assert.match(fixture, /process\.platform === 'darwin'\) return \['--use-mock-keychain'\]/);
    assert.match(fixture, /process\.platform === 'linux'\) return \['--password-store=basic'\]/);
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
});
