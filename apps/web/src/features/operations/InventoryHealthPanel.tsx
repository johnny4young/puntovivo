import { useTranslation } from 'react-i18next';
import { Boxes, PackageSearch, RefreshCw, ScanLine } from 'lucide-react';
import { formatQuantity } from '@puntovivo/shared/unit-math';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { KpiTile } from '@/components/ui';
import { EmptyState } from '@/components/feedback/EmptyState';
import { usePaginatedRows } from '@/components/tables/usePaginatedRows';
import { TablePagination } from '@/components/tables/TablePagination';

/**
 * ENG-065b — Operations Center: Inventory Health panel.
 *
 * Tenant-wide cache-vs-cache discrepancy scan. Reads
 * `reports.inventory.discrepancies` (managerOrAdmin), which compares
 * the cached `products.stock` total against
 * `Σ(inventory_balances.on_hand)` per product. Drift surfaces as a
 * row; the operator can heal it by clicking "Reconciliar" which fires
 * the existing admin `inventory.reconcileBalances` mutation.
 *
 * Rediseño FASE 6 (O2) — recetas pv-*: KPIs de drift con `KpiTile`
 * (`.pv-kpi`), tabla de discrepancias con `.pv-table`, severidad por
 * fila con `.pv-badge` (ok / atención / falla) y vacío con
 * `EmptyState`. Encabezado con `.pv-kicker` / `.pv-title` y CTA
 * `.pv-btn outline`.
 */

const INVENTORY_DELTA_EPSILON = 0.001;

type DeltaTone = 'success' | 'danger' | 'warning';

function deltaTone(delta: number): DeltaTone {
  if (Math.abs(delta) <= INVENTORY_DELTA_EPSILON) return 'success';
  return delta < 0 ? 'danger' : 'warning';
}

/** Severidad legible del drift (ok / atención / falla). */
function deltaSeverityKey(delta: number): 'ok' | 'attention' | 'fault' {
  if (Math.abs(delta) <= INVENTORY_DELTA_EPSILON) return 'ok';
  return delta < 0 ? 'fault' : 'attention';
}

export function InventoryHealthPanel() {
  const { t } = useTranslation('operations');
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const isAdmin = user?.role === 'admin';

  const discrepanciesQuery = trpc.reports.inventory.discrepancies.useQuery(
    { limit: 100 },
    { staleTime: 30_000, refetchInterval: 30_000 }
  );

  const reconcileMutation = trpc.inventory.reconcileBalances.useMutation({
    onSuccess: async result => {
      await utils.reports.inventory.discrepancies.invalidate();
      toast.success({
        title: t('inventory.reconcile.success', { count: result.productsUpdated }),
      });
    },
    onError: onErrorToast(toast, t, { titleKey: 'operations:inventory.reconcile.error' }),
  });

  const data = discrepanciesQuery.data;
  const rows = data?.rows ?? [];

  const { pageRows, hasPagination, ...pagination } = usePaginatedRows(rows, 8);

  return (
    <div className="space-y-6">
      <section className="card p-6 space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="pv-kicker">{t('inventory.kicker')}</p>
            <h2 className="pv-title text-2xl">{t('inventory.title')}</h2>
            <p className="mt-2 text-sm text-secondary-500">{t('inventory.description')}</p>
          </div>
          <button
            type="button"
            className="pv-btn outline"
            disabled={!isAdmin || reconcileMutation.isPending}
            title={!isAdmin ? t('inventory.reconcile.noPermission') : undefined}
            onClick={() => {
              if (!isAdmin) return;
              void reconcileMutation.mutateAsync();
            }}
            data-testid="inventory-reconcile-cta"
          >
            <RefreshCw className={reconcileMutation.isPending ? 'animate-spin' : ''} />
            {t('inventory.reconcile.cta')}
          </button>
        </header>

        {discrepanciesQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('common.loading')}</p>
        )}

        {discrepanciesQuery.error && (
          <div className="pv-strip danger">
            <span className="msg">
              {translateServerError(discrepanciesQuery.error, t, t('common.errorGeneric'))}
            </span>
          </div>
        )}

        {data && (
          <div className="pv-kpis grid grid-cols-2 md:grid-cols-3" data-testid="inventory-summary">
            <KpiTile
              icon={ScanLine}
              label={t('inventory.summary.productsScanned')}
              value={formatQuantity(data.summary.productsScanned)}
              tone="ink"
            />
            <KpiTile
              icon={PackageSearch}
              label={t('inventory.summary.discrepancyCount')}
              value={formatQuantity(data.summary.discrepancyCount)}
              tone={data.summary.discrepancyCount === 0 ? 'success' : 'warning'}
            />
          </div>
        )}

        {data && rows.length === 0 && !discrepanciesQuery.isLoading && (
          <EmptyState
            icon={Boxes}
            title={t('inventory.emptyTitle')}
            description={t('inventory.emptyState')}
          />
        )}

        {rows.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="pv-table">
                <thead>
                  <tr>
                    <th>{t('inventory.columns.product')}</th>
                    <th>{t('inventory.columns.sku')}</th>
                    <th className="num">{t('inventory.columns.cachedStock')}</th>
                    <th className="num">{t('inventory.columns.sumOfBalances')}</th>
                    <th>{t('inventory.columns.delta')}</th>
                    <th className="num">{t('inventory.columns.siteCount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(row => (
                    <tr key={row.productId}>
                      <td className="pname">{row.productName}</td>
                      <td className="muted">{row.productSku ?? '—'}</td>
                      <td className="num">{formatQuantity(row.cachedStock)}</td>
                      <td className="num">{formatQuantity(row.sumOfBalances)}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <span
                            className={`pv-mv ${
                              deltaTone(row.delta) === 'success'
                                ? ''
                                : row.delta < 0
                                  ? 'down'
                                  : 'up'
                            }`}
                          >
                            {row.delta > 0 ? '+' : ''}
                            {formatQuantity(row.delta)}
                          </span>
                          <span className={`pv-badge ${deltaTone(row.delta)}`}>
                            <span className="dot" />
                            {t(`inventory.severity.${deltaSeverityKey(row.delta)}`)}
                          </span>
                        </div>
                      </td>
                      <td className="num">{row.siteCount}</td>
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
    </div>
  );
}
