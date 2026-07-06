import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { Banknote, BadgePercent, PieChart, Receipt, TrendingUp } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency } from '@/lib/utils';
import { KpiTile } from '@/components/ui';
import { EmptyState } from '@/components/feedback/EmptyState';

type ProfitMarginReport = inferRouterOutputs<AppRouter>['reports']['profit']['margin'];

/** Local calendar day as `YYYY-MM-DD` (what `<input type="date">` expects). */
function isoDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function firstOfThisMonth(): string {
  const now = new Date();
  return isoDay(new Date(now.getFullYear(), now.getMonth(), 1));
}

/** `grossProfit ≥ 0 → success`, otherwise `danger` — the operator's "am I making money" glance. */
function profitTone(value: number): 'success' | 'danger' {
  return value >= 0 ? 'success' : 'danger';
}

/**
 * ENG-190 — admin Profitability report.
 *
 * Realized gross margin over a date range, sourcing COGS from the per-lot
 * ledger (`sale_item_lots`) for lot-tracked lines and the `cost_at_sale`
 * snapshot otherwise. Reads `reports.profit.margin` (managerOrAdmin); the
 * surface is admin-only via the finance workspace. Read-only — margin is an
 * accounting view, not a state-advancing action.
 */
export function ProfitMarginReportPage() {
  const { t } = useTranslation('reports');

  const [fromDate, setFromDate] = useState<string>(firstOfThisMonth);
  const [toDate, setToDate] = useState<string>(() => isoDay(new Date()));

  const input = useMemo(
    () => ({
      fromDate: `${fromDate}T00:00:00.000Z`,
      toDate: `${toDate}T23:59:59.999Z`,
      limit: 50,
    }),
    [fromDate, toDate]
  );

  const marginQuery = trpc.reports.profit.margin.useQuery(input, {
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const data: ProfitMarginReport | undefined = marginQuery.data;
  const summary = data?.summary;
  const products = data?.products ?? [];

  const formatPct = (value: number) => `${value.toFixed(1)}%`;

  return (
    <div className="space-y-6">
      <header>
        <p className="pv-kicker">{t('margin.kicker')}</p>
        <h1 className="pv-title text-2xl">{t('margin.title')}</h1>
        <p className="mt-2 text-sm text-secondary-500">{t('margin.description')}</p>
      </header>

      <div className="card p-4">
        <div className="flex flex-wrap gap-4">
          <label className="block">
            <span className="label">{t('margin.filters.from')}</span>
            <input
              type="date"
              className="input mt-1"
              value={fromDate}
              max={toDate}
              onChange={event => setFromDate(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="label">{t('margin.filters.to')}</span>
            <input
              type="date"
              className="input mt-1"
              value={toDate}
              min={fromDate}
              onChange={event => setToDate(event.target.value)}
            />
          </label>
        </div>
      </div>

      {marginQuery.isLoading && <p className="text-sm text-secondary-500">{t('margin.loading')}</p>}

      {marginQuery.error && (
        <div className="pv-strip danger">
          <span className="msg">
            {translateServerError(marginQuery.error, t, t('margin.error'))}
          </span>
        </div>
      )}

      {summary && (
        <>
          <div className="pv-kpis grid grid-cols-2 md:grid-cols-4" data-testid="margin-summary">
            <KpiTile
              icon={Banknote}
              label={t('margin.summary.revenue')}
              value={formatCurrency(summary.revenue)}
              tone="primary"
              mono
            />
            <KpiTile
              icon={Receipt}
              label={t('margin.summary.cogs')}
              value={formatCurrency(summary.cogs)}
              context={t('margin.summary.cogsSplit', {
                lots: formatCurrency(summary.cogsFromLots),
                snapshot: formatCurrency(summary.cogsFromSnapshot),
              })}
              tone="ink"
              mono
            />
            <KpiTile
              icon={TrendingUp}
              label={t('margin.summary.grossProfit')}
              value={formatCurrency(summary.grossProfit)}
              context={t('margin.summary.salesLines', {
                sales: summary.salesCount,
                lines: summary.lineCount,
              })}
              tone={profitTone(summary.grossProfit)}
              mono
            />
            <KpiTile
              icon={BadgePercent}
              label={t('margin.summary.grossMargin')}
              value={formatPct(summary.grossMarginPct)}
              tone={profitTone(summary.grossProfit)}
              mono
            />
          </div>

          <section className="card p-6 space-y-4">
            <h2 className="pv-title text-lg">{t('margin.byProduct.title')}</h2>
            {products.length === 0 ? (
              <EmptyState
                icon={PieChart}
                title={t('margin.byProduct.emptyTitle')}
                description={t('margin.byProduct.emptyState')}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="pv-table">
                  <thead>
                    <tr>
                      <th>{t('margin.byProduct.columns.product')}</th>
                      <th className="num">{t('margin.byProduct.columns.quantity')}</th>
                      <th className="num">{t('margin.byProduct.columns.revenue')}</th>
                      <th className="num">{t('margin.byProduct.columns.cogs')}</th>
                      <th className="num">{t('margin.byProduct.columns.grossProfit')}</th>
                      <th className="num">{t('margin.byProduct.columns.margin')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map(row => (
                      <tr key={row.productId}>
                        <td className="pname">
                          {row.name}
                          <span className="muted"> · {row.sku}</span>
                        </td>
                        <td className="num">{row.quantity}</td>
                        <td className="num">{formatCurrency(row.revenue)}</td>
                        <td className="num">{formatCurrency(row.cogs)}</td>
                        <td className="num">{formatCurrency(row.grossProfit)}</td>
                        <td className="num">{formatPct(row.grossMarginPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
