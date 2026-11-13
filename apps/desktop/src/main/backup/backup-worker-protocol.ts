/** Messages between main and the backup worker. Structured-clone data only. */
import type { CreateBackupBundleArgs, CreateBackupBundleResult } from './backup-bundle.ts';

export type BackupWorkerArgs = Omit<CreateBackupBundleArgs, 'signal'>;

export type BackupWorkerMessage = { type: 'create'; args: BackupWorkerArgs } | { type: 'cancel' };

export type BackupWorkerReply =
  | { type: 'result'; ok: true; value: CreateBackupBundleResult }
  | { type: 'result'; ok: false; error: { name: string; message: string; code?: string } };
