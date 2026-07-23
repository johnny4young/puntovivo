import { Cloud, CloudCog, KeyRound, PlugZap, Save, Unplug } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { Badge, Button } from '@/components/ui';
import { formatDateTime } from '@/lib/utils';
import type { BackupCloudVaultErrorCode, BackupCloudVaultStatus } from '@/types/electron';
import {
  cloudVaultFormFromStatus,
  EMPTY_CLOUD_VAULT_FORM,
  type CloudVaultForm,
} from './backupCloudVaultForm';
type CloudVaultAction = 'load' | 'save' | 'test' | 'disconnect' | null;
interface BackupCloudVaultPanelProps {
  refreshKey?: number;
}
export function BackupCloudVaultPanel({ refreshKey = 0 }: BackupCloudVaultPanelProps = {}) {
  const { t } = useTranslation('backupProtection');
  const toast = useToast();
  const electron = typeof window !== 'undefined' ? window.electron : undefined;
  const supported = Boolean(
    electron?.getBackupCloudVaultStatus &&
    electron.configureBackupCloudVault &&
    electron.disconnectBackupCloudVault &&
    electron.testBackupCloudVault
  );
  const [status, setStatus] = useState<BackupCloudVaultStatus | null>(null);
  const [form, setForm] = useState<CloudVaultForm>(EMPTY_CLOUD_VAULT_FORM);
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false);
  const [action, setAction] = useState<CloudVaultAction>(supported ? 'load' : null);
  const [error, setError] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const errorMessage = useCallback(
    (code: BackupCloudVaultErrorCode | undefined, fallback: string) => {
      if (code === 'configuration_invalid') return t('cloud.errors.configurationInvalid');
      if (code === 'configuration_missing') return t('cloud.errors.configurationMissing');
      if (code === 'secure_storage_unavailable') return t('cloud.errors.secureStorage');
      if (code === 'connection_failed') return t('cloud.errors.connection');
      if (code === 'upload_failed') return t('cloud.errors.upload');
      if (code === 'operation_in_progress') return t('cloud.errors.inProgress');
      return fallback;
    },
    [t]
  );
  const updateEditing = useCallback((next: boolean) => {
    editingRef.current = next;
    setEditing(next);
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!electron?.getBackupCloudVaultStatus) return;
    void electron
      .getBackupCloudVaultStatus()
      .then(result => {
        if (cancelled) return;
        if (!result.success || !result.status) {
          setError(errorMessage(result.error, t('cloud.errors.load')));
          return;
        }
        setStatus(result.status);
        // Snapshot-triggered evidence refreshes must not erase credentials the
        // administrator is currently replacing in this write-only form.
        if (!editingRef.current) {
          setForm(cloudVaultFormFromStatus(result.status));
          updateEditing(!result.status.configured);
        }
      })
      .catch(() => {
        if (!cancelled) setError(t('cloud.errors.load'));
      })
      .finally(() => {
        if (!cancelled) setAction(null);
      });
    return () => {
      cancelled = true;
    };
  }, [electron, errorMessage, refreshKey, t, updateEditing]);
  const updateField = <Key extends keyof CloudVaultForm>(
    field: Key,
    value: CloudVaultForm[Key]
  ) => {
    setForm(current => ({
      ...current,
      [field]: value,
    }));
    setError(null);
  };
  const handleSaveAndTest = async () => {
    if (!electron?.configureBackupCloudVault || !electron.testBackupCloudVault) return;
    setAction('save');
    setError(null);
    try {
      const configured = await electron.configureBackupCloudVault({
        endpoint: form.endpoint,
        region: form.region,
        bucket: form.bucket,
        prefix: form.prefix,
        forcePathStyle: form.forcePathStyle,
        accessKeyId: form.accessKeyId,
        secretAccessKey: form.secretAccessKey,
      });
      if (!configured.success || !configured.status) {
        throw new Error(configured.error ?? 'cloud_vault_unavailable');
      }
      setStatus(configured.status);
      setForm(cloudVaultFormFromStatus(configured.status));
      // Configuration is already persisted even when the following write
      // probe fails. Return to the redacted state so it can be retried safely.
      updateEditing(false);
      setAction('test');
      const tested = await electron.testBackupCloudVault();
      if (!tested.success || !tested.status) {
        if (tested.status) setStatus(tested.status);
        throw new Error(tested.error ?? 'connection_failed');
      }
      setStatus(tested.status);
      setForm(cloudVaultFormFromStatus(tested.status));
      updateEditing(false);
      toast.success({
        title: t('cloud.toast.connected'),
      });
    } catch (cause) {
      const code =
        cause instanceof Error ? (cause.message as BackupCloudVaultErrorCode) : undefined;
      setError(errorMessage(code, t('cloud.errors.save')));
    } finally {
      setAction(null);
    }
  };
  const handleTest = async () => {
    if (!electron?.testBackupCloudVault) return;
    setAction('test');
    setError(null);
    try {
      const result = await electron.testBackupCloudVault();
      if (result.status) setStatus(result.status);
      if (!result.success || !result.status) {
        throw new Error(result.error ?? 'connection_failed');
      }
      toast.success({
        title: t('cloud.toast.testPassed'),
      });
    } catch (cause) {
      const code =
        cause instanceof Error ? (cause.message as BackupCloudVaultErrorCode) : undefined;
      setError(errorMessage(code, t('cloud.errors.connection')));
    } finally {
      setAction(null);
    }
  };
  const handleDisconnect = async () => {
    if (!electron?.disconnectBackupCloudVault) return;
    setDisconnectOpen(false);
    setAction('disconnect');
    setError(null);
    try {
      const result = await electron.disconnectBackupCloudVault();
      if (!result.success || !result.status) {
        throw new Error(result.error ?? 'cloud_vault_unavailable');
      }
      setStatus(result.status);
      setForm(EMPTY_CLOUD_VAULT_FORM);
      updateEditing(true);
      toast.success({
        title: t('cloud.toast.disconnected'),
      });
    } catch (cause) {
      const code =
        cause instanceof Error ? (cause.message as BackupCloudVaultErrorCode) : undefined;
      setError(errorMessage(code, t('cloud.errors.disconnect')));
    } finally {
      setAction(null);
    }
  };
  const busy = action !== null;
  const formComplete = Boolean(
    form.endpoint.trim() &&
    form.region.trim() &&
    form.bucket.trim() &&
    form.prefix.trim() &&
    form.accessKeyId.trim() &&
    form.secretAccessKey
  );
  return (
    <section
      className="rounded-2xl border border-line bg-surface-1 p-4 sm:p-5"
      data-testid="backup-cloud-vault-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="pv-gt pv-gt-primary h-9 w-9 shrink-0">
            <Cloud className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="font-semibold text-secondary-950">{t('cloud.title')}</h3>
            <p className="mt-1 text-sm text-secondary-600">{t('cloud.description')}</p>
          </div>
        </div>
        {status?.configured && (
          <Badge variant="success" marker="dot" data-testid="backup-cloud-connected-badge">
            {t('cloud.connected')}
          </Badge>
        )}
      </div>

      {!supported ? (
        <p className="mt-4 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-secondary-600">
          {t('cloud.unsupported')}
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          {status && !status.secureStorageAvailable && (
            <div
              id="backup-cloud-secure-storage-alert"
              className="rounded-xl border border-danger-300 bg-danger-50 px-3 py-2 text-sm text-danger-700"
              role="alert"
            >
              {t('cloud.secureStorageUnavailable')}
            </div>
          )}

          {status?.configured && !editing && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="metric-tile p-3">
                  <p className="pv-kicker">{t('cloud.destination')}</p>
                  <p className="mt-1 break-all text-sm font-semibold text-secondary-950">
                    {status.bucket}
                  </p>
                  <p className="mt-1 break-all text-xs text-secondary-500">{status.endpoint}</p>
                </div>
                <div className="metric-tile p-3">
                  <p className="pv-kicker">{t('cloud.prefix')}</p>
                  <p className="mt-1 break-all font-mono text-xs text-secondary-800">
                    {status.prefix}
                  </p>
                </div>
                <div className="metric-tile p-3">
                  <p className="pv-kicker">{t('cloud.credential')}</p>
                  <p className="mt-1 font-mono text-sm font-semibold text-secondary-950">
                    {status.accessKeyHint}
                  </p>
                </div>
                <div className="metric-tile p-3">
                  <p className="pv-kicker">{t('cloud.lastSuccess')}</p>
                  <p
                    className="mt-1 text-sm font-semibold text-secondary-950"
                    data-testid="backup-cloud-last-success"
                  >
                    {status.lastSuccessAt ? formatDateTime(status.lastSuccessAt) : t('cloud.never')}
                  </p>
                </div>
              </div>

              {status.lastObjectKey && (
                <div className="rounded-xl border border-line bg-surface-2 px-3 py-2">
                  <p className="pv-kicker">{t('cloud.lastObject')}</p>
                  <p
                    className="mt-1 break-all font-mono text-xs text-secondary-700"
                    data-testid="backup-cloud-last-object"
                  >
                    {status.lastObjectKey}
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => void handleTest()}
                  disabled={busy || !status.secureStorageAvailable}
                  aria-describedby={
                    status.secureStorageAvailable ? undefined : 'backup-cloud-secure-storage-alert'
                  }
                  variant="primary"
                >
                  <PlugZap aria-hidden="true" />
                  {action === 'test' ? t('cloud.testing') : t('cloud.test')}
                </Button>
                <Button
                  type="button"
                  onClick={() => updateEditing(true)}
                  disabled={busy}
                  variant="outline"
                >
                  <CloudCog aria-hidden="true" />
                  {t('cloud.replace')}
                </Button>
                <Button
                  type="button"
                  className="text-danger-600"
                  onClick={() => setDisconnectOpen(true)}
                  disabled={busy}
                  variant="ghost"
                >
                  <Unplug aria-hidden="true" />
                  {t('cloud.disconnect')}
                </Button>
              </div>
            </div>
          )}

          {status && editing && (
            <form
              className="space-y-4"
              onSubmit={event => {
                event.preventDefault();
                void handleSaveAndTest();
              }}
              data-testid="backup-cloud-vault-form"
            >
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm font-medium text-secondary-700">
                  <span>{t('cloud.fields.endpoint')}</span>
                  <input
                    className="pv-input w-full"
                    type="url"
                    value={form.endpoint}
                    onChange={event => updateField('endpoint', event.target.value)}
                    placeholder={t('cloud.placeholders.endpoint')}
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={busy}
                    required
                  />
                </label>
                <label className="space-y-1 text-sm font-medium text-secondary-700">
                  <span>{t('cloud.fields.region')}</span>
                  <input
                    className="pv-input w-full"
                    value={form.region}
                    onChange={event => updateField('region', event.target.value)}
                    placeholder={t('cloud.placeholders.region')}
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={busy}
                    required
                  />
                </label>
                <label className="space-y-1 text-sm font-medium text-secondary-700">
                  <span>{t('cloud.fields.bucket')}</span>
                  <input
                    className="pv-input w-full"
                    value={form.bucket}
                    onChange={event => updateField('bucket', event.target.value)}
                    placeholder={t('cloud.placeholders.bucket')}
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={busy}
                    required
                  />
                </label>
                <label className="space-y-1 text-sm font-medium text-secondary-700">
                  <span>{t('cloud.fields.prefix')}</span>
                  <input
                    className="pv-input w-full"
                    value={form.prefix}
                    onChange={event => updateField('prefix', event.target.value)}
                    placeholder={t('cloud.placeholders.prefix')}
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={busy}
                    required
                  />
                </label>
                <label className="space-y-1 text-sm font-medium text-secondary-700">
                  <span>{t('cloud.fields.accessKey')}</span>
                  <input
                    className="pv-input w-full font-mono"
                    value={form.accessKeyId}
                    onChange={event => updateField('accessKeyId', event.target.value)}
                    placeholder={t('cloud.placeholders.accessKey')}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={busy}
                    required
                  />
                </label>
                <label className="space-y-1 text-sm font-medium text-secondary-700">
                  <span>{t('cloud.fields.secretKey')}</span>
                  <input
                    className="pv-input w-full font-mono"
                    type="password"
                    value={form.secretAccessKey}
                    onChange={event => updateField('secretAccessKey', event.target.value)}
                    placeholder={t('cloud.placeholders.secretKey')}
                    autoComplete="new-password"
                    disabled={busy}
                    required
                  />
                </label>
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-secondary-700">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-line"
                  checked={form.forcePathStyle}
                  onChange={event => updateField('forcePathStyle', event.target.checked)}
                  disabled={busy}
                />
                <span>
                  <span className="block font-medium text-secondary-900">
                    {t('cloud.fields.pathStyle')}
                  </span>
                  <span className="mt-0.5 block text-xs text-secondary-500">
                    {t('cloud.fields.pathStyleHelp')}
                  </span>
                </span>
              </label>

              <div className="flex items-start gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-900">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>{t('cloud.securityNote')}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  disabled={busy || !formComplete || !status.secureStorageAvailable}
                  aria-describedby={
                    status.secureStorageAvailable ? undefined : 'backup-cloud-secure-storage-alert'
                  }
                  variant="primary"
                >
                  <Save aria-hidden="true" />
                  {action === 'save' || action === 'test'
                    ? t('cloud.saving')
                    : t('cloud.saveAndTest')}
                </Button>
                {status.configured && (
                  <Button
                    type="button"
                    onClick={() => {
                      setForm(cloudVaultFormFromStatus(status));
                      updateEditing(false);
                      setError(null);
                    }}
                    disabled={busy}
                    variant="outline"
                  >
                    {t('cloud.cancel')}
                  </Button>
                )}
              </div>
            </form>
          )}

          {error && (
            <p
              className="rounded-xl border border-danger-300 bg-danger-50 px-3 py-2 text-sm text-danger-700"
              role="alert"
            >
              {error}
            </p>
          )}
          {status?.lastError && !error && (
            <p
              className="rounded-xl border border-warning-300 bg-warning-50 px-3 py-2 text-sm text-warning-900"
              role="status"
            >
              {status.lastError === 'connection_failed'
                ? t('cloud.errors.connection')
                : t('cloud.errors.upload')}
            </p>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        onConfirm={() => void handleDisconnect()}
        title={t('cloud.disconnectModal.title')}
        message={t('cloud.disconnectModal.message')}
        confirmText={t('cloud.disconnectModal.confirm')}
        variant="danger"
      />
    </section>
  );
}
