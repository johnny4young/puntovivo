import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { EyeOff, Minus, Plus, Scale } from 'lucide-react';
import { ModalButton } from '@/components/form-controls/Modal';
import { Overlay } from '@/components/overlay/Overlay';
import { useAuth } from '@/features/auth/AuthProvider';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { CashSession, CashSessionDenomination } from '@/types';
import {
  cashSessionTotalsMatch,
  createCashSessionDenominations,
  getCashSessionCountedTotal,
} from './cashSessionDenominations';

/**
 * ENG-194 — tolerance under which counted-vs-expected is considered balanced
 * while typing the close count. Mirrors CASH_OVER_SHORT_EPSILON in the
 * Operations Center cash panel so both surfaces agree on "cuadrada".
 */
const LIVE_DELTA_EPSILON = 0.009;

export interface CashSessionCloseValues {
  actualCount: number;
  denominations: CashSessionDenomination[];
  justification?: string;
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
    justification: '',
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
  const { user } = useAuth();
  // ENG-194 — the live counted-vs-expected semaphore is deliberately
  // role-gated: cashiers keep the blind close (an anti-fraud control — they
  // must not see the target while counting); managers/admins closing or
  // supervising a till get live feedback so balancing feels like hitting the
  // mark instead of filling a form.
  const canSeeLiveDelta = user?.role === 'admin' || user?.role === 'manager';
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
      headerAside={
        <span className="hidden items-center gap-2 rounded-full border border-secondary-700/40 bg-secondary-950/95 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-secondary-50 sm:inline-flex">
          <EyeOff className="h-3 w-3" aria-hidden="true" />
          {t('cashSession.closeForm.blindBadge', { defaultValue: 'Cierre ciego' })}
        </span>
      }
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
      <form
        className="space-y-4 rounded-[20px] bg-secondary-950 p-4 text-secondary-50 sm:p-5"
        onSubmit={handleSubmit}
      >
        {suspendedDraftsCount > 0 && (
          <div
            className="rounded-2xl border border-warning-400/40 bg-warning-500/15 px-4 py-3 text-sm text-warning-100"
            role="alert"
            data-testid="close-session-suspended-warning"
          >
            {t('park.closedSessionWarning', { count: suspendedDraftsCount })}
          </div>
        )}

        <section className="rounded-[16px] border border-secondary-800/70 bg-secondary-900/60 p-4 sm:p-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-secondary-400">
                {t('cashSession.closeForm.registerName')}
              </p>
              <p className="mt-1.5 font-display text-lg text-white">
                {cashSession?.registerName ?? '—'}
              </p>
              <p className="mt-1 text-[12px] text-secondary-400">
                {t('cashSession.closeForm.openedAt')}{' '}
                {cashSession ? formatDateTime(cashSession.openedAt) : '—'}
              </p>
            </div>

            <div>
              <label
                htmlFor="cash-session-closing-count"
                className="text-[10px] font-semibold uppercase tracking-[0.22em] text-secondary-400"
              >
                {t('cashSession.closeForm.actualCount')}
              </label>
              <input
                id="cash-session-closing-count"
                type="number"
                min={0}
                step="0.01"
                className="mt-1 h-10 w-full rounded-[10px] border border-secondary-700 bg-secondary-950 px-3 text-sm text-white tabular-nums outline-none transition focus:border-primary-300 focus:ring-2 focus:ring-primary-400/40"
                {...form.register('actualCount', {
                  valueAsNumber: true,
                  min: {
                    value: 0,
                    message: t('cashSession.closeForm.actualCountRequired'),
                  },
                })}
              />
              {form.formState.errors.actualCount && (
                <p className="mt-1 text-xs text-danger-300">
                  {form.formState.errors.actualCount.message}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-3 rounded-[16px] border border-secondary-800/70 bg-secondary-900/60 p-4 sm:grid-cols-3 sm:p-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-secondary-400">
              {t('cashSession.closeForm.countedTotal')}
            </p>
            <p className="mt-1.5 font-display text-2xl tabular-nums tracking-[-0.02em] text-white">
              {formatCurrency(countedTotal)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-secondary-400">
              {t('cashSession.closeForm.actualCount')}
            </p>
            <p className="mt-1.5 font-display text-xl tabular-nums tracking-[-0.02em] text-white">
              {formatCurrency(actualCount || 0)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-secondary-400">
              {t('cashSession.closeForm.blindClose')}
            </p>
            <p className="mt-1.5 text-[11.5px] leading-5 text-secondary-300">
              {t('cashSession.closeForm.blindCloseHint')}
            </p>
          </div>
        </section>

        {mismatchMessage && (
          <p className="rounded-2xl border border-warning-400/40 bg-warning-500/15 px-3 py-2 text-[12.5px] text-warning-100">
            {mismatchMessage}
          </p>
        )}

        {/* ENG-083b V6 — 5-col per-payment-method strip. Cash gets the
         * counted value live; the other four methods surface as "—"
         * pending server-side aggregation in ENG-083c (extend
         * cashSessions.summary with sales-by-method rollups). Keeping
         * the chrome in place now lets the operator see the structure
         * before the wiring lands. */}
        <section className="rounded-[16px] border border-secondary-800/70 bg-secondary-900/60 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-secondary-400">
            {t('cashSession.closeForm.byMethodTitle', { defaultValue: 'Por método de pago' })}
          </p>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-5">
            {(
              [
                [
                  'cash',
                  t('cashSession.closeForm.method.cash', { defaultValue: 'Efectivo' }),
                  formatCurrency(countedTotal),
                  true,
                ],
                [
                  'card',
                  t('cashSession.closeForm.method.card', { defaultValue: 'Tarjeta' }),
                  '—',
                  false,
                ],
                [
                  'transfer',
                  t('cashSession.closeForm.method.transfer', { defaultValue: 'Transferencia' }),
                  '—',
                  false,
                ],
                [
                  'credit',
                  t('cashSession.closeForm.method.credit', { defaultValue: 'Crédito' }),
                  '—',
                  false,
                ],
                [
                  'other',
                  t('cashSession.closeForm.method.other', { defaultValue: 'Otro' }),
                  '—',
                  false,
                ],
              ] as const
            ).map(([key, label, value, isPrimary]) => (
              <div
                key={key}
                className={`rounded-[10px] border px-2.5 py-2 ${
                  isPrimary
                    ? 'border-primary-300/40 bg-primary-400/10'
                    : 'border-secondary-700/70 bg-secondary-950/40'
                }`}
              >
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-secondary-400">
                  {label}
                </p>
                <p
                  className={`mt-1 font-mono text-[12px] tabular-nums ${isPrimary ? 'text-white' : 'text-secondary-500'}`}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10.5px] text-secondary-500">
            {t('cashSession.closeForm.byMethodHint', {
              defaultValue:
                'Tarjeta · Transferencia · Crédito · Otro aparecen cuando ENG-083c sume las ventas por método.',
            })}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-secondary-400">
            {t('cashSession.closeForm.denominations')}
          </h3>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
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
                  className="rounded-[14px] border border-secondary-800/70 bg-secondary-900/60 px-3 py-3"
                >
                  <input
                    type="hidden"
                    {...form.register(`denominations.${index}.value`, {
                      valueAsNumber: true,
                    })}
                  />
                  <p className="text-[13px] font-semibold tabular-nums text-white">
                    {formatCurrency(field.value)}
                  </p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-secondary-400">
                    {t('cashSession.closeForm.lineTotal', {
                      total: formatCurrency(lineTotal),
                    })}
                  </p>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label={t('cashSession.form.decrementCount', { defaultValue: 'Restar' })}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-secondary-700 text-secondary-200 transition hover:border-warning-300 hover:bg-warning-500/15 hover:text-warning-200 disabled:opacity-40"
                      disabled={currentCount <= 0}
                      onClick={() => setCount(currentCount - 1)}
                    >
                      <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
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
                      className="h-8 w-14 rounded-[8px] border border-secondary-700 bg-secondary-950 text-center font-mono text-[14px] tabular-nums text-white outline-none focus:border-primary-300"
                      {...form.register(`denominations.${index}.count`, {
                        valueAsNumber: true,
                        min: 0,
                      })}
                    />
                    <button
                      type="button"
                      aria-label={t('cashSession.form.incrementCount', { defaultValue: 'Sumar' })}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-secondary-700 text-secondary-200 transition hover:border-primary-300 hover:bg-primary-400/10 hover:text-primary-200"
                      onClick={() => setCount(currentCount + 1)}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ENG-194 — live over/short semaphore, manager/admin only (the
         * cashier keeps the blind close). Reacts per keystroke because
         * `denominations` is a useWatch subscription. */}
        {canSeeLiveDelta && cashSession && countedTotal > 0 && (
          <section
            data-testid="close-session-live-delta"
            className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${
              Math.abs(countedTotal - cashSession.expectedBalance) <= LIVE_DELTA_EPSILON
                ? 'border-success-500/30 bg-success-500/15 text-success-100'
                : countedTotal - cashSession.expectedBalance > 0
                  ? 'border-warning-400/40 bg-warning-500/15 text-warning-100'
                  : 'border-danger-400/40 bg-danger-500/15 text-danger-100'
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <Scale className="h-4 w-4" aria-hidden="true" />
              {Math.abs(countedTotal - cashSession.expectedBalance) <= LIVE_DELTA_EPSILON
                ? t('cashSession.closeForm.liveDelta.balanced')
                : countedTotal - cashSession.expectedBalance > 0
                  ? t('cashSession.closeForm.liveDelta.over')
                  : t('cashSession.closeForm.liveDelta.short')}
            </span>
            <span className="font-mono tabular-nums">
              {formatCurrency(countedTotal - cashSession.expectedBalance)}
            </span>
          </section>
        )}

        <section>
          <label
            htmlFor="cash-session-close-justification"
            className="text-[10px] font-semibold uppercase tracking-[0.22em] text-secondary-400"
          >
            {t('cashSession.closeForm.justificationLabel', {
              defaultValue: 'Justificación (opcional)',
            })}
          </label>
          <textarea
            id="cash-session-close-justification"
            rows={2}
            className="mt-1.5 w-full rounded-[10px] border border-secondary-700 bg-secondary-950 px-3 py-2 text-[13px] text-white outline-none transition focus:border-primary-300 focus:ring-2 focus:ring-primary-400/40"
            placeholder={t('cashSession.closeForm.justificationPlaceholder', {
              defaultValue: 'Explica cualquier sobrante o faltante…',
            })}
            {...form.register('justification', { maxLength: 500 })}
          />
        </section>

        {error && <p className="text-[12.5px] text-danger-300">{error}</p>}
      </form>
    </Overlay>
  );
}
