import { AlertTriangle, CloudOff, RefreshCw } from 'lucide-react';
import { useOfflineSync } from '@/hooks';
import { cn, formatDateTime } from '@/lib/utils';

function getBannerCopy({
  isOnline,
  pendingItems,
  conflicts,
  error,
}: {
  isOnline: boolean;
  pendingItems: number;
  conflicts: number;
  error: string | null;
}) {
  if (!isOnline) {
    return {
      title: 'You are offline',
      description:
        pendingItems > 0
          ? `${pendingItems} queued change${pendingItems === 1 ? '' : 's'} will sync when the connection returns.`
          : 'Changes made in the desktop app will stay local until the connection returns.',
      tone: 'warning',
    } as const;
  }

  if (conflicts > 0) {
    return {
      title: 'Sync conflicts require review',
      description: `${conflicts} conflict${conflicts === 1 ? '' : 's'} need to be resolved before all queued changes can sync cleanly.`,
      tone: 'danger',
    } as const;
  }

  if (error) {
    return {
      title: 'Sync needs attention',
      description: error,
      tone: 'danger',
    } as const;
  }

  return {
    title: 'Pending changes waiting to sync',
    description: `${pendingItems} queued change${pendingItems === 1 ? '' : 's'} will sync automatically.`,
    tone: 'primary',
  } as const;
}

export function OfflineStatusBanner() {
  const { isOnline, lastSync, pendingItems, conflicts, isSyncing, error, triggerSync } =
    useOfflineSync();
  const shouldShow = !isOnline || pendingItems > 0 || conflicts > 0 || Boolean(error);

  if (!shouldShow) {
    return null;
  }

  const bannerCopy = getBannerCopy({ isOnline, pendingItems, conflicts, error });
  const canRetry = isOnline && !isSyncing && pendingItems > 0 && conflicts === 0;

  return (
    <div className="px-4 pb-1 pt-3 sm:px-6 xl:px-8">
      <div
        className={cn(
          'shell-panel flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between',
          bannerCopy.tone === 'danger' && 'border-danger-200/75 bg-danger-50/90 text-danger-700',
          bannerCopy.tone === 'warning' &&
            'border-warning-500/20 bg-warning-50/90 text-warning-700',
          bannerCopy.tone === 'primary' && 'border-primary-200/75 bg-primary-50/85 text-primary-700'
        )}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl',
              bannerCopy.tone === 'danger' && 'bg-white/70 text-danger-600',
              bannerCopy.tone === 'warning' && 'bg-white/65 text-warning-700',
              bannerCopy.tone === 'primary' && 'bg-white/70 text-primary-700'
            )}
          >
            {bannerCopy.tone === 'danger' ? (
              <AlertTriangle className="h-5 w-5" />
            ) : (
              <CloudOff className="h-5 w-5" />
            )}
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">{bannerCopy.title}</p>
            <p className="text-sm">{bannerCopy.description}</p>
            {lastSync && (
              <p className="text-xs opacity-80">Last successful sync: {formatDateTime(lastSync)}</p>
            )}
          </div>
        </div>

        {canRetry && (
          <button
            type="button"
            className="btn-outline flex items-center justify-center gap-2 self-start md:self-center"
            onClick={() => {
              void triggerSync();
            }}
            disabled={isSyncing}
          >
            <RefreshCw className={cn('h-4 w-4', isSyncing && 'animate-spin')} />
            {isSyncing ? 'Syncing...' : 'Retry sync'}
          </button>
        )}
      </div>
    </div>
  );
}
