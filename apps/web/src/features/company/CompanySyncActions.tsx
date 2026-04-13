import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('settings');

  return (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        className="btn-outline flex items-center gap-2"
        disabled={isRefreshing}
        onClick={onPullSnapshot}
      >
        <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        {isPulling ? t('company.sync.actions.pulling') : t('company.sync.actions.pullSnapshot')}
      </button>
      <button
        type="button"
        className="btn-outline flex items-center gap-2"
        disabled={isRefreshing}
        onClick={onRefreshView}
      >
        <CloudDownload className="h-4 w-4" />
        {t('company.sync.actions.refreshView')}
      </button>
      <button
        type="button"
        className="btn-primary flex items-center gap-2"
        disabled={!canProcessQueue || isPushing}
        onClick={onProcessQueue}
      >
        <CloudUpload className="h-4 w-4" />
        {isPushing ? t('company.sync.actions.processing') : t('company.sync.actions.processQueue')}
      </button>
    </div>
  );
}
