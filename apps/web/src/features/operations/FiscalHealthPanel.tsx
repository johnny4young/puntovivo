import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, FileSignature } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { FiscalStatusBadge } from '@/components/fiscal/FiscalStatusBadge';

/**
 * ENG-065a — Operations Center: Fiscal Health panel.
 *
 * Surfaces fiscal documents that need operator action (status
 * `contingency` or `rejected`) plus a tail of recent `accepted` rows
 * for context. Per-row "Reintentar" button is admin-only and wires
 * through `reports.fiscal.retryDocument`. Read-only access is
 * manager + admin (the procedure was widened in ENG-065a).
 */

type ActionFilter = 'contingency' | 'rejected' | 'accepted';

const ACTION_FILTERS: ActionFilter[] = ['contingency', 'rejected', 'accepted'];
const PAGE_LIMIT = 20;

export function FiscalHealthPanel() {
  const { t } = useTranslation('operations');
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState<ActionFilter>('contingency');
  const isAdmin = user?.role === 'admin';

  const listQuery = trpc.reports.fiscal.list.useQuery(
    {
      limit: PAGE_LIMIT,
      offset: 0,
      status: statusFilter,
    },
    {
      staleTime: 30_000,
      refetchInterval: 30_000,
    }
  );

  const retryMutation = trpc.reports.fiscal.retryDocument.useMutation({
    onSuccess: async () => {
      await utils.reports.fiscal.list.invalidate();
      toast.success({ title: t('fiscal.retry.success') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'operations:fiscal.retry.error' }),
  });

  const items = listQuery.data?.items ?? [];

  return (
    <section className="card p-6 space-y-5">
      <header className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
          <FileSignature className="h-5 w-5 text-primary-700" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-secondary-900">
            {t('fiscal.title')}
          </h2>
          <p className="text-sm text-secondary-500">{t('fiscal.description')}</p>
        </div>
      </header>

      <nav
        className="segmented-control"
        role="tablist"
        aria-label={t('fiscal.statusFilter.ariaLabel')}
      >
        {ACTION_FILTERS.map(option => {
          const selected = statusFilter === option;
          return (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`segmented-tab ${selected ? 'segmented-tab-active' : ''}`}
              onClick={() => setStatusFilter(option)}
              data-testid={`fiscal-status-${option}`}
            >
              {t(`fiscal.statusFilter.${option}`)}
            </button>
          );
        })}
      </nav>

      {listQuery.isLoading && (
        <p className="text-sm text-secondary-500">{t('common.loading')}</p>
      )}

      {listQuery.error && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {translateServerError(listQuery.error, t, t('common.errorGeneric'))}
        </div>
      )}

      {!listQuery.isLoading && !listQuery.error && items.length === 0 && (
        <p className="text-sm text-secondary-500">
          {t(`fiscal.emptyState.${statusFilter}`)}
        </p>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-secondary-500">
              <tr>
                <th className="px-3 py-2">{t('fiscal.columns.document')}</th>
                <th className="px-3 py-2">{t('fiscal.columns.status')}</th>
                <th className="px-3 py-2">{t('fiscal.columns.emittedAt')}</th>
                <th className="px-3 py-2">{t('fiscal.columns.buyer')}</th>
                <th className="px-3 py-2">{t('fiscal.columns.total')}</th>
                <th className="px-3 py-2 text-right">{t('fiscal.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const isRetrying =
                  retryMutation.isPending &&
                  retryMutation.variables?.fiscalDocumentId === item.id;
                return (
                  <tr key={item.id} className="border-t border-secondary-200">
                    <td className="px-3 py-2">
                      <div className="font-medium text-secondary-900">
                        {item.documentNumber}
                      </div>
                      <div className="text-xs text-secondary-500 break-all">
                        {item.cufe}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <FiscalStatusBadge status={item.status} />
                    </td>
                    <td className="px-3 py-2 text-secondary-700">
                      {formatDateTime(item.emittedAt)}
                    </td>
                    <td className="px-3 py-2 text-secondary-700">
                      {item.buyerName}
                    </td>
                    <td className="px-3 py-2 text-secondary-700">
                      {formatCurrency(item.totalAmount, item.currencyCode)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {(item.status === 'contingency' ||
                        item.status === 'rejected') && (
                        <button
                          type="button"
                          className="btn-secondary inline-flex items-center gap-2 text-sm"
                          disabled={!isAdmin || isRetrying}
                          title={
                            !isAdmin
                              ? t('fiscal.retry.noPermission')
                              : undefined
                          }
                          onClick={() => {
                            if (!isAdmin) return;
                            void retryMutation.mutateAsync({
                              fiscalDocumentId: item.id,
                            });
                          }}
                          data-testid={`fiscal-retry-${item.id}`}
                        >
                          <RefreshCw
                            className={`h-4 w-4 ${
                              isRetrying ? 'animate-spin' : ''
                            }`}
                          />
                          {t('fiscal.retry.cta')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
