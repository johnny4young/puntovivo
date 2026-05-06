import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plug, RefreshCw } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { Badge } from '@/components/ui/Badge';
import { formatDateTime } from '@/lib/utils';

/**
 * ENG-065a — Operations Center: Device Health panel.
 *
 * Two stacked sections:
 *   1. Registered peripherals via `peripherals.list` (across all
 *      sites the manager + admin caller can see), grouped by `kind`,
 *      with last-test result + timestamp.
 *   2. Hardware outbox tail via `peripherals.peekHardwareOutbox`,
 *      defaulting to "problems only" (status `failed` / `retrying` /
 *      `dead_letter`); a toggle reveals all rows.
 *
 * Per-row "Reintentar" wires to `peripherals.retryHardwareOutbox`
 * (admin-only). Manager callers see the data but the button is
 * disabled with a translated tooltip.
 */

const PROBLEM_STATUSES = new Set<string>([
  'failed',
  'retrying',
  'dead_letter',
]);

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
  const message =
    error.message ?? error.providerMessage ?? error.kind ?? error.errorCode ?? null;
  return typeof message === 'string' && message.length > 0 ? message : null;
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
      t.peripherals.list({ siteId: site.id }, { staleTime: 30_000 })
    )
  );
  const peripherals = useMemo(
    () =>
      peripheralQueries.flatMap((query, index) => {
        const rows = query.data ?? [];
        const siteName = allSites[index]?.name ?? '';
        return rows.map(row => ({ ...row, siteName }));
      }),
    [peripheralQueries, allSites]
  );

  const peripheralsByKind = useMemo(
    () =>
      PERIPHERAL_KINDS.map(kind => ({
        kind,
        rows: peripherals.filter(row => row.kind === kind),
      })).filter(group => group.rows.length > 0),
    [peripherals]
  );

  const outboxQuery = trpc.peripherals.peekHardwareOutbox.useQuery(
    { limit: 50 },
    { staleTime: 15_000, refetchInterval: 15_000 }
  );

  const outboxRows = useMemo(() => {
    const rows = outboxQuery.data ?? [];
    if (showAll) return rows;
    return rows.filter(row => PROBLEM_STATUSES.has(row.status));
  }, [outboxQuery.data, showAll]);

  const retryMutation = trpc.peripherals.retryHardwareOutbox.useMutation({
    onSuccess: async () => {
      await utils.peripherals.peekHardwareOutbox.invalidate();
      toast.success({ title: t('device.retry.success') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'operations:device.retry.error' }),
  });

  return (
    <div className="space-y-6">
      <section className="card p-6 space-y-4">
        <header className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
            <Plug className="h-5 w-5 text-primary-700" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-secondary-900">
              {t('device.peripherals.title')}
            </h2>
            <p className="text-sm text-secondary-500">
              {t('device.peripherals.description')}
            </p>
          </div>
        </header>

        {peripherals.length === 0 && (
          <p className="text-sm text-secondary-500">
            {t('device.peripherals.emptyState')}
          </p>
        )}

        {peripheralsByKind.map(group => (
          <div key={group.kind} className="space-y-2">
            <h3 className="text-sm font-semibold text-secondary-700">
              {t(`device.peripherals.kind.${group.kind}`)}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-secondary-500">
                  <tr>
                    <th className="px-3 py-2">{t('device.peripherals.columns.site')}</th>
                    <th className="px-3 py-2">{t('device.peripherals.columns.driver')}</th>
                    <th className="px-3 py-2">{t('device.peripherals.columns.displayName')}</th>
                    <th className="px-3 py-2">{t('device.peripherals.columns.lastTest')}</th>
                    <th className="px-3 py-2">{t('device.peripherals.columns.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map(row => (
                    <tr key={row.id} className="border-t border-secondary-200">
                      <td className="px-3 py-2 text-secondary-700">{row.siteName}</td>
                      <td className="px-3 py-2 text-secondary-700">{row.driver}</td>
                      <td className="px-3 py-2 text-secondary-900">
                        {row.displayName ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-secondary-700">
                        {row.lastTestedAt
                          ? formatDateTime(row.lastTestedAt)
                          : t('device.peripherals.notTested')}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={
                            row.lastTestResult === 'ok'
                              ? 'success'
                              : row.lastTestResult === 'failed'
                                ? 'danger'
                                : 'secondary'
                          }
                        >
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
      </section>

      <section className="card p-6 space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-warning-100">
              <RefreshCw className="h-5 w-5 text-warning-700" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-secondary-900">
                {t('device.outbox.title')}
              </h2>
              <p className="text-sm text-secondary-500">
                {t('device.outbox.description')}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => setShowAll(prev => !prev)}
            data-testid="device-outbox-toggle"
          >
            {showAll
              ? t('device.outbox.filter.problemsOnly')
              : t('device.outbox.filter.showAll')}
          </button>
        </header>

        {outboxQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('common.loading')}</p>
        )}

        {outboxQuery.error && (
          <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
            {translateServerError(outboxQuery.error, t, t('common.errorGeneric'))}
          </div>
        )}

        {!outboxQuery.isLoading && !outboxQuery.error && outboxRows.length === 0 && (
          <p className="text-sm text-secondary-500">
            {showAll
              ? t('device.outbox.emptyState.all')
              : t('device.outbox.emptyState.problems')}
          </p>
        )}

        {outboxRows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-secondary-500">
                <tr>
                  <th className="px-3 py-2">{t('device.outbox.columns.kind')}</th>
                  <th className="px-3 py-2">{t('device.outbox.columns.status')}</th>
                  <th className="px-3 py-2">{t('device.outbox.columns.attempts')}</th>
                  <th className="px-3 py-2">{t('device.outbox.columns.lastError')}</th>
                  <th className="px-3 py-2">{t('device.outbox.columns.createdAt')}</th>
                  <th className="px-3 py-2 text-right">{t('device.outbox.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {outboxRows.map(row => {
                  const errorMessage = getHardwareErrorMessage(row.lastError);
                  const canRetry = PROBLEM_STATUSES.has(row.status);
                  const isRetrying =
                    retryMutation.isPending &&
                    retryMutation.variables?.id === row.id;
                  return (
                    <tr key={row.id} className="border-t border-secondary-200">
                      <td className="px-3 py-2 text-secondary-700">{row.kind}</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={
                            row.status === 'printed'
                              ? 'success'
                              : row.status === 'dead_letter' || row.status === 'failed'
                                ? 'danger'
                                : row.status === 'retrying'
                                  ? 'warning'
                                  : 'secondary'
                          }
                        >
                          {t(`device.outbox.status.${row.status}`, {
                            defaultValue: row.status,
                          })}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-secondary-700">{row.attempts}</td>
                      <td className="px-3 py-2 text-secondary-700 break-all">
                        {errorMessage ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-secondary-700">
                        {formatDateTime(row.createdAt)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canRetry && (
                          <button
                            type="button"
                            className="btn-secondary inline-flex items-center gap-2 text-sm"
                            disabled={!isAdmin || isRetrying}
                            title={!isAdmin ? t('device.retry.noPermission') : undefined}
                            onClick={() => {
                              if (!isAdmin) return;
                              void retryMutation.mutateAsync({ id: row.id });
                            }}
                            data-testid={`device-retry-${row.id}`}
                          >
                            <RefreshCw
                              className={`h-4 w-4 ${
                                isRetrying ? 'animate-spin' : ''
                              }`}
                            />
                            {t('device.retry.cta')}
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
    </div>
  );
}
