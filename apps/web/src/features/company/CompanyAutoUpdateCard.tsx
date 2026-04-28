import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw, RotateCcw, Sparkles } from 'lucide-react';
import { useToast } from '@/components/feedback/ToastProvider';
import { translateServerError } from '@/lib/translateServerError';
import { formatDateTime } from '@/lib/utils';

type AutoUpdateState = 'unavailable' | 'idle' | 'checking' | 'available' | 'downloaded' | 'error';

interface AutoUpdateStatus {
  isAvailable: boolean;
  state: AutoUpdateState;
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
  currentVersion: '',
  lastCheckedAt: null,
  releaseName: null,
  releaseNotes: null,
  releaseDate: null,
  updateUrl: null,
  error: null,
  reason: null,
};

interface StatusBadgeProps {
  state: AutoUpdateState;
}

function StatusBadge({ state }: StatusBadgeProps) {
  const { t } = useTranslation('settings');
  const labelMap: Record<AutoUpdateState, string> = {
    unavailable: t('company.updater.statusBadge.unavailable'),
    idle: t('company.updater.statusBadge.idle'),
    checking: t('company.updater.statusBadge.checking'),
    available: t('company.updater.statusBadge.available'),
    downloaded: t('company.updater.statusBadge.downloaded'),
    error: t('company.updater.statusBadge.error'),
  };
  const classNameMap: Record<AutoUpdateState, string> = {
    unavailable: 'bg-secondary-100 text-secondary-700',
    idle: 'bg-success-50 text-success-700',
    checking: 'bg-primary-50 text-primary-700',
    available: 'bg-primary-50 text-primary-700',
    downloaded: 'bg-warning-50 text-warning-700',
    error: 'bg-danger-50 text-danger-700',
  };

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${classNameMap[state]}`}
    >
      {labelMap[state]}
    </span>
  );
}

interface UpdateMetricProps {
  label: string;
  value: string;
}

function UpdateMetric({ label, value }: UpdateMetricProps) {
  return (
    <div className="surface-panel-muted">
      <p className="text-xs uppercase tracking-wide text-secondary-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-secondary-900">{value}</p>
    </div>
  );
}

function getStatusMessage(status: AutoUpdateStatus, t: (key: string) => string): string {
  switch (status.state) {
    case 'unavailable':
      return status.reason ?? t('company.updater.statusMessage.unavailable');
    case 'checking':
      return t('company.updater.statusMessage.checking');
    case 'available':
      return t('company.updater.statusMessage.available');
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
    onError: error => {
      toast.error({
        title: t('company.updater.toast.checkError'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
    },
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
    onError: error => {
      toast.error({
        title: t('company.updater.toast.restartError'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
    },
  });

  const status = statusQuery.data ?? defaultAutoUpdateStatus;
  const releaseLabel =
    status.releaseName ?? (status.state === 'downloaded' ? t('company.updater.downloadedUpdateReady') : t('company.updater.none'));
  const currentVersionLabel = status.currentVersion || t('company.updater.unknown');

  return (
    <section className="card p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
          <Sparkles className="h-5 w-5 text-primary-700" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-secondary-900">{t('company.updater.title')}</h2>
          <p className="text-sm text-secondary-500">
            {t('company.updater.description')}
          </p>
        </div>
      </div>

      {!isDesktop && (
        <div className="surface-panel-muted text-sm text-secondary-600">{t('company.updater.desktopOnly')}</div>
      )}

      {statusQuery.error && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {translateServerError(statusQuery.error, t, t('errors:server.unknown'))}
        </div>
      )}

      <div className="surface-panel flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-secondary-900">{t('company.updater.updaterStatus')}</p>
          <p className="text-sm text-secondary-500">{getStatusMessage(status, t)}</p>
        </div>
        <StatusBadge state={status.state} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <UpdateMetric label={t('company.updater.currentVersion')} value={currentVersionLabel} />
        <UpdateMetric label={t('company.updater.latestDownload')} value={releaseLabel} />
        <UpdateMetric
          label={t('company.updater.lastChecked')}
          value={status.lastCheckedAt ? formatDateTime(status.lastCheckedAt) : t('company.updater.notYet')}
        />
      </div>

      {status.releaseDate && (
        <p className="text-sm text-secondary-500">
          {t('company.updater.updatePublished')} <span className="font-medium text-secondary-700">{formatDateTime(status.releaseDate)}</span>
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="btn-outline flex items-center gap-2"
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
          <RefreshCw className={`h-4 w-4 ${checkMutation.isPending ? 'animate-spin' : ''}`} />
          {checkMutation.isPending ? t('company.updater.actions.checking') : t('company.updater.actions.checkForUpdates')}
        </button>

        <button
          type="button"
          className="btn-primary flex items-center gap-2"
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
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4" />
          )}
          {restartMutation.isPending ? t('company.updater.actions.restarting') : t('company.updater.actions.restartToInstall')}
        </button>
      </div>

      {status.state === 'available' && (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-800">
          <div className="flex items-start gap-2">
            <Download className="mt-0.5 h-4 w-4" />
            <p>{t('company.updater.downloading')}</p>
          </div>
        </div>
      )}
    </section>
  );
}
