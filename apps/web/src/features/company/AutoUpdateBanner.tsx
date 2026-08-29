import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import {
  autoUpdateStatusQueryKey,
  defaultAutoUpdateStatus,
  type AutoUpdateStatus,
} from './auto-update-status';

const DISMISS_KEY_PREFIX = 'puntovivo:auto-update-banner:dismissed:';

export function AutoUpdateBanner() {
  const { t } = useTranslation('settings');
  const electron = typeof window !== 'undefined' ? window.electron : undefined;
  const queryClient = useQueryClient();
  const toast = useToast();
  const statusQuery = useQuery({
    queryKey: autoUpdateStatusQueryKey,
    queryFn: async (): Promise<AutoUpdateStatus> =>
      window.electron?.getAutoUpdateStatus() ?? defaultAutoUpdateStatus,
    enabled: Boolean(electron),
    refetchInterval: 30_000,
  });
  const status = statusQuery.data ?? defaultAutoUpdateStatus;
  const version = status.downloadedVersion ?? status.releaseName ?? '';
  const dismissKey = version ? `${DISMISS_KEY_PREFIX}${version}` : '';
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const dismissed = Boolean(
    dismissKey && (dismissedVersion === version || window.localStorage.getItem(dismissKey) === '1')
  );

  const checkMutation = useMutation({
    mutationFn: async () => {
      if (!window.electron) throw new Error('Desktop updater unavailable');
      return window.electron.checkForAppUpdates();
    },
    onSuccess: next => queryClient.setQueryData(autoUpdateStatusQueryKey, next),
    onError: onErrorToast(toast, t, { titleKey: 'settings:company.updater.toast.checkError' }),
  });
  const restartMutation = useMutation({
    mutationFn: async () => {
      if (!window.electron) throw new Error('Desktop updater unavailable');
      const result = await window.electron.restartToApplyAppUpdate();
      if (!result.success) throw new Error(result.error ?? 'Update restart failed');
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'settings:company.updater.toast.restartError',
    }),
  });

  if (!electron || status.state !== 'downloaded' || !version || dismissed) return null;

  return (
    <section
      className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning-300 bg-warning-50 px-4 py-3 text-warning-900 sm:mx-6 xl:mx-8"
      data-testid="auto-update-banner"
      role="status"
    >
      <ShieldCheck className="h-5 w-5 flex-none" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {status.installReady
            ? t('company.updater.banner.readyTitle', { version })
            : t('company.updater.banner.verifyTitle', { version })}
        </p>
        <p className="mt-0.5 text-xs text-warning-800">
          {status.installReady
            ? t('company.updater.banner.readyDescription')
            : t('company.updater.banner.verifyDescription')}
        </p>
      </div>
      {status.installReady ? (
        <Button
          type="button"
          size="compact"
          disabled={restartMutation.isPending}
          onClick={() => restartMutation.mutate()}
        >
          <RotateCcw aria-hidden="true" />
          {t('company.updater.actions.restartToInstall')}
        </Button>
      ) : (
        <Button
          type="button"
          size="compact"
          variant="outline"
          disabled={checkMutation.isPending}
          onClick={() => checkMutation.mutate()}
        >
          <RefreshCw className={checkMutation.isPending ? 'animate-spin' : ''} aria-hidden="true" />
          {t('company.updater.actions.verifyDownload')}
        </Button>
      )}
      <button
        type="button"
        className="rounded-md p-2 text-warning-800 hover:bg-warning-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning-500"
        aria-label={t('company.updater.banner.dismiss')}
        onClick={() => {
          window.localStorage.setItem(dismissKey, '1');
          setDismissedVersion(version);
        }}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </section>
  );
}
