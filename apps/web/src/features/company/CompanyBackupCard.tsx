import { AlertTriangle, DatabaseBackup, HardDriveDownload } from 'lucide-react';
import { useState } from 'react';

type BackupAction = 'backup' | 'restore' | null;

interface BackupStatus {
  tone: 'success' | 'error' | 'info';
  message: string;
}

function getStatusClasses(tone: BackupStatus['tone']): string {
  if (tone === 'success') {
    return 'border-success-200 bg-success-50 text-success-800';
  }

  if (tone === 'error') {
    return 'border-danger-200 bg-danger-50 text-danger-700';
  }

  return 'border-warning-200 bg-warning-50 text-warning-800';
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function CompanyBackupCard() {
  const [activeAction, setActiveAction] = useState<BackupAction>(null);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const electron = typeof window !== 'undefined' ? window.electron : undefined;
  const isDesktop = Boolean(electron);

  const handleCreateBackup = async () => {
    if (!electron) {
      setStatus({
        tone: 'info',
        message: 'Database backups are available only in the desktop app.',
      });
      return;
    }

    setActiveAction('backup');

    try {
      const result = await electron.createDatabaseBackup();

      if (result.cancelled) {
        setStatus({
          tone: 'info',
          message: 'Backup creation was cancelled.',
        });
        return;
      }

      if (!result.success) {
        throw new Error(result.error || 'Database backup failed');
      }

      setStatus({
        tone: 'success',
        message: result.path
          ? `Backup saved to ${result.path}.`
          : 'Backup created successfully.',
      });
    } catch (error) {
      setStatus({
        tone: 'error',
        message: getErrorMessage(error, 'Database backup failed'),
      });
    } finally {
      setActiveAction(null);
    }
  };

  const handleRestoreBackup = async () => {
    if (!electron) {
      setStatus({
        tone: 'info',
        message: 'Database restore is available only in the desktop app.',
      });
      return;
    }

    const confirmed = window.confirm(
      'Restoring a backup will replace the current local database and reload the app. Continue?'
    );

    if (!confirmed) {
      return;
    }

    setActiveAction('restore');

    try {
      const result = await electron.restoreDatabaseBackup();

      if (result.cancelled) {
        setStatus({
          tone: 'info',
          message: 'Restore was cancelled.',
        });
        return;
      }

      if (!result.success) {
        throw new Error(result.error || 'Database restore failed');
      }

      setStatus({
        tone: 'success',
        message: 'Backup restored successfully. Reloading the application data...',
      });
    } catch (error) {
      setStatus({
        tone: 'error',
        message: getErrorMessage(error, 'Database restore failed'),
      });
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <section className="card p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-warning-100">
          <DatabaseBackup className="h-5 w-5 text-warning-700" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-secondary-900">Local Database Backup</h2>
          <p className="text-sm text-secondary-500">
            Create a point-in-time backup of the local SQLite database or restore a previous backup
            on this device.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-900">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Restore replaces the current local database. Use it only when you intentionally need to
            roll the workstation back to a prior state.
          </p>
        </div>
      </div>

      {!isDesktop && (
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-3 text-sm text-secondary-600">
          Backup and restore controls are available in the Electron desktop app. The browser build
          stays read-only for local database maintenance.
        </div>
      )}

      {status && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${getStatusClasses(status.tone)}`}>
          {status.message}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={handleCreateBackup}
          disabled={!isDesktop || activeAction !== null}
          className="btn-primary flex items-center justify-center gap-2"
        >
          <DatabaseBackup className="h-4 w-4" />
          {activeAction === 'backup' ? 'Creating Backup...' : 'Create Backup'}
        </button>

        <button
          type="button"
          onClick={handleRestoreBackup}
          disabled={!isDesktop || activeAction !== null}
          className="btn-outline flex items-center justify-center gap-2"
        >
          <HardDriveDownload className="h-4 w-4" />
          {activeAction === 'restore' ? 'Restoring Backup...' : 'Restore Backup'}
        </button>
      </div>
    </section>
  );
}
