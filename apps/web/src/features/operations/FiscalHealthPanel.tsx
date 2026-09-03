import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCw, FileSignature, FileCheck2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { FiscalStatusBadge } from '@/components/fiscal/FiscalStatusBadge';
import { FiscalMaturityBadge } from '@/components/fiscal/FiscalMaturityBadge';
import { EmptyState } from '@/components/feedback/EmptyState';
import { KpiTile, Button } from '@/components/ui';
import { usePaginatedRows } from '@/components/tables/usePaginatedRows';
import { TablePagination } from '@/components/tables/TablePagination';

/**
 * Operations Center: Fiscal Health panel.
 *
 * Surfaces fiscal documents that need operator action (status
 * `contingency` or `rejected`) plus a tail of recent `accepted` rows
 * for context. Per-row "Reintentar" button is admin-only and wires
 * through `reports.fiscal.retryDocument`. Read-only access is
 * manager + admin (the procedure was widened in ).
 *
 * hereda las recetas pv-*: titulación de panel
 * (.pv-kicker / .pv-title), filtro segmented (.pv-seg), KPI con la
 * receta única (danger cuando hay documentos por resolver), tabla densa
 * (.pv-table) y estado vacío del sistema (EmptyState).
 */

type ActionFilter = 'contingency' | 'rejected' | 'accepted';
const ACTION_FILTERS: ActionFilter[] = ['contingency', 'rejected', 'accepted'];
const PAGE_LIMIT = 20;
export function FiscalHealthPanel() {
  const { t } = useTranslation(['fiscalOperations', 'operations']);
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState<ActionFilter>('contingency');
  const [intentPage, setIntentPage] = useState(0);
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
  const intentsQuery = trpc.reports.fiscal.listIntents.useQuery(
    { limit: PAGE_LIMIT, offset: intentPage * PAGE_LIMIT },
    { staleTime: 30_000, refetchInterval: 30_000 }
  );
  const retryMutation = trpc.reports.fiscal.retryDocument.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.reports.fiscal.list.invalidate(),
        utils.operations.needsAttention.invalidate(),
      ]);
      toast.success({
        title: t('fiscal.retry.success'),
      });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'fiscalOperations:fiscal.retry.error',
    }),
  });
  const retryIntentMutation = trpc.reports.fiscal.retryIntent.useMutation({
    onSuccess: async () => {
      setIntentPage(0);
      await Promise.all([
        utils.reports.fiscal.list.invalidate(),
        utils.reports.fiscal.listIntents.invalidate(),
        utils.operations.needsAttention.invalidate(),
      ]);
      toast.success({ title: t('fiscal.intent.retrySuccess') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'fiscalOperations:fiscal.retry.error',
    }),
  });
  const items = listQuery.data?.items ?? [];
  const intents = intentsQuery.data?.items ?? [];
  const intentTotal = intentsQuery.data?.total ?? 0;
  // Documentos por resolver = todo lo que no esté aceptado. La métrica
  // pasa a `danger` cuando hay > 0 para comunicar urgencia (§09).
  const needsAction = statusFilter !== 'accepted';
  const actionCount = needsAction ? items.length : 0;

  // Paginación client-side sobre el array ya cargado (8 filas/página).
  const { pageRows, hasPagination, ...pagination } = usePaginatedRows(items, 8);
  return (
    <section className="card space-y-5 p-6">
      <header className="flex items-start gap-3">
        <span className="pv-gt pv-gt-primary h-11 w-11 rounded-xl">
          <FileSignature className="h-5 w-5" />
        </span>
        <div>
          <p className="pv-kicker">{t('fiscal.kicker')}</p>
          <h2 className="pv-title text-lg">{t('fiscal.title')}</h2>
          <p className="mt-1 text-sm text-secondary-500">{t('fiscal.description')}</p>
        </div>
      </header>

      <div className="pv-kpis grid-cols-2 lg:grid-cols-2">
        <KpiTile
          icon={needsAction ? RefreshCw : FileCheck2}
          tone={actionCount > 0 ? 'danger' : needsAction ? 'success' : 'primary'}
          label={t(`fiscal.statusFilter.${statusFilter}`)}
          value={listQuery.isLoading ? '—' : actionCount.toLocaleString()}
          context={t(`fiscal.kpi.context.${statusFilter}`)}
        />
        <KpiTile
          icon={FileCheck2}
          tone="ink"
          label={t('fiscal.kpi.windowLabel')}
          value={listQuery.isLoading ? '—' : items.length.toLocaleString()}
          context={t('fiscal.kpi.windowContext')}
        />
      </div>

      <section className="space-y-3 rounded-2xl border border-line/75 bg-surface-2/40 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-warning-600" aria-hidden="true" />
          <div>
            <h3 className="font-semibold text-secondary-900">{t('fiscal.intent.title')}</h3>
            <p className="text-sm text-secondary-500">{t('fiscal.intent.description')}</p>
          </div>
        </div>
        {intentsQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('operations:common.loading')}</p>
        )}
        {intentsQuery.error && (
          <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
            {translateServerError(intentsQuery.error, t, t('operations:common.errorGeneric'))}
          </div>
        )}
        {!intentsQuery.isLoading && !intentsQuery.error && intents.length === 0 && (
          <p className="text-sm text-success-700">{t('fiscal.intent.empty')}</p>
        )}
        {intents.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-line/75 bg-surface-1">
            <table className="pv-table">
              <thead>
                <tr>
                  <th>{t('fiscal.intent.columns.sale')}</th>
                  <th>{t('fiscal.columns.status')}</th>
                  <th>{t('fiscal.intent.columns.reason')}</th>
                  <th>{t('fiscal.intent.columns.createdAt')}</th>
                  <th className="num">{t('fiscal.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {intents.map(intent => {
                  const canRetry =
                    intent.status === 'blocked' ||
                    intent.status === 'retrying' ||
                    intent.status === 'dead_letter';
                  const isRetrying =
                    retryIntentMutation.isPending &&
                    retryIntentMutation.variables?.intentId === intent.id;
                  const reasonKey = intent.reason ?? 'pending';
                  return (
                    <tr key={intent.id}>
                      <td>
                        <div className="pname">{intent.saleNumber}</div>
                        <div className="sku">{intent.kind}</div>
                      </td>
                      <td>{t(`fiscal.intent.status.${intent.status}`)}</td>
                      <td className="muted">
                        {t(`fiscal.intent.reason.${reasonKey}`, {
                          defaultValue: t('fiscal.intent.reason.unknown'),
                        })}
                      </td>
                      <td className="muted whitespace-nowrap">
                        {formatDateTime(intent.createdAt)}
                      </td>
                      <td className="num">
                        {canRetry && (
                          <Button
                            type="button"
                            className="ml-auto"
                            disabled={!isAdmin || isRetrying}
                            title={!isAdmin ? t('fiscal.intent.noPermission') : undefined}
                            onClick={() => {
                              if (!isAdmin) return;
                              retryIntentMutation.mutate({ intentId: intent.id });
                            }}
                            data-testid={`fiscal-intent-retry-${intent.id}`}
                            variant="outline"
                          >
                            <RefreshCw className={isRetrying ? 'animate-spin' : undefined} />
                            {t('fiscal.intent.retryCta')}
                          </Button>
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

      <TablePagination
        page={intentPage}
        pageCount={Math.max(intentPage + 1, Math.ceil(intentTotal / PAGE_LIMIT))}
        total={intentTotal}
        rangeStart={intents.length ? intentPage * PAGE_LIMIT + 1 : 0}
        rangeEnd={intents.length ? intentPage * PAGE_LIMIT + intents.length : 0}
        onPageChange={setIntentPage}
      />

      <nav className="pv-seg" role="tablist" aria-label={t('fiscal.statusFilter.ariaLabel')}>
        {ACTION_FILTERS.map(option => {
          const selected = statusFilter === option;
          return (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={selected}
              className={selected ? 'on' : undefined}
              onClick={() => setStatusFilter(option)}
              data-testid={`fiscal-status-${option}`}
            >
              {t(`fiscal.statusFilter.${option}`)}
            </button>
          );
        })}
      </nav>

      {listQuery.isLoading && (
        <p className="text-sm text-secondary-500">{t('operations:common.loading')}</p>
      )}

      {listQuery.error && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {translateServerError(listQuery.error, t, t('operations:common.errorGeneric'))}
        </div>
      )}

      {!listQuery.isLoading && !listQuery.error && items.length === 0 && (
        <EmptyState
          icon={FileCheck2}
          title={t('fiscal.title')}
          description={t(`fiscal.emptyState.${statusFilter}`)}
        />
      )}

      {items.length > 0 && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-2xl border border-line/75">
            <table className="pv-table">
              <thead>
                <tr>
                  <th>{t('fiscal.columns.document')}</th>
                  <th>{t('fiscal.columns.status')}</th>
                  <th>{t('fiscal.columns.emittedAt')}</th>
                  <th>{t('fiscal.columns.buyer')}</th>
                  <th className="num">{t('fiscal.columns.total')}</th>
                  <th className="num">{t('fiscal.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(item => {
                  const isRetrying =
                    retryMutation.isPending &&
                    retryMutation.variables?.fiscalDocumentId === item.id;
                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="pname">{item.documentNumber}</div>
                        <div className="sku break-all">{item.cufe}</div>
                      </td>
                      <td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <FiscalStatusBadge status={item.status} />
                          {/* flag demo/draft provider docs. */}
                          <FiscalMaturityBadge maturity={item.maturity} />
                        </div>
                      </td>
                      <td className="muted whitespace-nowrap">{formatDateTime(item.emittedAt)}</td>
                      <td>{item.buyerName}</td>
                      <td className="num">{formatCurrency(item.totalAmount, item.currencyCode)}</td>
                      <td className="num">
                        {(item.status === 'contingency' || item.status === 'rejected') && (
                          <Button
                            type="button"
                            className="ml-auto"
                            disabled={!isAdmin || isRetrying}
                            title={!isAdmin ? t('fiscal.retry.noPermission') : undefined}
                            onClick={() => {
                              if (!isAdmin) return;
                              retryMutation.mutate({
                                fiscalDocumentId: item.id,
                              });
                            }}
                            data-testid={`fiscal-retry-${item.id}`}
                            variant="outline"
                          >
                            <RefreshCw className={isRetrying ? 'animate-spin' : undefined} />
                            {t('fiscal.retry.cta')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hasPagination && <TablePagination {...pagination} onPageChange={pagination.setPage} />}
        </div>
      )}
    </section>
  );
}
