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
 *
 * Mirrors the shape of `CashSessionMovementModal` (amount input +
 * note textarea + Cancel / Confirm footer) so the operator sees a
 * familiar layout across the two ledger surfaces.
 */
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';

export type CustomerLedgerAbonoMode = 'payment' | 'adjustment';

export interface CustomerLedgerAbonoValues {
  amount: number;
  note: string;
}

interface CustomerLedgerAbonoModalProps {
  mode: CustomerLedgerAbonoMode;
  isOpen: boolean;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: CustomerLedgerAbonoValues) => Promise<void>;
}

const PAYMENT_MIN = 0.01;

export function CustomerLedgerAbonoModal({
  mode,
  isOpen,
  isSaving,
  error,
  onClose,
  onSubmit,
}: CustomerLedgerAbonoModalProps) {
  const { t } = useTranslation('customers');
  const ns = mode === 'payment' ? 'ledger.abonoModal' : 'ledger.adjustmentModal';
  const form = useForm<CustomerLedgerAbonoValues>({
    defaultValues: { amount: 0, note: '' },
  });

  // Reset on `mode` / `isOpen` change so a future keep-mounted
  // refactor cannot leak stale values across opens. Safe today
  // (parent already unmounts via conditional render) but the explicit
  // reset removes the fragility.
  useEffect(() => {
    if (isOpen) {
      form.reset({ amount: 0, note: '' });
    }
  }, [isOpen, mode, form]);

  const handleConfirm = form.handleSubmit(async values => {
    await onSubmit({
      amount: values.amount,
      note: values.note?.trim() ?? '',
    });
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      title={t(`${ns}.title`)}
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
        <p className="text-sm text-secondary-600">{t(`${ns}.description`)}</p>

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
            min={mode === 'payment' ? PAYMENT_MIN : undefined}
            step="0.01"
            className="input mt-1"
            data-testid="customer-ledger-amount-input"
            {...form.register('amount', {
              valueAsNumber: true,
              validate: value => {
                if (!Number.isFinite(value)) {
                  return t(`${ns}.amountRequired`);
                }
                if (mode === 'payment' && value < PAYMENT_MIN) {
                  return t(`${ns}.amountRequired`);
                }
                if (mode === 'adjustment' && value === 0) {
                  return t(`${ns}.amountRequired`);
                }
                return true;
              },
            })}
          />
          {form.formState.errors.amount && (
            <p className="mt-1 text-sm text-danger-500" data-testid="customer-ledger-amount-error">
              {form.formState.errors.amount.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="customer-ledger-note" className="label">
            {t(`${ns}.noteLabel`)}
            {mode === 'payment' && (
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
            <p className="mt-1 text-sm text-danger-500" data-testid="customer-ledger-note-error">
              {form.formState.errors.note.message}
            </p>
          )}
        </div>

        {error && (
          <p className="text-sm text-danger-500" data-testid="customer-ledger-abono-error">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
