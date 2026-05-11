import { useMemo, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { sumBy } from '@/lib/numbers';
import { formatCurrency } from '@/lib/utils';
import type { Customer, PaymentMethod } from '@/types';

type SplitTenderMethod = Exclude<PaymentMethod, 'credit'>;

export interface SalePaymentTenderValue {
  method: SplitTenderMethod;
  amount: number;
  reference: string;
}

export interface SalePaymentValues {
  customerId: string;
  paymentMethod: PaymentMethod;
  amountReceived: number;
  notes: string;
  /**
   * Optional multi-tender breakdown. When non-empty, the server ignores
   * `paymentMethod` + `amountReceived` for persistence and uses this list.
   */
  tenders: SalePaymentTenderValue[];
}

interface SalePaymentModalProps {
  isOpen: boolean;
  total: number;
  customers: Customer[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: SalePaymentValues) => Promise<void>;
}

const TENDER_SUM_EPSILON = 0.005;

function getDefaultValues(total: number): SalePaymentValues {
  return {
    customerId: '',
    paymentMethod: 'cash',
    amountReceived: total,
    notes: '',
    tenders: [],
  };
}

export function SalePaymentModal({
  isOpen,
  total,
  customers,
  isSaving,
  error,
  onClose,
  onSubmit,
}: SalePaymentModalProps) {
  const { t } = useTranslation('sales');
  const [splitMode, setSplitMode] = useState(false);
  const form = useForm<SalePaymentValues>({
    defaultValues: getDefaultValues(total),
  });
  const tenderFields = useFieldArray({
    control: form.control,
    name: 'tenders',
  });

  const paymentMethod = useWatch({ control: form.control, name: 'paymentMethod' }) ?? 'cash';
  const amountReceived = useWatch({ control: form.control, name: 'amountReceived' });
  const watchedTenders = useWatch({ control: form.control, name: 'tenders' });
  const tenders = useMemo(() => watchedTenders ?? [], [watchedTenders]);
  const amountReceivedValue = Number(amountReceived) || 0;
  const isCash = paymentMethod === 'cash';
  const change = isCash ? Math.max(0, amountReceivedValue - total) : 0;
  const outstanding = Math.max(0, total - amountReceivedValue);

  const tenderSum = useMemo(
    () => sumBy(tenders, tender => Number(tender.amount) || 0),
    [tenders]
  );
  const tenderDelta = tenderSum - total;
  const tendersAreAllPositive = tenders.every(
    tender => (Number(tender.amount) || 0) > 0
  );

  function handleEnableSplit(): void {
    if (splitMode) {
      return;
    }
    setSplitMode(true);
    // Seed a first tender row so the cashier only needs to add the remainder.
    tenderFields.append({ method: 'cash', amount: total, reference: '' });
  }

  function handleDisableSplit(): void {
    if (!splitMode) {
      return;
    }
    setSplitMode(false);
    tenderFields.replace([]);
  }

  const handleSubmit = form.handleSubmit(values => {
    // Normalize: when split mode is inactive, strip the (empty) tenders array
    // so the legacy single-tender backend path is selected unambiguously.
    return onSubmit({
      ...values,
      tenders: splitMode ? values.tenders : [],
    });
  });

  const splitIsValid =
    splitMode &&
    tenders.length >= 2 &&
    Math.abs(tenderDelta) < TENDER_SUM_EPSILON &&
    tendersAreAllPositive;

  const canSubmit = !isSaving && (!splitMode || splitIsValid);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('payment.title')}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('payment.cancel')}
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {isSaving ? t('payment.processing') : t('payment.confirm')}
          </ModalButton>
        </>
      }
    >
      <form id="sale-payment-form" className="space-y-4" onSubmit={handleSubmit}>
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-4">
          <p className="text-sm text-primary-700">{t('payment.saleTotal')}</p>
          <p className="mt-1 text-3xl font-semibold text-primary-900">{formatCurrency(total)}</p>
        </div>

        <div>
          <label htmlFor="sale-payment-customer" className="label">
            {t('payment.customer')}
          </label>
          <select id="sale-payment-customer" className="input mt-1" {...form.register('customerId')}>
            <option value="">{t('payment.walkIn')}</option>
            {customers.map(customer => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </div>

        {!splitMode && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="sale-payment-method" className="label">
                  {t('payment.paymentMethod')}
                </label>
                <select
                  id="sale-payment-method"
                  className="input mt-1"
                  {...form.register('paymentMethod')}
                >
                  <option value="cash">{t('payment.cash')}</option>
                  <option value="card">{t('payment.card')}</option>
                  <option value="transfer">{t('payment.transfer')}</option>
                  <option value="credit">{t('payment.credit')}</option>
                  <option value="other">{t('payment.other')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="sale-payment-amount" className="label">
                  {t('payment.amountReceived')}
                </label>
                <input
                  id="sale-payment-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  className="input mt-1"
                  {...form.register('amountReceived', {
                    valueAsNumber: true,
                    min: { value: 0, message: t('payment.amountNegative') },
                  })}
                />
                {form.formState.errors.amountReceived && (
                  <p className="mt-1 text-sm text-danger-500">
                    {form.formState.errors.amountReceived.message}
                  </p>
                )}
              </div>
            </div>

            <div className="surface-panel-muted text-sm">
              <div className="flex items-center justify-between">
                <span className="text-secondary-500">{t('payment.amountReceived')}</span>
                <span className="font-medium text-secondary-900">{formatCurrency(amountReceivedValue)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-secondary-500">{isCash ? t('payment.change') : t('payment.balance')}</span>
                <span className="font-medium text-secondary-900">
                  {formatCurrency(isCash ? change : outstanding)}
                </span>
              </div>
            </div>

            <button
              type="button"
              className="btn-ghost inline-flex items-center gap-2 text-sm"
              onClick={handleEnableSplit}
            >
              <Plus className="h-4 w-4" />
              {t('payment.splitEnable')}
            </button>
          </>
        )}

        {splitMode && (
          <div className="space-y-3 rounded-xl border border-secondary-200 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-secondary-900">
                {t('payment.splitHeading')}
              </p>
              <button
                type="button"
                className="btn-ghost text-xs text-secondary-600"
                onClick={handleDisableSplit}
              >
                {t('payment.splitDisable')}
              </button>
            </div>
            <p className="text-xs text-secondary-500">{t('payment.splitHelp')}</p>

            <div className="space-y-2">
              {tenderFields.fields.map((field, index) => (
                // `field.id` is react-hook-form's stable UUID for this row.
                // Using it alone (not composed with `index`) keeps DOM nodes
                // stable across removes/reorders so focus and transient input
                // state survive array mutations.
                <div key={field.id} className="grid gap-2 md:grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <select
                    className="input"
                    aria-label={t('payment.splitMethodLabel', { index: index + 1 })}
                    {...form.register(`tenders.${index}.method` as const)}
                  >
                    <option value="cash">{t('payment.cash')}</option>
                    <option value="card">{t('payment.card')}</option>
                    <option value="transfer">{t('payment.transfer')}</option>
                    <option value="other">{t('payment.other')}</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder={t('payment.splitAmountPlaceholder')}
                    aria-label={t('payment.splitAmountLabel', { index: index + 1 })}
                    className="input"
                    {...form.register(`tenders.${index}.amount` as const, {
                      // NOTE: single-tender `amountReceived` above uses
                      // `valueAsNumber: true` because it is a plain field.
                      // Field arrays + `valueAsNumber` have known edge cases
                      // around cleared inputs turning into NaN, which then
                      // poisons `Number(NaN) || 0` comparisons downstream and
                      // blocks Confirm. `setValueAs` normalizes empty to 0 at
                      // registration time.
                      setValueAs: value => {
                        if (value === '' || value === null || value === undefined) {
                          return 0;
                        }
                        const parsed = Number(value);
                        return Number.isFinite(parsed) ? parsed : 0;
                      },
                      min: { value: 0, message: t('payment.amountNegative') },
                    })}
                  />
                  <input
                    type="text"
                    placeholder={t('payment.splitReferencePlaceholder')}
                    aria-label={t('payment.splitReferenceLabel', { index: index + 1 })}
                    className="input"
                    {...form.register(`tenders.${index}.reference` as const)}
                  />
                  <button
                    type="button"
                    className="btn-ghost justify-self-start p-2"
                    onClick={() => tenderFields.remove(index)}
                    aria-label={t('payment.splitRemove', { index: index + 1 })}
                    disabled={tenderFields.fields.length <= 1}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-2 text-sm"
              onClick={() => {
                const currentTenderSum = sumBy(
                  form.getValues('tenders'),
                  tender => Number(tender.amount) || 0
                );
                tenderFields.append({
                  method: 'card',
                  amount: Math.max(0, total - currentTenderSum),
                  reference: '',
                });
              }}
            >
              <Plus className="h-4 w-4" />
              {t('payment.splitAddTender')}
            </button>

            <div className="surface-panel-muted text-sm">
              <div className="flex items-center justify-between">
                <span className="text-secondary-500">{t('payment.splitSum')}</span>
                <span className="font-medium text-secondary-900">{formatCurrency(tenderSum)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-secondary-500">{t('payment.splitDelta')}</span>
                <span
                  className={
                    Math.abs(tenderDelta) < TENDER_SUM_EPSILON
                      ? 'font-medium text-success-600'
                      : 'font-medium text-danger-600'
                  }
                >
                  {tenderDelta >= 0 ? '+' : ''}
                  {formatCurrency(tenderDelta)}
                </span>
              </div>
            </div>

            {!splitIsValid && (
              <p className="text-xs text-secondary-500">
                {t('payment.splitMustMatch')}
              </p>
            )}
          </div>
        )}

        <div>
          <label htmlFor="sale-payment-notes" className="label">
            {t('payment.notes')}
          </label>
          <textarea
            id="sale-payment-notes"
            className="input mt-1 min-h-[96px]"
            placeholder={t('payment.notesHint')}
            {...form.register('notes')}
          />
        </div>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
