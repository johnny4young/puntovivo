import { AlertTriangle, DatabaseBackup, HardDriveDownload } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { getErrorMessage } from '@/lib/utils';

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

export function CompanyBackupCard() {
  const { t } = useTranslation('settings');
  const [activeAction, setActiveAction] = useState<BackupAction>(null);
  const [isRestoreConfirmOpen, setIsRestoreConfirmOpen] = useState(false);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const toast = useToast();
  const electron = typeof window !== 'undefined' ? window.electron : undefined;
  const isDesktop = Boolean(electron);

  const handleCreateBackup = async () => {
    if (!electron) {
      toast.info({ title: t('company.backup.toast.desktopOnly') });
      setStatus({
        tone: 'info',
        message: t('company.backup.toast.desktopOnlyDetail'),
      });
      return;
    }

    setActiveAction('backup');

    try {
      const result = await electron.createDatabaseBackup();

      if (result.cancelled) {
        toast.info({ title: t('company.backup.toast.cancelledTitle') });
        setStatus({
          tone: 'info',
          message: t('company.backup.toast.cancelledDetail'),
        });
        return;
      }

      if (!result.success) {
        throw new Error(result.error || t('company.backup.toast.failed'));
      }

      toast.success({ title: t('company.backup.toast.created') });
      setStatus({
        tone: 'success',
        message: result.path
          ? t('company.backup.toast.savedPath', { path: result.path })
          : t('company.backup.toast.savedOk'),
      });
    } catch (error) {
      toast.error({
        title: t('company.backup.toast.failed'),
        description: getErrorMessage(error, t('company.backup.toast.failed')),
      });
      setStatus({
        tone: 'error',
        message: getErrorMessage(error, t('company.backup.toast.failed')),
      });
    } finally {
      setActiveAction(null);
    }
  };

  const handleRequestRestoreBackup = () => {
    if (!electron) {
      toast.info({ title: t('company.backup.toast.restoreDesktopOnly') });
      setStatus({
        tone: 'info',
        message: t('company.backup.toast.restoreDesktopOnlyDetail'),
      });
      return;
    }

    setIsRestoreConfirmOpen(true);
  };

  const handleRestoreBackup = async () => {
    if (!electron) {
      return;
    }

    setActiveAction('restore');

    try {
      const result = await electron.restoreDatabaseBackup();

      if (result.cancelled) {
        toast.info({ title: t('company.backup.toast.restoreCancelledTitle') });
        setStatus({
          tone: 'info',
          message: t('company.backup.toast.restoreCancelledDetail'),
        });
        setIsRestoreConfirmOpen(false);
        return;
      }

      if (!result.success) {
        throw new Error(result.error || t('company.backup.toast.restoreFailed'));
      }

      toast.success({ title: t('company.backup.toast.restored') });
      setStatus({
        tone: 'success',
        message: t('company.backup.toast.restoredOk'),
      });
      setIsRestoreConfirmOpen(false);
    } catch (error) {
      toast.error({
        title: t('company.backup.toast.restoreFailed'),
        description: getErrorMessage(error, t('company.backup.toast.restoreFailed')),
      });
      setStatus({
        tone: 'error',
        message: getErrorMessage(error, t('company.backup.toast.restoreFailed')),
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
          <h2 className="text-lg font-semibold text-secondary-900">{t('company.backup.title')}</h2>
          <p className="text-sm text-secondary-500">
            {t('company.backup.description')}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-900">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t('company.backup.restoreWarning')}</p>
        </div>
      </div>

      {!isDesktop && (
        <div className="surface-panel-muted text-sm text-secondary-600">{t('company.backup.desktopOnly')}</div>
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
          {activeAction === 'backup' ? t('company.backup.creating') : t('company.backup.createBackup')}
        </button>

        <button
          type="button"
          onClick={handleRequestRestoreBackup}
          disabled={!isDesktop || activeAction !== null}
          className="btn-outline flex items-center justify-center gap-2"
        >
          <HardDriveDownload className="h-4 w-4" />
          {activeAction === 'restore' ? t('company.backup.restoring') : t('company.backup.restoreBackup')}
        </button>
      </div>

      <ConfirmModal
        isOpen={isRestoreConfirmOpen}
        onClose={() => setIsRestoreConfirmOpen(false)}
        onConfirm={() => {
          void handleRestoreBackup();
        }}
        title={t('company.backup.restoreModal.title')}
        message={t('company.backup.restoreModal.message')}
        confirmText={t('company.backup.restoreModal.confirm')}
        loading={activeAction === 'restore'}
        variant="danger"
      />
    </section>
  );
}
