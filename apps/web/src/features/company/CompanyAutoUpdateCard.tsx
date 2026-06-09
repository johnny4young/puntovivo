import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, ExternalLink, RefreshCw, RotateCcw, Sparkles } from 'lucide-react';
import { useToast } from '@/components/feedback/ToastProvider';
import { DesktopOnlyChip, DisabledControl } from '@/components/feedback/DesktopOnlyChip';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { formatDateTime } from '@/lib/utils';

type AutoUpdateState = 'unavailable' | 'idle' | 'checking' | 'available' | 'downloaded' | 'error';

/**
 * How an available update reaches the user. `auto` (public repo) downloads +
 * installs via Squirrel; `manual` (private repo, notify-only) just surfaces the
 * release so the user downloads it themselves. Optional for back-compat with
 * older desktop builds whose status payload predates this field.
 */
type AutoUpdateInstallMode = 'auto' | 'manual';

interface AutoUpdateStatus {
  isAvailable: boolean;
  state: AutoUpdateState;
  installMode?: AutoUpdateInstallMode;
  currentVersion: string;
  lastCheckedAt: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  updateUrl: string | null;
  error: string | null;
  reason: string | null;
}

const autoUpdateStatusQueryKey = ['desktop', 'auto-update-status'] as const;

const defaultAutoUpdateStatus: AutoUpdateStatus = {
  isAvailable: false,
  state: 'unavailable',
  installMode: 'auto',
  currentVersion: '',
  lastCheckedAt: null,
  releaseName: null,
  releaseNotes: null,
  releaseDate: null,
  updateUrl: null,
  error: null,
  reason: null,
};

type BadgeTone = 'success' | 'warning' | 'danger' | 'primary' | 'neutral';

interface StatusBadgeProps {
  state: AutoUpdateState;
  installMode: AutoUpdateInstallMode;
}

function StatusBadge({ state, installMode }: StatusBadgeProps) {
  const { t } = useTranslation('settings');
  const labelMap: Record<AutoUpdateState, string> = {
    unavailable: t('company.updater.statusBadge.unavailable'),
    idle: t('company.updater.statusBadge.idle'),
    checking: t('company.updater.statusBadge.checking'),
    // In notify-only mode "available" means downloadable, not downloading.
    available:
      installMode === 'manual'
        ? t('company.updater.statusBadge.availableManual')
        : t('company.updater.statusBadge.available'),
    downloaded: t('company.updater.statusBadge.downloaded'),
    error: t('company.updater.statusBadge.error'),
  };
  const toneMap: Record<AutoUpdateState, BadgeTone> = {
    unavailable: 'neutral',
    idle: 'success',
    checking: 'primary',
    available: 'primary',
    downloaded: 'warning',
    error: 'danger',
  };

  return <span className={`pv-badge ${toneMap[state]}`}>{labelMap[state]}</span>;
}

interface UpdateMetricProps {
  label: string;
  value: string;
}

function UpdateMetric({ label, value }: UpdateMetricProps) {
  return (
    <div className="surface-panel-muted">
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-fg2">{label}</p>
      <p className="mt-2 font-mono text-sm font-semibold text-fg1">{value}</p>
    </div>
  );
}

function getStatusMessage(status: AutoUpdateStatus, t: (key: string) => string): string {
  const installMode = status.installMode ?? 'auto';
  switch (status.state) {
    case 'unavailable':
      return status.reason ?? t('company.updater.statusMessage.unavailable');
    case 'checking':
      return t('company.updater.statusMessage.checking');
    case 'available':
      return installMode === 'manual'
        ? t('company.updater.statusMessage.availableManual')
        : t('company.updater.statusMessage.available');
    case 'downloaded':
      return t('company.updater.statusMessage.downloaded');
    case 'error':
      return status.error ?? t('company.updater.statusMessage.error');
    case 'idle':
    default:
      return t('company.updater.statusMessage.idle');
  }
}

export function CompanyAutoUpdateCard() {
  const { t } = useTranslation('settings');
  const electron = typeof window !== 'undefined' ? window.electron : undefined;
  const isDesktop = Boolean(electron);
  const toast = useToast();
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: autoUpdateStatusQueryKey,
    queryFn: async () => {
      if (!window.electron) {
        return defaultAutoUpdateStatus;
      }

      return window.electron.getAutoUpdateStatus();
    },
    enabled: isDesktop,
    refetchInterval: 30_000,
  });
  const checkMutation = useMutation({
    mutationFn: async () => {
      if (!window.electron) {
        throw new Error('App updates are available only in the desktop app.');
      }

      return window.electron.checkForAppUpdates();
    },
    onSuccess: status => {
      queryClient.setQueryData(autoUpdateStatusQueryKey, status);
      toast.info({
        title: status.isAvailable ? t('company.updater.toast.checkingForUpdates') : t('company.updater.toast.updatesUnavailable'),
        description: status.isAvailable ? undefined : status.reason ?? undefined,
      });
    },
    onError: onErrorToast(toast, t, { titleKey: 'settings:company.updater.toast.checkError' }),
  });
  const restartMutation = useMutation({
    mutationFn: async () => {
      if (!window.electron) {
        throw new Error('App updates are available only in the desktop app.');
      }

      const result = await window.electron.restartToApplyAppUpdate();

      if (!result.success) {
        throw new Error(result.error || 'Unable to restart and install the update.');
      }
    },
    onSuccess: () => {
      toast.info({
        title: t('company.updater.toast.restarting'),
        description: t('company.updater.toast.restartDescription'),
      });
    },
    onError: onErrorToast(toast, t, { titleKey: 'settings:company.updater.toast.restartError' }),
  });

  const status = statusQuery.data ?? defaultAutoUpdateStatus;
  const installMode: AutoUpdateInstallMode = status.installMode ?? 'auto';
  const canViewRelease = status.state === 'available' && Boolean(status.updateUrl);
  const releaseLabel =
    status.releaseName ?? (status.state === 'downloaded' ? t('company.updater.downloadedUpdateReady') : t('company.updater.none'));
  const currentVersionLabel = status.currentVersion || t('company.updater.unknown');

  const actions = (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        className="pv-btn outline disabled:cursor-not-allowed disabled:opacity-60"
        disabled={
          !isDesktop ||
          !status.isAvailable ||
          checkMutation.isPending ||
          restartMutation.isPending ||
          status.state === 'checking'
        }
        onClick={() => {
          void checkMutation.mutateAsync();
        }}
      >
        <RefreshCw className={checkMutation.isPending ? 'animate-spin' : ''} aria-hidden="true" />
        {checkMutation.isPending ? t('company.updater.actions.checking') : t('company.updater.actions.checkForUpdates')}
      </button>

      {installMode === 'manual' ? (
        // Notify-only: no in-place install — the user opens the release page to
        // download. The https link routes through the main process'
        // setWindowOpenHandler -> shell.openExternal (sandbox-safe).
        canViewRelease && status.updateUrl ? (
          <a
            className="pv-btn primary"
            href={status.updateUrl}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink aria-hidden="true" />
            {t('company.updater.actions.viewRelease')}
          </a>
        ) : (
          <button
            type="button"
            className="pv-btn primary disabled:cursor-not-allowed disabled:opacity-60"
            disabled
          >
            <ExternalLink aria-hidden="true" />
            {t('company.updater.actions.viewRelease')}
          </button>
        )
      ) : (
        <button
          type="button"
          className="pv-btn primary disabled:cursor-not-allowed disabled:opacity-60"
          disabled={
            !isDesktop ||
            status.state !== 'downloaded' ||
            checkMutation.isPending ||
            restartMutation.isPending
          }
          onClick={() => {
            void restartMutation.mutateAsync();
          }}
        >
          {restartMutation.isPending ? (
            <RefreshCw className="animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw aria-hidden="true" />
          )}
          {restartMutation.isPending
            ? t('company.updater.actions.restarting')
            : t('company.updater.actions.restartToInstall')}
        </button>
      )}
    </div>
  );

  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="pv-gt pv-gt-ink flex h-10 w-10 flex-shrink-0 items-center justify-center">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="pv-title text-lg">{t('company.updater.title')}</h2>
            <p className="mt-1 text-sm text-fg3">{t('company.updater.description')}</p>
          </div>
        </div>
        {!isDesktop && <DesktopOnlyChip />}
      </div>

      {!isDesktop && <p className="mt-3 text-xs text-fg3">{t('company.updater.desktopOnly')}</p>}

      {statusQuery.error && (
        <div className="mt-4 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {translateServerError(statusQuery.error, t, t('errors:server.unknown'))}
        </div>
      )}

      <div className="surface-panel mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-fg1">{t('company.updater.updaterStatus')}</p>
          <p className="text-sm text-fg3">{getStatusMessage(status, t)}</p>
        </div>
        <StatusBadge state={status.state} installMode={installMode} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <UpdateMetric label={t('company.updater.currentVersion')} value={currentVersionLabel} />
        <UpdateMetric label={t('company.updater.latestDownload')} value={releaseLabel} />
        <UpdateMetric
          label={t('company.updater.lastChecked')}
          value={status.lastCheckedAt ? formatDateTime(status.lastCheckedAt) : t('company.updater.notYet')}
        />
      </div>

      {status.releaseDate && (
        <p className="mt-4 text-sm text-fg3">
          {t('company.updater.updatePublished')}{' '}
          <span className="font-medium text-fg1">{formatDateTime(status.releaseDate)}</span>
        </p>
      )}

      <div className="mt-4">{isDesktop ? actions : <DisabledControl>{actions}</DisabledControl>}</div>

      {status.state === 'available' && installMode === 'auto' && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-800">
          <Download className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <p>{t('company.updater.downloading')}</p>
        </div>
      )}

      {status.state === 'available' && installMode === 'manual' && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-800">
          <Download className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <p>{t('company.updater.availableManualHint')}</p>
        </div>
      )}
    </section>
  );
}
