import { useTranslation } from 'react-i18next';
import { Boxes, RefreshCw } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { Badge } from '@/components/ui/Badge';

/**
 * ENG-065b — Operations Center: Inventory Health panel.
 *
 * Tenant-wide cache-vs-cache discrepancy scan. Reads
 * `reports.inventory.discrepancies` (managerOrAdmin), which compares
 * the cached `products.stock` total against
 * `Σ(inventory_balances.on_hand)` per product. Drift surfaces as a
 * row; the operator can heal it by clicking "Reconciliar" which fires
 * the existing admin `inventory.reconcileBalances` mutation.
 */

const INVENTORY_DELTA_EPSILON = 0.001;

function deltaVariant(delta: number): 'success' | 'danger' | 'warning' {
  if (Math.abs(delta) <= INVENTORY_DELTA_EPSILON) return 'success';
  return delta < 0 ? 'danger' : 'warning';
}

function formatQuantity(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
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

  return (
    <div className="space-y-6">
      <section className="card p-6 space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-warning-100">
              <Boxes className="h-5 w-5 text-warning-700" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-secondary-900">
                {t('inventory.title')}
              </h2>
              <p className="text-sm text-secondary-500">
                {t('inventory.description')}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2 text-sm"
            disabled={!isAdmin || reconcileMutation.isPending}
            title={!isAdmin ? t('inventory.reconcile.noPermission') : undefined}
            onClick={() => {
              if (!isAdmin) return;
              void reconcileMutation.mutateAsync();
            }}
            data-testid="inventory-reconcile-cta"
          >
            <RefreshCw
              className={`h-4 w-4 ${reconcileMutation.isPending ? 'animate-spin' : ''}`}
            />
            {t('inventory.reconcile.cta')}
          </button>
        </header>

        {discrepanciesQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('common.loading')}</p>
        )}

        {discrepanciesQuery.error && (
          <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
            {translateServerError(discrepanciesQuery.error, t, t('common.errorGeneric'))}
          </div>
        )}

        {data && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4" data-testid="inventory-summary">
            <div className="rounded-xl border border-secondary-200 bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-secondary-500">
                {t('inventory.summary.productsScanned')}
              </p>
              <p className="mt-1 text-2xl font-semibold text-secondary-900">
                {data.summary.productsScanned}
              </p>
            </div>
            <div className="rounded-xl border border-secondary-200 bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-secondary-500">
                {t('inventory.summary.discrepancyCount')}
              </p>
              <p
                className={`mt-1 text-2xl font-semibold ${
                  data.summary.discrepancyCount === 0
                    ? 'text-success-700'
                    : 'text-warning-700'
                }`}
              >
                {data.summary.discrepancyCount}
              </p>
            </div>
          </div>
        )}

        {data && rows.length === 0 && !discrepanciesQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('inventory.emptyState')}</p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-secondary-500">
                <tr>
                  <th className="px-3 py-2">{t('inventory.columns.product')}</th>
                  <th className="px-3 py-2">{t('inventory.columns.sku')}</th>
                  <th className="px-3 py-2">{t('inventory.columns.cachedStock')}</th>
                  <th className="px-3 py-2">{t('inventory.columns.sumOfBalances')}</th>
                  <th className="px-3 py-2">{t('inventory.columns.delta')}</th>
                  <th className="px-3 py-2">{t('inventory.columns.siteCount')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.productId} className="border-t border-secondary-200">
                    <td className="px-3 py-2 text-secondary-900">{row.productName}</td>
                    <td className="px-3 py-2 text-secondary-700">
                      {row.productSku ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-secondary-700">
                      {formatQuantity(row.cachedStock)}
                    </td>
                    <td className="px-3 py-2 text-secondary-700">
                      {formatQuantity(row.sumOfBalances)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={deltaVariant(row.delta)}>
                        {row.delta > 0 ? '+' : ''}
                        {formatQuantity(row.delta)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-secondary-700">{row.siteCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
