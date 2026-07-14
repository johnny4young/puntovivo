import { AlertTriangle, Copy, Database, HardDriveDownload, KeyRound, Save } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal, Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { DesktopOnlyChip, DisabledControl } from '@/components/feedback/DesktopOnlyChip';
import { EmptyState } from '@/components/feedback/EmptyState';
import { translateServerError } from '@/lib/translateServerError';
import { BackupProtectionPanel } from './BackupProtectionPanel';
import { BackupSchedulePanel } from './BackupSchedulePanel';

type BackupAction = 'backup' | 'restore' | null;

/** ENG-167b — shape of the server's backup encryption key. */
const BACKUP_KEY_PATTERN = /^[0-9a-f]{64}$/i;

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
  // ENG-167b — cross-device restore key prompt. Non-null while the
  // main process holds a staged bundle waiting for the source
  // device's key (the token must be echoed back to complete it).
  const [restoreKeyToken, setRestoreKeyToken] = useState<string | null>(null);
  const [restoreKeyInput, setRestoreKeyInput] = useState('');
  const [restoreKeyError, setRestoreKeyError] = useState<string | null>(null);
  // ENG-167b — admin-gated reveal of this install's backup key.
  const [isRevealConfirmOpen, setIsRevealConfirmOpen] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
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

      // ENG-167b — the bundle comes from another device: the main
      // process holds the staged copy and waits for its backup key.
      if (result.needsKey && result.token) {
        setIsRestoreConfirmOpen(false);
        setRestoreKeyInput('');
        setRestoreKeyError(null);
        setRestoreKeyToken(result.token);
        setStatus({
          tone: 'info',
          message: t('company.backup.keyPrompt.statusWaiting'),
        });
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

  // ENG-167b — abandoning the key prompt must also clear the
  // "waiting for the key" status banner (leaving it up would claim
  // an in-flight restore that no longer exists) AND tell the main
  // process to discard the staged copy right away instead of leaving
  // it in the tmpdir until quit or the startup sweep collects it.
  const handleCancelRestoreKey = () => {
    const token = restoreKeyToken;
    setRestoreKeyToken(null);
    setRestoreKeyError(null);
    setStatus({
      tone: 'info',
      message: t('company.backup.toast.restoreCancelledDetail'),
    });
    if (token) {
      // Fire-and-forget: the cleanup is best-effort hygiene; the UI
      // state above is already coherent regardless of its outcome.
      void electron?.cancelRestoreStaging?.(token).catch(() => {});
    }
  };

  // ENG-167b — complete the cross-device restore with the key the
  // operator copied from the SOURCE device. A wrong key keeps the
  // staged bundle on the main side so the prompt can retry.
  const handleSubmitRestoreKey = async () => {
    if (!electron?.provideRestoreKey || !restoreKeyToken) {
      return;
    }
    const candidate = restoreKeyInput.trim();
    if (!BACKUP_KEY_PATTERN.test(candidate)) {
      setRestoreKeyError(t('company.backup.keyPrompt.invalidShape'));
      return;
    }
    setActiveAction('restore');
    setRestoreKeyError(null);
    try {
      const result = await electron.provideRestoreKey(restoreKeyToken, candidate);
      if (result.needsKey) {
        setRestoreKeyError(result.error ?? t('company.backup.keyPrompt.mismatch'));
        return;
      }
      if (!result.success) {
        throw new Error(result.error || t('company.backup.toast.restoreFailed'));
      }
      setRestoreKeyToken(null);
      setRestoreKeyInput('');
      toast.success({ title: t('company.backup.toast.restored') });
      setStatus({
        tone: 'success',
        message: t('company.backup.toast.restoredOk'),
      });
    } catch (error) {
      const message = translateServerError(error, t, t('errors:server.unknown'));
      setRestoreKeyToken(null);
      toast.error({
        title: t('company.backup.toast.restoreFailed'),
        description: message,
      });
      setStatus({ tone: 'error', message });
    } finally {
      setActiveAction(null);
    }
  };

  // ENG-167b — reveal this install's backup key after an explicit
  // warning confirmation. Needed to restore this device's bundles on
  // another machine; documented trade-off in docs/SECURITY.md.
  const handleRevealKey = async () => {
    setIsRevealConfirmOpen(false);
    if (!electron?.getBackupEncryptionKey) {
      return;
    }
    try {
      const result = await electron.getBackupEncryptionKey();
      if (!result.success || !result.key) {
        throw new Error(result.error || t('errors:server.unknown'));
      }
      setRevealedKey(result.key);
    } catch (error) {
      const message = translateServerError(error, t, t('errors:server.unknown'));
      toast.error({
        title: t('company.backup.revealKey.failed'),
        description: message,
      });
    }
  };

  const handleCopyRevealedKey = async () => {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey);
      toast.success({ title: t('company.backup.revealKey.copied') });
    } catch {
      toast.error({ title: t('company.backup.revealKey.copyFailed') });
    }
  };

  const supportsCrossDeviceRestore = Boolean(electron?.getBackupEncryptionKey);

  const actions = (
    <div className="flex flex-col gap-3 sm:flex-row">
      <button
        type="button"
        onClick={handleCreateBackup}
        disabled={!isDesktop || activeAction !== null}
        className="pv-btn primary"
      >
        <Save aria-hidden="true" />
        {activeAction === 'backup'
          ? t('company.backup.creating')
          : t('company.backup.createBackup')}
      </button>

      <button
        type="button"
        onClick={handleRequestRestoreBackup}
        disabled={!isDesktop || activeAction !== null}
        className="pv-btn outline"
      >
        <HardDriveDownload aria-hidden="true" />
        {activeAction === 'restore'
          ? t('company.backup.restoring')
          : t('company.backup.restoreBackup')}
      </button>

      {supportsCrossDeviceRestore && (
        <button
          type="button"
          onClick={() => setIsRevealConfirmOpen(true)}
          disabled={activeAction !== null}
          className="pv-btn outline"
          data-testid="backup-reveal-key"
        >
          <KeyRound aria-hidden="true" />
          {t('company.backup.revealKey.button')}
        </button>
      )}
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
            <h2 className="text-lg font-semibold text-secondary-950">
              {t('company.backup.title')}
            </h2>
            <p className="text-sm text-secondary-500">{t('company.backup.description')}</p>
          </div>
        </div>
        <DesktopOnlyChip />
      </div>

      <BackupProtectionPanel />

      <BackupSchedulePanel />

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

      {/* ENG-167b — cross-device restore key prompt */}
      <Modal
        isOpen={restoreKeyToken !== null}
        onClose={handleCancelRestoreKey}
        title={t('company.backup.keyPrompt.title')}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-secondary-600">{t('company.backup.keyPrompt.message')}</p>
          <div className="space-y-1">
            <label className="label" htmlFor="backup-restore-key-input">
              {t('company.backup.keyPrompt.inputLabel')}
            </label>
            <input
              id="backup-restore-key-input"
              type="text"
              value={restoreKeyInput}
              onChange={event => {
                setRestoreKeyInput(event.target.value);
                setRestoreKeyError(null);
              }}
              placeholder={t('company.backup.keyPrompt.inputPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              data-testid="backup-restore-key-input"
              className="input w-full font-mono text-xs"
            />
            {restoreKeyError && (
              <p
                className="text-sm text-danger-600"
                role="alert"
                data-testid="backup-restore-key-error"
              >
                {restoreKeyError}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" className="pv-btn outline" onClick={handleCancelRestoreKey}>
              {t('company.backup.keyPrompt.cancel')}
            </button>
            <button
              type="button"
              className="pv-btn primary"
              onClick={() => {
                void handleSubmitRestoreKey();
              }}
              disabled={activeAction !== null}
              data-testid="backup-restore-key-submit"
            >
              {activeAction === 'restore'
                ? t('company.backup.restoring')
                : t('company.backup.keyPrompt.submit')}
            </button>
          </div>
        </div>
      </Modal>

      {/* ENG-167b — reveal warning gate */}
      <ConfirmModal
        isOpen={isRevealConfirmOpen}
        onClose={() => setIsRevealConfirmOpen(false)}
        onConfirm={() => {
          void handleRevealKey();
        }}
        title={t('company.backup.revealKey.confirmTitle')}
        message={t('company.backup.revealKey.confirmMessage')}
        confirmText={t('company.backup.revealKey.confirmCta')}
        variant="danger"
      />

      {/* ENG-167b — revealed key (one showing; closes on dismiss) */}
      <Modal
        isOpen={revealedKey !== null}
        onClose={() => setRevealedKey(null)}
        title={t('company.backup.revealKey.title')}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-secondary-600">{t('company.backup.revealKey.message')}</p>
          <code
            className="block break-all rounded-xl border border-line bg-surface-2 px-4 py-3 font-mono text-xs text-secondary-900"
            data-testid="backup-revealed-key"
          >
            {revealedKey}
          </code>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              className="pv-btn outline"
              onClick={() => {
                void handleCopyRevealedKey();
              }}
            >
              <Copy aria-hidden="true" />
              {t('company.backup.revealKey.copy')}
            </button>
            <button type="button" className="pv-btn primary" onClick={() => setRevealedKey(null)}>
              {t('company.backup.revealKey.done')}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
