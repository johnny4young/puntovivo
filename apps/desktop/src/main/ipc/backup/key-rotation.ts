/** admin-gated SQLCipher key rotation IPC and audit boundary. */

import { createModuleLogger } from '@puntovivo/server';
import type { BackupIpcDeps } from './contracts.ts';
import { requireAdminTenantActor } from './guards.ts';

const rotationLog = createModuleLogger('backup');

// Closed error union (same posture as the key reveal): the rotation
// path can throw diagnostics carrying filesystem paths or SQLCipher
// details, so raw messages never cross to the renderer.
export type DbKeyRotationErrorCode = 'unsupported' | 'rotation_pending' | 'rotation_failed';

export type DbKeyRotationResult =
  { success: true } | { success: false; error: DbKeyRotationErrorCode };

/**
 * Rotate this install's SQLCipher key. Admin-only; the renderer
 * gates the action behind an explicit confirmation. The embedded
 * server is stopped around the offline rekey (same choreography as
 * a destructive restore) and restarted with the new key, so the
 * operator never has to relaunch the app. Every attempt — success
 * or failure — leaves an immutable audit row; unlike the key
 * reveal, the rotation is NOT withheld when the evidence write
 * fails afterwards, because by then the rekey already happened.
 */
export async function handleRotateDbEncryptionKey(
  deps: BackupIpcDeps
): Promise<DbKeyRotationResult> {
  const { tenantId, actorId } = requireAdminTenantActor();

  try {
    // reloadWindow like the restore path: the renderer reconnects to
    // the restarted server instead of dead-ending its live queries.
    await deps.runExclusiveBackupOperation(() =>
      deps.runWithServerRestart(() => deps.rotateDatabaseKey(), { reloadWindow: true })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    const code: DbKeyRotationErrorCode =
      message === 'DB_KEY_ROTATION_UNSUPPORTED'
        ? 'unsupported'
        : message === 'DB_KEY_ROTATION_PENDING'
          ? 'rotation_pending'
          : 'rotation_failed';
    if (code === 'rotation_failed') {
      // Keep SQLCipher/keychain diagnostics out of structured logs,
      // matching the reveal handler's posture.
      rotationLog.warn({ tenantId }, 'db encryption key rotation failed');
    }
    try {
      deps.recordDbKeyRotationAudit({ tenantId, actorId, outcome: 'failed' });
    } catch {
      rotationLog.error(
        { tenantId },
        'failed db key rotation audit evidence could not be recorded'
      );
    }
    return { success: false, error: code };
  }

  try {
    deps.recordDbKeyRotationAudit({ tenantId, actorId, outcome: 'rotated' });
  } catch {
    // The rotation already happened; the missing evidence row is a
    // logged gap, not a reason to report failure to the operator.
    rotationLog.error({ tenantId }, 'db key rotation audit evidence could not be recorded');
  }
  rotationLog.info({ tenantId }, 'db encryption key rotated by admin');
  return { success: true };
}

export function handleGetDbKeyRotationStatus(deps: BackupIpcDeps) {
  // Status is non-secret but still admin-surface data.
  requireAdminTenantActor();
  return deps.getKeyRotationStatus();
}
