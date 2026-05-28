import { AlertTriangle, RefreshCw } from 'lucide-react';

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
  retryLabel = 'Retry',
}: TableErrorStateProps) {
  return (
    <div className="rounded-[24px] border border-danger-200/70 bg-danger-50/90 px-4 py-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/75">
          <AlertTriangle className="h-5 w-5 text-danger-600" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <h3 className="text-sm font-semibold text-danger-700">{title}</h3>
          <p className="text-sm text-danger-700/90">{message}</p>
          {onRetry && (
            <button type="button" className="btn-outline flex items-center gap-2" onClick={onRetry}>
              <RefreshCw className="h-4 w-4" />
              {retryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
