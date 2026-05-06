import { useTranslation } from 'react-i18next';
import { Coins } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';

/**
 * ENG-065b — Operations Center: Cash Health panel.
 *
 * Tenant-wide cash reconciliation snapshot. Reads `reports.cash.reconciliation`
 * (managerOrAdmin), aggregating open cash sessions + closed sessions in
 * the last 30 days across every site the tenant operates.
 *
 * The panel is intentionally read-only: cash reconciliation is a
 * physical-world action (recount the till, file an audit) and the
 * surface exists so the operator knows where to look — not to advance
 * state from the UI.
 */

const CASH_OVER_SHORT_EPSILON = 0.009;

function overShortVariant(value: number): 'success' | 'danger' | 'warning' {
  if (Math.abs(value) <= CASH_OVER_SHORT_EPSILON) return 'success';
  return value < 0 ? 'danger' : 'warning';
}

export function CashHealthPanel() {
  const { t } = useTranslation('operations');

  const reconciliationQuery = trpc.reports.cash.reconciliation.useQuery(
    { limit: 20 },
    { staleTime: 30_000, refetchInterval: 30_000 }
  );

  const data = reconciliationQuery.data;

  return (
    <div className="space-y-6">
      <section className="card p-6 space-y-5">
        <header className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
            <Coins className="h-5 w-5 text-primary-700" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-secondary-900">
              {t('cash.title')}
            </h2>
            <p className="text-sm text-secondary-500">{t('cash.description')}</p>
          </div>
        </header>

        {reconciliationQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('common.loading')}</p>
        )}

        {reconciliationQuery.error && (
          <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
            {translateServerError(reconciliationQuery.error, t, t('common.errorGeneric'))}
          </div>
        )}

        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="cash-summary">
            <SummaryTile
              label={t('cash.summary.openSessions')}
              value={String(data.summary.openSessionCount)}
            />
            <SummaryTile
              label={t('cash.summary.closedRecent', { days: data.summary.windowDays })}
              value={String(data.summary.closedRecentCount)}
            />
            <SummaryTile
              label={t('cash.summary.netOverShort')}
              value={formatCurrency(data.summary.netOverShort)}
              variant={overShortVariant(data.summary.netOverShort)}
            />
            <SummaryTile
              label={t('cash.summary.largestDiscrepancy')}
              value={formatCurrency(data.summary.largestDiscrepancy)}
              variant={
                data.summary.largestDiscrepancy > CASH_OVER_SHORT_EPSILON
                  ? 'warning'
                  : 'success'
              }
            />
          </div>
        )}
      </section>

      {data && (
        <section className="card p-6 space-y-4">
          <h3 className="text-base font-semibold text-secondary-900">
            {t('cash.bySite.title')}
          </h3>
          {data.bySite.length === 0 ? (
            <p className="text-sm text-secondary-500">
              {t('cash.bySite.emptyState')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-secondary-500">
                  <tr>
                    <th className="px-3 py-2">{t('cash.bySite.columns.site')}</th>
                    <th className="px-3 py-2">{t('cash.bySite.columns.openSessions')}</th>
                    <th className="px-3 py-2">{t('cash.bySite.columns.netOverShort')}</th>
                    <th className="px-3 py-2">{t('cash.bySite.columns.overShortCount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bySite.map(row => (
                    <tr key={row.siteId} className="border-t border-secondary-200">
                      <td className="px-3 py-2 text-secondary-900">{row.siteName}</td>
                      <td className="px-3 py-2 text-secondary-700">{row.openSessions}</td>
                      <td className="px-3 py-2">
                        <Badge variant={overShortVariant(row.netOverShort)}>
                          {formatCurrency(row.netOverShort)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={row.overShortCount === 0 ? 'success' : 'warning'}>
                          {row.overShortCount}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {data && (
        <section className="card p-6 space-y-4">
          <h3 className="text-base font-semibold text-secondary-900">
            {t('cash.recentDiscrepancies.title')}
          </h3>
          {data.recentDiscrepancies.length === 0 ? (
            <p className="text-sm text-secondary-500">
              {t('cash.recentDiscrepancies.emptyState')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-secondary-500">
                  <tr>
                    <th className="px-3 py-2">{t('cash.recentDiscrepancies.columns.site')}</th>
                    <th className="px-3 py-2">{t('cash.recentDiscrepancies.columns.cashier')}</th>
                    <th className="px-3 py-2">{t('cash.recentDiscrepancies.columns.closedAt')}</th>
                    <th className="px-3 py-2">{t('cash.recentDiscrepancies.columns.expected')}</th>
                    <th className="px-3 py-2">{t('cash.recentDiscrepancies.columns.actual')}</th>
                    <th className="px-3 py-2">{t('cash.recentDiscrepancies.columns.overShort')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentDiscrepancies.map(row => (
                    <tr key={row.sessionId} className="border-t border-secondary-200">
                      <td className="px-3 py-2 text-secondary-900">{row.siteName}</td>
                      <td className="px-3 py-2 text-secondary-700">{row.cashierName}</td>
                      <td className="px-3 py-2 text-secondary-700">
                        {row.closedAt ? formatDateTime(row.closedAt) : '—'}
                      </td>
                      <td className="px-3 py-2 text-secondary-700">
                        {formatCurrency(row.expectedBalance)}
                      </td>
                      <td className="px-3 py-2 text-secondary-700">
                        {formatCurrency(row.actualCount)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={overShortVariant(row.overShort)}>
                          {formatCurrency(row.overShort)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant?: 'success' | 'warning' | 'danger';
}) {
  const accent =
    variant === 'danger'
      ? 'text-danger-700'
      : variant === 'warning'
        ? 'text-warning-700'
        : variant === 'success'
          ? 'text-success-700'
          : 'text-secondary-900';
  return (
    <div className="rounded-xl border border-secondary-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-secondary-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${accent}`}>{value}</p>
    </div>
  );
}
