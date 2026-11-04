import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { useOfflineSync } from '@/hooks';

const PILL_CLASS =
  'pv-signal-chip inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap bg-warning-50 px-3 py-1.5 text-[11px] font-semibold text-warning-700';

/**
 * Conflicts do not stop a sale, so they stay in the header instead of taking a
 * page banner. Only managers and admins can open the screen that resolves them.
 */
export function SyncConflictsPill() {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const { conflicts } = useOfflineSync();

  if (conflicts === 0) return null;

  const label = t('offline.conflictsPill', { count: conflicts });
  const content = (
    <>
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      <span aria-hidden="true" className="tabular-nums sm:hidden">
        {conflicts}
      </span>
      <span aria-hidden="true" className="hidden sm:inline">
        {label}
      </span>
    </>
  );

  if (user?.role === 'admin' || user?.role === 'manager') {
    return (
      <Link
        to="/operations?tab=sync"
        data-testid="sync-conflicts-pill"
        className={`${PILL_CLASS} hover:bg-warning-100`}
        aria-label={label}
        title={t('offline.conflictsTitle')}
      >
        {content}
      </Link>
    );
  }

  return (
    <span
      data-testid="sync-conflicts-pill"
      role="status"
      className={PILL_CLASS}
      aria-label={label}
      title={t('offline.conflictsTitle')}
    >
      {content}
    </span>
  );
}
