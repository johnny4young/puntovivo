import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, RotateCcw, Sparkles } from 'lucide-react';
import { useToast } from '@/components/feedback/ToastProvider';
import { formatDateTime, getErrorMessage } from '@/lib/utils';

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
  currentVersion: 'Unknown',
  lastCheckedAt: null,
  releaseName: null,
  releaseNotes: null,
  releaseDate: null,
  updateUrl: null,
  error: null,
  reason: 'App updates are available only in the Electron desktop app.',
};

interface StatusBadgeProps {
  state: AutoUpdateState;
}

function StatusBadge({ state }: StatusBadgeProps) {
  const labelMap: Record<AutoUpdateState, string> = {
    unavailable: 'Unavailable',
    idle: 'Up to Date',
    checking: 'Checking',
    available: 'Downloading',
    downloaded: 'Ready to Install',
    error: 'Error',
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
    <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
      <p className="text-xs uppercase tracking-wide text-secondary-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-secondary-900">{value}</p>
    </div>
  );
}

function getStatusMessage(status: AutoUpdateStatus): string {
  switch (status.state) {
    case 'unavailable':
      return status.reason ?? 'Automatic updates are not available in this runtime.';
    case 'checking':
      return 'Checking the update service for a newer desktop build.';
    case 'available':
      return 'A new desktop version is being downloaded in the background.';
    case 'downloaded':
      return 'A downloaded update is ready. Restart the desktop app to apply it.';
    case 'error':
      return status.error ?? 'The last update check failed.';
    case 'idle':
    default:
      return 'This workstation is on the latest available desktop build.';
  }
}

export function CompanyAutoUpdateCard() {
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
        title: status.isAvailable ? 'Checking for updates' : 'App updates unavailable',
        description: status.isAvailable ? undefined : status.reason ?? undefined,
      });
    },
    onError: error => {
      toast.error({
        title: 'Unable to check for updates',
        description: getErrorMessage(error, 'Unable to check for updates'),
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
        title: 'Restarting to install update',
        description: 'The desktop app will close and apply the downloaded release.',
      });
    },
    onError: error => {
      toast.error({
        title: 'Unable to apply update',
        description: getErrorMessage(error, 'Unable to apply update'),
      });
    },
  });

  const status = statusQuery.data ?? defaultAutoUpdateStatus;
  const releaseLabel =
    status.releaseName ?? (status.state === 'downloaded' ? 'Downloaded update ready' : 'None');

  return (
    <section className="card p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
          <Sparkles className="h-5 w-5 text-primary-700" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-secondary-900">App Updates</h2>
          <p className="text-sm text-secondary-500">
            Review the desktop updater status, trigger a manual check, and restart when a download
            is ready to install.
          </p>
        </div>
      </div>

      {!isDesktop && (
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-3 text-sm text-secondary-600">
          App update controls are available in the Electron desktop app.
        </div>
      )}

      {statusQuery.error && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {statusQuery.error.message}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-secondary-200 bg-white px-4 py-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-secondary-900">Updater Status</p>
          <p className="text-sm text-secondary-500">{getStatusMessage(status)}</p>
        </div>
        <StatusBadge state={status.state} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <UpdateMetric label="Current Version" value={status.currentVersion} />
        <UpdateMetric label="Latest Download" value={releaseLabel} />
        <UpdateMetric
          label="Last Checked"
          value={status.lastCheckedAt ? formatDateTime(status.lastCheckedAt) : 'Not yet'}
        />
      </div>

      {status.releaseDate && (
        <p className="text-sm text-secondary-500">
          Update published <span className="font-medium text-secondary-700">{formatDateTime(status.releaseDate)}</span>
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
          {checkMutation.isPending ? 'Checking...' : 'Check for Updates'}
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
          {restartMutation.isPending ? 'Restarting...' : 'Restart to Install'}
        </button>
      </div>

      {status.state === 'available' && (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-800">
          <div className="flex items-start gap-2">
            <Download className="mt-0.5 h-4 w-4" />
            <p>The updater has found a newer release and is downloading it in the background.</p>
          </div>
        </div>
      )}
    </section>
  );
}
