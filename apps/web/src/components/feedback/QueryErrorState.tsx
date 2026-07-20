import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface QueryErrorStateProps {
  title: string;
  message: string;
  onRetry: () => void;
  retryLabel?: string;
}

export function QueryErrorState({
  title,
  message,
  onRetry,
  // resolved below rather than defaulted to English here.
  retryLabel,
}: QueryErrorStateProps) {
  const { t } = useTranslation('common');
  return (
    <div className="rounded-3xl border border-danger-200 bg-white p-6 shadow-soft">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-danger-50">
          <AlertTriangle className="h-6 w-6 text-danger-600" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="text-lg font-semibold text-secondary-900">{title}</h2>
          <p className="text-sm text-secondary-600">{message}</p>
          <button type="button" className="btn-outline flex items-center gap-2" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" />
            {retryLabel ?? t('table.retry')}
          </button>
        </div>
      </div>
    </div>
  );
}
