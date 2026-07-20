import { afterEach, beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import {
  BackupCloudVaultError,
  createBackupCloudVault,
  normalizeBackupCloudVaultConfig,
  type BackupCloudUploadRequest,
} from '../backup/cloud-vault.ts';
import type { SafeStorageLike } from '../db-key-store.ts';

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'puntovivo-cloud-vault-test-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function makeSafeStorage(
  options: {
    available?: boolean;
    backend?: ReturnType<NonNullable<SafeStorageLike['getSelectedStorageBackend']>>;
  } = {}
): SafeStorageLike {
  const envelopes = new Map<string, string>();
  let sequence = 0;
  return {
    isEncryptionAvailable: () => options.available ?? true,
    getSelectedStorageBackend: () => options.backend ?? 'unknown',
    encryptString: plain => {
      const token = `sealed-${++sequence}`;
      envelopes.set(token, plain);
      return Buffer.from(token, 'utf8');
    },
    decryptString: sealed => {
      const value = envelopes.get(sealed.toString('utf8'));
      if (!value) throw new Error('envelope rejected');
      return value;
    },
  };
}

const CONFIG = {
  endpoint: 'https://objects.example.test',
  region: 'auto',
  bucket: 'merchant-backups',
  prefix: 'puntovivo/production',
  forcePathStyle: true,
  accessKeyId: 'PVACCESS1234',
  secretAccessKey: 'secret-value-that-must-never-leak',
};

function makeVault(
  options: {
    safeStorage?: SafeStorageLike;
    platform?: NodeJS.Platform;
    allowInsecureLoopback?: boolean;
    uploadObject?: (request: BackupCloudUploadRequest) => Promise<void>;
    now?: () => Date;
  } = {}
) {
  return createBackupCloudVault({
    getStatePath: () => join(scratch, 'state', 'backup-cloud-vaults.v1.json'),
    safeStorage: options.safeStorage ?? makeSafeStorage(),
    platform: options.platform ?? process.platform,
    allowInsecureLoopback: options.allowInsecureLoopback ?? false,
    ...(options.uploadObject ? { uploadObject: options.uploadObject } : {}),
    ...(options.now ? { now: options.now } : {}),
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
}

describe('backup cloud vault configuration', () => {
  it('requires HTTPS except for explicit loopback development endpoints', () => {
    assert.throws(
      () => normalizeBackupCloudVaultConfig({ ...CONFIG, endpoint: 'http://storage.example.test' }),
      (error: unknown) =>
        error instanceof BackupCloudVaultError && error.code === 'configuration_invalid'
    );
    assert.equal(
      normalizeBackupCloudVaultConfig(
        { ...CONFIG, endpoint: 'http://127.0.0.1:9900/' },
        { allowInsecureLoopback: true }
      ).endpoint,
      'http://127.0.0.1:9900'
    );
    assert.throws(() =>
      normalizeBackupCloudVaultConfig(
        { ...CONFIG, prefix: '../escape' },
        { allowInsecureLoopback: true }
      )
    );
  });

  it('fails closed when safeStorage is unavailable or Linux selects basic_text', async () => {
    await assert.rejects(
      makeVault({ safeStorage: makeSafeStorage({ available: false }) }).configure(
        'tenant-a',
        CONFIG
      ),
      { message: 'secure_storage_unavailable' }
    );
    await assert.rejects(
      makeVault({
        safeStorage: makeSafeStorage({ backend: 'basic_text' }),
        platform: 'linux',
      }).configure('tenant-a', CONFIG),
      { message: 'secure_storage_unavailable' }
    );
  });

  it('persists a sealed tenant-isolated envelope and returns only redacted metadata', async () => {
    const vault = makeVault({ now: () => new Date('2026-07-14T12:00:00.000Z') });

    const status = await vault.configure('tenant-a', CONFIG);

    assert.equal(status.configured, true);
    assert.equal(status.accessKeyHint, '••••1234');
    assert.equal(JSON.stringify(status).includes(CONFIG.accessKeyId), false);
    assert.equal(JSON.stringify(status).includes(CONFIG.secretAccessKey), false);
    assert.equal((await vault.getStatus('tenant-b')).configured, false);

    const statePath = join(scratch, 'state', 'backup-cloud-vaults.v1.json');
    const persisted = await readFile(statePath, 'utf8');
    assert.doesNotMatch(persisted, /PVACCESS1234|secret-value-that-must-never-leak/);
    if (process.platform !== 'win32') {
      assert.equal((await stat(statePath)).mode & 0o777, 0o600);
    }
  });

  it('never exposes a complete short access-key identifier in status', async () => {
    const vault = makeVault();

    const status = await vault.configure('tenant-a', {
      ...CONFIG,
      accessKeyId: 'abc',
    });

    assert.equal(status.accessKeyHint, '••••bc');
    assert.equal(status.accessKeyHint.includes('abc'), false);
  });

  it('fails closed on a corrupted credential state instead of silently replacing it', async () => {
    const path = join(scratch, 'state', 'backup-cloud-vaults.v1.json');
    await writeFile(path, '{not-json', 'utf8').catch(async () => {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(scratch, 'state'), { recursive: true });
      await writeFile(path, '{not-json', 'utf8');
    });

    await assert.rejects(makeVault().getStatus('tenant-a'), {
      message: 'cloud_vault_unavailable',
    });
  });
});

describe('backup cloud vault writes', () => {
  it('signs and sends a real S3-compatible path-style PUT to a loopback provider', async () => {
    const requests: Array<{ method: string | undefined; url: string | undefined; body: string }> =
      [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        requests.push({
          method: request.method,
          url: request.url,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        response.writeHead(200, { etag: '"puntovivo-test"' });
        response.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const vault = makeVault({ allowInsecureLoopback: true });
      await vault.configure('tenant-a', {
        ...CONFIG,
        endpoint: `http://127.0.0.1:${address.port}`,
      });

      const result = await vault.testConnection('tenant-a');

      assert.equal(result.success, true);
      assert.equal(requests.length, 1);
      assert.equal(requests[0]?.method, 'PUT');
      assert.equal(
        requests[0]?.url,
        '/merchant-backups/puntovivo/production/tenant-a/.puntovivo-connection-test?x-id=PutObject'
      );
      assert.equal(requests[0]?.body, 'Puntovivo cloud backup connection test\n');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }
  });

  it('writes a bounded connection probe and records safe success metadata', async () => {
    const uploads: BackupCloudUploadRequest[] = [];
    let current = new Date('2026-07-14T12:00:00.000Z');
    const vault = makeVault({
      now: () => current,
      uploadObject: async request => {
        uploads.push(request);
        current = new Date('2026-07-14T12:00:01.000Z');
      },
    });
    await vault.configure('tenant/a', CONFIG);

    const result = await vault.testConnection('tenant/a');

    assert.equal(result.success, true);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0]?.objectKey, 'puntovivo/production/tenant-a/.puntovivo-connection-test');
    assert.equal(uploads[0]?.contentType, 'text/plain; charset=utf-8');
    assert.equal(result.status.lastSuccessAt, '2026-07-14T12:00:01.000Z');
    assert.equal(result.status.lastError, null);
  });

  it('streams the encrypted ZIP to a portable object key', async () => {
    const zipPath = join(scratch, 'puntovivo-backup-tenant-a-20260714.zip');
    await writeFile(zipPath, Buffer.from('encrypted-zip-fixture'));
    let upload: BackupCloudUploadRequest | undefined;
    const vault = makeVault({
      uploadObject: async request => {
        upload = request;
        (request.body as Readable).destroy();
      },
    });
    await vault.configure('tenant-a', CONFIG);

    const result = await vault.replicateSnapshot({ tenantId: 'tenant-a', zipPath });

    assert.equal(result.success, true);
    assert.equal(
      upload?.objectKey,
      'puntovivo/production/tenant-a/puntovivo-backup-tenant-a-20260714.zip'
    );
    assert.equal(upload?.contentLength, 21);
    assert.equal(upload?.contentType, 'application/zip');
  });

  it('skips cleanly without configuration and normalizes provider diagnostics on failure', async () => {
    const unconfigured = await makeVault().replicateSnapshot({
      tenantId: 'tenant-a',
      zipPath: join(scratch, 'missing.zip'),
    });
    assert.equal(unconfigured.skipped, true);
    assert.equal(unconfigured.error, 'configuration_missing');

    const vault = makeVault({
      uploadObject: async () => {
        throw new Error('Authorization failed for secret-value at /private/provider/path');
      },
    });
    await vault.configure('tenant-a', CONFIG);
    const failed = await vault.testConnection('tenant-a');

    assert.equal(failed.success, false);
    assert.equal(failed.error, 'connection_failed');
    assert.equal(failed.status.lastError, 'connection_failed');
    assert.doesNotMatch(JSON.stringify(failed), /Authorization|secret-value|private|provider/);
  });

  it('blocks configuration replacement and disconnect while a cloud write is active', async () => {
    let releaseUpload: (() => void) | undefined;
    let markUploadStarted: (() => void) | undefined;
    const uploadGate = new Promise<void>(resolve => {
      releaseUpload = resolve;
    });
    const uploadStarted = new Promise<void>(resolve => {
      markUploadStarted = resolve;
    });
    const vault = makeVault({
      uploadObject: async () => {
        markUploadStarted?.();
        await uploadGate;
      },
    });
    await vault.configure('tenant-a', CONFIG);

    const activeWrite = vault.testConnection('tenant-a');
    await uploadStarted;

    await assert.rejects(vault.configure('tenant-a', { ...CONFIG, bucket: 'replacement' }), {
      message: 'operation_in_progress',
    });
    await assert.rejects(vault.disconnect('tenant-a'), {
      message: 'operation_in_progress',
    });

    releaseUpload?.();
    assert.equal((await activeWrite).success, true);
    assert.equal((await vault.getStatus('tenant-a')).bucket, CONFIG.bucket);
  });

  it('claims the tenant before state loading so simultaneous writes cannot overlap', async () => {
    let releaseUpload: (() => void) | undefined;
    let markUploadStarted: (() => void) | undefined;
    const uploadGate = new Promise<void>(resolve => {
      releaseUpload = resolve;
    });
    const uploadStarted = new Promise<void>(resolve => {
      markUploadStarted = resolve;
    });
    let uploadCount = 0;
    const vault = makeVault({
      uploadObject: async () => {
        uploadCount += 1;
        markUploadStarted?.();
        await uploadGate;
      },
    });
    await vault.configure('tenant-a', CONFIG);

    const firstWrite = vault.testConnection('tenant-a');
    const competingWrite = vault.testConnection('tenant-a');
    await uploadStarted;

    const competingResult = await competingWrite;
    assert.equal(competingResult.success, false);
    assert.equal(competingResult.error, 'operation_in_progress');
    assert.equal(competingResult.status.inProgress, true);
    assert.equal(uploadCount, 1);

    releaseUpload?.();
    assert.equal((await firstWrite).success, true);
  });
});
