import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';

/**
 * Shell-level badge that counts fiscal documents currently in
 * `status='contingency'` for the active tenant.
 *
 * Mounted in the header so admins see a nudge when fiscal documents
 * need follow-up. Renders nothing when the count is 0 or the caller
 * is not an admin — the query is gated so cashiers never issue a
 * FORBIDDEN call on every page load.
 */
export function FiscalContingencyIndicator() {
  const { t } = useTranslation('fiscal');
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const query = trpc.reports.fiscal.list.useQuery(
    { limit: 1, offset: 0, status: 'contingency' as const },
    {
      enabled: isAdmin,
      staleTime: 60_000,
      // Silent fail — a backend hiccup should not splatter an error
      // banner on every page.
      retry: false,
    }
  );

  const count = query.data?.total ?? 0;
  if (!isAdmin || count === 0) return null;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-state-warning-soft px-3 py-1 text-xs font-semibold text-state-warning"
      title={t('contingency.title')}
      aria-label={t('contingency.badge', { count })}
    >
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      {t('contingency.badge', { count })}
    </span>
  );
}
