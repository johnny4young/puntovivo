import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const desktopPackage = JSON.parse(
  readFileSync(new URL('../apps/desktop/package.json', import.meta.url), 'utf8')
);
const manualWorkflow = readFileSync(
  new URL('../.github/workflows/build-desktop.yml', import.meta.url),
  'utf8'
);
const releaseWorkflow = readFileSync(
  new URL('../.github/workflows/release.yml', import.meta.url),
  'utf8'
);
const nativeRuntimeScript = readFileSync(
  new URL('./ensure-native-runtime.mjs', import.meta.url),
  'utf8'
);
const builderConfig = readFileSync(
  new URL('../apps/desktop/electron-builder.yml', import.meta.url),
  'utf8'
);
const webViteConfig = readFileSync(new URL('../apps/web/vite.config.ts', import.meta.url), 'utf8');

test('local packaging prepares Electron native modules before electron-builder', () => {
  for (const scriptName of ['package:desktop', 'make:desktop']) {
    const script = desktopPackage.scripts[scriptName];
    const nativeIndex = script.indexOf('pnpm run native:ensure:electron');
    const builderIndex = script.indexOf('electron-builder');

    assert.ok(nativeIndex >= 0, `${scriptName} must prepare Electron native modules`);
    assert.ok(builderIndex > nativeIndex, `${scriptName} must prepare natives before packaging`);
  }
});

test('direct workflow packaging prepares Electron native modules', () => {
  assert.match(
    manualWorkflow,
    /run prebuild:desktop\s+pnpm --filter @puntovivo\/desktop run native:ensure:electron\s+pnpm --filter @puntovivo\/desktop exec electron-builder --mac/
  );
  assert.match(
    releaseWorkflow,
    /- name: Verify Electron native modules\s+run: pnpm --filter @puntovivo\/desktop run native:ensure:electron[\s\S]*- name: Package desktop app \(macOS\)/
  );
});

test('release packaging runs the full target-runtime smoke', () => {
  assert.doesNotMatch(releaseWorkflow, /run-desktop-smoke\.mjs[^\n]*--structure-only/);
  assert.match(
    releaseWorkflow,
    /xvfb-run -a dbus-run-session -- node scripts\/run-linux-desktop-smoke\.mjs --against-packaged apps\/desktop\/out-builder/
  );
  assert.match(
    releaseWorkflow,
    /if: matrix\.platform != 'linux'\s+run: \|\s+node scripts\/run-desktop-smoke\.mjs --against-packaged apps\/desktop\/out-builder\s+node scripts\/run-desktop-smoke\.mjs --against-packaged apps\/desktop\/out-builder --renderer/
  );
  assert.doesNotMatch(releaseWorkflow, /dbus-run-session -- xvfb-run/);
  assert.match(releaseWorkflow, /python3-dbus python3-gi/);
  assert.doesNotMatch(releaseWorkflow, /uses:\s+pnpm\/action-setup/);
  assert.equal(
    (
      releaseWorkflow.match(
        /npm install --global "pnpm@\$pnpmVersion" --ignore-scripts --no-audit --no-fund/g
      ) ?? []
    ).length,
    3
  );
});

test('packaged renderer carries its preload and file-relative web assets', () => {
  assert.match(builderConfig, /- \.vite\/preload\/\*\*/);
  assert.match(webViteConfig, /base: mode === 'production' \? '\.\/' : '\/'/);
});

test('packaging prunes non-target bundled SQLite prebuilds', () => {
  assert.match(builderConfig, /^afterPack: \.\.\/\.\.\/scripts\/prune-native-prebuilds\.mjs$/m);
  assert.match(builderConfig, /asarUnpack:\s+- '\*\*\/\*\.node'/u);
});

test('macOS packaging declares the supported OS floor and pinned release host', () => {
  assert.match(builderConfig, /^\s+minimumSystemVersion: '15\.0'$/m);
  assert.match(releaseWorkflow, /- os: macos-26\s+platform: mac/);
  assert.doesNotMatch(releaseWorkflow, /- os: macos-latest\s+platform: mac/);
});

test('Linux package metadata associates the launcher with the running window', () => {
  assert.equal(desktopPackage.desktopName, 'Puntovivo.desktop');
  assert.doesNotMatch(builderConfig, /^\s+desktopName:/m);
  assert.match(builderConfig, /^\s+syncDesktopName: true$/m);
  assert.match(builderConfig, /^\s+category: Office$/m);
});

test('Electron native preparation verifies Node-API without rebuilding SQLite', () => {
  assert.doesNotMatch(nativeRuntimeScript, /electron-rebuild|node-gyp|native-binaries/u);
  assert.match(nativeRuntimeScript, /ELECTRON_RUN_AS_NODE: '1'/u);
  assert.match(nativeRuntimeScript, /prebuilds/u);
  assert.match(nativeRuntimeScript, /verifyNativeRuntime/u);
  assert.equal(
    desktopPackage.scripts['native:ensure:electron'],
    'pnpm run electron:ensure:binary && node ../../scripts/ensure-native-runtime.mjs electron',
    'a clean checkout must install the lazy Electron runtime before probing SQLite under it'
  );
  assert.equal(
    desktopPackage.scripts.rebuild,
    'pnpm run native:ensure:electron',
    'the compatibility command must verify the shared Node-API binary without rebuilding it'
  );
});
