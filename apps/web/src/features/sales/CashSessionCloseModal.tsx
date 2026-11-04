import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { EyeOff, Minus, Plus, Scale } from 'lucide-react';
import { ModalButton } from '@/components/form-controls/Modal';
import { Overlay } from '@/components/overlay/Overlay';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { CashSession, CashSessionDenomination } from '@/types';
import {
  cashSessionTotalsMatch,
  createCashSessionDenominations,
  getCashSessionCountedTotal,
} from './cashSessionDenominations';
import { useSingleFlightSubmit } from '@/lib/useSingleFlightSubmit';

/**
 * tolerance under which counted-vs-expected is considered balanced
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
   * count of suspended drafts still in flight for this
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
  const { tenantSettings } = useTenant();
  // tenant-level blind-close policy. Default true keeps the
  // anti-fraud control (cashiers must not see the target while counting);
  // an owner-operated tenant can opt out and show the semaphore to everyone.
  const blindClose = tenantSettings?.cashClose?.blindClose ?? true;
  // the live counted-vs-expected semaphore. Under blind close it
  // is role-gated: cashiers keep the blind close while managers/admins
  // closing or supervising a till get live feedback so balancing feels like
  // hitting the mark instead of filling a form. When the tenant relaxed
  // blind close (), every role sees it.
  const canSeeLiveDelta = !blindClose || user?.role === 'admin' || user?.role === 'manager';
  const actualCountLabel = canSeeLiveDelta
    ? t('cashSession.closeForm.supervisedActualCount')
    : t('cashSession.closeForm.actualCount');
  const form = useForm<CashSessionCloseValues>({
    defaultValues: createDefaultValues(),
  });
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

  const hasFiniteDenominationCounts = (denominations ?? []).every(denomination =>
    Number.isFinite(denomination.count)
  );
  const countedTotal = hasFiniteDenominationCounts
    ? getCashSessionCountedTotal(denominations ?? [])
    : 0;
  const isBalanced = cashSessionTotalsMatch(actualCount ?? 0, denominations ?? []);
  const shouldShowMismatch = (actualCount ?? 0) > 0 || countedTotal > 0;
  const mismatchMessage =
    shouldShowMismatch && !isBalanced
      ? t(
          canSeeLiveDelta
            ? 'cashSession.closeForm.supervisedMismatch'
            : 'cashSession.closeForm.mismatch'
        )
      : null;
  // Mirrors the confirm button's disabled expression, so the Enter path
  // cannot submit what the click path refuses.
  const canSubmit = !isSaving && !!cashSession && !mismatchMessage;
  const handleSubmit = form.handleSubmit(useSingleFlightSubmit(canSubmit, onSubmit));
  const liveDelta =
    cashSession && typeof cashSession.expectedBalance === 'number' && hasFiniteDenominationCounts
      ? countedTotal - cashSession.expectedBalance
      : null;
  const liveDeltaState =
    liveDelta === null
      ? null
      : Math.abs(liveDelta) <= LIVE_DELTA_EPSILON
        ? 'balanced'
        : liveDelta > 0
          ? 'over'
          : 'short';

  return (
    <Overlay
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      kicker={t('cashSession.closeForm.kicker', { defaultValue: 'Cierre de caja' })}
      title={t('cashSession.closeForm.title')}
      description={t(
        canSeeLiveDelta
          ? 'cashSession.closeForm.supervisedDescription'
          : 'cashSession.closeForm.description'
      )}
      headerAside={
        <span className="hidden items-center gap-2 rounded-full border border-line bg-surface-3 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink sm:inline-flex">
          {canSeeLiveDelta ? (
            <Scale className="h-3 w-3" aria-hidden="true" />
          ) : (
            <EyeOff className="h-3 w-3" aria-hidden="true" />
          )}
          {t(
            canSeeLiveDelta
              ? 'cashSession.closeForm.supervisedBadge'
              : 'cashSession.closeForm.blindBadge'
          )}
        </span>
      }
      footer={
        <div className="w-full space-y-3">
          <dl
            data-testid="close-session-totals"
            className="grid grid-cols-2 items-end gap-3 text-left sm:grid-cols-3"
          >
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                {t('cashSession.closeForm.countedTotal')}
              </dt>
              <dd
                data-testid="close-session-counted"
                className="text-lg font-semibold tabular-nums wrap-anywhere text-ink"
              >
                {formatCurrency(countedTotal)}
              </dd>
            </div>
            {canSeeLiveDelta && typeof cashSession?.expectedBalance === 'number' && (
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">
                  {t('cashSession.closeForm.expected')}
                </dt>
                <dd
                  data-testid="close-session-expected"
                  className="text-lg font-medium tabular-nums wrap-anywhere text-ink"
                >
                  {formatCurrency(cashSession.expectedBalance)}
                </dd>
              </div>
            )}
            {canSeeLiveDelta && liveDelta !== null && liveDeltaState && (
              <div
                data-testid="close-session-live-delta"
                aria-live="polite"
                aria-atomic="true"
                className={`col-span-2 min-w-0 sm:col-span-1 ${
                  liveDeltaState === 'balanced'
                    ? 'text-success-700'
                    : liveDeltaState === 'over'
                      ? 'text-warning-700'
                      : 'text-danger-700'
                }`}
              >
                <dt className="inline-flex items-center gap-1 text-xs">
                  <Scale className="h-3 w-3" aria-hidden="true" />
                  {t(`cashSession.closeForm.liveDelta.${liveDeltaState}`)}
                </dt>
                <dd className="text-lg font-semibold tabular-nums wrap-anywhere">
                  {formatCurrency(liveDelta)}
                </dd>
              </div>
            )}
          </dl>
          <div className="flex gap-3 sm:justify-end">
            <ModalButton
              onClick={onClose}
              disabled={isSaving}
              className="w-auto shrink-0 sm:min-w-[8.5rem]"
            >
              {t('cashSession.closeForm.cancel')}
            </ModalButton>
            <ModalButton
              variant="primary"
              onClick={handleSubmit}
              disabled={isSaving || !cashSession || !!mismatchMessage}
              className="w-auto min-w-0 flex-1 sm:min-w-[10rem] sm:flex-none"
            >
              {isSaving ? t('cashSession.closeForm.closing') : t('cashSession.closeForm.confirm')}
            </ModalButton>
          </div>
        </div>
      }
    >
      <form
        className="space-y-4 rounded-[20px] bg-surface-2 p-4 text-ink sm:p-5"
        onSubmit={handleSubmit}
      >
        {suspendedDraftsCount > 0 && (
          <div
            className="rounded-2xl border border-warning-500/40 bg-warning-500/15 px-4 py-3 text-sm text-warning-700"
            role="alert"
            data-testid="close-session-suspended-warning"
          >
            {t('park.closedSessionWarning', { count: suspendedDraftsCount })}
          </div>
        )}

        <section className="rounded-[16px] border border-line bg-surface p-4 sm:p-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                {t('cashSession.closeForm.registerName')}
              </p>
              <p className="mt-1.5 font-display text-lg text-ink">
                {cashSession?.registerName ?? '—'}
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {t('cashSession.closeForm.openedAt')}{' '}
                {cashSession ? formatDateTime(cashSession.openedAt) : '—'}
              </p>
              <p className="mt-1 text-[11.5px] leading-5 text-muted-foreground">
                {t(
                  canSeeLiveDelta
                    ? 'cashSession.closeForm.supervisedCloseHint'
                    : 'cashSession.closeForm.blindCloseHint'
                )}
              </p>
            </div>

            <div>
              <label
                htmlFor="cash-session-closing-count"
                className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground"
              >
                {actualCountLabel}
              </label>
              <input
                id="cash-session-closing-count"
                type="number"
                min={0}
                step="0.01"
                className="mt-1 h-10 w-full rounded-[10px] border border-line-strong bg-surface px-3 text-sm text-ink tabular-nums outline-none transition focus:border-primary-300 focus:ring-2 focus:ring-primary-400/40"
                {...form.register('actualCount', {
                  valueAsNumber: true,
                  min: {
                    value: 0,
                    message: t('cashSession.closeForm.actualCountRequired'),
                  },
                })}
              />
              {form.formState.errors.actualCount && (
                <p className="mt-1 text-xs text-danger-600">
                  {form.formState.errors.actualCount.message}
                </p>
              )}
            </div>
          </div>
        </section>

        {mismatchMessage && (
          <p className="rounded-2xl border border-warning-500/40 bg-warning-500/15 px-3 py-2 text-[12.5px] text-warning-700">
            {mismatchMessage}
          </p>
        )}

        <section className="space-y-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {t('cashSession.closeForm.denominations')}
          </h3>

          <div className="grid gap-x-3 gap-y-1.5 sm:grid-cols-2">
            {denominationFieldArray.fields.map((field, index) => {
              const watchedCount = denominations?.[index]?.count;
              const currentCount = Number.isFinite(watchedCount) ? (watchedCount ?? 0) : 0;
              const lineTotal = currentCount * field.value;
              const setCount = (next: number) =>
                form.setValue(`denominations.${index}.count`, Math.max(0, next), {
                  shouldDirty: true,
                });
              return (
                <div
                  key={field.value}
                  data-testid={`close-session-denomination-${index}`}
                  className="flex min-h-11 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-1"
                >
                  <input
                    type="hidden"
                    {...form.register(`denominations.${index}.value`, {
                      valueAsNumber: true,
                    })}
                  />
                  <p className="w-20 shrink-0 text-[13px] font-semibold tabular-nums text-ink">
                    {formatCurrency(field.value)}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label={t('cashSession.form.decrementCount', { defaultValue: 'Restar' })}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line-strong text-muted-foreground transition hover:border-warning-500 hover:bg-warning-500/15 hover:text-warning-700 disabled:opacity-40"
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
                      className="h-8 w-14 rounded-[8px] border border-line-strong bg-surface text-center font-mono text-[14px] tabular-nums text-ink outline-none focus:border-primary-300"
                      {...form.register(`denominations.${index}.count`, {
                        valueAsNumber: true,
                        min: 0,
                      })}
                    />
                    <button
                      type="button"
                      aria-label={t('cashSession.form.incrementCount', { defaultValue: 'Sumar' })}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line-strong text-muted-foreground transition hover:border-primary-300 hover:bg-primary-400/10 hover:text-primary-700"
                      onClick={() => setCount(currentCount + 1)}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  <p className="ml-auto truncate text-right text-[12px] tabular-nums text-muted-foreground">
                    {formatCurrency(lineTotal)}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <label
            htmlFor="cash-session-close-justification"
            className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground"
          >
            {t('cashSession.closeForm.justificationLabel', {
              defaultValue: 'Justificación (opcional)',
            })}
          </label>
          <textarea
            id="cash-session-close-justification"
            rows={2}
            className="mt-1.5 w-full rounded-[10px] border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink outline-none transition focus:border-primary-300 focus:ring-2 focus:ring-primary-400/40"
            placeholder={t('cashSession.closeForm.justificationPlaceholder', {
              defaultValue: 'Explica cualquier sobrante o faltante…',
            })}
            {...form.register('justification', { maxLength: 500 })}
          />
        </section>

        {error && <p className="text-[12.5px] text-danger-600">{error}</p>}
      </form>
    </Overlay>
  );
}
