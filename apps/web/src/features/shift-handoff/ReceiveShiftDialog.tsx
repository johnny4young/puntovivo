import { useMemo, useState } from 'react';
import { ArrowRight, CircleDollarSign, Equal, FileText, PauseCircle, Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Overlay } from '@/components/overlay/Overlay';
import { useToast } from '@/components/feedback/ToastProvider';
import { Button } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { createCashSessionDenominations } from '@/features/sales/cashSessionDenominations';
import { CASH_SESSION_OPEN_INVALIDATIONS, invalidateGroups } from '@/lib/invalidateGroups';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { cn, formatCurrency } from '@/lib/utils';
import type { CashSessionDenomination } from '@/types';
import { DenominationStepper } from './DenominationCount';
import {
  countedTotal,
  countsMatch,
  type PendingHandoff,
  type ReceiveMode,
} from './shiftHandoffModel';

const PIN_LENGTH = 6;
const MODES: readonly ReceiveMode[] = ['counted_drawer', 'new_float'];

export interface ReceivedDraft {
  id: string;
  label: string;
  suspendedAt: string;
}

interface ReceiveShiftDialogProps {
  handoff: PendingHandoff;
  pinRequired: boolean;
  isOpen: boolean;
  onClose: () => void;
  /** Leaves the handoff waiting and opens the register the usual way. */
  onOpenWithout: () => void;
  /** Called once the session is open; carries the draft the cashier chose to resume. */
  onReceived: (resume: ReceivedDraft | null) => void;
}

/** Incoming cashier: recount or bring a new float, read the note, confirm with PIN. */
export function ReceiveShiftDialog({
  handoff,
  pinRequired,
  isOpen,
  onClose,
  onOpenWithout,
  onReceived,
}: ReceiveShiftDialogProps) {
  const { t, i18n } = useTranslation(['shiftHandoff', 'errors', 'common']);
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<ReceiveMode>('counted_drawer');
  const [denominations, setDenominations] = useState<CashSessionDenomination[]>(
    createCashSessionDenominations
  );
  const [pin, setPin] = useState('');
  const [resumeId, setResumeId] = useState<string | null>(null);
  const total = countedTotal(denominations);
  const matches = countsMatch(total, handoff.countedTotal);
  const time = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' }),
    [i18n.language]
  );
  const formatTime = (iso: string) => time.format(new Date(iso));
  const lowChange = handoff.notices.find(notice => notice.kind === 'low_change');
  const printer = handoff.notices.find(notice => notice.kind === 'printer');

  const changeRequest = trpc.registerIncidents.report.useMutation({
    onError: onErrorToast(toast, t, { titleKey: 'shiftHandoff:receive.changeErrorTitle' }),
  });

  const receive = useCriticalMutation('shiftHandoffs.receive', {
    onSuccess: async result => {
      await invalidateGroups(utils, CASH_SESSION_OPEN_INVALIDATIONS);
      await Promise.all([
        utils.shiftHandoffs.pending.invalidate(),
        utils.sales.listDrafts.invalidate(),
      ]);
      toast.success({
        title: t('shiftHandoff:receive.doneTitle'),
        description:
          mode === 'new_float'
            ? t('shiftHandoff:receive.doneNewFloat', { amount: formatCurrency(total) })
            : result.matches
              ? t('shiftHandoff:receive.doneMatch')
              : t('shiftHandoff:receive.doneDifference', {
                  amount: formatCurrency(result.recountDifference ?? 0),
                }),
      });
      const draft = handoff.drafts.find(
        row => row.id === resumeId && result.reassignedSaleIds.includes(row.id)
      );
      onReceived(
        draft ? { id: draft.id, label: draft.label, suspendedAt: draft.suspendedAt } : null
      );
    },
    onError: onErrorToast(toast, t, { titleKey: 'shiftHandoff:receive.errorTitle' }),
  });

  const pinReady = !pinRequired || pin.length === PIN_LENGTH;
  const canSubmit = total > 0 && pinReady && !receive.isPending;
  const submit = () =>
    receive.mutate({
      handoffId: handoff.id,
      mode,
      denominations: denominations.filter(row => row.count > 0),
      pin: pinRequired ? pin : null,
    });

  return (
    <Overlay
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      kicker={t('shiftHandoff:receive.kicker')}
      title={t('shiftHandoff:receive.title', { register: handoff.registerName })}
      description={t('shiftHandoff:receive.subtitle', {
        name: user?.name ?? '',
        time: formatTime(handoff.createdAt),
        from: handoff.fromUserName,
      })}
      footer={
        <div className="flex w-full flex-wrap items-end gap-3" data-testid="receive-footer">
          {pinRequired && (
            <label className="flex flex-col gap-1 text-[13px] text-fg2">
              {t('shiftHandoff:receive.pin')}
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]*"
                maxLength={PIN_LENGTH}
                value={pin}
                onChange={event => setPin(event.target.value.replace(/\D/g, ''))}
                className="h-11 w-36 rounded-xl border-2 border-line-strong bg-surface px-3 font-mono text-xl tracking-[0.4em] text-fg1 outline-none focus:border-primary-600"
                data-testid="receive-pin"
              />
            </label>
          )}
          <Button
            variant="ghost"
            onClick={onOpenWithout}
            disabled={receive.isPending}
            data-testid="receive-open-without"
          >
            {t('shiftHandoff:receive.openWithout')}
          </Button>
          <Button
            variant="charge"
            className="ml-auto min-h-12 px-6 text-base"
            disabled={!canSubmit}
            onClick={submit}
            data-testid="receive-submit"
          >
            {receive.isPending
              ? t('shiftHandoff:receive.submitting')
              : t('shiftHandoff:receive.submit')}
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>
      }
    >
      <div className="space-y-5" data-testid="receive-dialog">
        <div
          role="radiogroup"
          aria-label={t('shiftHandoff:receive.modesLabel')}
          className="grid gap-3 sm:grid-cols-2"
        >
          {MODES.map(option => {
            const selected = option === mode;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setMode(option)}
                data-testid={`receive-mode-${option}`}
                className={cn(
                  'min-h-[72px] rounded-[16px] border-2 px-4 py-3 text-left',
                  selected ? 'border-primary-600 bg-accent' : 'border-line bg-surface'
                )}
              >
                <span className="block text-base font-semibold text-fg1">
                  {t(`shiftHandoff:receive.modes.${option}.title`)}
                </span>
                <span className="mt-0.5 block text-[13px] text-fg2">
                  {t(`shiftHandoff:receive.modes.${option}.detail`)}
                </span>
              </button>
            );
          })}
        </div>

        <DenominationStepper
          denominations={denominations}
          onChange={setDenominations}
          formatCurrency={formatCurrency}
          disabled={receive.isPending}
        />

        <section
          className={cn(
            'flex flex-wrap items-center gap-4 rounded-[18px] border-2 bg-surface px-4 py-3',
            mode === 'counted_drawer' && total > 0
              ? matches
                ? 'border-success-500'
                : 'border-warning-500'
              : 'border-line'
          )}
          data-testid="receive-compare"
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.14em] text-fg3 uppercase">
              {mode === 'counted_drawer'
                ? t('shiftHandoff:receive.yourRecount')
                : t('shiftHandoff:receive.newFloat')}
            </p>
            <p
              className="font-numeric text-[2.6rem] leading-none text-fg1"
              data-testid="receive-total"
            >
              {formatCurrency(total)}
            </p>
          </div>
          {mode === 'counted_drawer' && (
            <>
              {total > 0 && (
                <span
                  className={cn(
                    'ml-auto inline-flex h-20 w-20 flex-col items-center justify-center rounded-full text-[13px] font-bold',
                    matches ? 'bg-success-700 text-white' : 'bg-warning-50 text-warning-700'
                  )}
                  data-testid="receive-match"
                  data-state={matches ? 'match' : 'difference'}
                  aria-live="polite"
                >
                  {matches && <Equal className="h-6 w-6" aria-hidden="true" />}
                  {matches ? t('shiftHandoff:receive.match') : t('shiftHandoff:receive.difference')}
                </span>
              )}
              <div className={cn('text-right', total === 0 && 'ml-auto')}>
                <p className="text-xs font-semibold tracking-[0.14em] text-fg3 uppercase">
                  {t('shiftHandoff:receive.theyCounted', { name: handoff.fromUserName })}
                </p>
                <p className="font-numeric text-2xl text-fg1" data-testid="receive-their-count">
                  {formatCurrency(handoff.countedTotal)}
                </p>
              </div>
            </>
          )}
        </section>

        {handoff.note && (
          <section className="rounded-[16px] bg-danger-50 px-4 py-3" data-testid="receive-note">
            <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.1em] text-danger-700 uppercase">
              <FileText className="h-4 w-4" aria-hidden="true" />
              {t('shiftHandoff:receive.noteFrom', {
                name: handoff.fromUserName,
                time: formatTime(handoff.createdAt),
              })}
            </p>
            <p className="mt-1 text-base text-fg1">{handoff.note}</p>
          </section>
        )}

        {(handoff.drafts.length > 0 || lowChange || printer) && (
          <section>
            <p className="text-xs font-semibold tracking-[0.14em] text-fg3 uppercase">
              {t('shiftHandoff:receive.alsoReceives')}
            </p>
            <ul className="mt-2" data-testid="receive-also">
              {handoff.drafts.map(draft => {
                const selected = resumeId === draft.id;
                return (
                  <li
                    key={draft.id}
                    className="flex min-h-[58px] items-center gap-3 border-t border-line py-2"
                    data-testid="receive-draft"
                  >
                    <PauseCircle className="h-5 w-5 shrink-0 text-fg2" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold text-fg1">
                        {t('shiftHandoff:receive.draft', {
                          label: draft.label,
                          amount: formatCurrency(draft.total),
                        })}
                      </p>
                      <p className="text-[13px] text-fg3">
                        {t('shiftHandoff:receive.suspendedAt', {
                          time: formatTime(draft.suspendedAt),
                        })}
                      </p>
                    </div>
                    <Button
                      variant={selected ? 'secondary' : 'outline'}
                      size="compact"
                      className="min-h-11"
                      aria-pressed={selected}
                      onClick={() => setResumeId(selected ? null : draft.id)}
                      data-testid={`receive-resume-${draft.id}`}
                    >
                      {selected
                        ? t('shiftHandoff:receive.resumeSelected')
                        : t('shiftHandoff:receive.resume')}
                    </Button>
                  </li>
                );
              })}
              {lowChange && (
                <li className="flex min-h-[58px] items-center gap-3 border-t border-line py-2">
                  <CircleDollarSign className="h-5 w-5 shrink-0 text-fg2" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-fg1">
                      {t('shiftHandoff:lowChange.title')}
                    </p>
                    <p className="text-[13px] text-fg3">
                      {t('shiftHandoff:lowChange.receiveDetail')}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="compact"
                    className="min-h-11"
                    disabled={changeRequest.isPending || changeRequest.isSuccess}
                    onClick={() =>
                      changeRequest.mutate({
                        kind: 'change_request',
                        note: t('shiftHandoff:receive.changeNote', {
                          register: handoff.registerName,
                          denominations: lowChange.values
                            .map(value => formatCurrency(value))
                            .join(', '),
                        }),
                      })
                    }
                    data-testid="receive-request-change"
                  >
                    {changeRequest.isSuccess
                      ? t('shiftHandoff:receive.changeRequested')
                      : t('shiftHandoff:receive.requestChange')}
                  </Button>
                </li>
              )}
              {printer && (
                <li className="flex min-h-[58px] items-center gap-3 border-t border-line py-2">
                  <Printer className="h-5 w-5 shrink-0 text-fg2" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-fg1">
                      {t('shiftHandoff:printer.title')}
                    </p>
                    <p className="text-[13px] text-fg3">
                      {t('shiftHandoff:printer.detail', {
                        count: printer.count,
                        time: printer.since ? formatTime(printer.since) : '',
                      })}
                    </p>
                  </div>
                </li>
              )}
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
