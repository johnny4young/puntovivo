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
    /- name: Prepare Electron native modules\s+run: pnpm --filter @puntovivo\/desktop run native:ensure:electron[\s\S]*- name: Package desktop app \(macOS\)/
  );
});

test('release packaging runs the full target-runtime smoke', () => {
  assert.doesNotMatch(releaseWorkflow, /run-desktop-smoke\.mjs[^\n]*--structure-only/);
  assert.match(
    releaseWorkflow,
    /xvfb-run -a node scripts\/run-desktop-smoke\.mjs --against-packaged apps\/desktop\/out-builder/
  );
  assert.match(
    releaseWorkflow,
    /if: matrix\.platform != 'linux'\s+run: node scripts\/run-desktop-smoke\.mjs --against-packaged apps\/desktop\/out-builder/
  );
});
