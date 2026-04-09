import { CloudDownload, CloudUpload, RefreshCw } from 'lucide-react';

interface CompanySyncActionsProps {
  isRefreshing: boolean;
  isPulling: boolean;
  isPushing: boolean;
  canProcessQueue: boolean;
  onPullSnapshot: () => void;
  onRefreshView: () => void;
  onProcessQueue: () => void;
}

export function CompanySyncActions({
  isRefreshing,
  isPulling,
  isPushing,
  canProcessQueue,
  onPullSnapshot,
  onRefreshView,
  onProcessQueue,
}: CompanySyncActionsProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        className="btn-outline flex items-center gap-2"
        disabled={isRefreshing}
        onClick={onPullSnapshot}
      >
        <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        {isPulling ? 'Pulling...' : 'Pull Snapshot'}
      </button>
      <button
        type="button"
        className="btn-outline flex items-center gap-2"
        disabled={isRefreshing}
        onClick={onRefreshView}
      >
        <CloudDownload className="h-4 w-4" />
        Refresh View
      </button>
      <button
        type="button"
        className="btn-primary flex items-center gap-2"
        disabled={!canProcessQueue || isPushing}
        onClick={onProcessQueue}
      >
        <CloudUpload className="h-4 w-4" />
        {isPushing ? 'Processing...' : 'Process Queue'}
      </button>
    </div>
  );
}
