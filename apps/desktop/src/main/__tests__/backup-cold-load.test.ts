import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Resolve hooks exercise actual module evaluation in a fresh Node process,
// including ESM archiver (which cannot be observed through require.cache).
for (const entry of [
  '../backup/backup-bundle/archive.ts',
  '../backup/backup-bundle/extract.ts',
  '../packaged-recovery/run.ts',
  '../backup/cloud-vault.ts',
]) {
  test(`backup entry ${entry} does not load backup engines before an operation`, () => {
    const url = new URL(entry, import.meta.url).href;
    const child = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        `
      import { registerHooks } from 'node:module';
      registerHooks({ resolve(specifier, context, nextResolve) {
        if (specifier === 'archiver' || specifier === 'unzipper' || specifier === '@aws-sdk/client-s3') {
          throw new Error('Backup engine loaded during idle import: ' + specifier);
        }
        return nextResolve(specifier, context);
      }});
      await import(${JSON.stringify(url)});
    `,
      ],
      { encoding: 'utf8', timeout: 20_000, env: { ...process.env, NODE_ENV: 'test' } }
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, `${child.stderr}\n${child.stdout}`);
  });
}

function runIsolated(source: string): void {
  const child = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', source],
    { encoding: 'utf8', timeout: 20_000, env: { ...process.env, NODE_ENV: 'test' } }
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, `${child.stderr}\n${child.stdout}`);
}

test('cloud transport loads only after authorization and before streams; import failure releases the tenant', () => {
  runIsolated(`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { mkdtemp, rm, writeFile } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { registerHooks, syncBuiltinESMExports } from 'node:module';
    let loads = 0;
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier === '@aws-sdk/client-s3') {
        loads++;
        throw new Error('private module import failure');
      }
      return nextResolve(specifier, context);
    }});
    const { createBackupCloudVault } = await import(${JSON.stringify(new URL('../backup/cloud-vault.ts', import.meta.url).href)});
    const scratch = await mkdtemp(join(tmpdir(), 'puntovivo-cloud-cold-'));
    let streams = 0;
    const original = fs.createReadStream;
    fs.createReadStream = (...args) => { streams++; return original(...args); };
    syncBuiltinESMExports();
    const config = { endpoint: 'https://objects.example.test', region: 'auto', bucket: 'backups', prefix: 'pv', forcePathStyle: true, accessKeyId: 'test-key', secretAccessKey: 'test-secret' };
    let rejectDecrypt = false;
    const deps = {
      getStatePath: () => join(scratch, 'state.json'), platform: 'darwin',
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: value => Buffer.from(value),
        decryptString: value => { if (rejectDecrypt) throw new Error('private decryption failure'); return value.toString(); }
      },
      log: { info() {}, warn() {}, error() {} }
    };
    try {
      const vault = createBackupCloudVault(deps);
      assert.equal((await vault.testConnection('absent')).error, 'configuration_missing');
      assert.equal(loads, 0);
      await vault.configure('tenant', config);
      rejectDecrypt = true;
      assert.equal((await vault.testConnection('tenant')).error, 'secure_storage_unavailable');
      assert.equal(loads, 0);
      rejectDecrypt = false;
      let injected = 0;
      const injectedVault = createBackupCloudVault({ ...deps, uploadObject: async () => { injected++; } });
      assert.equal((await injectedVault.testConnection('tenant')).success, true);
      assert.equal(injected, 1);
      assert.equal(loads, 0);
      const zipPath = join(scratch, 'snapshot.zip');
      await writeFile(zipPath, 'fixture');
      const result = await vault.replicateSnapshot({ tenantId: 'tenant', zipPath });
      assert.equal(result.error, 'upload_failed');
      assert.ok(loads > 0);
      assert.equal(streams, 0, 'transport must load before opening a file stream');
      assert.equal((await vault.getStatus('tenant')).inProgress, false);
      assert.doesNotMatch(JSON.stringify(result), /private module|test-secret|test-key/);
      assert.equal((await vault.disconnect('tenant')).configured, false);
    } finally {
      fs.createReadStream = original;
      syncBuiltinESMExports();
      await rm(scratch, { recursive: true, force: true });
    }
  `);
});

test('cancellation during ZIP engine import does not open streams or publish output', () => {
  runIsolated(`
    import assert from 'node:assert/strict';
    import { mkdtemp, readdir, rm } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { registerHooks } from 'node:module';
    const controller = new AbortController();
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier === 'archiver') controller.abort();
      return nextResolve(specifier, context);
    }});
    const { writeBackupArchive } = await import(${JSON.stringify(new URL('../backup/backup-bundle/archive.ts', import.meta.url).href)});
    const scratch = await mkdtemp(join(tmpdir(), 'puntovivo-zip-cold-'));
    try {
      await assert.rejects(writeBackupArchive({ dbPath: join(scratch, 'missing.db'), outZipPath: join(scratch, 'out', 'backup.zip'), manifestJson: '{}', signal: controller.signal }), { name: 'AbortError' });
      assert.deepEqual(await readdir(scratch), []);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  `);
});
