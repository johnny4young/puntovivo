import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { formatCurrency } from '@/lib/utils';
import type { CashSessionDenomination, RegisterAssignment } from '@/types';
import {
  cashSessionTotalsMatch,
  createCashSessionDenominations,
  getCashSessionCountedTotal,
} from './cashSessionDenominations';

export interface CashSessionOpenValues {
  registerName: string;
  openingFloat: number;
  denominations: CashSessionDenomination[];
}

interface CashSessionOpenModalProps {
  isOpen: boolean;
  isSaving: boolean;
  error: string | null;
  defaultRegisterAssignment?: RegisterAssignment | null;
  onClose: () => void;
  onSubmit: (values: CashSessionOpenValues) => Promise<void>;
}

function createDefaultValues(
  defaultRegisterAssignment?: RegisterAssignment | null
): CashSessionOpenValues {
  const assignmentDenominations = defaultRegisterAssignment?.denominations ?? [];

  return {
    registerName: defaultRegisterAssignment?.registerName ?? 'Main register',
    openingFloat: defaultRegisterAssignment?.openingFloat ?? 0,
    denominations:
      assignmentDenominations.length > 0
        ? assignmentDenominations.map(denomination => ({ ...denomination }))
        : createCashSessionDenominations(),
  };
}

export function CashSessionOpenModal({
  isOpen,
  isSaving,
  error,
  defaultRegisterAssignment,
  onClose,
  onSubmit,
}: CashSessionOpenModalProps) {
  const { t } = useTranslation('sales');
  const form = useForm<CashSessionOpenValues>({
    defaultValues: createDefaultValues(defaultRegisterAssignment),
  });
  const handleSubmit = form.handleSubmit(onSubmit);
  const denominationFieldArray = useFieldArray({
    control: form.control,
    name: 'denominations',
  });

  const denominations = useWatch({
    control: form.control,
    name: 'denominations',
  });
  const openingFloat = useWatch({
    control: form.control,
    name: 'openingFloat',
  });

  const countedTotal = getCashSessionCountedTotal(denominations ?? []);
  const isBalanced = cashSessionTotalsMatch(openingFloat ?? 0, denominations ?? []);
  const shouldShowMismatch = (openingFloat ?? 0) > 0 || countedTotal > 0;
  const mismatchMessage =
    shouldShowMismatch && !isBalanced ? t('cashSession.form.mismatch') : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title={t('cashSession.form.title')}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving} className="sm:min-w-[8.5rem]">
            {t('cashSession.form.cancel')}
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={handleSubmit}
            disabled={isSaving || !!mismatchMessage}
            className="sm:min-w-[10rem]"
          >
            {isSaving ? t('cashSession.form.opening') : t('cashSession.form.confirm')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <section className="card-inset p-4 sm:p-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
            <div>
              <label htmlFor="cash-session-register" className="label">
                {t('cashSession.form.registerName')}
              </label>
              <input
                id="cash-session-register"
                className="input mt-1"
                {...form.register('registerName', {
                  required: t('cashSession.form.registerNameRequired'),
                })}
              />
              {form.formState.errors.registerName && (
                <p className="mt-1 text-sm text-danger-500">
                  {form.formState.errors.registerName.message}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="cash-session-opening-float" className="label">
                {t('cashSession.form.openingFloat')}
              </label>
              <input
                id="cash-session-opening-float"
                type="number"
                min={0}
                step="0.01"
                className="input mt-1"
                {...form.register('openingFloat', {
                  valueAsNumber: true,
                  min: {
                    value: 0,
                    message: t('cashSession.form.openingFloatRequired'),
                  },
                })}
              />
              {form.formState.errors.openingFloat && (
                <p className="mt-1 text-sm text-danger-500">
                  {form.formState.errors.openingFloat.message}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="card-inset p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                {t('cashSession.form.countedTotal')}
              </p>
              <p className="mt-2 text-xl font-semibold text-secondary-950 sm:text-2xl">
                {formatCurrency(countedTotal)}
              </p>
            </div>
            <div className="text-right text-sm">
              <p className="text-secondary-500">{t('cashSession.form.openingFloat')}</p>
              <p className="mt-1 font-medium text-secondary-900">{formatCurrency(openingFloat || 0)}</p>
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-secondary-600">{t('cashSession.form.description')}</p>
          {mismatchMessage && <p className="mt-3 text-sm text-danger-500">{mismatchMessage}</p>}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-secondary-500">
                {t('cashSession.form.denominations')}
              </h3>
              <p className="mt-2 text-sm leading-6 text-secondary-500">
                {t('cashSession.form.denominationsHint')}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {denominationFieldArray.fields.map((field, index) => (
              <div key={field.value} className="card-inset bg-surface/92 px-4 py-3">
                <input
                  type="hidden"
                  {...form.register(`denominations.${index}.value`, {
                    valueAsNumber: true,
                  })}
                />
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-secondary-950">
                      {formatCurrency(field.value)}
                    </p>
                    <p className="mt-1 text-xs text-secondary-500">
                      {t('cashSession.form.lineTotal', {
                        total: formatCurrency((denominations?.[index]?.count ?? 0) * field.value),
                      })}
                    </p>
                  </div>
                  <div className="w-24">
                    <label htmlFor={`cash-session-count-${index}`} className="sr-only">
                      {t('cashSession.form.countFor', {
                        denomination: formatCurrency(field.value),
                      })}
                    </label>
                    <input
                      id={`cash-session-count-${index}`}
                      type="number"
                      min={0}
                      step={1}
                      className="input text-right"
                      {...form.register(`denominations.${index}.count`, {
                        valueAsNumber: true,
                        min: 0,
                      })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
