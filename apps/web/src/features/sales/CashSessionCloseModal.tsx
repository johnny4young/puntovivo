import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ModalButton } from '@/components/form-controls/Modal';
import { Overlay } from '@/components/overlay/Overlay';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { CashSession, CashSessionDenomination } from '@/types';
import {
  cashSessionTotalsMatch,
  createCashSessionDenominations,
  getCashSessionCountedTotal,
} from './cashSessionDenominations';

export interface CashSessionCloseValues {
  actualCount: number;
  denominations: CashSessionDenomination[];
}

interface CashSessionCloseModalProps {
  cashSession: CashSession | null;
  isOpen: boolean;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: CashSessionCloseValues) => Promise<void>;
  /**
   * ENG-018b — count of suspended drafts still in flight for this
   * cashier's visibility scope. When greater than zero, the modal
   * surfaces a warning so the operator knows the drafts will survive
   * the close as `status='draft'` rows and must be picked up later.
   * Defaults to 0 when the caller does not wire it.
   */
  suspendedDraftsCount?: number;
}

function createDefaultValues(): CashSessionCloseValues {
  return {
    actualCount: 0,
    denominations: createCashSessionDenominations(),
  };
}

export function CashSessionCloseModal({
  cashSession,
  isOpen,
  isSaving,
  error,
  onClose,
  onSubmit,
  suspendedDraftsCount = 0,
}: CashSessionCloseModalProps) {
  const { t } = useTranslation('sales');
  const form = useForm<CashSessionCloseValues>({
    defaultValues: createDefaultValues(),
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
  const actualCount = useWatch({
    control: form.control,
    name: 'actualCount',
  });

  const countedTotal = getCashSessionCountedTotal(denominations ?? []);
  const isBalanced = cashSessionTotalsMatch(actualCount ?? 0, denominations ?? []);
  const shouldShowMismatch = (actualCount ?? 0) > 0 || countedTotal > 0;
  const mismatchMessage =
    shouldShowMismatch && !isBalanced ? t('cashSession.closeForm.mismatch') : null;

  return (
    <Overlay
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      kicker={t('cashSession.closeForm.kicker', { defaultValue: 'Cierre de caja' })}
      title={t('cashSession.closeForm.title')}
      description={t('cashSession.closeForm.description', {
        defaultValue:
          'Cuenta el efectivo en caja por denominación. El cierre ciego mantiene oculto el saldo esperado hasta que envías el conteo final.',
      })}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving} className="sm:min-w-[8.5rem]">
            {t('cashSession.closeForm.cancel')}
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={handleSubmit}
            disabled={isSaving || !cashSession || !!mismatchMessage}
            className="sm:min-w-[10rem]"
          >
            {isSaving ? t('cashSession.closeForm.closing') : t('cashSession.closeForm.confirm')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {suspendedDraftsCount > 0 && (
          <div
            className="rounded-2xl border border-warning-300 bg-warning-50 px-4 py-3 text-sm text-warning-900"
            role="alert"
            data-testid="close-session-suspended-warning"
          >
            {t('park.closedSessionWarning', { count: suspendedDraftsCount })}
          </div>
        )}

        <section className="card-inset p-4 sm:p-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
            <div className="card-inset bg-surface/92 px-4 py-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                {t('cashSession.closeForm.registerName')}
              </p>
              <p className="mt-2 text-lg font-semibold text-secondary-950">
                {cashSession?.registerName ?? '—'}
              </p>
              <p className="mt-1 text-sm text-secondary-500">
                {t('cashSession.closeForm.openedAt')}{' '}
                {cashSession ? formatDateTime(cashSession.openedAt) : '—'}
              </p>
            </div>

            <div>
              <label htmlFor="cash-session-closing-count" className="label">
                {t('cashSession.closeForm.actualCount')}
              </label>
              <input
                id="cash-session-closing-count"
                type="number"
                min={0}
                step="0.01"
                className="input mt-1"
                {...form.register('actualCount', {
                  valueAsNumber: true,
                  min: {
                    value: 0,
                    message: t('cashSession.closeForm.actualCountRequired'),
                  },
                })}
              />
              {form.formState.errors.actualCount && (
                <p className="mt-1 text-sm text-danger-500">
                  {form.formState.errors.actualCount.message}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="card-inset p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                {t('cashSession.closeForm.countedTotal')}
              </p>
              <p className="mt-2 text-xl font-semibold text-secondary-950 sm:text-2xl">
                {formatCurrency(countedTotal)}
              </p>
            </div>
            <div className="text-right text-sm">
              <p className="text-secondary-500">{t('cashSession.closeForm.blindClose')}</p>
              <p className="mt-1 font-medium text-secondary-900">
                {t('cashSession.closeForm.blindCloseHint')}
              </p>
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-secondary-600">{t('cashSession.closeForm.description')}</p>
          {mismatchMessage && <p className="mt-3 text-sm text-danger-500">{mismatchMessage}</p>}
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-secondary-500">
              {t('cashSession.closeForm.denominations')}
            </h3>
            <p className="mt-2 text-sm leading-6 text-secondary-500">
              {t('cashSession.closeForm.denominationsHint')}
            </p>
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
                      {t('cashSession.closeForm.lineTotal', {
                        total: formatCurrency((denominations?.[index]?.count ?? 0) * field.value),
                      })}
                    </p>
                  </div>
                  <div className="w-24">
                    <label htmlFor={`cash-session-close-count-${index}`} className="sr-only">
                      {t('cashSession.closeForm.countFor', {
                        denomination: formatCurrency(field.value),
                      })}
                    </label>
                    <input
                      id={`cash-session-close-count-${index}`}
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
    </Overlay>
  );
}
