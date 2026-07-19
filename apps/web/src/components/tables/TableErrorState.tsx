import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// ENG-179b — explicit `| undefined` on optional fields.
interface TableErrorStateProps {
  title: string;
  message: string;
  onRetry?: (() => void) | undefined;
  retryLabel?: string | undefined;
}

export function TableErrorState({
  title,
  message,
  onRetry,
  // ENG-220 — resolved below rather than defaulted to English here.
  retryLabel,
}: TableErrorStateProps) {
  const { t } = useTranslation('common');
  return (
    <div className="flex items-start gap-3.5 rounded-[24px] border border-line/80 bg-card/82 p-[18px] shadow-[var(--shadow-card)]">
      <span className="pv-gt pv-gt-danger h-9 w-9" aria-hidden="true">
        <AlertTriangle className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-semibold text-fg1">{title}</h3>
        <p className="mt-1 text-[13px] text-fg3">{message}</p>
        {onRetry && (
          <button type="button" className="pv-btn outline mt-3" onClick={onRetry}>
            <RefreshCw />
            {retryLabel ?? t('table.retry')}
          </button>
        )}
      </div>
    </div>
  );
}
