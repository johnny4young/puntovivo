import { AlertTriangle, CloudOff, RefreshCw } from 'lucide-react';
import { useOfflineSync } from '@/hooks';
import { cn, formatDateTime } from '@/lib/utils';

function getBannerCopy({
  isOnline,
  pendingItems,
  error,
}: {
  isOnline: boolean;
  pendingItems: number;
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
  const { isOnline, lastSync, pendingItems, isSyncing, error, triggerSync } = useOfflineSync();
  const shouldShow = !isOnline || pendingItems > 0 || Boolean(error);

  if (!shouldShow) {
    return null;
  }

  const bannerCopy = getBannerCopy({ isOnline, pendingItems, error });
  const canRetry = isOnline && !isSyncing && (pendingItems > 0 || Boolean(error));

  return (
    <div className="border-b border-secondary-200 bg-white px-6 py-3">
      <div
        className={cn(
          'flex flex-col gap-3 rounded-2xl border px-4 py-3 md:flex-row md:items-center md:justify-between',
          bannerCopy.tone === 'danger' && 'border-danger-200 bg-danger-50 text-danger-700',
          bannerCopy.tone === 'warning' && 'border-warning-500/30 bg-warning-50 text-warning-700',
          bannerCopy.tone === 'primary' && 'border-primary-200 bg-primary-50 text-primary-700'
        )}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
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
