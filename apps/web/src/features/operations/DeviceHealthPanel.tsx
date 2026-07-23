import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plug, RefreshCw, Inbox } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { formatDateTime } from '@/lib/utils';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Badge, KpiTile, Button } from '@/components/ui';
import { usePaginatedRows } from '@/components/tables/usePaginatedRows';
import { TablePagination } from '@/components/tables/TablePagination';

/**
 * Operations Center: Device Health panel.
 *
 * Two stacked sections:
 * 1. Registered peripherals via `peripherals.list` (across all
 * sites the manager + admin caller can see), grouped by `kind`,
 * with last-test result + timestamp.
 * 2. Hardware outbox tail via `peripherals.peekHardwareOutbox`,
 * defaulting to "problems only" (status `failed` / `retrying` /
 * `dead_letter`); a toggle reveals all rows.
 *
 * Per-row "Reintentar" wires to `peripherals.retryHardwareOutbox`
 * (admin-only). Manager callers see the data but the button is
 * disabled with a translated tooltip.
 *
 * hereda las recetas pv-*: titulación de panel,
 * KPI de salud del outbox (danger cuando hay trabajos fallando), tablas
 * densas (.pv-table) con badge semántico por estado, y estado vacío del
 * sistema (EmptyState).
 */

const PROBLEM_STATUSES = new Set<string>(['failed', 'retrying', 'dead_letter']);
const PERIPHERAL_KINDS = [
  'printer',
  'cash_drawer',
  'scanner',
  'payment_terminal',
  'customer_display',
] as const;
function getHardwareErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const error = value as {
    message?: unknown;
    providerMessage?: unknown;
    kind?: unknown;
    errorCode?: unknown;
  };
  const message = error.message ?? error.providerMessage ?? error.kind ?? error.errorCode ?? null;
  return typeof message === 'string' && message.length > 0 ? message : null;
}
function testResultTone(result: string | null | undefined): 'success' | 'danger' | 'neutral' {
  if (result === 'ok') return 'success';
  if (result === 'failed') return 'danger';
  return 'neutral';
}
function outboxStatusTone(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
  if (status === 'printed') return 'success';
  if (status === 'dead_letter' || status === 'failed') return 'danger';
  if (status === 'retrying') return 'warning';
  return 'neutral';
}
export function DeviceHealthPanel() {
  const { t } = useTranslation('operations');
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const isAdmin = user?.role === 'admin';
  const [showAll, setShowAll] = useState(false);
  const sitesQuery = trpc.sites.list.useQuery();
  const siteItems = sitesQuery.data?.items;
  const allSites = useMemo(() => siteItems ?? [], [siteItems]);

  // Aggregate peripherals from all sites the user can see. The
  // existing `peripherals.list` is keyed by siteId; the Operations
  // Center surfaces per-tenant health, so we merge across sites and
  // group client-side by kind.
  const peripheralQueries = trpc.useQueries(t =>
    allSites.map(site =>
      t.peripherals.list(
        {
          siteId: site.id,
        },
        {
          staleTime: 30_000,
        }
      )
    )
  );
  const peripherals = useMemo(
    () =>
      peripheralQueries.flatMap((query, index) => {
        const rows = query.data ?? [];
        const siteName = allSites[index]?.name ?? '';
        return rows.map(row => ({
          ...row,
          siteName,
        }));
      }),
    [peripheralQueries, allSites]
  );

  // Client-side pagination over the combined peripherals array (across all
  // sites). The page slice is then re-grouped by kind so each `kind` keeps its
  // own heading + dense table, but the card never renders more than one page of
  // rows at a time regardless of fleet size.
  const {
    pageRows: peripheralPageRows,
    hasPagination: peripheralsHavePagination,
    setPage: setPeripheralsPage,
    ...peripheralsPagination
  } = usePaginatedRows(peripherals, 8);
  const peripheralsByKind = useMemo(
    () =>
      PERIPHERAL_KINDS.map(kind => ({
        kind,
        rows: peripheralPageRows.filter(row => row.kind === kind),
      })).filter(group => group.rows.length > 0),
    [peripheralPageRows]
  );
  const outboxQuery = trpc.peripherals.peekHardwareOutbox.useQuery(
    {
      limit: 50,
    },
    {
      staleTime: 15_000,
      refetchInterval: 15_000,
    }
  );
  const allOutboxRows = useMemo(() => outboxQuery.data ?? [], [outboxQuery.data]);
  const problemCount = useMemo(
    () => allOutboxRows.filter(row => PROBLEM_STATUSES.has(row.status)).length,
    [allOutboxRows]
  );
  const outboxRows = useMemo(() => {
    if (showAll) return allOutboxRows;
    return allOutboxRows.filter(row => PROBLEM_STATUSES.has(row.status));
  }, [allOutboxRows, showAll]);

  // Paginate the (already filtered) outbox tail client-side. Toggling the
  // "show all" filter changes the row count, which resets the hook to page 1.
  const {
    pageRows: outboxPageRows,
    hasPagination: outboxHasPagination,
    setPage: setOutboxPage,
    ...outboxPagination
  } = usePaginatedRows(outboxRows, 8);
  const retryMutation = trpc.peripherals.retryHardwareOutbox.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.peripherals.peekHardwareOutbox.invalidate(),
        utils.operations.needsAttention.invalidate(),
      ]);
      toast.success({
        title: t('device.retry.success'),
      });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'operations:device.retry.error',
    }),
  });
  return (
    <div className="space-y-6">
      <section className="card space-y-4 p-6">
        <header className="flex items-start gap-3">
          <span className="pv-gt pv-gt-primary h-11 w-11 rounded-xl">
            <Plug className="h-5 w-5" />
          </span>
          <div>
            <p className="pv-kicker">{t('device.kicker')}</p>
            <h2 className="pv-title text-lg">{t('device.peripherals.title')}</h2>
            <p className="mt-1 text-sm text-secondary-500">{t('device.peripherals.description')}</p>
          </div>
        </header>

        {peripherals.length === 0 && (
          <EmptyState
            icon={Plug}
            title={t('device.peripherals.title')}
            description={t('device.peripherals.emptyState')}
          />
        )}

        {peripheralsByKind.map(group => (
          <div key={group.kind} className="space-y-2">
            <h3 className="text-sm font-semibold text-secondary-700">
              {t(`device.peripherals.kind.${group.kind}`)}
            </h3>
            <div className="overflow-x-auto rounded-2xl border border-line/75">
              <table className="pv-table">
                <thead>
                  <tr>
                    <th>{t('device.peripherals.columns.site')}</th>
                    <th>{t('device.peripherals.columns.driver')}</th>
                    <th>{t('device.peripherals.columns.displayName')}</th>
                    <th>{t('device.peripherals.columns.lastTest')}</th>
                    <th>{t('device.peripherals.columns.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map(row => (
                    <tr key={row.id}>
                      <td>{row.siteName}</td>
                      <td className="muted">{row.driver}</td>
                      <td className="font-medium text-secondary-900">{row.displayName ?? '—'}</td>
                      <td className="muted whitespace-nowrap">
                        {row.lastTestedAt
                          ? formatDateTime(row.lastTestedAt)
                          : t('device.peripherals.notTested')}
                      </td>
                      <td>
                        <Badge variant={testResultTone(row.lastTestResult)}>
                          {row.lastTestResult
                            ? t(`device.peripherals.testResult.${row.lastTestResult}`)
                            : t('device.peripherals.testResult.untested')}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {peripheralsHavePagination && (
          <TablePagination {...peripheralsPagination} onPageChange={setPeripheralsPage} />
        )}
      </section>

      <section className="card space-y-4 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="pv-gt pv-gt-warning h-11 w-11 rounded-xl">
              <RefreshCw className="h-5 w-5" />
            </span>
            <div>
              <p className="pv-kicker">{t('device.kicker')}</p>
              <h2 className="pv-title text-lg">{t('device.outbox.title')}</h2>
              <p className="mt-1 text-sm text-secondary-500">{t('device.outbox.description')}</p>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => setShowAll(prev => !prev)}
            data-testid="device-outbox-toggle"
            variant="outline"
          >
            {showAll ? t('device.outbox.filter.problemsOnly') : t('device.outbox.filter.showAll')}
          </Button>
        </header>

        <div className="pv-kpis grid-cols-2 lg:grid-cols-2">
          <KpiTile
            icon={RefreshCw}
            tone={problemCount > 0 ? 'danger' : 'success'}
            label={t('device.outbox.kpi.problemsLabel')}
            value={outboxQuery.isLoading ? '—' : problemCount.toLocaleString()}
            context={t('device.outbox.kpi.problemsContext')}
          />
          <KpiTile
            icon={Inbox}
            tone="ink"
            label={t('device.outbox.kpi.totalLabel')}
            value={outboxQuery.isLoading ? '—' : allOutboxRows.length.toLocaleString()}
            context={t('device.outbox.kpi.totalContext')}
          />
        </div>

        {outboxQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('common.loading')}</p>
        )}

        {outboxQuery.error && (
          <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
            {translateServerError(outboxQuery.error, t, t('common.errorGeneric'))}
          </div>
        )}

        {!outboxQuery.isLoading && !outboxQuery.error && outboxRows.length === 0 && (
          <EmptyState
            icon={Inbox}
            title={t('device.outbox.title')}
            description={
              showAll ? t('device.outbox.emptyState.all') : t('device.outbox.emptyState.problems')
            }
          />
        )}

        {outboxRows.length > 0 && (
          <>
            <div className="overflow-x-auto rounded-2xl border border-line/75">
              <table className="pv-table">
                <thead>
                  <tr>
                    <th>{t('device.outbox.columns.kind')}</th>
                    <th>{t('device.outbox.columns.status')}</th>
                    <th className="num">{t('device.outbox.columns.attempts')}</th>
                    <th>{t('device.outbox.columns.lastError')}</th>
                    <th>{t('device.outbox.columns.createdAt')}</th>
                    <th className="num">{t('device.outbox.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {outboxPageRows.map(row => {
                    const errorMessage = getHardwareErrorMessage(row.lastError);
                    const canRetry = PROBLEM_STATUSES.has(row.status);
                    const isRetrying =
                      retryMutation.isPending && retryMutation.variables?.id === row.id;
                    return (
                      <tr key={row.id}>
                        <td className="muted">{row.kind}</td>
                        <td>
                          <Badge variant={outboxStatusTone(row.status)}>
                            {t(`device.outbox.status.${row.status}`, {
                              defaultValue: row.status,
                            })}
                          </Badge>
                        </td>
                        <td className="num">{row.attempts}</td>
                        <td className="muted break-all">{errorMessage ?? '—'}</td>
                        <td className="muted whitespace-nowrap">{formatDateTime(row.createdAt)}</td>
                        <td className="num">
                          {canRetry && (
                            <Button
                              type="button"
                              className="ml-auto"
                              disabled={!isAdmin || isRetrying}
                              title={!isAdmin ? t('device.retry.noPermission') : undefined}
                              onClick={() => {
                                if (!isAdmin) return;
                                void retryMutation.mutateAsync({
                                  id: row.id,
                                });
                              }}
                              data-testid={`device-retry-${row.id}`}
                              variant="outline"
                            >
                              <RefreshCw className={isRetrying ? 'animate-spin' : undefined} />
                              {t('device.retry.cta')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {outboxHasPagination && (
              <TablePagination {...outboxPagination} onPageChange={setOutboxPage} />
            )}
          </>
        )}
      </section>
    </div>
  );
}
