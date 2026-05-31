import { useTranslation } from 'react-i18next';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { Coins, DoorOpen, ListChecks, Scale, TrendingDown } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { KpiTile } from '@/components/ui';
import { EmptyState } from '@/components/feedback/EmptyState';
import { usePaginatedRows } from '@/components/tables/usePaginatedRows';
import { TablePagination } from '@/components/tables/TablePagination';

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
 *
 * Rediseño FASE 6 (O2) — recetas pv-*: KPIs con `KpiTile` (`.pv-kpi`,
 * descuadres en tono danger/warning), tablas con `.pv-table`, estados
 * de discrepancia con `.pv-badge` (balanceado / faltante / sobrante) y
 * vacíos con `EmptyState`. Encabezado de panel con `.pv-kicker` /
 * `.pv-title`.
 */

const CASH_OVER_SHORT_EPSILON = 0.009;

type OverShortTone = 'success' | 'danger' | 'warning';

function overShortTone(value: number): OverShortTone {
  if (Math.abs(value) <= CASH_OVER_SHORT_EPSILON) return 'success';
  return value < 0 ? 'danger' : 'warning';
}

/** Etiqueta semántica del estado de cuadre (balanceado / faltante / sobrante). */
function overShortLabelKey(value: number): 'balanced' | 'short' | 'over' {
  if (Math.abs(value) <= CASH_OVER_SHORT_EPSILON) return 'balanced';
  return value < 0 ? 'short' : 'over';
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
        <header>
          <p className="pv-kicker">{t('cash.kicker')}</p>
          <h2 className="pv-title text-2xl">{t('cash.title')}</h2>
          <p className="mt-2 text-sm text-secondary-500">{t('cash.description')}</p>
        </header>

        {reconciliationQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('common.loading')}</p>
        )}

        {reconciliationQuery.error && (
          <div className="pv-strip danger">
            <span className="msg">
              {translateServerError(reconciliationQuery.error, t, t('common.errorGeneric'))}
            </span>
          </div>
        )}

        {data && (
          <div className="pv-kpis grid grid-cols-2 md:grid-cols-4" data-testid="cash-summary">
            <KpiTile
              icon={DoorOpen}
              label={t('cash.summary.openSessions')}
              value={String(data.summary.openSessionCount)}
              tone="primary"
            />
            <KpiTile
              icon={ListChecks}
              label={t('cash.summary.closedRecent', { days: data.summary.windowDays })}
              value={String(data.summary.closedRecentCount)}
              tone="ink"
            />
            <KpiTile
              icon={Scale}
              label={t('cash.summary.netOverShort')}
              value={formatCurrency(data.summary.netOverShort)}
              tone={overShortTone(data.summary.netOverShort)}
              mono
            />
            <KpiTile
              icon={TrendingDown}
              label={t('cash.summary.largestDiscrepancy')}
              value={formatCurrency(data.summary.largestDiscrepancy)}
              tone={
                data.summary.largestDiscrepancy > CASH_OVER_SHORT_EPSILON ? 'warning' : 'success'
              }
              mono
            />
          </div>
        )}
      </section>

      {data && <CashBySiteSection rows={data.bySite} />}

      {data && <CashRecentDiscrepanciesSection rows={data.recentDiscrepancies} />}
    </div>
  );
}

type CashReconciliation = inferRouterOutputs<AppRouter>['reports']['cash']['reconciliation'];
type BySiteRow = CashReconciliation['bySite'][number];

/**
 * Resumen por sede. Pagina client-side (8 por página) sobre el array ya
 * cargado; el footer `TablePagination` solo aparece cuando hay más de una
 * página. El render de cada fila (badges de cuadre, montos con signo) se
 * conserva intacto.
 */
function CashBySiteSection({ rows }: { rows: BySiteRow[] }) {
  const { t } = useTranslation('operations');
  const { pageRows, hasPagination, ...pagination } = usePaginatedRows(rows, 8);

  return (
    <section className="card p-6 space-y-4">
      <h3 className="pv-title text-lg">{t('cash.bySite.title')}</h3>
      {rows.length === 0 ? (
        <EmptyState
          icon={Coins}
          title={t('cash.bySite.emptyTitle')}
          description={t('cash.bySite.emptyState')}
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="pv-table">
              <thead>
                <tr>
                  <th>{t('cash.bySite.columns.site')}</th>
                  <th className="num">{t('cash.bySite.columns.openSessions')}</th>
                  <th className="num">{t('cash.bySite.columns.netOverShort')}</th>
                  <th>{t('cash.bySite.columns.overShortCount')}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(row => (
                  <tr key={row.siteId}>
                    <td className="pname">{row.siteName}</td>
                    <td className="num">{row.openSessions}</td>
                    <td className="num">
                      <span className={`pv-badge ${overShortTone(row.netOverShort)}`}>
                        <span className="dot" />
                        {formatCurrency(row.netOverShort)}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`pv-badge ${row.overShortCount === 0 ? 'success' : 'warning'}`}
                      >
                        {row.overShortCount}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasPagination && (
            <TablePagination {...pagination} onPageChange={pagination.setPage} />
          )}
        </>
      )}
    </section>
  );
}

type RecentDiscrepancyRow = CashReconciliation['recentDiscrepancies'][number];

/**
 * Cierres recientes con discrepancia. Pagina client-side (8 por página) sobre
 * el array ya cargado; el footer `TablePagination` solo aparece cuando hay más
 * de una página. El render de cada fila (badge de estado de cuadre, montos
 * formateados, fecha) se conserva intacto.
 */
function CashRecentDiscrepanciesSection({ rows }: { rows: RecentDiscrepancyRow[] }) {
  const { t } = useTranslation('operations');
  const { pageRows, hasPagination, ...pagination } = usePaginatedRows(rows, 8);

  return (
    <section className="card p-6 space-y-4">
      <h3 className="pv-title text-lg">{t('cash.recentDiscrepancies.title')}</h3>
      {rows.length === 0 ? (
        <EmptyState
          icon={Scale}
          title={t('cash.recentDiscrepancies.emptyTitle')}
          description={t('cash.recentDiscrepancies.emptyState')}
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="pv-table">
              <thead>
                <tr>
                  <th>{t('cash.recentDiscrepancies.columns.site')}</th>
                  <th>{t('cash.recentDiscrepancies.columns.register')}</th>
                  <th>{t('cash.recentDiscrepancies.columns.cashier')}</th>
                  <th>{t('cash.recentDiscrepancies.columns.closedAt')}</th>
                  <th className="num">{t('cash.recentDiscrepancies.columns.expected')}</th>
                  <th className="num">{t('cash.recentDiscrepancies.columns.actual')}</th>
                  <th>{t('cash.recentDiscrepancies.columns.overShort')}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(row => (
                  <tr key={row.sessionId}>
                    <td className="pname">{row.siteName}</td>
                    <td>{row.registerName}</td>
                    <td>{row.cashierName}</td>
                    <td className="muted">
                      {row.closedAt ? formatDateTime(row.closedAt) : '—'}
                    </td>
                    <td className="num">{formatCurrency(row.expectedBalance)}</td>
                    <td className="num">{formatCurrency(row.actualCount)}</td>
                    <td>
                      <span className={`pv-badge ${overShortTone(row.overShort)}`}>
                        <span className="dot" />
                        {t(`cash.overShortStatus.${overShortLabelKey(row.overShort)}`)} ·{' '}
                        {formatCurrency(row.overShort)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasPagination && (
            <TablePagination {...pagination} onPageChange={pagination.setPage} />
          )}
        </>
      )}
    </section>
  );
}
