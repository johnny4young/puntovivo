import {
  AlertTriangle,
  Copy,
  Database,
  Eye,
  EyeOff,
  HardDriveDownload,
  KeyRound,
  RefreshCw,
  Save,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal, Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { DesktopOnlyChip, DisabledControl } from '@/components/feedback/DesktopOnlyChip';
import { EmptyState } from '@/components/feedback/EmptyState';
import { translateServerError } from '@/lib/translateServerError';
import { BackupProtectionPanel } from './BackupProtectionPanel';
import { BackupCloudVaultPanel } from './BackupCloudVaultPanel';
import { BackupRestoreDrillPanel } from './BackupRestoreDrillPanel';
import { BackupSchedulePanel } from './BackupSchedulePanel';
import { Button } from '@/components/ui';
import { DeepLinkFocusTarget } from '@/components/experience/DeepLinkFocusTarget';
import { generateBackupPassphrase } from './backupPassphrase';
type BackupAction = 'backup' | 'restore' | 'rotate' | null;

interface CompanyBackupCardProps {
  focusRestore?: boolean;
}

/** shape of the server's backup encryption key. */
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
export function CompanyBackupCard({ focusRestore = false }: CompanyBackupCardProps) {
  const { t } = useTranslation('settings');
  const [activeAction, setActiveAction] = useState<BackupAction>(null);
  const [cloudVaultRefreshKey, setCloudVaultRefreshKey] = useState(0);
  const [isRestoreConfirmOpen, setIsRestoreConfirmOpen] = useState(false);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  // cross-device restore key prompt. Non-null while the
  // main process holds a staged bundle waiting for the source
  // device's key (the token must be echoed back to complete it).
  const [restoreKeyToken, setRestoreKeyToken] = useState<string | null>(null);
  const [restoreKeyInput, setRestoreKeyInput] = useState('');
  const [restoreKeyError, setRestoreKeyError] = useState<string | null>(null);
  // admin-gated reveal of this install's backup key.
  const [isRevealConfirmOpen, setIsRevealConfirmOpen] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [isRotateConfirmOpen, setIsRotateConfirmOpen] = useState(false);
  // optional passphrase gate before a manual backup: wraps
  // the install key inside the bundle for phrase-based restores.
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createPassphrase, setCreatePassphrase] = useState('');
  const [createPassphraseError, setCreatePassphraseError] = useState<string | null>(null);
  const [createPassphraseGenerated, setCreatePassphraseGenerated] = useState(false);
  const [showCreatePassphrase, setShowCreatePassphrase] = useState(false);
  // A staged rotation left by a crash only resolves on app restart;
  // the button is disabled with a restart hint until then.
  const [rotationPending, setRotationPending] = useState(false);
  const toast = useToast();
  const electron = typeof window !== 'undefined' ? window.electron : undefined;
  const isDesktop = Boolean(electron);

  useEffect(() => {
    let cancelled = false;
    void electron
      ?.getDbKeyRotationStatus?.()
      .then(status => {
        if (!cancelled) setRotationPending(status.pending);
      })
      .catch(() => {
        // Non-secret status probe; the button stays enabled and the
        // rotation handler reports its own closed error codes.
      });
    return () => {
      cancelled = true;
    };
  }, [electron]);
  const handleRequestCreateBackup = () => {
    if (!electron) {
      toast.info({
        title: t('company.backup.toast.desktopOnly'),
      });
      setStatus({
        tone: 'info',
        message: t('company.backup.toast.desktopOnlyDetail'),
      });
      return;
    }
    setCreatePassphrase('');
    setCreatePassphraseError(null);
    setCreatePassphraseGenerated(false);
    setShowCreatePassphrase(false);
    setIsCreateModalOpen(true);
  };
  const closeCreatePassphraseModal = () => {
    setIsCreateModalOpen(false);
    setCreatePassphrase('');
    setCreatePassphraseError(null);
    setCreatePassphraseGenerated(false);
    setShowCreatePassphrase(false);
  };
  const handleGeneratePassphrase = () => {
    try {
      setCreatePassphrase(generateBackupPassphrase());
      setCreatePassphraseError(null);
      setCreatePassphraseGenerated(true);
      setShowCreatePassphrase(true);
    } catch {
      setCreatePassphraseError(t('company.backup.createPassphrase.generationFailed'));
    }
  };
  const handleCreateBackup = async () => {
    if (!electron) {
      return;
    }
    const passphrase = createPassphrase.trim();
    if (passphrase.length > 0 && passphrase.length < 10) {
      setCreatePassphraseError(t('company.backup.createPassphrase.tooShort'));
      return;
    }
    setIsCreateModalOpen(false);
    setCreatePassphrase('');
    setCreatePassphraseGenerated(false);
    setShowCreatePassphrase(false);
    setActiveAction('backup');
    try {
      const result = await electron.createDatabaseBackup(
        passphrase.length > 0 ? passphrase : undefined
      );
      if (result.cancelled) {
        toast.info({
          title: t('company.backup.toast.cancelledTitle'),
        });
        setStatus({
          tone: 'info',
          message: t('company.backup.toast.cancelledDetail'),
        });
        return;
      }
      if (!result.success) {
        throw new Error(result.error || t('company.backup.toast.failed'));
      }
      toast.success({
        title: t('company.backup.toast.created'),
      });
      setStatus({
        tone: 'success',
        message: result.path
          ? t('company.backup.toast.savedPath', {
              path: result.path,
            })
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
  const handleCancelCreateBackup = async () => {
    if (!electron?.cancelDatabaseBackup) return;
    setStatus({
      tone: 'info',
      message: t('company.backup.createPassphrase.cancellationRequested'),
    });
    try {
      await electron.cancelDatabaseBackup();
    } catch {
      // The create promise owns the final result. Avoid replacing its neutral
      // cancellation/success state with an internal IPC rejection.
    }
  };
  const handleRequestRestoreBackup = () => {
    if (!electron) {
      toast.info({
        title: t('company.backup.toast.restoreDesktopOnly'),
      });
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
        toast.info({
          title: t('company.backup.toast.restoreCancelledTitle'),
        });
        setStatus({
          tone: 'info',
          message: t('company.backup.toast.restoreCancelledDetail'),
        });
        setIsRestoreConfirmOpen(false);
        return;
      }

      // the bundle comes from another device: the main
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
      toast.success({
        title: t('company.backup.toast.restored'),
      });
      if (result.unauthenticated) {
        // An unauthenticated restore must never be silent.
        toast.warning({
          title: t('company.backup.toast.restoredUnauthenticated'),
          description: t('company.backup.toast.restoredUnauthenticatedDetail'),
        });
      }
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

  // abandoning the key prompt must also clear the
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

  // complete the cross-device restore with the key the
  // operator copied from the SOURCE device. A wrong key keeps the
  // staged bundle on the main side so the prompt can retry.
  const handleSubmitRestoreKey = async () => {
    if (!electron?.provideRestoreKey || !restoreKeyToken) {
      return;
    }
    const candidate = restoreKeyInput.trim();
    // Either the source install's 64-hex key OR the backup passphrase
    // (when the bundle carries a key-wrap). The main process decides
    // which one it received; the renderer only rejects the obviously
    // unusable empty/too-short case.
    if (!BACKUP_KEY_PATTERN.test(candidate) && candidate.length < 10) {
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
      toast.success({
        title: t('company.backup.toast.restored'),
      });
      if (result.unauthenticated) {
        // An unauthenticated restore must never be silent.
        toast.warning({
          title: t('company.backup.toast.restoredUnauthenticated'),
          description: t('company.backup.toast.restoredUnauthenticatedDetail'),
        });
      }
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
      setStatus({
        tone: 'error',
        message,
      });
    } finally {
      setActiveAction(null);
    }
  };

  // reveal this install's backup key after an explicit
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
        // Closed code union from the main process — raw keychain or
        // audit diagnostics never cross the bridge.
        const description =
          result.error === 'audit_unavailable' || result.error === 'key_unavailable'
            ? t(`company.backup.revealKey.${result.error}`)
            : t('errors:server.unknown');
        toast.error({
          title: t('company.backup.revealKey.failed'),
          description,
        });
        return;
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
      toast.success({
        title: t('company.backup.revealKey.copied'),
      });
    } catch {
      toast.error({
        title: t('company.backup.revealKey.copyFailed'),
      });
    }
  };
  // rotate this install's SQLCipher key after an explicit
  // confirmation. The embedded server restarts around the offline
  // rekey, so the operation blocks every other backup action.
  const handleRotateKey = async () => {
    setIsRotateConfirmOpen(false);
    if (!electron?.rotateDbEncryptionKey) {
      return;
    }
    setActiveAction('rotate');
    try {
      const result = await electron.rotateDbEncryptionKey();
      if (!result.success) {
        const description =
          result.error === 'unsupported' ||
          result.error === 'rotation_pending' ||
          result.error === 'rotation_failed'
            ? t(`company.backup.rotateKey.${result.error}`)
            : t('errors:server.unknown');
        toast.error({
          title: t('company.backup.rotateKey.failed'),
          description,
        });
        return;
      }
      toast.success({
        title: t('company.backup.rotateKey.success'),
        description: t('company.backup.rotateKey.successDescription'),
      });
    } catch (error) {
      const message = translateServerError(error, t, t('errors:server.unknown'));
      toast.error({
        title: t('company.backup.rotateKey.failed'),
        description: message,
      });
    } finally {
      setActiveAction(null);
    }
  };
  const supportsCrossDeviceRestore = Boolean(electron?.getBackupEncryptionKey);
  const supportsKeyRotation = Boolean(electron?.rotateDbEncryptionKey);
  const actions = (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Button
        type="button"
        onClick={handleRequestCreateBackup}
        disabled={!isDesktop || activeAction !== null}
        variant="primary"
      >
        <Save aria-hidden="true" />
        {activeAction === 'backup'
          ? t('company.backup.creating')
          : t('company.backup.createBackup')}
      </Button>

      {activeAction === 'backup' && electron?.cancelDatabaseBackup ? (
        <Button
          type="button"
          onClick={() => {
            void handleCancelCreateBackup();
          }}
          variant="outline"
          data-testid="backup-create-cancel-active"
        >
          <X aria-hidden="true" />
          {t('company.backup.createPassphrase.cancelActive')}
        </Button>
      ) : null}

      <Button
        type="button"
        onClick={handleRequestRestoreBackup}
        disabled={!isDesktop || activeAction !== null}
        variant="outline"
      >
        <HardDriveDownload aria-hidden="true" />
        {activeAction === 'restore'
          ? t('company.backup.restoring')
          : t('company.backup.restoreBackup')}
      </Button>

      {supportsCrossDeviceRestore && (
        <Button
          type="button"
          onClick={() => setIsRevealConfirmOpen(true)}
          disabled={activeAction !== null}
          data-testid="backup-reveal-key"
          variant="outline"
        >
          <KeyRound aria-hidden="true" />
          {t('company.backup.revealKey.button')}
        </Button>
      )}

      {supportsKeyRotation && (
        <Button
          type="button"
          onClick={() => setIsRotateConfirmOpen(true)}
          disabled={activeAction !== null || rotationPending}
          data-testid="backup-rotate-key"
          title={rotationPending ? t('company.backup.rotateKey.pendingHint') : undefined}
          variant="outline"
        >
          <KeyRound aria-hidden="true" />
          {activeAction === 'rotate'
            ? t('company.backup.rotateKey.rotating')
            : rotationPending
              ? t('company.backup.rotateKey.pendingButton')
              : t('company.backup.rotateKey.button')}
        </Button>
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

      <BackupSchedulePanel
        onSnapshotCreated={() => setCloudVaultRefreshKey(current => current + 1)}
      />
      <BackupCloudVaultPanel refreshKey={cloudVaultRefreshKey} />
      <BackupRestoreDrillPanel />

      <DeepLinkFocusTarget
        active={focusRestore}
        id="backup-restore"
        label={t('company.backup.restoreBackup')}
        testId="company-backup-restore-target"
      >
        <div className="space-y-5">
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
        </div>
      </DeepLinkFocusTarget>

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

      {/* cross-device restore key prompt */}
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
            <Button type="button" onClick={handleCancelRestoreKey} variant="outline">
              {t('company.backup.keyPrompt.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleSubmitRestoreKey();
              }}
              disabled={activeAction !== null}
              data-testid="backup-restore-key-submit"
              variant="primary"
            >
              {activeAction === 'restore'
                ? t('company.backup.restoring')
                : t('company.backup.keyPrompt.submit')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* optional passphrase gate before a manual backup */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={closeCreatePassphraseModal}
        title={t('company.backup.createPassphrase.title')}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-secondary-600">
            {t('company.backup.createPassphrase.message')}
          </p>
          <div className="space-y-1">
            <label className="label" htmlFor="backup-create-passphrase-input">
              {t('company.backup.createPassphrase.inputLabel')}
            </label>
            <input
              id="backup-create-passphrase-input"
              type={showCreatePassphrase ? 'text' : 'password'}
              value={createPassphrase}
              onChange={event => {
                setCreatePassphrase(event.target.value);
                setCreatePassphraseError(null);
                setCreatePassphraseGenerated(false);
              }}
              placeholder={t('company.backup.createPassphrase.placeholder')}
              className="input w-full"
              data-testid="backup-create-passphrase"
              aria-describedby={
                createPassphrase.trim().length >= 10
                  ? 'backup-create-passphrase-feedback'
                  : undefined
              }
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleGeneratePassphrase}
                data-testid="backup-generate-passphrase"
              >
                <RefreshCw aria-hidden="true" />
                {t('company.backup.createPassphrase.generate')}
              </Button>
              {createPassphrase.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowCreatePassphrase(current => !current)}
                  aria-pressed={showCreatePassphrase}
                >
                  {showCreatePassphrase ? (
                    <EyeOff aria-hidden="true" />
                  ) : (
                    <Eye aria-hidden="true" />
                  )}
                  {showCreatePassphrase
                    ? t('company.backup.createPassphrase.hide')
                    : t('company.backup.createPassphrase.show')}
                </Button>
              ) : null}
            </div>
            {createPassphrase.trim().length >= 10 ? (
              <p
                id="backup-create-passphrase-feedback"
                className="mt-2 text-xs text-secondary-600"
                role="status"
                data-testid="backup-passphrase-feedback"
              >
                {createPassphraseGenerated
                  ? t('company.backup.createPassphrase.generatedFeedback')
                  : t('company.backup.createPassphrase.requirementMet')}
              </p>
            ) : null}
            {createPassphraseError && (
              <p className="text-sm text-danger-600" role="alert">
                {createPassphraseError}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={closeCreatePassphraseModal}>
              {t('company.backup.createPassphrase.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              data-testid="backup-create-confirm"
              onClick={() => {
                void handleCreateBackup();
              }}
            >
              {t('company.backup.createPassphrase.cta')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* rotation warning gate */}
      <ConfirmModal
        isOpen={isRotateConfirmOpen}
        onClose={() => setIsRotateConfirmOpen(false)}
        onConfirm={() => {
          void handleRotateKey();
        }}
        title={t('company.backup.rotateKey.confirmTitle')}
        message={t('company.backup.rotateKey.confirmMessage')}
        confirmText={t('company.backup.rotateKey.confirmCta')}
        variant="danger"
      />

      {/* reveal warning gate */}
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

      {/* revealed key (one showing; closes on dismiss) */}
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
            <Button
              type="button"
              onClick={() => {
                void handleCopyRevealedKey();
              }}
              variant="outline"
            >
              <Copy aria-hidden="true" />
              {t('company.backup.revealKey.copy')}
            </Button>
            <Button type="button" onClick={() => setRevealedKey(null)} variant="primary">
              {t('company.backup.revealKey.done')}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
