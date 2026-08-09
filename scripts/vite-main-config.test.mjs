import assert from 'node:assert/strict';
import test from 'node:test';

import viteMainConfig from '../apps/desktop/vite.main.config.ts';

test('Electron main config targets the Node platform in Rolldown', () => {
  assert.equal(typeof viteMainConfig, 'function');

  const config = viteMainConfig({
    command: 'build',
    isPreview: false,
    isSsrBuild: true,
    mode: 'production',
  });

  assert.equal(config.build?.rolldownOptions?.platform, 'node');
  assert.equal(config.build?.rolldownOptions?.output?.entryFileNames, '[name].cjs');
  assert.equal(config.build?.rollupOptions, undefined);
  assert.equal(
    config.define?.['import.meta.url'],
    'require("node:url").pathToFileURL(__filename).href'
  );
});
