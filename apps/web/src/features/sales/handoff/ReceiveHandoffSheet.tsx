import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CheckCircle2, Coins, Equal, FileText, PauseCircle, X } from 'lucide-react';
import { useToast } from '@/components/feedback/ToastProvider';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/AuthProvider';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { CASH_SESSION_OPEN_INVALIDATIONS, invalidateGroups } from '@/lib/invalidateGroups';
import { trpc } from '@/lib/trpc';
import { extractServerErrorCode, translateServerError } from '@/lib/translateServerError';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { roundMoney } from '@/lib/money';
import { cn, formatCurrency } from '@/lib/utils';
import type { CashSessionDenomination, PendingCashHandoff, RegisterAssignment } from '@/types';
import {
  createCashSessionDenominations,
  getCashSessionCountedTotal,
} from '../cashSessionDenominations';
import { DenominationCounter } from './DenominationCounter';
import { HandoffCap, HandoffFrame, HandoffRow, PinField, ToggleChip } from './HandoffFrame';
import { HANDOFF_INVALIDATIONS, isCompletePin, lowChangeCoins, withCountAt } from './handoffModel';
import { useClock } from './useClock';

type ReceiveMode = 'counted_drawer' | 'new_drawer';

export interface ReceivedHandoffFollowUp {
  resumeDraft: PendingCashHandoff['drafts'][number] | null;
  requestChange: boolean;
}

interface ReceiveHandoffSheetProps {
  handoff: PendingCashHandoff;
  assignment: RegisterAssignment | null;
  onClose: () => void;
  onReceived: (followUp: ReceivedHandoffFollowUp) => void;
}

/** The currency's rows plus any the outgoing cashier counted outside them. */
function recountRows(handoff: PendingCashHandoff, currencyCode: string): CashSessionDenomination[] {
  const base = createCashSessionDenominations(currencyCode);
  const extra = handoff.outgoingDenominations
    .filter(row => !base.some(baseRow => baseRow.value === row.value))
    .map(row => ({ value: row.value, count: 0 }));
  return [...base, ...extra].sort((a, b) => b.value - a.value);
}

/** Recibir caja: keep the counted drawer or start a new one, sign, and sell. */
export function ReceiveHandoffSheet({
  handoff,
  assignment,
  onClose,
  onReceived,
}: ReceiveHandoffSheetProps) {
  const { t } = useTranslation(['cashHandoffs', 'errors']);
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const { currency, isFallback } = useResolvedLocale();
  const currencyCode = isFallback ? 'COP' : currency;
  const clock = useClock();
  const [mode, setMode] = useState<ReceiveMode>('counted_drawer');
  const [denominations, setDenominations] = useState(() => recountRows(handoff, currencyCode));
  const [pin, setPin] = useState('');
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [requestChange, setRequestChange] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllRows, setShowAllRows] = useState(false);
  const signerQuery = trpc.cashSessions.mySigner.useQuery(undefined, { staleTime: 5 * 60_000 });
  // The server is the authority on the PIN: a stale or failed read must not hide the field.
  const [pinRequired, setPinRequired] = useState(false);
  const hasPin = pinRequired || signerQuery.data?.hasPin === true;

  const total = getCashSessionCountedTotal(denominations);
  const kept = mode === 'counted_drawer';
  const difference = roundMoney(total - handoff.outgoingCount);
  const matches = Math.abs(difference) < 0.005;
  const lowChange = kept ? lowChangeCoins(handoff.outgoingDenominations, currencyCode) : null;
  const fromName = handoff.fromCashierName;
  const fromFirstName = fromName.split(' ')[0] ?? fromName;
  // A kept drawer is recounted on the rows the outgoing cashier used; the rest stay one tap away.
  const countedValues = new Set(
    handoff.outgoingDenominations.filter(row => row.count > 0).map(row => row.value)
  );
  const hiddenValues =
    kept && !showAllRows && countedValues.size > 0
      ? new Set(
          denominations
            .filter(row => !countedValues.has(row.value) && row.count === 0)
            .map(row => row.value)
        )
      : undefined;

  const mutation = useCriticalMutation('cashSessions.receiveHandoff', {
    onSuccess: async result => {
      await invalidateGroups(utils, [...CASH_SESSION_OPEN_INVALIDATIONS, ...HANDOFF_INVALIDATIONS]);
      toast.success({
        title: t('sheet.receive.toastTitle'),
        description: t('sheet.receive.toastDescription', {
          register: result.session.registerName,
          count: result.handoff.reassignedDraftCount,
        }),
      });
      onReceived({
        resumeDraft: handoff.drafts.find(draft => draft.id === resumeId) ?? null,
        requestChange: requestChange && !!lowChange,
      });
    },
    onError: err => {
      setError(translateServerError(err, t, t('errors:server.unknown')));
      if (extractServerErrorCode(err) === 'CASH_HANDOFF_PIN_REQUIRED') {
        setPinRequired(true);
      }
      setPin('');
    },
  });

  const canSubmit =
    !mutation.isPending && !signerQuery.isLoading && (!hasPin || isCompletePin(pin));
  const submit = () => {
    if (!canSubmit) return;
    setError(null);
    mutation.mutate({
      handoffId: handoff.id,
      mode,
      count: total,
      denominations,
      ...(hasPin ? { pin } : {}),
    });
  };

  const switchMode = (next: ReceiveMode) => {
    setMode(next);
    setDenominations(
      next === 'new_drawer' && assignment?.denominations.length
        ? assignment.denominations.map(row => ({ ...row }))
        : recountRows(handoff, currencyCode)
    );
  };

  const modeOption = (value: ReceiveMode, title: string, detail: string) => {
    const selected = mode === value;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        data-testid={`handoff-mode-${value}`}
        onClick={() => switchMode(value)}
        className={cn(
          'flex-1 rounded-[18px] px-4 py-3.5 text-left transition',
          selected
            ? 'border-[2.5px] border-primary-700 bg-primary-50'
            : 'border-[1.5px] border-line-strong bg-surface hover:bg-surface-2'
        )}
      >
        <span className="flex items-center gap-2 text-[15.5px] font-bold text-fg1">
          {selected && (
            <CheckCircle2 className="h-[18px] w-[18px] text-primary-700" aria-hidden="true" />
          )}
          {title}
        </span>
        <span className={cn('mt-0.5 block text-[13px]', selected ? 'text-fg2' : 'text-fg3')}>
          {detail}
        </span>
      </button>
    );
  };

  return (
    <HandoffFrame
      isOpen
      onClose={onClose}
      testId="receive-handoff-sheet"
      personName={user?.name}
      title={t('sheet.receive.title', { register: handoff.registerName })}
      subtitle={t('sheet.receive.subtitle', {
        name: user?.name ?? '',
        time: clock.time(clock.now),
        from: fromName,
      })}
      headerExtra={
        <>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="absolute right-3 top-3"
            aria-label={t('sheet.close')}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
          <div
            role="radiogroup"
            aria-label={t('sheet.receive.modeLabel')}
            className="mt-3 flex gap-2.5"
          >
            {modeOption(
              'counted_drawer',
              t('sheet.receive.keepTitle'),
              t('sheet.receive.keepDetail')
            )}
            {modeOption(
              'new_drawer',
              t('sheet.receive.newTitle'),
              assignment && assignment.openingFloat > 0
                ? t('sheet.receive.newDetail', { amount: formatCurrency(assignment.openingFloat) })
                : t('sheet.receive.newDetailNoFloat')
            )}
          </div>
        </>
      }
      footer={
        <>
          {hasPin && (
            <PinField
              value={pin}
              onChange={value => {
                setPin(value);
                setError(null);
              }}
              label={t('sheet.pin')}
              invalid={!!error}
            />
          )}
          <Button
            variant="charge"
            onClick={mutation.isPending ? undefined : submit}
            disabled={!canSubmit && !mutation.isPending}
            aria-disabled={mutation.isPending || undefined}
            className={cn(
              'ml-auto h-[68px] shrink-0 rounded-[18px] px-[26px] text-[19px]',
              mutation.isPending && 'pointer-events-none opacity-45'
            )}
            data-testid="handoff-receive"
          >
            {t('sheet.receive.confirm')}
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </Button>
        </>
      }
    >
      <DenominationCounter
        denominations={denominations}
        currencyCode={currencyCode}
        testIdPrefix="handoff-recount"
        hiddenValues={hiddenValues}
        onChange={(index, count) => setDenominations(rows => withCountAt(rows, index, count))}
      />
      {hiddenValues && hiddenValues.size > 0 && (
        <button
          type="button"
          className="sales-mini-link mt-2"
          onClick={() => setShowAllRows(true)}
          data-testid="handoff-recount-show-all"
        >
          {t('sheet.receive.otherDenominations')}
        </button>
      )}

      <section
        data-testid="handoff-recount-result"
        aria-live="polite"
        className={cn(
          'mt-3.5 flex items-center gap-4 rounded-[20px] border-2 bg-surface px-[18px] py-3.5',
          !kept || matches ? 'border-success-500' : 'border-warning-500'
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="sales-cap text-fg3">
            {kept ? t('sheet.receive.yourRecount') : t('sheet.receive.newFloat')}
          </p>
          <p className="font-display text-[clamp(2rem,6vw,2.875rem)] font-extrabold leading-[1.1] tabular-nums text-fg1">
            {formatCurrency(total)}
          </p>
        </div>
        {kept && (
          <>
            <div
              data-testid="handoff-recount-verdict"
              className={cn(
                'flex h-[104px] w-[104px] shrink-0 flex-col items-center justify-center rounded-full text-center font-display text-[15px] font-bold',
                matches ? 'bg-success-700 text-surface' : 'bg-warning-50 text-warning-700'
              )}
            >
              {matches ? (
                <>
                  <Equal className="h-7 w-7" aria-hidden="true" />
                  {t('sheet.receive.matches')}
                </>
              ) : (
                <>
                  <span>{difference > 0 ? t('sheet.receive.over') : t('sheet.receive.short')}</span>
                  <span className="tabular-nums">{formatCurrency(Math.abs(difference))}</span>
                </>
              )}
            </div>
            <div className="text-right">
              <p className="sales-cap text-fg3">
                {t('sheet.receive.theyCounted', { name: fromFirstName })}
              </p>
              <p className="font-display text-3xl font-bold tabular-nums text-fg2">
                {formatCurrency(handoff.outgoingCount)}
              </p>
            </div>
          </>
        )}
      </section>

      {handoff.note && (
        <section
          data-testid="handoff-received-note"
          className="mt-3 rounded-2xl bg-brand-accent-50 px-4 py-3 text-base leading-snug text-fg1"
        >
          <p className="mb-0.5 flex items-center gap-2 text-[13px] font-bold uppercase text-brand-accent-700">
            <FileText className="h-4 w-4" aria-hidden="true" />
            {t('sheet.receive.noteFrom', {
              name: fromFirstName,
              time: clock.time(handoff.handedOverAt),
            })}
          </p>
          {handoff.note}
        </section>
      )}

      {(handoff.drafts.length > 0 || lowChange) && (
        <>
          <HandoffCap>{t('sheet.receive.alsoReceives')}</HandoffCap>
          <ul>
            {handoff.drafts.map(draft => {
              const selected = resumeId === draft.id;
              return (
                <HandoffRow
                  key={draft.id}
                  testId="handoff-received-draft"
                  icon={<PauseCircle className="h-5 w-5" />}
                  title={`${draft.label ?? draft.saleNumber} · ${formatCurrency(draft.total)}`}
                  detail={
                    draft.suspendedAt
                      ? t('sheet.receive.suspendedAt', { time: clock.time(draft.suspendedAt) })
                      : undefined
                  }
                  action={
                    <ToggleChip
                      pressed={selected}
                      testId="handoff-resume-toggle"
                      onClick={() => setResumeId(selected ? null : draft.id)}
                      label={t('sheet.receive.resume')}
                    />
                  }
                />
              );
            })}
            {lowChange && (
              <HandoffRow
                testId="handoff-received-low-change"
                icon={<Coins className="h-5 w-5" />}
                title={t('sheet.lowChange')}
                action={
                  <ToggleChip
                    pressed={requestChange}
                    testId="handoff-request-change"
                    onClick={() => setRequestChange(value => !value)}
                    label={t('sheet.receive.requestChange')}
                  />
                }
              />
            )}
          </ul>
        </>
      )}

      {error && (
        <p role="alert" data-testid="handoff-error" className="mt-3 text-[13.5px] text-danger-700">
          {error}
        </p>
      )}
    </HandoffFrame>
  );
}
