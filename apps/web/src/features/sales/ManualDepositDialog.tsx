/**
 * Manual deposit (abono) dialog — Fase 5.5 / T3.
 *
 * Presentational on purpose: every read and write arrives through the
 * `deposit` controller (`useManualDeposit`), so the register/cashier flow and
 * the reconciliation subsection render the same component over the same
 * server procedure. The dialog never derives money: the tender's expected
 * amount comes from the tender the server recorded, and the applied amount
 * shown after a deposit is the server's accumulated answer. A shortfall or an
 * excess is rendered as whatever `status` the server returned.
 *
 * Two separate panels keep the two sources apart (S12). The current state is
 * whatever a read that started after the last submit returned — loading,
 * settled out of the list, or not refreshed are each said out loud. The
 * recorded outcome is the mutation's own answer: evidence of that movement,
 * never the tender's balance.
 *
 * @module features/sales/ManualDepositDialog
 */
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { formatCurrency } from '@/lib/utils';
import { useSingleFlightSubmit } from '@/lib/useSingleFlightSubmit';
import type {
  ManualDepositController,
  ManualDepositTender,
  ManualDepositValues,
} from './useManualDeposit';

export interface ManualDepositDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The transfer tender the deposit lands on; already frozen by the server. */
  tender: ManualDepositTender;
  /** Server reads/writes and the permission gate, from `useManualDeposit`. */
  deposit: ManualDepositController;
}

/** Transfer confirmation statuses the server can answer with. */
const CONFIRMATION_STATUSES = [
  'pending',
  'customer_reported',
  'manual_confirmed',
  'provider_confirmed',
  'rejected',
  'needs_reconciliation',
] as const;

function todayLocalDate(): string {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
}

function createDefaultValues(): ManualDepositValues {
  return { reference: '', verifiedAmount: 0, valueDate: todayLocalDate(), note: '' };
}

export function ManualDepositDialog({
  isOpen,
  onClose,
  tender,
  deposit,
}: ManualDepositDialogProps) {
  const { t } = useTranslation('transferDeposits');
  const form = useForm<ManualDepositValues>({ defaultValues: createDefaultValues() });
  // A fresh draft per opening; a failed deposit keeps the typed movement
  // because only opening the dialog again clears it.
  useEffect(() => {
    if (isOpen) form.reset(createDefaultValues());
  }, [form, isOpen]);

  const canSubmit = deposit.canDeposit && !deposit.isSubmitting;
  const handleSubmit = form.handleSubmit(useSingleFlightSubmit(canSubmit, deposit.submit));
  const statusLabel = (status: string | null | undefined): string => {
    if (!status) return '—';
    return (CONFIRMATION_STATUSES as readonly string[]).includes(status)
      ? t(`statuses.${status}`)
      : status;
  };
  const amountLabel = (value: number | undefined): string =>
    typeof value === 'number' && Number.isFinite(value)
      ? formatCurrency(value)
      : t('history.notReported');
  // The tender's current state, from a read that started after the last
  // submit. Absent on a controller built by hand (the hook always sends it).
  const current = deposit.currentState;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title={t('title')}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={deposit.isSubmitting}>
            {t('actions.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={!canSubmit}>
            {deposit.isSubmitting ? t('actions.saving') : t('actions.submit')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit} noValidate>
        <p className="text-sm text-secondary-700">{t('subtitle')}</p>

        <section className="surface-panel-muted p-4" data-testid="manual-deposit-tender">
          <p className="sales-cap">{t('tender.heading')}</p>
          <dl className="mt-2 grid gap-x-4 gap-y-2 text-sm md:grid-cols-2">
            <div>
              <dt className="text-secondary-500">{t('tender.sale')}</dt>
              <dd data-testid="manual-deposit-sale">{tender.saleNumber ?? tender.saleId}</dd>
            </div>
            <div>
              <dt className="text-secondary-500">{t('tender.expectedAmount')}</dt>
              <dd data-testid="manual-deposit-expected-amount">
                {formatCurrency(tender.expectedAmount)}
              </dd>
            </div>
            <div>
              <dt className="text-secondary-500">{t('tender.destination')}</dt>
              <dd data-testid="manual-deposit-destination">
                {tender.destination?.label ?? t('tender.destinationMissing')}
              </dd>
            </div>
            <div>
              <dt className="text-secondary-500">{t('tender.reportedReference')}</dt>
              <dd data-testid="manual-deposit-reported-reference">{tender.reference ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-secondary-500">{t('tender.presentation')}</dt>
              <dd data-testid="manual-deposit-presentation">
                {tender.presentationId ?? t('tender.presentationMissing')}
              </dd>
            </div>
            <div>
              <dt className="text-secondary-500">{t('tender.confirmationStatus')}</dt>
              <dd data-testid="manual-deposit-tender-status">
                {statusLabel(tender.confirmationStatus)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="surface-panel-muted p-4" data-testid="manual-deposit-current-state">
          <p className="sales-cap">{t('state.heading')}</p>
          {!current ? null : current.phase === 'ready' ? (
            <>
              <dl className="mt-2 grid gap-x-4 gap-y-2 text-sm md:grid-cols-3">
                <div>
                  <dt className="text-secondary-500">{t('state.appliedAmount')}</dt>
                  <dd data-testid="manual-deposit-current-applied">
                    {amountLabel(current.appliedAmount ?? undefined)}
                  </dd>
                </div>
                <div>
                  <dt className="text-secondary-500">{t('state.surplusAmount')}</dt>
                  <dd data-testid="manual-deposit-current-surplus">
                    {amountLabel(current.surplusAmount ?? undefined)}
                  </dd>
                </div>
                <div>
                  <dt className="text-secondary-500">{t('state.status')}</dt>
                  <dd data-testid="manual-deposit-current-status">
                    {statusLabel(current.confirmationStatus)}
                  </dd>
                </div>
              </dl>
              {current.isFetching && (
                <p className="mt-2 text-xs text-secondary-500" role="status">
                  {t('state.refreshing')}
                </p>
              )}
            </>
          ) : current.phase === 'loading' ? (
            <p
              className="mt-2 text-sm text-secondary-500"
              role="status"
              data-testid="manual-deposit-current-loading"
            >
              {t('state.reading')}
            </p>
          ) : current.phase === 'absent' ? (
            <p
              className="mt-2 text-sm text-secondary-500"
              data-testid="manual-deposit-current-absent"
            >
              {t('state.absent')}
            </p>
          ) : current.phase === 'notRefreshed' ? (
            <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
              <p
                className="text-sm text-danger-500"
                role="alert"
                data-testid="manual-deposit-current-error"
              >
                {current.error ?? t('state.notRefreshed')}
              </p>
              <button
                type="button"
                className="text-sm font-semibold text-primary-700 underline"
                onClick={current.refetch}
              >
                {t('state.retry')}
              </button>
            </div>
          ) : null}
        </section>

        <section className="surface-panel-muted p-4" data-testid="manual-deposit-server-state">
          <p className="sales-cap">{t('state.outcomeHeading')}</p>
          <p className="mt-1 text-xs text-secondary-500">{t('state.outcomeHint')}</p>
          {deposit.result ? (
            <dl className="mt-2 grid gap-x-4 gap-y-2 text-sm md:grid-cols-3">
              <div>
                <dt className="text-secondary-500">{t('state.appliedAmount')}</dt>
                <dd data-testid="manual-deposit-applied-amount">
                  {formatCurrency(deposit.result.appliedAmount)}
                </dd>
              </div>
              <div>
                <dt className="text-secondary-500">{t('state.surplusAmount')}</dt>
                <dd data-testid="manual-deposit-surplus-amount">
                  {formatCurrency(deposit.result.surplusAmount)}
                </dd>
              </div>
              <div>
                <dt className="text-secondary-500">{t('state.status')}</dt>
                <dd data-testid="manual-deposit-result-status">
                  {statusLabel(deposit.result.status)}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-secondary-500" data-testid="manual-deposit-state-pending">
              {t('state.pending')}
            </p>
          )}
        </section>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,160px)]">
          <div>
            <label htmlFor="manual-deposit-reference" className="label">
              {t('fields.reference')}
            </label>
            <input
              id="manual-deposit-reference"
              className="input mt-1"
              autoComplete="off"
              spellCheck={false}
              maxLength={120}
              {...form.register('reference', {
                required: t('validation.referenceRequired'),
              })}
            />
            <p className="mt-1 text-xs text-secondary-500">{t('fields.referenceHint')}</p>
            {form.formState.errors.reference && (
              <p className="mt-1 text-sm text-danger-500">
                {form.formState.errors.reference.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="manual-deposit-amount" className="label">
              {t('fields.amount')}
            </label>
            <input
              id="manual-deposit-amount"
              type="number"
              min={0.01}
              step="0.01"
              className="input mt-1"
              {...form.register('verifiedAmount', {
                valueAsNumber: true,
                required: t('validation.amountRequired'),
                min: { value: 0.01, message: t('validation.amountRequired') },
              })}
            />
            {form.formState.errors.verifiedAmount && (
              <p className="mt-1 text-sm text-danger-500">
                {form.formState.errors.verifiedAmount.message}
              </p>
            )}
          </div>
        </div>
        <p className="text-xs text-secondary-500">{t('fields.amountHint')}</p>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="manual-deposit-value-date" className="label">
              {t('fields.valueDate')}
            </label>
            <input
              id="manual-deposit-value-date"
              type="date"
              className="input mt-1"
              {...form.register('valueDate', {
                required: t('validation.valueDateRequired'),
              })}
            />
            {form.formState.errors.valueDate && (
              <p className="mt-1 text-sm text-danger-500">
                {form.formState.errors.valueDate.message}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="manual-deposit-note" className="label">
              {t('fields.note')}
            </label>
            <textarea
              id="manual-deposit-note"
              rows={2}
              className="input mt-1"
              maxLength={500}
              {...form.register('note', {
                maxLength: { value: 500, message: t('validation.noteTooLong') },
              })}
            />
            {form.formState.errors.note && (
              <p className="mt-1 text-sm text-danger-500">{form.formState.errors.note.message}</p>
            )}
          </div>
        </div>

        {!deposit.canDeposit && (
          <p className="text-sm text-danger-500" data-testid="manual-deposit-denied">
            {t('permission.denied')}
          </p>
        )}

        {deposit.error && (
          <p className="text-sm text-danger-500" role="alert" data-testid="manual-deposit-error">
            {deposit.error}
          </p>
        )}

        <section data-testid="manual-deposit-history">
          <div className="flex items-baseline justify-between gap-3">
            <p className="sales-cap">{t('history.heading')}</p>
            <button
              type="button"
              className="text-sm font-semibold text-primary-700 underline"
              onClick={deposit.history.refetch}
              disabled={deposit.history.isLoading}
            >
              {t('history.refresh')}
            </button>
          </div>
          <p className="mt-1 text-xs text-secondary-500">{t('history.description')}</p>
          {deposit.history.isLoading ? (
            <p className="mt-2 text-sm text-secondary-500" role="status">
              {t('history.loading')}
            </p>
          ) : deposit.history.isError ? (
            <p className="mt-2 text-sm text-danger-500" role="alert">
              {t('history.error')}
            </p>
          ) : deposit.history.rows.length === 0 ? (
            <p
              className="mt-2 text-sm text-secondary-500"
              data-testid="manual-deposit-history-empty"
            >
              {t('history.empty')}
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {deposit.history.rows.map(item => (
                <li
                  key={item.salePaymentId}
                  className="rounded-md border border-border p-3 text-sm"
                  data-testid={`manual-deposit-row-${item.salePaymentId}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{statusLabel(item.confirmationStatus)}</span>
                    <span>
                      {t('history.columns.tenderAmount')}: {formatCurrency(item.amount)}
                    </span>
                  </div>
                  <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-secondary-500 md:grid-cols-3">
                    <div>
                      <dt>{t('history.columns.appliedAmount')}</dt>
                      <dd>{amountLabel(item.appliedAmount)}</dd>
                    </div>
                    <div>
                      <dt>{t('history.columns.surplusAmount')}</dt>
                      <dd>{amountLabel(item.surplusAmount)}</dd>
                    </div>
                    <div>
                      <dt>{t('history.columns.reference')}</dt>
                      <dd>{item.reference ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>{t('history.columns.confirmedAt')}</dt>
                      <dd>{item.confirmedAt ?? '—'}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </section>
      </form>
    </Modal>
  );
}
