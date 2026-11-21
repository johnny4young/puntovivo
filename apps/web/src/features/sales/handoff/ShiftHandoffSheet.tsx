import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Coins, PauseCircle, Printer, Undo2 } from 'lucide-react';
import { ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { CASH_SESSION_CLOSE_INVALIDATIONS, invalidateGroups } from '@/lib/invalidateGroups';
import { trpc } from '@/lib/trpc';
import { extractServerErrorCode, translateServerError } from '@/lib/translateServerError';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { formatCurrency } from '@/lib/utils';
import type { CashSession, CashSessionDenomination } from '@/types';
import {
  createCashSessionDenominations,
  getCashSessionCountedTotal,
} from '../cashSessionDenominations';
import { DenominationChip, DenominationCounter } from './DenominationCounter';
import {
  HandoffCap,
  HandoffFrame,
  HandoffRow,
  HandoffStepper,
  PinField,
  type HandoffStep,
} from './HandoffFrame';
import { useClock } from './useClock';
import {
  draftsPassingOn,
  HANDOFF_INVALIDATIONS,
  isCompletePin,
  withCountAt,
  lowChangeCoins,
  shiftDuration,
  sparkline,
} from './handoffModel';

interface ShiftHandoffSheetProps {
  cashSession: CashSession;
  hasReceiptPrinter: boolean;
  onClose: () => void;
}

const CURVE_WIDTH = 480;
const CURVE_HEIGHT = 44;
const STEP_SETTLE_MS = 500;

/** Entregar turno: blind count, what the next cashier inherits, then the signature. */
export function ShiftHandoffSheet({
  cashSession,
  hasReceiptPrinter,
  onClose,
}: ShiftHandoffSheetProps) {
  const { t } = useTranslation(['cashHandoffs', 'errors']);
  const { user } = useAuth();
  const { tenantSettings } = useTenant();
  const toast = useToast();
  const utils = trpc.useUtils();
  const { currency, isFallback } = useResolvedLocale();
  const currencyCode = isFallback ? 'COP' : currency;
  const clock = useClock();
  const [step, setStep] = useState<HandoffStep>(1);
  const [denominations, setDenominations] = useState<CashSessionDenomination[]>(() =>
    createCashSessionDenominations(currencyCode)
  );
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const summaryQuery = trpc.cashSessions.myShiftSummary.useQuery(
    { siteId: cashSession.siteId },
    { refetchOnMount: 'always' }
  );
  const signerQuery = trpc.cashSessions.mySigner.useQuery(undefined, { staleTime: 5 * 60_000 });
  const draftsQuery = trpc.sales.listDrafts.useQuery({
    page: 1,
    perPage: 200,
    siteId: cashSession.siteId,
  });
  const approvalsQuery = trpc.managerApprovals.mine.useQuery({ limit: 20 });

  const total = getCashSessionCountedTotal(denominations);
  const counted = denominations.filter(row => row.count > 0);
  // The server is the authority on the PIN: a stale or failed read must not hide the field.
  const [pinRequired, setPinRequired] = useState(false);
  const hasPin = pinRequired || signerQuery.data?.hasPin === true;
  const blindForMe =
    (tenantSettings?.cashClose?.blindClose ?? true) &&
    user?.role !== 'admin' &&
    user?.role !== 'manager';

  const passing = draftsPassingOn(draftsQuery.data?.items ?? [], user?.id ?? '');
  const pendingRefunds = (approvalsQuery.data ?? []).filter(
    request =>
      request.action === 'sale_refund' &&
      request.status === 'pending' &&
      request.siteId === cashSession.siteId
  );
  const lowChange = lowChangeCoins(denominations, currencyCode);
  const hasPrepared =
    passing.length > 0 || pendingRefunds.length > 0 || !!lowChange || !hasReceiptPrinter;
  const summary = summaryQuery.data;
  const curve = summary ? sparkline(summary.slices, CURVE_WIDTH, CURVE_HEIGHT) : null;
  const duration = shiftDuration(cashSession.openedAt, clock.now);

  const mutation = useCriticalMutation('cashSessions.startHandoff', {
    onSuccess: async () => {
      await invalidateGroups(utils, [
        ...CASH_SESSION_CLOSE_INVALIDATIONS,
        ...HANDOFF_INVALIDATIONS,
      ]);
      toast.success({
        title: t('sheet.give.toastTitle'),
        description: t('sheet.give.toastDescription', { register: cashSession.registerName }),
      });
      onClose();
    },
    onError: err => {
      setError(translateServerError(err, t, t('errors:server.unknown')));
      if (extractServerErrorCode(err) === 'CASH_HANDOFF_PIN_REQUIRED') {
        setPinRequired(true);
        setStep(3);
      }
      setPin('');
    },
  });

  const submit = () => {
    if (mutation.isPending || (hasPin && !isCompletePin(pin))) return;
    setError(null);
    mutation.mutate({
      actualCount: total,
      denominations,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(hasPin ? { pin } : {}),
    });
  };

  // Back and forward share one key, so a double tap must not confirm a step it just revealed.
  const stepShownAt = useRef(0);
  const showStep = (next: HandoffStep) => {
    stepShownAt.current = Date.now();
    setStep(next);
  };
  const goForward = () => {
    if (Date.now() - stepShownAt.current < STEP_SETTLE_MS) return;
    setError(null);
    if (step === 1) showStep(2);
    else if (step === 2 && hasPin) showStep(3);
    else submit();
  };

  const draftsTotal = passing.reduce((sum, draft) => sum + draft.total, 0);
  const forwardDisabled =
    (step === 2 && signerQuery.isLoading) || (step === 3 && !isCompletePin(pin));

  return (
    <HandoffFrame
      isOpen
      onClose={onClose}
      testId="shift-handoff-sheet"
      personName={user?.name}
      title={t('sheet.give.title', { register: cashSession.registerName })}
      subtitle={t('sheet.give.subtitle', {
        name: user?.name ?? '',
        from: clock.time(cashSession.openedAt),
        to: clock.time(clock.now),
      })}
      headerExtra={<HandoffStepper step={step} />}
      footer={
        <>
          <ModalButton
            onClick={step === 1 ? onClose : () => showStep(step === 3 ? 2 : 1)}
            disabled={mutation.isPending}
            className="h-[60px] w-auto shrink-0 px-5"
            testId="handoff-back"
          >
            {t('sheet.back')}
          </ModalButton>
          {step > 1 && (
            <p className="hidden min-w-0 flex-1 text-right text-[13.5px] text-fg3 sm:block">
              {t('sheet.give.consequence')}
            </p>
          )}
          <ModalButton
            variant="primary"
            onClick={goForward}
            disabled={forwardDisabled}
            pending={mutation.isPending}
            className="ml-auto h-[68px] w-auto shrink-0 rounded-[18px] px-[26px] text-[19px]"
            testId="handoff-forward"
          >
            {step === 1
              ? t('sheet.next')
              : step === 2
                ? t('sheet.give.confirm')
                : t('sheet.give.signAndConfirm')}
          </ModalButton>
        </>
      }
    >
      {step === 1 && (
        <section aria-labelledby="handoff-count-title">
          <HandoffCap id="handoff-count-title">{t('sheet.give.countTitle')}</HandoffCap>
          <DenominationCounter
            denominations={denominations}
            currencyCode={currencyCode}
            testIdPrefix="handoff-count"
            onChange={(index, count) => setDenominations(rows => withCountAt(rows, index, count))}
          />
          <div className="mt-3.5 flex items-end justify-between rounded-[20px] border-2 border-line bg-surface px-[18px] py-3.5">
            <span className="sales-cap text-fg3">{t('sheet.give.yourCount')}</span>
            <output
              data-testid="handoff-count-total"
              aria-live="polite"
              className="font-display text-[2.5rem] font-extrabold leading-none tabular-nums text-fg1"
            >
              {formatCurrency(total)}
            </output>
          </div>
        </section>
      )}

      {step === 2 && (
        <>
          <section data-testid="handoff-shift-summary">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="sales-cap text-fg3">{t('sheet.give.yourShift')}</p>
                <p className="font-display text-[2.75rem] font-bold leading-[1.1] tabular-nums text-fg1">
                  {formatCurrency(summary?.revenue ?? 0)}
                </p>
              </div>
              <p className="pb-1.5 text-[14.5px] text-fg2">
                {t('sheet.give.shiftStats', {
                  count: summary?.salesCount ?? 0,
                  hours: duration.hours,
                  minutes: duration.minutes,
                })}
              </p>
            </div>
            {curve && (
              <svg
                viewBox={`-6 0 ${CURVE_WIDTH + 12} ${CURVE_HEIGHT + 4}`}
                className="mt-1.5 h-11 w-full text-primary-600"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path d={curve.area} className="fill-primary-200/70" />
                <path d={curve.line} fill="none" stroke="currentColor" strokeWidth="2" />
                <line
                  x1="0"
                  x2={CURVE_WIDTH}
                  y1={CURVE_HEIGHT}
                  y2={CURVE_HEIGHT}
                  className="stroke-fg1"
                  strokeWidth="2"
                />
                <circle cx={curve.end.x} cy={curve.end.y} r="4" className="fill-cobrar" />
              </svg>
            )}
          </section>

          <section
            data-testid="handoff-blind-count"
            className="mt-4 rounded-[18px] bg-success-50 px-4 py-3.5"
          >
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-5 w-5 text-success-700" aria-hidden="true" />
              <p className="text-[16.5px] font-bold text-success-700">
                {t('sheet.give.blindSaved')}
              </p>
              <span className="flex-1" />
              <p className="font-display text-3xl font-bold tabular-nums text-fg1">
                {formatCurrency(total)}
              </p>
            </div>
            {counted.length > 0 && (
              <ul className="mt-2.5 flex flex-wrap gap-x-3 gap-y-2">
                {counted.map(row => (
                  <li key={row.value} className="inline-flex items-center gap-1.5">
                    <DenominationChip value={row.value} currencyCode={currencyCode} small />
                    <span className="sr-only">{formatCurrency(row.value)}</span>
                    <b className="font-display text-base tabular-nums text-fg1">× {row.count}</b>
                  </li>
                ))}
              </ul>
            )}
            {blindForMe && (
              <p className="mt-2 text-[13.5px] text-fg2">{t('sheet.give.blindHint')}</p>
            )}
          </section>

          <HandoffCap>{t('sheet.give.prepared')}</HandoffCap>
          <ul data-testid="handoff-prepared">
            {passing.length > 0 && (
              <HandoffRow
                testId="handoff-prepared-suspended"
                icon={<PauseCircle className="h-5 w-5" />}
                title={t('sheet.give.suspended', {
                  count: passing.length,
                  amount: formatCurrency(draftsTotal),
                })}
                detail={passing
                  .map(
                    draft =>
                      `${draft.suspendedLabel ?? draft.saleNumber} ${formatCurrency(draft.total)}`
                  )
                  .join(' · ')}
                tag={t('sheet.give.suspendedTag')}
                tone="go"
              />
            )}
            {pendingRefunds.length > 0 && (
              <HandoffRow
                testId="handoff-prepared-refunds"
                icon={<Undo2 className="h-5 w-5" />}
                title={t('sheet.give.refunds', { count: pendingRefunds.length })}
                detail={t('sheet.give.refundDetail', {
                  amount: formatCurrency(pendingRefunds[0]!.summary.amount ?? 0),
                  label: pendingRefunds[0]!.summary.label,
                  time: clock.time(pendingRefunds[0]!.requestedAt),
                })}
                tag={t('sheet.give.refundsTag')}
                tone="red"
              />
            )}
            {lowChange && (
              <HandoffRow
                testId="handoff-prepared-low-change"
                icon={<Coins className="h-5 w-5" />}
                title={t('sheet.lowChange')}
                detail={
                  lowChange.length > 0
                    ? t('sheet.give.lowChangeDetail', {
                        coins: lowChange
                          .map(row => `${row.count} × ${formatCurrency(row.value)}`)
                          .join(', '),
                      })
                    : t('sheet.give.noCoins')
                }
                tag={t('sheet.give.lowChangeTag')}
                tone="amber"
              />
            )}
            {!hasReceiptPrinter && (
              <HandoffRow
                testId="handoff-prepared-printer"
                icon={<Printer className="h-5 w-5" />}
                title={t('sheet.give.printer', { register: cashSession.registerName })}
                detail={t('sheet.give.printerMissing')}
                tag={t('sheet.give.printerTag')}
              />
            )}
            {!hasPrepared && (
              <li className="border-t-[1.5px] border-line py-4 text-[14.5px] text-fg3">
                {t('sheet.give.nothingPending')}
              </li>
            )}
          </ul>

          <HandoffCap>
            <label htmlFor="handoff-note">{t('sheet.give.noteLabel')}</label>
          </HandoffCap>
          <textarea
            id="handoff-note"
            data-testid="handoff-note"
            rows={3}
            maxLength={500}
            value={note}
            onChange={event => setNote(event.target.value)}
            className="min-h-[84px] w-full rounded-2xl border-2 border-line-strong bg-surface px-3.5 py-3 text-base leading-snug text-fg1 outline-none transition focus:border-primary-700"
          />
        </>
      )}

      {step === 3 && (
        <section aria-labelledby="handoff-sign-title" data-testid="handoff-sign">
          <HandoffCap id="handoff-sign-title">{t('sheet.give.signTitle')}</HandoffCap>
          <div className="rounded-[18px] border-[1.5px] border-line bg-surface p-4">
            <p className="text-[16.5px] font-semibold text-fg1">
              {t('sheet.give.signSummary', {
                amount: formatCurrency(total),
                register: cashSession.registerName,
              })}
            </p>
            {passing.length > 0 && (
              <p className="mt-1 text-[13.5px] text-fg3">
                {t('sheet.give.suspended', {
                  count: passing.length,
                  amount: formatCurrency(draftsTotal),
                })}
              </p>
            )}
            <div className="mt-4">
              <PinField
                value={pin}
                onChange={value => {
                  setPin(value);
                  setError(null);
                }}
                label={t('sheet.pin')}
                invalid={!!error}
              />
            </div>
          </div>
        </section>
      )}

      {error && (
        <p role="alert" data-testid="handoff-error" className="mt-3 text-[13.5px] text-danger-700">
          {error}
        </p>
      )}
    </HandoffFrame>
  );
}
