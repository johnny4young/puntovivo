import { beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { __withExpectedTestLogs } from '@puntovivo/server';
import type { DbKeyRotationAuditInput } from '../ipc/backup/contracts.ts';
import {
  handleGetDbKeyRotationStatus,
  handleRotateDbEncryptionKey,
} from '../ipc/backup/key-rotation.ts';
import {
  __resetForTests,
  SESSION_NOT_REGISTERED,
  SESSION_ROLE_FORBIDDEN,
} from '../session/desktopSession.ts';
import { makeBackupIpcDeps } from './helpers/backup-ipc-deps.ts';
import { registerRole } from './helpers/desktop-session.ts';

describe('db key rotation IPC', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('rejects missing and non-admin desktop sessions before rotating', async () => {
    let rotated = false;
    const deps = makeBackupIpcDeps({
      rotateDatabaseKey: async () => {
        rotated = true;
      },
    });

    await assert.rejects(handleRotateDbEncryptionKey(deps), {
      message: SESSION_NOT_REGISTERED,
    });
    await registerRole('manager');
    await assert.rejects(handleRotateDbEncryptionKey(deps), {
      message: SESSION_ROLE_FORBIDDEN,
    });
    assert.equal(rotated, false);
  });

  it('rotates for an admin inside the restart choreography and records evidence', async () => {
    await registerRole('admin');
    const audit: DbKeyRotationAuditInput[] = [];
    const order: string[] = [];

    const result = await handleRotateDbEncryptionKey(
      makeBackupIpcDeps({
        runWithServerRestart: async operation => {
          order.push('stop');
          const value = await operation();
          order.push('start');
          return value;
        },
        rotateDatabaseKey: async () => {
          order.push('rotate');
        },
        recordDbKeyRotationAudit: input => audit.push(input),
      })
    );

    assert.deepEqual(result, { success: true });
    // The rekey runs strictly between server stop and start.
    assert.deepEqual(order, ['stop', 'rotate', 'start']);
    assert.deepEqual(audit, [{ tenantId: 'tenant-1', actorId: 'user-admin', outcome: 'rotated' }]);
  });

  it('maps an unsupported install to its closed code without a scare log', async () => {
    await registerRole('admin');
    const audit: DbKeyRotationAuditInput[] = [];

    const result = await handleRotateDbEncryptionKey(
      makeBackupIpcDeps({
        rotateDatabaseKey: async () => {
          throw new Error('DB_KEY_ROTATION_UNSUPPORTED');
        },
        recordDbKeyRotationAudit: input => audit.push(input),
      })
    );

    assert.deepEqual(result, { success: false, error: 'unsupported' });
    assert.deepEqual(audit, [{ tenantId: 'tenant-1', actorId: 'user-admin', outcome: 'failed' }]);
  });

  it('maps a failed rotation to a closed code and keeps diagnostics out', async () => {
    await registerRole('admin');
    const audit: DbKeyRotationAuditInput[] = [];

    const result = await __withExpectedTestLogs(
      [
        {
          level: 'warn',
          module: 'backup',
          message: 'db encryption key rotation failed',
        },
      ],
      () =>
        handleRotateDbEncryptionKey(
          makeBackupIpcDeps({
            rotateDatabaseKey: async () => {
              throw new Error('rekey failed at /Users/x/Library/data/local.db');
            },
            recordDbKeyRotationAudit: input => audit.push(input),
          })
        )
    );

    assert.deepEqual(result, { success: false, error: 'rotation_failed' });
    // the filesystem diagnostic never crosses to the renderer.
    assert.doesNotMatch(JSON.stringify(result), /Library|local\.db/i);
    assert.deepEqual(audit, [{ tenantId: 'tenant-1', actorId: 'user-admin', outcome: 'failed' }]);
  });

  it('serves rotation status to admins only', async () => {
    const deps = makeBackupIpcDeps({
      getKeyRotationStatus: () => ({
        supported: true,
        pending: true,
        envelopeUpdatedAt: '2026-08-22T00:00:00.000Z',
      }),
    });

    assert.throws(() => handleGetDbKeyRotationStatus(deps), {
      message: SESSION_NOT_REGISTERED,
    });
    await registerRole('admin');
    assert.deepEqual(handleGetDbKeyRotationStatus(deps), {
      supported: true,
      pending: true,
      envelopeUpdatedAt: '2026-08-22T00:00:00.000Z',
    });
  });
});
