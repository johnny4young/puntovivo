import { beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { __withExpectedTestLogs } from '@puntovivo/server';
import type { BackupKeyRevealAuditInput } from '../ipc/backup/contracts.ts';
import { handleGetBackupEncryptionKey } from '../ipc/backup/encryption-key.ts';
import {
  __resetForTests,
  SESSION_NOT_REGISTERED,
  SESSION_ROLE_FORBIDDEN,
} from '../session/desktopSession.ts';
import { makeBackupIpcDeps } from './helpers/backup-ipc-deps.ts';
import { registerRole } from './helpers/desktop-session.ts';

const TEST_KEY = 'f'.repeat(64);

describe('backup encryption key reveal IPC', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('rejects missing and non-admin desktop sessions before touching the key', async () => {
    let resolved = false;
    const deps = makeBackupIpcDeps({
      resolveDatabaseEncryptionKey: async () => {
        resolved = true;
        return TEST_KEY;
      },
    });

    await assert.rejects(handleGetBackupEncryptionKey(deps), {
      message: SESSION_NOT_REGISTERED,
    });
    await registerRole('manager');
    await assert.rejects(handleGetBackupEncryptionKey(deps), {
      message: SESSION_ROLE_FORBIDDEN,
    });
    assert.equal(resolved, false);
  });

  it('reveals the key to an admin and records tenant-scoped evidence first', async () => {
    await registerRole('admin');
    const audit: BackupKeyRevealAuditInput[] = [];

    const result = await handleGetBackupEncryptionKey(
      makeBackupIpcDeps({
        resolveDatabaseEncryptionKey: async () => TEST_KEY,
        recordBackupKeyRevealAudit: input => audit.push(input),
      })
    );

    assert.deepEqual(result, { success: true, key: TEST_KEY });
    assert.deepEqual(audit, [{ tenantId: 'tenant-1', actorId: 'user-admin', outcome: 'revealed' }]);
    // key material never leaks through the audit input.
    assert.doesNotMatch(JSON.stringify(audit), new RegExp(TEST_KEY));
  });

  it('withholds the key behind a closed code when the audit evidence cannot be written', async () => {
    await registerRole('admin');
    const attempts: BackupKeyRevealAuditInput[] = [];

    const result = await __withExpectedTestLogs(
      [
        {
          level: 'error',
          module: 'backup',
          message: 'backup key reveal blocked: audit evidence could not be recorded',
        },
      ],
      () =>
        handleGetBackupEncryptionKey(
          makeBackupIpcDeps({
            resolveDatabaseEncryptionKey: async () => TEST_KEY,
            recordBackupKeyRevealAudit: input => {
              attempts.push(input);
              throw new Error('database read-only: /secret/path/local.db');
            },
          })
        )
    );

    assert.deepEqual(result, { success: false, error: 'audit_unavailable' });
    // key material and the raw diagnostic never reach the result.
    assert.doesNotMatch(JSON.stringify(result), new RegExp(TEST_KEY));
    assert.doesNotMatch(JSON.stringify(result), /secret|read-only/i);
    // best-effort failed-outcome row was still attempted after the block.
    assert.deepEqual(
      attempts.map(input => input.outcome),
      ['revealed', 'failed']
    );
  });

  it('maps a failed key resolution to a closed code and records failed evidence', async () => {
    await registerRole('admin');
    const audit: BackupKeyRevealAuditInput[] = [];

    const result = await __withExpectedTestLogs(
      [
        {
          level: 'warn',
          module: 'backup',
          message: 'backup encryption key could not be resolved',
        },
      ],
      () =>
        handleGetBackupEncryptionKey(
          makeBackupIpcDeps({
            resolveDatabaseEncryptionKey: async () => {
              throw new Error('keychain item /Users/x/Library/Keychains unavailable');
            },
            recordBackupKeyRevealAudit: input => audit.push(input),
          })
        )
    );

    assert.deepEqual(result, { success: false, error: 'key_unavailable' });
    // the keychain diagnostic never crosses to the renderer.
    assert.doesNotMatch(JSON.stringify(result), /keychain|Library/i);
    assert.deepEqual(audit, [{ tenantId: 'tenant-1', actorId: 'user-admin', outcome: 'failed' }]);
  });
});
