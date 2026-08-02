import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const smoke = readFileSync(new URL('./run-desktop-smoke.mjs', import.meta.url), 'utf8');
const linuxSmoke = readFileSync(new URL('./run-linux-desktop-smoke.mjs', import.meta.url), 'utf8');
const linuxPortal = readFileSync(new URL('./linux-smoke-portal.py', import.meta.url), 'utf8');

test('packaged runtime smoke waits for Electron before cleaning its profile', () => {
  assert.match(smoke, /import \{ listPackage \} from '@electron\/asar'/);
  assert.match(smoke, /listPackage\(asar, \{ isPack: false \}\)/);
  assert.doesNotMatch(smoke, /@electron.*asar.*bin.*asar\.(?:js|mjs)/);
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
  assert.match(smoke, /waitForRendererReadyTarget/);
  assert.match(smoke, /\/json\/list/);
  assert.match(smoke, /target\.url\.includes\('#\/login'\)/);
  assert.doesNotMatch(smoke, /\/json\/version/);
  assert.match(smoke, /AbortSignal\.timeout\(500\)/);
  assert.match(smoke, /PUNTOVIVO_E2E: '1'/);
  assert.match(smoke, /PUNTOVIVO_BIND_PORT: String\(serverPort\)/);
  assert.match(smoke, /classifyElectronStdoutLine/);
  assert.match(smoke, /classifyElectronStderrLine/);
  assert.match(smoke, /packaged process emitted unexpected warning\/error output/);
  assert.match(smoke, /PUNTOVIVO_DB_KEY: randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(smoke, /AUTO_UPDATE: 'false'/);
  assert.match(smoke, /--use-mock-keychain/);
  assert.match(smoke, /--password-store=basic/);
  assert.match(smoke, /--disable-gpu/);
  assert.doesNotMatch(smoke, /KEY_STORE_GATED|keyGated/);
  assert.match(smoke, /Boolean\(window\.electron\)/);
  assert.match(smoke, /Boolean\(window\.api\)/);
  assert.match(smoke, /admin@localhost/);
  assert.match(smoke, /today's sales\|ventas de hoy/);
  assert.match(smoke, /company-tab-readiness/);
  assert.match(smoke, /aria-current/);
  assert.match(smoke, /\\\[Database\\\] Password:/);
  assert.match(smoke, /\[Redacted\]/);

  const rendererJourney = smoke.slice(
    smoke.indexOf('async function verifyPackagedRenderer()'),
    smoke.indexOf("child.stdout.on('data'")
  );
  assert.doesNotMatch(
    rendererJourney,
    /browser(?:\?|\.)\.close\(/,
    'closing a connected CDP Browser shuts down the remote Electron process'
  );
  assert.match(rendererJourney, /child exit then closes the CDP/);
  assert.match(rendererJourney, /window\.electron\?\.requestE2eAppQuit\?\.\(\)/);
  assert.match(rendererJourney, /quitResult\?\.ok !== true/);
  assert.match(rendererJourney, /gracefulQuitRequested: true/);
  assert.ok(
    rendererJourney.lastIndexOf('finish(rendererError)') >
      rendererJourney.indexOf('chromium.connectOverCDP'),
    'the owned Electron child must remain the sole shutdown authority'
  );
  assert.match(smoke, /if \(gracefulQuitRequested\) return/);
});

test('Linux smoke supplies a deterministic portal instead of filtering its diagnostics', () => {
  assert.match(linuxSmoke, /spawn\('python3', \[portalScript\]/);
  assert.match(linuxSmoke, /await verifyPortalContract\(\)/);
  assert.match(linuxSmoke, /--verify-contract/);
  assert.match(linuxSmoke, /await runSmoke\(packagedPath, false\)/);
  assert.match(linuxSmoke, /await runSmoke\(packagedPath, true\)/);
  assert.match(linuxSmoke, /Linux smoke portal emitted unexpected stderr output/);
  assert.doesNotMatch(linuxSmoke, /warning.*allow|ignore.*warning|suppress/i);

  assert.match(linuxPortal, /org\.freedesktop\.host\.portal\.Registry/);
  assert.match(linuxPortal, /org\.freedesktop\.portal\.Settings/);
  assert.match(linuxPortal, /org\.freedesktop\.portal\.FileChooser/);
  assert.match(linuxPortal, /@dbus\.service\.method/);
  assert.match(linuxPortal, /sender_keyword="sender"/);
  assert.match(linuxPortal, /dbus\.UInt32\(0, variant_level=2\)/);
  assert.match(linuxPortal, /color_scheme\.variant_level != 2/);
  assert.match(linuxPortal, /read_all_color_scheme\.variant_level != 1/);
  assert.match(linuxPortal, /settings_version\.variant_level != 1/);
  assert.doesNotMatch(linuxPortal, /FLATPAK_SANDBOX_DIR|SNAP/);
});
