import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';

// explicit `| undefined` on optional fields.
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
  // resolved below rather than defaulted to English here.
  retryLabel,
}: TableErrorStateProps) {
  const { t } = useTranslation('common');
  return (
    <div className="operator-table-shell flex items-start gap-3.5 rounded-[16px] border border-line/80 p-[18px]">
      <span className="pv-gt pv-gt-danger h-9 w-9" aria-hidden="true">
        <AlertTriangle className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-semibold text-fg1">{title}</h3>
        <p className="mt-1 text-[13px] text-fg3">{message}</p>
        {onRetry && (
          <Button variant="outline" className="mt-3" onClick={onRetry}>
            <RefreshCw />
            {retryLabel ?? t('table.retry')}
          </Button>
        )}
      </div>
    </div>
  );
}
