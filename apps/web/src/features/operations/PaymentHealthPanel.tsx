import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Inbox,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { KpiTile } from '@/components/ui';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ConfirmModal, Modal, ModalButton } from '@/components/form-controls/Modal';
import { usePaginatedRows } from '@/components/tables/usePaginatedRows';
import { TablePagination } from '@/components/tables/TablePagination';

/**
 * ENG-038 + ENG-065d — Operations Center: Payment Health panel.
 *
 * ENG-038 shipped the read-only reconciliation surface; ENG-065d adds
 * per-row admin actions (Retry + Mark settled) and a per-rail × status
 * breakdown card. Both admin gestures wire through the `payments.*`
 * router and invalidate every payment-side cache on success so the
 * panel re-fetches without a manual reload.
 *
 * Rediseño FASE 6 (O2) — recetas pv-*: KPIs con `KpiTile` (`.pv-kpi`),
 * tablas con `.pv-table`, estados con `.pv-badge`, vacíos con
 * `EmptyState` y botones con `.pv-btn`. Encabezados de panel con
 * `.pv-kicker` / `.pv-title`.
 */

type SemanticTone = 'success' | 'warning' | 'danger' | 'neutral';

function statusTone(status: string | null): SemanticTone {
  if (status === 'approved' || status === 'settled') return 'success';
  if (status === 'declined' || status === 'timeout' || status === 'dead_letter') {
    return 'danger';
  }
  if (status === 'retrying' || status === 'submitting') return 'warning';
  return 'neutral';
}

function mismatchTone(type: string): SemanticTone {
  if (type === 'provider_issue') return 'danger';
  if (type === 'missing_provider_reference' || type === 'amount_mismatch') {
    return 'warning';
  }
  return 'neutral';
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

  // Client-side pagination over the already-loaded arrays. The hooks live at
  // the top level (never conditional) with empty-array fallbacks so the
  // queries / business logic stay untouched; only the rendered slice changes.
  const mismatchesPagination = usePaginatedRows(data?.mismatches ?? [], 8);
  const outboxPagination = usePaginatedRows(outboxRows, 8);
  const breakdownPagination = usePaginatedRows(breakdown, 8);

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
        <header>
          <p className="pv-kicker">{t('payments.kicker')}</p>
          <h2 className="pv-title text-2xl">{t('payments.title')}</h2>
          <p className="mt-2 text-sm text-secondary-500">{t('payments.description')}</p>
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
          <div className="pv-kpis grid grid-cols-2 md:grid-cols-4" data-testid="payments-summary">
            <KpiTile
              icon={ScanLine}
              label={t('payments.summary.tendersScanned')}
              value={String(data.summary.tendersScanned)}
              tone="ink"
            />
            <KpiTile
              icon={ShieldCheck}
              label={t('payments.summary.matched')}
              value={String(data.summary.matched)}
              tone={data.summary.matched === data.summary.tendersScanned ? 'success' : 'primary'}
            />
            <KpiTile
              icon={TriangleAlert}
              label={t('payments.summary.mismatches')}
              value={String(data.summary.mismatches)}
              tone={data.summary.mismatches === 0 ? 'success' : 'warning'}
            />
            <KpiTile
              icon={Wallet}
              label={t('payments.summary.unmatchedAmount')}
              value={formatCurrency(data.summary.unmatchedAmount)}
              tone={data.summary.unmatchedAmount === 0 ? 'success' : 'warning'}
              mono
            />
          </div>
        )}
      </section>

      {data && (
        <section className="card p-6 space-y-4">
          <h3 className="pv-title text-lg">{t('payments.byRail.title')}</h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.byRail.map(row => (
              <div
                key={row.railId}
                className="rounded-2xl border border-line/70 bg-surface-2/65 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-secondary-900">
                    {t(`payments.rails.${row.railId}`)}
                  </p>
                  <span className={`pv-badge ${row.issues > 0 ? 'warning' : 'success'}`}>
                    <span className="dot" />
                    {row.issues}
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-secondary-500">{t('payments.byRail.outboxRows')}</dt>
                    <dd className="font-semibold text-secondary-900">{row.outboxRows}</dd>
                  </div>
                  <div>
                    <dt className="text-secondary-500">{t('payments.byRail.amount')}</dt>
                    <dd className="font-mono font-semibold tabular-nums text-secondary-900">
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
            <h3 className="pv-title text-lg">{t('payments.mismatches.title')}</h3>
          </div>
          {data.mismatches.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title={t('payments.mismatches.emptyTitle')}
              description={t('payments.mismatches.emptyState')}
            />
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="pv-table">
                  <thead>
                    <tr>
                      <th>{t('payments.mismatches.columns.type')}</th>
                      <th>{t('payments.mismatches.columns.rail')}</th>
                      <th>{t('payments.mismatches.columns.reference')}</th>
                      <th className="num">{t('payments.mismatches.columns.amount')}</th>
                      <th>{t('payments.mismatches.columns.status')}</th>
                      <th>{t('payments.mismatches.columns.action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mismatchesPagination.pageRows.map((row, idx) => (
                      <tr
                        key={`${row.type}-${row.paymentOutboxId ?? row.salePaymentId ?? 'unknown'}-${idx}`}
                      >
                        <td>
                          <span className={`pv-badge ${mismatchTone(row.type)}`}>
                            <span className="dot" />
                            {t(`payments.mismatches.type.${row.type}`)}
                          </span>
                        </td>
                        <td>{row.railId ? t(`payments.rails.${row.railId}`) : '—'}</td>
                        <td className="break-all">
                          {row.reference ?? row.providerTransactionId ?? '—'}
                        </td>
                        <td className="num">{formatCurrency(row.amount)}</td>
                        <td>
                          <span className={`pv-badge ${statusTone(row.status)}`}>
                            <span className="dot" />
                            {row.status
                              ? t(`payments.status.${row.status}`, {
                                  defaultValue: row.status,
                                })
                              : t('payments.status.missing')}
                          </span>
                        </td>
                        <td className="muted">
                          {t(`payments.mismatches.action.${row.suggestedAction}`)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mismatchesPagination.hasPagination && (
                <TablePagination
                  page={mismatchesPagination.page}
                  pageCount={mismatchesPagination.pageCount}
                  total={mismatchesPagination.total}
                  rangeStart={mismatchesPagination.rangeStart}
                  rangeEnd={mismatchesPagination.rangeEnd}
                  onPageChange={mismatchesPagination.setPage}
                />
              )}
            </div>
          )}
        </section>
      )}

      <section className="card p-6 space-y-4">
        <h3 className="pv-title text-lg">{t('payments.outbox.title')}</h3>

        {outboxQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('common.loading')}</p>
        )}

        {outboxQuery.error && (
          <div className="pv-strip danger">
            <span className="msg">
              {translateServerError(outboxQuery.error, t, t('common.errorGeneric'))}
            </span>
          </div>
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
                          <span className={`pv-badge ${statusTone(row.status)}`}>
                            <span className="dot" />
                            {t(`payments.status.${row.status}`, {
                              defaultValue: row.status,
                            })}
                          </span>
                        </td>
                        <td className="num">{row.attempts}</td>
                        <td className="muted break-all">
                          {getPaymentErrorMessage(row.lastError) ?? '—'}
                        </td>
                        <td className="muted">{formatDateTime(row.createdAt)}</td>
                        <td>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              className="pv-btn ghost"
                              disabled={!isAdmin || !canRetryStatus || isRetryPending}
                              title={retryTitle}
                              onClick={() => {
                                if (!isAdmin || !canRetryStatus) return;
                                setRetryTargetId(row.id);
                              }}
                              data-testid={`payment-retry-${row.id}`}
                            >
                              <RefreshCw className={isRetryPending ? 'animate-spin' : ''} />
                              {t('payments.outbox.actions.retry')}
                            </button>
                            <button
                              type="button"
                              className="pv-btn ghost"
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
                            >
                              <CheckCircle2 />
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

      <section className="card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary-700" />
          <h3 className="pv-title text-lg">{t('payments.breakdown.title')}</h3>
        </div>
        <p className="text-sm text-secondary-500">{t('payments.breakdown.description')}</p>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-secondary-500">
          {t('payments.breakdown.windowDays', { days: BREAKDOWN_WINDOW_DAYS })}
        </p>

        {breakdownQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('common.loading')}</p>
        )}
        {breakdownQuery.error && (
          <div className="pv-strip danger">
            <span className="msg">
              {translateServerError(breakdownQuery.error, t, t('common.errorGeneric'))}
            </span>
          </div>
        )}
        {!breakdownQuery.isLoading && !breakdownQuery.error && breakdown.length === 0 && (
          <EmptyState
            icon={BarChart3}
            title={t('payments.breakdown.emptyTitle')}
            description={t('payments.breakdown.emptyState', { days: BREAKDOWN_WINDOW_DAYS })}
          />
        )}
        {breakdown.length > 0 && (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="pv-table" data-testid="payments-breakdown-table">
                <thead>
                  <tr>
                    <th>{t('payments.breakdown.columns.rail')}</th>
                    <th>{t('payments.breakdown.columns.status')}</th>
                    <th className="num">{t('payments.breakdown.columns.count')}</th>
                    <th className="num">{t('payments.breakdown.columns.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdownPagination.pageRows.map(row => (
                    <tr key={`${row.railId}-${row.status}`}>
                      <td>{t(`payments.rails.${row.railId}`)}</td>
                      <td>
                        <span className={`pv-badge ${statusTone(row.status)}`}>
                          <span className="dot" />
                          {t(`payments.status.${row.status}`, {
                            defaultValue: row.status,
                          })}
                        </span>
                      </td>
                      <td className="num">{row.count}</td>
                      <td className="num">{formatCurrency(row.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {breakdownPagination.hasPagination && (
              <TablePagination
                page={breakdownPagination.page}
                pageCount={breakdownPagination.pageCount}
                total={breakdownPagination.total}
                rangeStart={breakdownPagination.rangeStart}
                rangeEnd={breakdownPagination.rangeEnd}
                onPageChange={breakdownPagination.setPage}
              />
            )}
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
