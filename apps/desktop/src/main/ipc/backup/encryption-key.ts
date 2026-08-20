/** admin-gated backup encryption key reveal IPC and audit boundary. */

import { createModuleLogger } from '@puntovivo/server';
import type { BackupIpcDeps } from './contracts.ts';
import { requireAdminTenantActor } from './guards.ts';

const keyRevealLog = createModuleLogger('backup');

// Closed error union (same posture as the restore drill): the
// keychain / SQLCipher resolution path can throw diagnostics carrying
// filesystem paths, so raw messages never cross to the renderer.
export type BackupKeyRevealErrorCode = 'audit_unavailable' | 'key_unavailable';

export type BackupKeyRevealResult =
  { success: true; key: string } | { success: false; error: BackupKeyRevealErrorCode };

/**
 * reveal this install's backup encryption key so the
 * operator can restore its bundles on ANOTHER device. Admin-only;
 * the renderer gates the reveal behind an explicit confirmation with
 * a strong warning (docs/SECURITY.md documents the trade-off: the
 * key is the at-rest secret — whoever holds it can read the
 * backups). The key never leaves the machine through any other
 * channel. A successful reveal is only reported after its immutable
 * audit row is written — if the evidence cannot be recorded, the key
 * is withheld (same posture as the restore drill).
 */
export async function handleGetBackupEncryptionKey(
  deps: BackupIpcDeps
): Promise<BackupKeyRevealResult> {
  const { tenantId, actorId } = requireAdminTenantActor();

  try {
    const key = await deps.resolveDatabaseEncryptionKey();
    try {
      deps.recordBackupKeyRevealAudit({ tenantId, actorId, outcome: 'revealed' });
    } catch {
      keyRevealLog.error(
        { tenantId },
        'backup key reveal blocked: audit evidence could not be recorded'
      );
      // Best-effort failed-outcome row: the key WAS withheld, and if
      // the audit subsystem recovered between the two writes the record
      // should say a reveal attempt happened.
      try {
        deps.recordBackupKeyRevealAudit({ tenantId, actorId, outcome: 'failed' });
      } catch {
        // Evidence store is down; the structured error log above is the
        // only remaining trace.
      }
      return { success: false, error: 'audit_unavailable' };
    }
    keyRevealLog.info({ tenantId }, 'backup encryption key revealed to admin');
    return { success: true, key };
  } catch {
    try {
      deps.recordBackupKeyRevealAudit({ tenantId, actorId, outcome: 'failed' });
    } catch {
      keyRevealLog.error(
        { tenantId },
        'failed backup key reveal audit evidence could not be recorded'
      );
    }
    // The underlying exception can contain a keychain item path or a
    // SQLCipher diagnostic. Keep it out of structured logs just as we
    // keep it out of the renderer, same as the restore drill does.
    keyRevealLog.warn({ tenantId }, 'backup encryption key could not be resolved');
    return { success: false, error: 'key_unavailable' };
  }
}
