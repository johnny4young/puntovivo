import { strict as assert } from 'node:assert';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { getElectronRebuildBin } from './ensure-native-runtime.mjs';

test('resolves the Electron rebuild CLI through its public package export', async () => {
  const rebuildBin = await getElectronRebuildBin();

  assert.equal(path.basename(rebuildBin), 'cli.js');
  await access(rebuildBin);
  const source = await readFile(rebuildBin, 'utf8');
  assert.match(source, /^#!\/usr\/bin\/env node/u);
});
