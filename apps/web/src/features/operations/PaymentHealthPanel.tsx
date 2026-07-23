import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Inbox, RefreshCw } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { formatDateTime } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ConfirmModal, Modal, ModalButton } from '@/components/form-controls/Modal';
import { usePaginatedRows } from '@/components/tables/usePaginatedRows';
import { TablePagination } from '@/components/tables/TablePagination';
import { Badge, StatusStrip, Button } from '@/components/ui';
import { PaymentBreakdownSection } from './PaymentBreakdownSection';
import { PaymentHealthSummary, PaymentRailSummary } from './PaymentHealthOverview';
import { PaymentMismatchSection } from './PaymentMismatchSection';
import {
  getPaymentErrorMessage,
  PAYMENT_BREAKDOWN_WINDOW_DAYS,
  paymentStatusTone,
  RETRIABLE_PAYMENT_STATUSES,
} from './paymentHealthPresentation';

/**
 * +  — Operations Center: Payment Health panel.
 *
 * shipped the read-only reconciliation surface;  adds
 * per-row admin actions (Retry + Mark settled) and a per-rail × status
 * breakdown card. Both admin gestures wire through the `payments.*`
 * router and invalidate every payment-side cache on success so the
 * panel re-fetches without a manual reload.
 *
 * recetas pv-*: KPIs con `KpiTile` (`.pv-kpi`),
 * tablas con `.pv-table`, estados con `Badge`, vacíos con
 * `EmptyState` y controles `Button` tipados. Encabezados de panel con
 * `.pv-kicker` / `.pv-title`.
 */

export function PaymentHealthPanel() {
  const { t } = useTranslation('operations');
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const isAdmin = user?.role === 'admin';
  const reconciliationQuery = trpc.payments.reconciliation.useQuery(
    {
      limit: 50,
    },
    {
      staleTime: 30_000,
      refetchInterval: 30_000,
    }
  );
  const outboxQuery = trpc.payments.peekOutbox.useQuery(
    {
      limit: 20,
    },
    {
      staleTime: 30_000,
      refetchInterval: 30_000,
    }
  );
  const breakdownQuery = trpc.payments.methodBreakdown.useQuery(
    {
      windowDays: PAYMENT_BREAKDOWN_WINDOW_DAYS,
    },
    {
      staleTime: 30_000,
      refetchInterval: 60_000,
    }
  );
  const data = reconciliationQuery.data;
  const outboxRows = outboxQuery.data ?? [];
  const breakdown = breakdownQuery.data?.entries ?? [];

  // Client-side pagination over the already-loaded arrays. The hooks live at
  // the top level (never conditional) with empty-array fallbacks so the
  // queries / business logic stay untouched; only the rendered slice changes.
  const outboxPagination = usePaginatedRows(outboxRows, 8);
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
      toast.success({
        title: t('payments.outbox.actions.retrySuccess'),
      });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'operations:payments.outbox.actions.retryError',
    }),
  });
  const markSettledMutation = trpc.payments.markSettled.useMutation({
    onSuccess: async () => {
      await invalidatePaymentSurfaces();
      toast.success({
        title: t('payments.outbox.actions.markSettledSuccess'),
      });
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
      .mutateAsync({
        outboxId: retryTargetId,
      })
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
        ...(trimmed.length > 0
          ? {
              providerTransactionId: trimmed,
            }
          : {}),
      })
      .then(() => closeMarkSettledModal())
      .catch(() => {
        /* onError toast already fired */
      });
  };
  return (
    <div className="space-y-6">
      <section className="card p-6 space-y-5">
        <header>
          <p className="pv-kicker">{t('payments.kicker')}</p>
          <h2 className="pv-title text-2xl">{t('payments.title')}</h2>
          <p className="mt-2 text-sm text-secondary-500">{t('payments.description')}</p>
        </header>

        {reconciliationQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('common.loading')}</p>
        )}

        {reconciliationQuery.error && (
          <StatusStrip
            tone="danger"
            icon={AlertTriangle}
            title={translateServerError(reconciliationQuery.error, t, t('common.errorGeneric'))}
            role="alert"
          />
        )}

        {data && <PaymentHealthSummary data={data} />}
      </section>

      {data && <PaymentRailSummary data={data} />}

      {data && <PaymentMismatchSection mismatches={data.mismatches} />}

      <section className="card p-6 space-y-4">
        <h3 className="pv-title text-lg">{t('payments.outbox.title')}</h3>

        {outboxQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('common.loading')}</p>
        )}

        {outboxQuery.error && (
          <StatusStrip
            tone="danger"
            icon={AlertTriangle}
            title={translateServerError(outboxQuery.error, t, t('common.errorGeneric'))}
            role="alert"
          />
        )}

        {!outboxQuery.isLoading && !outboxQuery.error && outboxRows.length === 0 && (
          <EmptyState
            icon={Inbox}
            title={t('payments.outbox.emptyTitle')}
            description={t('payments.outbox.emptyState')}
          />
        )}

        {outboxRows.length > 0 && (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="pv-table">
                <thead>
                  <tr>
                    <th>{t('payments.outbox.columns.rail')}</th>
                    <th>{t('payments.outbox.columns.kind')}</th>
                    <th>{t('payments.outbox.columns.status')}</th>
                    <th className="num">{t('payments.outbox.columns.attempts')}</th>
                    <th>{t('payments.outbox.columns.lastError')}</th>
                    <th>{t('payments.outbox.columns.createdAt')}</th>
                    <th className="num">{t('payments.outbox.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {outboxPagination.pageRows.map(row => {
                    const isSettled = row.status === 'settled';
                    const canRetryStatus = RETRIABLE_PAYMENT_STATUSES.has(row.status);
                    const isRetryPending = retryMutation.isPending && retryTargetId === row.id;
                    const isMarkSettledPending =
                      markSettledMutation.isPending && markSettledTargetId === row.id;
                    const retryTitle = !isAdmin
                      ? t('payments.outbox.actions.noPermission')
                      : !canRetryStatus
                        ? t('payments.outbox.actions.retryUnavailable')
                        : undefined;
                    return (
                      <tr key={row.id}>
                        <td>{t(`payments.rails.${row.railId}`)}</td>
                        <td>{t(`payments.kind.${row.kind}`)}</td>
                        <td>
                          <Badge variant={paymentStatusTone(row.status)} marker="dot">
                            {t(`payments.status.${row.status}`, {
                              defaultValue: row.status,
                            })}
                          </Badge>
                        </td>
                        <td className="num">{row.attempts}</td>
                        <td className="muted break-all">
                          {getPaymentErrorMessage(row.lastError) ?? '—'}
                        </td>
                        <td className="muted">{formatDateTime(row.createdAt)}</td>
                        <td>
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              type="button"
                              disabled={!isAdmin || !canRetryStatus || isRetryPending}
                              title={retryTitle}
                              onClick={() => {
                                if (!isAdmin || !canRetryStatus) return;
                                setRetryTargetId(row.id);
                              }}
                              data-testid={`payment-retry-${row.id}`}
                              variant="ghost"
                            >
                              <RefreshCw className={isRetryPending ? 'animate-spin' : ''} />
                              {t('payments.outbox.actions.retry')}
                            </Button>
                            <Button
                              type="button"
                              disabled={!isAdmin || isSettled || isMarkSettledPending}
                              title={
                                !isAdmin ? t('payments.outbox.actions.noPermission') : undefined
                              }
                              onClick={() => {
                                if (!isAdmin || isSettled) return;
                                setProviderTxInput('');
                                setMarkSettledTargetId(row.id);
                              }}
                              data-testid={`payment-mark-settled-${row.id}`}
                              variant="ghost"
                            >
                              <CheckCircle2 />
                              {t('payments.outbox.actions.markSettled')}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {outboxPagination.hasPagination && (
              <TablePagination
                page={outboxPagination.page}
                pageCount={outboxPagination.pageCount}
                total={outboxPagination.total}
                rangeStart={outboxPagination.rangeStart}
                rangeEnd={outboxPagination.rangeEnd}
                onPageChange={outboxPagination.setPage}
              />
            )}
          </div>
        )}
      </section>

      <PaymentBreakdownSection
        entries={breakdown}
        isLoading={breakdownQuery.isLoading}
        error={breakdownQuery.error}
      />

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
            <ModalButton onClick={closeMarkSettledModal} disabled={markSettledMutation.isPending}>
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
          <p className="text-sm text-secondary-600">
            {t('payments.outbox.actions.markSettledConfirmMessage')}
          </p>
          <label className="pv-field">
            <span className="lab">{t('payments.outbox.actions.markSettledProviderTxLabel')}</span>
            <span className="pv-input">
              <input
                type="text"
                className="w-full border-0 bg-transparent p-0 text-secondary-900 placeholder:text-secondary-400 focus:outline-none focus:ring-0"
                placeholder={t('payments.outbox.actions.markSettledProviderTxPlaceholder')}
                value={providerTxInput}
                onChange={event => setProviderTxInput(event.target.value)}
                data-testid="payment-mark-settled-provider-tx"
                disabled={markSettledMutation.isPending}
              />
            </span>
          </label>
        </div>
      </Modal>
    </div>
  );
}
