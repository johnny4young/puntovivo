import { AlertTriangle, CheckCircle2, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BackupProtectionProvider, BackupProtectionStatus } from '@/types/electron.d';

type ProtectionLoadState =
  | { kind: 'browser' }
  | { kind: 'unsupported' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; status: BackupProtectionStatus };

const PROVIDER_KEYS: Record<BackupProtectionProvider, string> = {
  environment: 'providers.environment',
  macos_keychain: 'providers.macosKeychain',
  windows_dpapi: 'providers.windowsDpapi',
  linux_libsecret: 'providers.linuxLibsecret',
  linux_kwallet: 'providers.linuxKwallet',
  linux_basic_text: 'providers.linuxBasicText',
  unknown: 'providers.unknown',
};

function resolveReadyTone(status: BackupProtectionStatus): {
  icon: typeof ShieldCheck;
  classes: string;
  badgeKey: string;
  summaryKey: string;
} {
  if (status.protected) {
    return {
      icon: ShieldCheck,
      classes: 'border-success-300/70 bg-success-50 text-success-900',
      badgeKey: 'states.protected.badge',
      summaryKey: 'states.protected.summary',
    };
  }

  if (status.keyStorage === 'environment') {
    return {
      icon: KeyRound,
      classes: 'border-warning-300/70 bg-warning-50 text-warning-900',
      badgeKey: 'states.development.badge',
      summaryKey: 'states.development.summary',
    };
  }

  return {
    icon: AlertTriangle,
    classes: 'border-danger-300/70 bg-danger-50 text-danger-800',
    badgeKey: 'states.degraded.badge',
    summaryKey: 'states.degraded.summary',
  };
}

export function BackupProtectionPanel() {
  const { t } = useTranslation('backupProtection');
  const electron = typeof window !== 'undefined' ? window.electron : undefined;
  const getProtectionStatus = electron?.getBackupProtectionStatus;
  const [state, setState] = useState<ProtectionLoadState>(() => {
    if (!electron) return { kind: 'browser' };
    if (!getProtectionStatus) return { kind: 'unsupported' };
    return { kind: 'loading' };
  });

  useEffect(() => {
    if (!getProtectionStatus) return;
    let cancelled = false;

    void getProtectionStatus()
      .then(result => {
        if (cancelled) return;
        if (result.success && result.status) {
          setState({ kind: 'ready', status: result.status });
          return;
        }
        setState({ kind: 'error' });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [getProtectionStatus]);

  return (
    <div
      className="rounded-2xl border border-line bg-surface-2 p-4"
      data-testid="backup-protection-panel"
    >
      <div className="flex items-start gap-3">
        <span className="pv-gt pv-gt-primary h-9 w-9 shrink-0">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="font-semibold text-secondary-950">{t('title')}</h3>
          <p className="text-sm text-secondary-600">{t('description')}</p>
        </div>
      </div>

      {state.kind === 'loading' && (
        <div className="mt-4 flex items-center gap-2 text-sm text-secondary-600" role="status">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('states.loading')}
        </div>
      )}

      {(state.kind === 'browser' || state.kind === 'unsupported') && (
        <div className="mt-4 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-secondary-700">
          {t(state.kind === 'browser' ? 'states.browser' : 'states.unsupported')}
        </div>
      )}

      {state.kind === 'error' && (
        <div
          className="mt-4 flex items-start gap-2 rounded-xl border border-danger-300/70 bg-danger-50 px-3 py-2 text-sm text-danger-800"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t('states.error')}</span>
        </div>
      )}

      {state.kind === 'ready' &&
        (() => {
          const tone = resolveReadyTone(state.status);
          const StateIcon = tone.icon;
          return (
            <div className="mt-4 space-y-3" data-testid="backup-protection-ready" role="status">
              <div className={`rounded-xl border px-3 py-2.5 ${tone.classes}`}>
                <div className="flex items-center gap-2">
                  <StateIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="text-sm font-semibold">{t(tone.badgeKey)}</span>
                </div>
                <p className="mt-1 text-sm opacity-90">{t(tone.summaryKey)}</p>
              </div>

              <dl className="grid gap-2 text-sm sm:grid-cols-3">
                <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
                  <dt className="text-xs font-medium uppercase tracking-wide text-secondary-500">
                    {t('details.encryption')}
                  </dt>
                  <dd className="mt-1 flex items-center gap-1.5 font-medium text-secondary-900">
                    {state.status.databaseEncrypted ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-success-600" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-danger-600" aria-hidden="true" />
                    )}
                    {state.status.databaseEncrypted
                      ? t('details.sqlcipher')
                      : t('details.notPrepared')}
                  </dd>
                </div>

                <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
                  <dt className="text-xs font-medium uppercase tracking-wide text-secondary-500">
                    {t('details.keyStorage')}
                  </dt>
                  <dd className="mt-1 font-medium text-secondary-900">
                    {t(PROVIDER_KEYS[state.status.provider])}
                  </dd>
                </div>

                <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
                  <dt className="text-xs font-medium uppercase tracking-wide text-secondary-500">
                    {t('details.recovery')}
                  </dt>
                  <dd className="mt-1 font-medium text-secondary-900">
                    {state.status.recoveryKeyAvailable
                      ? t('details.recoveryAvailable')
                      : t('details.recoveryUnavailable')}
                  </dd>
                </div>
              </dl>

              <p className="text-xs text-secondary-500">{t('securityNote')}</p>
            </div>
          );
        })()}
    </div>
  );
}
