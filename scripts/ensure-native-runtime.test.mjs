import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getBetterSqliteBuildIdentity, getElectronRebuildBin } from './ensure-native-runtime.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('resolves the Electron rebuild CLI through its public package export', async () => {
  const rebuildBin = await getElectronRebuildBin();

  assert.equal(path.basename(rebuildBin), 'cli.js');
  await access(rebuildBin);
  const source = await readFile(rebuildBin, 'utf8');
  assert.match(source, /^#!\/usr\/bin\/env node/u);
});

test('native cache identity includes the maintained patch content hash', async () => {
  const patch = await readFile(
    path.join(repoRoot, 'patches', 'better-sqlite3-multiple-ciphers@12.11.1.patch')
  );
  const shortHash = createHash('sha256').update(patch).digest('hex').slice(0, 16);

  assert.equal(
    await getBetterSqliteBuildIdentity(),
    `better-sqlite3-multiple-ciphers@12.11.1+patch.${shortHash}`
  );
});
