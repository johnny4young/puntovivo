/**
 * Dashboard notice for DIAN numbering ranges close to expiry or exhaustion.
 * Admins and managers only; cashiers hear about numbering at checkout once a
 * document can no longer be issued.
 */
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { managerOrAdminRoles } from '@/features/auth/roleAccess';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

export function NumberingAlertBanner() {
  const { t } = useTranslation('fiscal');
  const { user } = useAuth();
  const allowed = user ? (managerOrAdminRoles as readonly string[]).includes(user.role) : false;
  const localeQuery = trpc.tenantLocale.get.useQuery(undefined, { enabled: allowed });
  const usageQuery = trpc.fiscalNumbering.usage.useQuery(undefined, {
    enabled: allowed && localeQuery.data?.countryCode === 'CO',
    staleTime: 5 * 60_000,
  });
  const alerts = (usageQuery.data ?? []).filter(entry => entry.alert !== null);
  if (alerts.length === 0) return null;
  const critical = alerts.some(entry => entry.alert?.level === 'critical');

  return (
    <section
      role="status"
      data-testid="numbering-alert-banner"
      className={cn(
        'flex flex-wrap items-start gap-3 rounded-xl border p-4',
        critical ? 'border-danger-200 bg-danger-50' : 'border-warning-200 bg-warning-50'
      )}
    >
      <AlertTriangle
        className={cn('mt-0.5 h-5 w-5', critical ? 'text-danger-600' : 'text-warning-600')}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-semibold text-secondary-950">
          {t('numbering.banner.title', { count: alerts.length })}
        </p>
        <ul className="space-y-0.5 text-sm text-secondary-700">
          {alerts.map(entry => (
            <li key={entry.rangeId}>
              {entry.siteName} · {t(`numbering.kind.${entry.kind}`)}:{' '}
              {t(
                `numbering.alert.${entry.alert!.reason}${
                  entry.hasScheduledSuccessor ? '' : 'NoSuccessor'
                }`,
                { days: Math.max(0, entry.daysUntilExpiry), count: entry.remaining }
              )}
            </li>
          ))}
        </ul>
      </div>
      {user?.role === 'admin' && (
        <Link className="btn-outline min-h-9 px-3 py-1.5 text-sm" to="/company?tab=fiscal">
          {t('numbering.banner.action')}
        </Link>
      )}
    </section>
  );
}
