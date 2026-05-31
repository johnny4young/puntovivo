import { AlertTriangle, Database, HardDriveDownload, Save } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { DesktopOnlyChip, DisabledControl } from '@/components/feedback/DesktopOnlyChip';
import { EmptyState } from '@/components/feedback/EmptyState';
import { translateServerError } from '@/lib/translateServerError';

type BackupAction = 'backup' | 'restore' | null;

interface BackupStatus {
  tone: 'success' | 'error' | 'info';
  message: string;
}

function getStatusToneClasses(tone: BackupStatus['tone']): string {
  if (tone === 'success') {
    return 'border-success-300/70 bg-success-50 text-success-800';
  }

  if (tone === 'error') {
    return 'border-danger-300/70 bg-danger-50 text-danger-700';
  }

  return 'border-line bg-surface-2 text-secondary-700';
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
      const message = translateServerError(error, t, t('errors:server.unknown'));
      toast.error({
        title: t('company.backup.toast.failed'),
        description: message,
      });
      setStatus({
        tone: 'error',
        message,
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
      const message = translateServerError(error, t, t('errors:server.unknown'));
      toast.error({
        title: t('company.backup.toast.restoreFailed'),
        description: message,
      });
      setStatus({
        tone: 'error',
        message,
      });
    } finally {
      setActiveAction(null);
    }
  };

  const actions = (
    <div className="flex flex-col gap-3 sm:flex-row">
      <button
        type="button"
        onClick={handleCreateBackup}
        disabled={!isDesktop || activeAction !== null}
        className="pv-btn primary"
      >
        <Save aria-hidden="true" />
        {activeAction === 'backup' ? t('company.backup.creating') : t('company.backup.createBackup')}
      </button>

      <button
        type="button"
        onClick={handleRequestRestoreBackup}
        disabled={!isDesktop || activeAction !== null}
        className="pv-btn outline"
      >
        <HardDriveDownload aria-hidden="true" />
        {activeAction === 'restore' ? t('company.backup.restoring') : t('company.backup.restoreBackup')}
      </button>
    </div>
  );

  return (
    <section className="card p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="pv-gt pv-gt-warning h-[38px] w-[38px]">
            <Database className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-secondary-950">{t('company.backup.title')}</h2>
            <p className="text-sm text-secondary-500">{t('company.backup.description')}</p>
          </div>
        </div>
        <DesktopOnlyChip />
      </div>

      <div className="rounded-2xl border border-warning-300/70 bg-warning-50 px-4 py-3 text-sm text-warning-900">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{t('company.backup.restoreWarning')}</p>
        </div>
      </div>

      {status ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${getStatusToneClasses(status.tone)}`}
          role="status"
        >
          {status.message}
        </div>
      ) : (
        <EmptyState
          icon={Database}
          title={t('company.backup.empty.title')}
          description={t('company.backup.empty.description')}
        />
      )}

      {!isDesktop ? (
        <div className="space-y-3">
          <p className="text-sm text-secondary-500">{t('company.backup.desktopOnly')}</p>
          <DisabledControl>{actions}</DisabledControl>
        </div>
      ) : (
        actions
      )}

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
