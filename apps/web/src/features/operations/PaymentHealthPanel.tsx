import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, BarChart3, CheckCircle2, CreditCard, RefreshCw } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { Badge } from '@/components/ui/Badge';
import { ConfirmModal, Modal, ModalButton } from '@/components/form-controls/Modal';

/**
 * ENG-038 + ENG-065d — Operations Center: Payment Health panel.
 *
 * ENG-038 shipped the read-only reconciliation surface; ENG-065d adds
 * per-row admin actions (Retry + Mark settled) and a per-rail × status
 * breakdown card. Both admin gestures wire through the `payments.*`
 * router and invalidate every payment-side cache on success so the
 * panel re-fetches without a manual reload.
 */

function statusVariant(status: string | null): 'success' | 'warning' | 'danger' | 'secondary' {
  if (status === 'approved' || status === 'settled') return 'success';
  if (status === 'declined' || status === 'timeout' || status === 'dead_letter') {
    return 'danger';
  }
  if (status === 'retrying' || status === 'submitting') return 'warning';
  return 'secondary';
}

function mismatchVariant(type: string): 'success' | 'warning' | 'danger' | 'secondary' {
  if (type === 'provider_issue') return 'danger';
  if (type === 'missing_provider_reference' || type === 'amount_mismatch') {
    return 'warning';
  }
  return 'secondary';
}

function getPaymentErrorMessage(value: Record<string, unknown> | null): string | null {
  if (!value) return null;
  const message = value.message;
  if (typeof message === 'string') return message;
  const kind = value.kind;
  if (typeof kind === 'string') return kind;
  return JSON.stringify(value);
}

const BREAKDOWN_WINDOW_DAYS = 7;
const RETRIABLE_PAYMENT_STATUSES = new Set(['declined', 'timeout', 'retrying', 'dead_letter']);

export function PaymentHealthPanel() {
  const { t } = useTranslation('operations');
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const isAdmin = user?.role === 'admin';

  const reconciliationQuery = trpc.payments.reconciliation.useQuery(
    { limit: 50 },
    { staleTime: 30_000, refetchInterval: 30_000 }
  );
  const outboxQuery = trpc.payments.peekOutbox.useQuery(
    { limit: 20 },
    { staleTime: 30_000, refetchInterval: 30_000 }
  );
  const breakdownQuery = trpc.payments.methodBreakdown.useQuery(
    { windowDays: BREAKDOWN_WINDOW_DAYS },
    { staleTime: 30_000, refetchInterval: 60_000 }
  );

  const data = reconciliationQuery.data;
  const outboxRows = outboxQuery.data ?? [];
  const breakdown = breakdownQuery.data?.entries ?? [];

  const invalidatePaymentSurfaces = async () => {
    await Promise.all([
      utils.payments.peekOutbox.invalidate(),
      utils.payments.reconciliation.invalidate(),
      utils.payments.methodBreakdown.invalidate(),
    ]);
  };

  const retryMutation = trpc.payments.retryOutbox.useMutation({
    onSuccess: async () => {
      await invalidatePaymentSurfaces();
      toast.success({ title: t('payments.outbox.actions.retrySuccess') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'operations:payments.outbox.actions.retryError',
    }),
  });

  const markSettledMutation = trpc.payments.markSettled.useMutation({
    onSuccess: async () => {
      await invalidatePaymentSurfaces();
      toast.success({ title: t('payments.outbox.actions.markSettledSuccess') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'operations:payments.outbox.actions.markSettledError',
    }),
  });

  const [retryTargetId, setRetryTargetId] = useState<string | null>(null);
  const [markSettledTargetId, setMarkSettledTargetId] = useState<string | null>(null);
  const [providerTxInput, setProviderTxInput] = useState('');

  const closeRetryModal = () => setRetryTargetId(null);
  const closeMarkSettledModal = () => {
    setMarkSettledTargetId(null);
    setProviderTxInput('');
  };

  const handleConfirmRetry = () => {
    if (!retryTargetId) return;
    void retryMutation
      .mutateAsync({ outboxId: retryTargetId })
      .then(() => closeRetryModal())
      .catch(() => {
        /* onError toast already fired; keep the modal open so the operator can read the row state */
      });
  };

  const handleConfirmMarkSettled = () => {
    if (!markSettledTargetId) return;
    const trimmed = providerTxInput.trim();
    void markSettledMutation
      .mutateAsync({
        outboxId: markSettledTargetId,
        ...(trimmed.length > 0 ? { providerTransactionId: trimmed } : {}),
      })
      .then(() => closeMarkSettledModal())
      .catch(() => {
        /* onError toast already fired */
      });
  };

  return (
    <div className="space-y-6">
      <section className="card p-6 space-y-5">
        <header className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
            <CreditCard className="h-5 w-5 text-primary-700" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-secondary-900">{t('payments.title')}</h2>
            <p className="text-sm text-secondary-500">{t('payments.description')}</p>
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="payments-summary">
            <SummaryTile
              label={t('payments.summary.tendersScanned')}
              value={String(data.summary.tendersScanned)}
            />
            <SummaryTile
              label={t('payments.summary.matched')}
              value={String(data.summary.matched)}
              variant={data.summary.matched === data.summary.tendersScanned ? 'success' : undefined}
            />
            <SummaryTile
              label={t('payments.summary.mismatches')}
              value={String(data.summary.mismatches)}
              variant={data.summary.mismatches === 0 ? 'success' : 'warning'}
            />
            <SummaryTile
              label={t('payments.summary.unmatchedAmount')}
              value={formatCurrency(data.summary.unmatchedAmount)}
              variant={data.summary.unmatchedAmount === 0 ? 'success' : 'warning'}
            />
          </div>
        )}
      </section>

      {data && (
        <section className="card p-6 space-y-4">
          <h3 className="text-base font-semibold text-secondary-900">
            {t('payments.byRail.title')}
          </h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.byRail.map(row => (
              <div key={row.railId} className="rounded-xl border border-secondary-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-secondary-900">
                    {t(`payments.rails.${row.railId}`)}
                  </p>
                  <Badge variant={row.issues > 0 ? 'warning' : 'success'}>{row.issues}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-secondary-500">{t('payments.byRail.outboxRows')}</dt>
                    <dd className="font-semibold text-secondary-900">{row.outboxRows}</dd>
                  </div>
                  <div>
                    <dt className="text-secondary-500">{t('payments.byRail.amount')}</dt>
                    <dd className="font-semibold text-secondary-900">
                      {formatCurrency(row.amount)}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </section>
      )}

      {data && (
        <section className="card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning-700" />
            <h3 className="text-base font-semibold text-secondary-900">
              {t('payments.mismatches.title')}
            </h3>
          </div>
          {data.mismatches.length === 0 ? (
            <p className="text-sm text-secondary-500">{t('payments.mismatches.emptyState')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-secondary-500">
                  <tr>
                    <th className="px-3 py-2">{t('payments.mismatches.columns.type')}</th>
                    <th className="px-3 py-2">{t('payments.mismatches.columns.rail')}</th>
                    <th className="px-3 py-2">{t('payments.mismatches.columns.reference')}</th>
                    <th className="px-3 py-2">{t('payments.mismatches.columns.amount')}</th>
                    <th className="px-3 py-2">{t('payments.mismatches.columns.status')}</th>
                    <th className="px-3 py-2">{t('payments.mismatches.columns.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.mismatches.map((row, idx) => (
                    <tr
                      key={`${row.type}-${row.paymentOutboxId ?? row.salePaymentId ?? 'unknown'}-${idx}`}
                      className="border-t border-secondary-200"
                    >
                      <td className="px-3 py-2">
                        <Badge variant={mismatchVariant(row.type)}>
                          {t(`payments.mismatches.type.${row.type}`)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-secondary-700">
                        {row.railId ? t(`payments.rails.${row.railId}`) : '—'}
                      </td>
                      <td className="px-3 py-2 text-secondary-700 break-all">
                        {row.reference ?? row.providerTransactionId ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-secondary-700">{formatCurrency(row.amount)}</td>
                      <td className="px-3 py-2">
                        <Badge variant={statusVariant(row.status)}>
                          {row.status
                            ? t(`payments.status.${row.status}`, {
                                defaultValue: row.status,
                              })
                            : t('payments.status.missing')}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-secondary-700">
                        {t(`payments.mismatches.action.${row.suggestedAction}`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="card p-6 space-y-4">
        <h3 className="text-base font-semibold text-secondary-900">{t('payments.outbox.title')}</h3>

        {outboxQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('common.loading')}</p>
        )}

        {outboxQuery.error && (
          <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
            {translateServerError(outboxQuery.error, t, t('common.errorGeneric'))}
          </div>
        )}

        {!outboxQuery.isLoading && !outboxQuery.error && outboxRows.length === 0 && (
          <p className="text-sm text-secondary-500">{t('payments.outbox.emptyState')}</p>
        )}

        {outboxRows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-secondary-500">
                <tr>
                  <th className="px-3 py-2">{t('payments.outbox.columns.rail')}</th>
                  <th className="px-3 py-2">{t('payments.outbox.columns.kind')}</th>
                  <th className="px-3 py-2">{t('payments.outbox.columns.status')}</th>
                  <th className="px-3 py-2">{t('payments.outbox.columns.attempts')}</th>
                  <th className="px-3 py-2">{t('payments.outbox.columns.lastError')}</th>
                  <th className="px-3 py-2">{t('payments.outbox.columns.createdAt')}</th>
                  <th className="px-3 py-2 text-right">
                    {t('payments.outbox.columns.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {outboxRows.map(row => {
                  const isSettled = row.status === 'settled';
                  const canRetryStatus = RETRIABLE_PAYMENT_STATUSES.has(row.status);
                  const isRetryPending =
                    retryMutation.isPending && retryTargetId === row.id;
                  const isMarkSettledPending =
                    markSettledMutation.isPending && markSettledTargetId === row.id;
                  const retryTitle = !isAdmin
                    ? t('payments.outbox.actions.noPermission')
                    : !canRetryStatus
                      ? t('payments.outbox.actions.retryUnavailable')
                      : undefined;
                  return (
                    <tr key={row.id} className="border-t border-secondary-200">
                      <td className="px-3 py-2 text-secondary-700">
                        {t(`payments.rails.${row.railId}`)}
                      </td>
                      <td className="px-3 py-2 text-secondary-700">
                        {t(`payments.kind.${row.kind}`)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={statusVariant(row.status)}>
                          {t(`payments.status.${row.status}`, {
                            defaultValue: row.status,
                          })}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-secondary-700">{row.attempts}</td>
                      <td className="px-3 py-2 text-secondary-700 break-all">
                        {getPaymentErrorMessage(row.lastError) ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-secondary-700">
                        {formatDateTime(row.createdAt)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            className="btn-secondary inline-flex items-center gap-2 text-sm"
                            disabled={!isAdmin || !canRetryStatus || isRetryPending}
                            title={retryTitle}
                            onClick={() => {
                              if (!isAdmin || !canRetryStatus) return;
                              setRetryTargetId(row.id);
                            }}
                            data-testid={`payment-retry-${row.id}`}
                          >
                            <RefreshCw
                              className={`h-4 w-4 ${
                                isRetryPending ? 'animate-spin' : ''
                              }`}
                            />
                            {t('payments.outbox.actions.retry')}
                          </button>
                          <button
                            type="button"
                            className="btn-secondary inline-flex items-center gap-2 text-sm"
                            disabled={!isAdmin || isSettled || isMarkSettledPending}
                            title={
                              !isAdmin
                                ? t('payments.outbox.actions.noPermission')
                                : undefined
                            }
                            onClick={() => {
                              if (!isAdmin || isSettled) return;
                              setProviderTxInput('');
                              setMarkSettledTargetId(row.id);
                            }}
                            data-testid={`payment-mark-settled-${row.id}`}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            {t('payments.outbox.actions.markSettled')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary-700" />
          <h3 className="text-base font-semibold text-secondary-900">
            {t('payments.breakdown.title')}
          </h3>
        </div>
        <p className="text-sm text-secondary-500">{t('payments.breakdown.description')}</p>
        <p className="text-xs uppercase tracking-wide text-secondary-500">
          {t('payments.breakdown.windowDays', { days: BREAKDOWN_WINDOW_DAYS })}
        </p>

        {breakdownQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('common.loading')}</p>
        )}
        {breakdownQuery.error && (
          <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
            {translateServerError(breakdownQuery.error, t, t('common.errorGeneric'))}
          </div>
        )}
        {!breakdownQuery.isLoading && !breakdownQuery.error && breakdown.length === 0 && (
          <p className="text-sm text-secondary-500">
            {t('payments.breakdown.emptyState', { days: BREAKDOWN_WINDOW_DAYS })}
          </p>
        )}
        {breakdown.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="payments-breakdown-table">
              <thead className="text-left text-xs uppercase tracking-wide text-secondary-500">
                <tr>
                  <th className="px-3 py-2">{t('payments.breakdown.columns.rail')}</th>
                  <th className="px-3 py-2">{t('payments.breakdown.columns.status')}</th>
                  <th className="px-3 py-2 text-right">
                    {t('payments.breakdown.columns.count')}
                  </th>
                  <th className="px-3 py-2 text-right">
                    {t('payments.breakdown.columns.amount')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map(row => (
                  <tr
                    key={`${row.railId}-${row.status}`}
                    className="border-t border-secondary-200"
                  >
                    <td className="px-3 py-2 text-secondary-700">
                      {t(`payments.rails.${row.railId}`)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={statusVariant(row.status)}>
                        {t(`payments.status.${row.status}`, {
                          defaultValue: row.status,
                        })}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right text-secondary-700">{row.count}</td>
                    <td className="px-3 py-2 text-right text-secondary-700">
                      {formatCurrency(row.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmModal
        isOpen={retryTargetId !== null}
        onClose={closeRetryModal}
        onConfirm={handleConfirmRetry}
        title={t('payments.outbox.actions.retryConfirmTitle')}
        message={t('payments.outbox.actions.retryConfirmMessage')}
        confirmText={t('payments.outbox.actions.confirm')}
        cancelText={t('payments.outbox.actions.cancel')}
        variant="primary"
        loading={retryMutation.isPending}
      />

      <Modal
        isOpen={markSettledTargetId !== null}
        onClose={closeMarkSettledModal}
        title={t('payments.outbox.actions.markSettledConfirmTitle')}
        size="sm"
        footer={
          <>
            <ModalButton
              onClick={closeMarkSettledModal}
              disabled={markSettledMutation.isPending}
            >
              {t('payments.outbox.actions.cancel')}
            </ModalButton>
            <ModalButton
              variant="primary"
              onClick={handleConfirmMarkSettled}
              disabled={markSettledMutation.isPending}
            >
              {markSettledMutation.isPending
                ? t('common.loading')
                : t('payments.outbox.actions.confirm')}
            </ModalButton>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-secondary-600">
            {t('payments.outbox.actions.markSettledConfirmMessage')}
          </p>
          <label className="block text-sm font-medium text-secondary-700">
            {t('payments.outbox.actions.markSettledProviderTxLabel')}
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-secondary-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder={t('payments.outbox.actions.markSettledProviderTxPlaceholder')}
              value={providerTxInput}
              onChange={event => setProviderTxInput(event.target.value)}
              data-testid="payment-mark-settled-provider-tx"
              disabled={markSettledMutation.isPending}
            />
          </label>
        </div>
      </Modal>
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
