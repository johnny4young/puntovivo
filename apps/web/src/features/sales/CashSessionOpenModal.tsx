import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Minus, Plus, Sun } from 'lucide-react';
import { ModalButton } from '@/components/form-controls/Modal';
import { Overlay } from '@/components/overlay/Overlay';
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
  const mismatchMessage = shouldShowMismatch && !isBalanced ? t('cashSession.form.mismatch') : null;

  return (
    <Overlay
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      kicker={t('cashSession.form.kicker', { defaultValue: 'Apertura de caja' })}
      title={t('cashSession.form.title')}
      description={t('cashSession.form.description', {
        defaultValue:
          'Cuenta el efectivo inicial por denominación. El total debe coincidir con la base de apertura antes de habilitar la caja.',
      })}
      headerAside={
        <span className="hidden items-center gap-2 rounded-full border border-warning-500/30 bg-warning-50/70 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-warning-700 sm:inline-flex">
          <Sun className="h-3 w-3" aria-hidden="true" />
          {t('cashSession.form.firstDay', { defaultValue: 'Primer día' })}
        </span>
      }
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

        <section
          className={`relative overflow-hidden rounded-[12px] border px-4 py-4 sm:px-5 ${
            mismatchMessage
              ? 'border-warning-500/30 bg-warning-50/70'
              : 'border-success-500/30 bg-success-50/40'
          }`}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background: mismatchMessage
                ? 'radial-gradient(circle at 92% 0%, color-mix(in oklch, var(--warning-500) 18%, transparent), transparent 60%)'
                : 'radial-gradient(circle at 92% 0%, color-mix(in oklch, var(--success-500) 16%, transparent), transparent 60%)',
            }}
          />
          <div className="relative grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-secondary-500">
                {t('cashSession.form.countedTotal')}
              </p>
              <p className="mt-1.5 font-display text-2xl tabular-nums tracking-[-0.02em] text-secondary-950">
                {formatCurrency(countedTotal)}
              </p>
            </div>
            <div>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-secondary-500">
                {t('cashSession.form.openingFloat')}
              </p>
              <p className="mt-1.5 font-display text-xl tabular-nums tracking-[-0.02em] text-secondary-900">
                {formatCurrency(openingFloat || 0)}
              </p>
            </div>
            <div>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-secondary-500">
                {t('cashSession.form.differenceLabel', { defaultValue: 'Diferencia' })}
              </p>
              <p
                className={`mt-1.5 font-display text-xl tabular-nums tracking-[-0.02em] ${
                  mismatchMessage ? 'text-warning-700' : 'text-success-700'
                }`}
              >
                {formatCurrency(countedTotal - (openingFloat || 0))}
              </p>
            </div>
          </div>
          {mismatchMessage && (
            <p className="relative mt-3 text-[12.5px] text-warning-700">{mismatchMessage}</p>
          )}
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

          <div className="grid gap-2.5 sm:grid-cols-2">
            {denominationFieldArray.fields.map((field, index) => {
              const currentCount = denominations?.[index]?.count ?? 0;
              const lineTotal = currentCount * field.value;
              const setCount = (next: number) =>
                form.setValue(`denominations.${index}.count`, Math.max(0, next), {
                  shouldDirty: true,
                });
              return (
                <div
                  key={field.value}
                  className="rounded-2xl border border-line/70 bg-surface/96 px-3.5 py-3 transition-colors hover:border-primary-200"
                >
                  <input
                    type="hidden"
                    {...form.register(`denominations.${index}.value`, {
                      valueAsNumber: true,
                    })}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[15px] font-semibold tabular-nums text-secondary-950">
                        {formatCurrency(field.value)}
                      </p>
                      <p className="mt-0.5 text-[10.5px] uppercase tracking-[0.18em] text-secondary-500">
                        {t('cashSession.form.lineTotal', {
                          total: formatCurrency(lineTotal),
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label={t('cashSession.form.decrementCount', {
                          defaultValue: 'Restar',
                        })}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line/70 text-secondary-700 transition hover:border-warning-300 hover:bg-warning-50 hover:text-warning-700 disabled:opacity-40"
                        disabled={currentCount <= 0}
                        onClick={() => setCount(currentCount - 1)}
                      >
                        <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
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
                        className="input h-9 w-14 text-center font-mono text-[14px] tabular-nums"
                        {...form.register(`denominations.${index}.count`, {
                          valueAsNumber: true,
                          min: 0,
                        })}
                      />
                      <button
                        type="button"
                        aria-label={t('cashSession.form.incrementCount', { defaultValue: 'Sumar' })}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line/70 text-secondary-700 transition hover:border-primary/40 hover:bg-primary-50 hover:text-primary-700"
                        onClick={() => setCount(currentCount + 1)}
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Overlay>
  );
}
