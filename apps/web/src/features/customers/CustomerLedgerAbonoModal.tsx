/**
 * modal for recording a ledger entry against a customer.
 *
 * Two modes share one component because the layout is identical and
 * only the validation rules + i18n copy differ:
 *
 * - `payment` (default): fires `customerLedger.addPayment`. Note is
 * optional. Manager + admin can confirm.
 * - `adjustment`: fires `customerLedger.addAdjustment`. Note is
 * REQUIRED (the server rejects an empty note as well). Amount can
 * be positive or negative. Admin-only — the parent gates the
 * "Cargar a cuenta" CTA behind `user.role === 'admin'`, so the
 * modal trusts the prop.
 * - `till`: cash taken at the register (`customerLedger.addTillPayment`),
 * capped at `balance`, which the modal states and can fill in one tap.
 *
 * Mirrors the shape of `CashSessionMovementModal` (amount input +
 * note textarea + Cancel / Confirm footer) so the operator sees a
 * familiar layout across the two ledger surfaces.
 */
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { useSingleFlightSubmit } from '@/lib/useSingleFlightSubmit';
import { formatCurrency } from '@/lib/utils';

export type CustomerLedgerAbonoMode = 'payment' | 'adjustment' | 'till';

export type CustomerLedgerPaymentMethod = 'cash' | 'card' | 'transfer';

export interface CustomerLedgerAbonoValues {
  amount: number;
  note: string;
  paymentMethod?: CustomerLedgerPaymentMethod | undefined;
}

interface CustomerLedgerAbonoModalProps {
  mode: CustomerLedgerAbonoMode;
  isOpen: boolean;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: CustomerLedgerAbonoValues) => Promise<void>;
  /** What the customer owes; required by `till`, the most it accepts. */
  balance?: number | undefined;
  customerName?: string | undefined;
}

const NAMESPACE_BY_MODE: Record<CustomerLedgerAbonoMode, string> = {
  payment: 'ledger.abonoModal',
  adjustment: 'ledger.adjustmentModal',
  till: 'ledger.tillModal',
};

const PAYMENT_MIN = 0.01;

export function CustomerLedgerAbonoModal({
  mode,
  isOpen,
  isSaving,
  error,
  onClose,
  onSubmit,
  balance = 0,
  customerName = '',
}: CustomerLedgerAbonoModalProps) {
  const { t } = useTranslation('customers');
  const ns = NAMESPACE_BY_MODE[mode];
  const isPayment = mode !== 'adjustment';
  const copyValues = { name: customerName, balance: formatCurrency(balance) };
  const form = useForm<CustomerLedgerAbonoValues>({
    defaultValues: { amount: 0, note: '', paymentMethod: 'cash' },
  });

  // Reset on `mode` / `isOpen` change so a future keep-mounted
  // refactor cannot leak stale values across opens. Safe today
  // (parent already unmounts via conditional render) but the explicit
  // reset removes the fragility.
  useEffect(() => {
    if (isOpen) {
      form.reset({ amount: 0, note: '', paymentMethod: 'cash' });
    }
  }, [isOpen, mode, form]);

  // Mirrors the confirm button's disabled expression, so the Enter path
  // cannot submit what the click path refuses.
  const canSubmit = !isSaving;
  const handleConfirm = form.handleSubmit(
    useSingleFlightSubmit(canSubmit, async values => {
      await onSubmit({
        amount: values.amount,
        note: values.note?.trim() ?? '',
        ...(mode === 'payment' ? { paymentMethod: values.paymentMethod ?? 'cash' } : {}),
      });
    })
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      title={t(`${ns}.title`, copyValues)}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('ledger.actions.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleConfirm} disabled={isSaving}>
            {isSaving ? t('ledger.actions.saving') : t(`${ns}.confirm`)}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleConfirm}>
        <p className="text-sm text-secondary-600">{t(`${ns}.description`, copyValues)}</p>

        <div>
          <label htmlFor="customer-ledger-amount" className="label">
            {t(`${ns}.amountLabel`)}
          </label>
          <input
            id="customer-ledger-amount"
            type="number"
            // The adjustment branch accepts negative amounts (e.g. a
            // returned item credit). `min` is omitted there and the
            // refinement runs through the existing Zod schema on the
            // server.
            min={isPayment ? PAYMENT_MIN : undefined}
            max={mode === 'till' ? balance : undefined}
            step="0.01"
            className="input mt-1"
            data-testid="customer-ledger-amount-input"
            {...form.register('amount', {
              valueAsNumber: true,
              validate: value => {
                if (!Number.isFinite(value)) {
                  return t(`${ns}.amountRequired`);
                }
                if (isPayment && value < PAYMENT_MIN) {
                  return t(`${ns}.amountRequired`);
                }
                if (mode === 'till' && value > balance) {
                  return t('ledger.tillModal.amountTooHigh', copyValues);
                }
                if (mode === 'adjustment' && value === 0) {
                  return t(`${ns}.amountRequired`);
                }
                return true;
              },
            })}
          />
          {mode === 'till' && balance > 0 && (
            <button
              type="button"
              className="btn-outline mt-2 h-9 px-3 text-sm"
              onClick={() => form.setValue('amount', balance, { shouldValidate: true })}
              data-testid="customer-ledger-pay-all"
            >
              {t('ledger.tillModal.payAll', copyValues)}
            </button>
          )}
          {form.formState.errors.amount && (
            <p
              role="alert"
              className="mt-1 text-sm text-danger-500"
              data-testid="customer-ledger-amount-error"
            >
              {form.formState.errors.amount.message}
            </p>
          )}
        </div>

        {mode === 'payment' && (
          <div>
            <label htmlFor="customer-ledger-payment-method" className="label">
              {t('ledger.abonoModal.paymentMethodLabel')}
            </label>
            <select
              id="customer-ledger-payment-method"
              className="input mt-1"
              data-testid="customer-ledger-payment-method"
              {...form.register('paymentMethod', { required: true })}
            >
              <option value="cash">{t('ledger.abonoModal.paymentMethods.cash')}</option>
              <option value="card">{t('ledger.abonoModal.paymentMethods.card')}</option>
              <option value="transfer">{t('ledger.abonoModal.paymentMethods.transfer')}</option>
            </select>
          </div>
        )}

        <div>
          <label htmlFor="customer-ledger-note" className="label">
            {t(`${ns}.noteLabel`)}
            {isPayment && (
              <span className="ml-1 text-xs text-secondary-500">
                {t('ledger.actions.optional')}
              </span>
            )}
          </label>
          <textarea
            id="customer-ledger-note"
            rows={3}
            className="input mt-1 min-h-[80px]"
            data-testid="customer-ledger-note-input"
            {...form.register('note', {
              // Adjustment requires a note (both server-side via Zod
              // and here so the operator gets immediate feedback).
              required: mode === 'adjustment' ? t('ledger.adjustmentModal.noteRequired') : false,
              maxLength: {
                value: 240,
                message: t('ledger.actions.noteTooLong'),
              },
            })}
          />
          {form.formState.errors.note && (
            <p
              role="alert"
              className="mt-1 text-sm text-danger-500"
              data-testid="customer-ledger-note-error"
            >
              {form.formState.errors.note.message}
            </p>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="text-sm text-danger-500"
            data-testid="customer-ledger-abono-error"
          >
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
