import { useMemo, useState } from 'react';
import { CircleDollarSign, EyeOff, PauseCircle, Printer, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Overlay } from '@/components/overlay/Overlay';
import { useToast } from '@/components/feedback/ToastProvider';
import { Button, SeverityMark } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { createCashSessionDenominations } from '@/features/sales/cashSessionDenominations';
import { CASH_SESSION_CLOSE_INVALIDATIONS, invalidateGroups } from '@/lib/invalidateGroups';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { cn, formatCurrency } from '@/lib/utils';
import type { CashSession, CashSessionDenomination } from '@/types';
import { DenominationStepper, DenominationSummary, StepPills } from './DenominationCount';
import { countedTotal, shiftCurvePoints, type HandOutPreview } from './shiftHandoffModel';

const NOTE_MAX_LENGTH = 500;
const CURVE_WIDTH = 480;
const CURVE_HEIGHT = 44;

interface HandOutShiftDialogProps {
  cashSession: CashSession;
  isOpen: boolean;
  onClose: () => void;
  /** Called once the session is closed and the handoff is signed. */
  onHandedOut: () => void;
}

/** Outgoing cashier: count blind, review what passes on, sign. */
export function HandOutShiftDialog({
  cashSession,
  isOpen,
  onClose,
  onHandedOut,
}: HandOutShiftDialogProps) {
  const { t, i18n } = useTranslation(['shiftHandoff', 'errors', 'common']);
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [step, setStep] = useState(0);
  const [denominations, setDenominations] = useState<CashSessionDenomination[]>(
    createCashSessionDenominations
  );
  const [note, setNote] = useState('');
  const total = countedTotal(denominations);

  const previewQuery = trpc.shiftHandoffs.handOutPreview.useQuery(
    { denominations },
    { enabled: isOpen && step > 0, staleTime: 0 }
  );
  const preview = previewQuery.data ?? null;

  const handOut = useCriticalMutation('shiftHandoffs.handOut', {
    onSuccess: async result => {
      await invalidateGroups(utils, CASH_SESSION_CLOSE_INVALIDATIONS);
      await Promise.all([
        utils.shiftHandoffs.pending.invalidate(),
        utils.sales.listDrafts.invalidate(),
      ]);
      toast.success({
        title: t('shiftHandoff:handOut.doneTitle'),
        description: t('shiftHandoff:handOut.doneDescription', {
          register: result.registerName,
          amount: formatCurrency(result.countedTotal),
        }),
      });
      onHandedOut();
    },
    onError: onErrorToast(toast, t, { titleKey: 'shiftHandoff:handOut.errorTitle' }),
  });

  const time = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' }),
    [i18n.language]
  );
  const steps = [
    t('shiftHandoff:steps.count'),
    t('shiftHandoff:steps.review'),
    t('shiftHandoff:steps.sign'),
  ];
  const signer = user?.name ?? '';

  return (
    <Overlay
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      kicker={t('shiftHandoff:handOut.kicker')}
      title={t('shiftHandoff:handOut.title', { register: cashSession.registerName })}
      description={t('shiftHandoff:handOut.subtitle', {
        name: signer,
        from: time.format(new Date(cashSession.openedAt)),
      })}
      footer={
        <div className="flex w-full items-center gap-3" data-testid="hand-out-footer">
          <Button
            variant="outline"
            onClick={step === 0 ? onClose : () => setStep(step - 1)}
            disabled={handOut.isPending}
            data-testid="hand-out-back"
          >
            {step === 0 ? t('common:actions.cancel') : t('shiftHandoff:back')}
          </Button>
          <p className="ml-auto hidden max-w-[16rem] text-right text-[13px] text-fg3 sm:block">
            {step > 0 && t('shiftHandoff:handOut.signHint')}
          </p>
          {step === 0 && (
            <Button className="ml-auto" onClick={() => setStep(1)} data-testid="hand-out-continue">
              {t('shiftHandoff:handOut.saveCount')}
            </Button>
          )}
          {step === 1 && (
            <Button disabled={!preview} onClick={() => setStep(2)} data-testid="hand-out-review">
              {t('shiftHandoff:handOut.action')}
            </Button>
          )}
          {step === 2 && (
            <Button
              disabled={handOut.isPending}
              onClick={() =>
                handOut.mutate({ actualCount: total, denominations, note: note.trim() || null })
              }
              data-testid="hand-out-sign"
            >
              {handOut.isPending
                ? t('shiftHandoff:handOut.signing')
                : t('shiftHandoff:handOut.sign')}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-5" data-testid="hand-out-dialog">
        <StepPills steps={steps} current={step} label={t('shiftHandoff:steps.label')} />

        {step === 0 && (
          <section className="space-y-3" data-testid="hand-out-step-count">
            <p className="flex items-center gap-2 text-sm text-fg2">
              <EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t('shiftHandoff:handOut.blindHint')}
            </p>
            <DenominationStepper
              denominations={denominations}
              onChange={setDenominations}
              formatCurrency={formatCurrency}
            />
            <p className="flex items-baseline justify-between border-t border-line pt-3">
              <span className="text-xs font-semibold tracking-[0.14em] text-fg3 uppercase">
                {t('shiftHandoff:handOut.yourCount')}
              </span>
              <span className="font-numeric text-[2rem] leading-none" data-testid="hand-out-total">
                {formatCurrency(total)}
              </span>
            </p>
          </section>
        )}

        {step === 1 &&
          (preview ? (
            <ReviewStep
              preview={preview}
              denominations={denominations}
              note={note}
              onNote={setNote}
              formatTime={iso => time.format(new Date(iso))}
            />
          ) : (
            <div
              className="min-h-48 animate-pulse rounded-[18px] bg-surface-2 motion-reduce:animate-none"
              role="status"
              aria-label={t('shiftHandoff:loading')}
            />
          ))}

        {step === 2 && (
          <section
            className="rounded-[18px] border-2 border-fg1 bg-surface p-4"
            data-testid="hand-out-step-sign"
          >
            <p className="text-base font-semibold text-fg1">
              {t('shiftHandoff:handOut.signTitle', { name: signer })}
            </p>
            <p className="mt-1 text-sm text-fg2">
              {t('shiftHandoff:handOut.signSummary', {
                register: cashSession.registerName,
                amount: formatCurrency(total),
                count: preview?.drafts.length ?? 0,
              })}
            </p>
            {note.trim() && (
              <p className="mt-3 rounded-xl bg-surface-3 px-3 py-2 text-sm text-fg1">
                {note.trim()}
              </p>
            )}
          </section>
        )}
      </div>
    </Overlay>
  );
}

function ReviewStep({
  preview,
  denominations,
  note,
  onNote,
  formatTime,
}: {
  preview: HandOutPreview;
  denominations: readonly CashSessionDenomination[];
  note: string;
  onNote: (value: string) => void;
  formatTime: (iso: string) => string;
}) {
  const { t } = useTranslation('shiftHandoff');
  const minutes = Math.max(
    0,
    Math.round((Date.parse(preview.generatedAt) - Date.parse(preview.openedAt)) / 60_000)
  );
  const lowChange = preview.notices.find(notice => notice.kind === 'low_change');
  const printer = preview.notices.find(notice => notice.kind === 'printer');
  const draftsTotal = preview.drafts.reduce((sum, draft) => sum + draft.total, 0);
  const nothingPrepared =
    preview.drafts.length === 0 && preview.approvals.length === 0 && !lowChange && !printer;

  return (
    <div className="space-y-5" data-testid="hand-out-step-review">
      <section>
        <p className="text-xs font-semibold tracking-[0.14em] text-fg3 uppercase">
          {t('handOut.yourShift')}
        </p>
        <div className="flex flex-wrap items-end justify-between gap-x-4">
          <p className="font-numeric text-[2.4rem] leading-none" data-testid="hand-out-shift-total">
            {formatCurrency(preview.salesTotal)}
          </p>
          <p className="pb-1 text-sm text-fg2">
            {t('handOut.shiftContext', {
              count: preview.salesCount,
              hours: Math.floor(minutes / 60),
              minutes: minutes % 60,
            })}
          </p>
        </div>
        <svg
          viewBox={`0 0 ${CURVE_WIDTH} ${CURVE_HEIGHT + 4}`}
          className="mt-2 h-12 w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label={t('handOut.curveLabel', { total: formatCurrency(preview.salesTotal) })}
        >
          <polygon
            points={`${shiftCurvePoints(preview.salesCurve, preview.openedAt, preview.generatedAt, CURVE_WIDTH, CURVE_HEIGHT)} ${CURVE_WIDTH},${CURVE_HEIGHT}`}
            fill="var(--primary-100)"
            stroke="var(--primary-600)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1="0"
            x2={CURVE_WIDTH}
            y1={CURVE_HEIGHT + 2}
            y2={CURVE_HEIGHT + 2}
            stroke="var(--fg1)"
            strokeWidth="2"
          />
        </svg>
      </section>

      <section
        className="rounded-[18px] bg-success-50 p-4 text-success-700"
        data-testid="hand-out-count-saved"
      >
        <div className="flex items-center gap-2">
          <SeverityMark severity="ready" size={20} />
          <p className="text-base font-semibold">{t('handOut.countSaved')}</p>
          <p className="ml-auto font-numeric text-2xl text-fg1">
            {formatCurrency(preview.countedTotal)}
          </p>
        </div>
        <div className="mt-3 text-fg1">
          <DenominationSummary denominations={denominations} testId="hand-out-chips" />
        </div>
        <p className="mt-3 text-[13px] text-fg2">{t('handOut.blindNote')}</p>
      </section>

      <section>
        <p className="text-xs font-semibold tracking-[0.14em] text-fg3 uppercase">
          {t('handOut.prepared')}
        </p>
        <ul className="mt-2" data-testid="hand-out-prepared">
          {preview.drafts.length > 0 && (
            <PreparedRow
              icon={PauseCircle}
              testId="hand-out-drafts"
              title={t('handOut.drafts', {
                count: preview.drafts.length,
                amount: formatCurrency(draftsTotal),
              })}
              detail={preview.drafts
                .map(draft => `${draft.label} ${formatCurrency(draft.total)}`)
                .join(' · ')}
              tag={t('handOut.tags.passes')}
              tone="go"
            />
          )}
          {preview.approvals.map(approval => (
            <PreparedRow
              key={approval.id}
              icon={Undo2}
              testId="hand-out-approval"
              title={t('handOut.approval', { label: approval.label })}
              detail={[
                approval.amount === null ? null : formatCurrency(approval.amount),
                t('handOut.requestedAt', { time: formatTime(approval.requestedAt) }),
              ]
                .filter(Boolean)
                .join(' · ')}
              tag={t('handOut.tags.staysOpen')}
              tone="red"
            />
          ))}
          {lowChange && (
            <PreparedRow
              icon={CircleDollarSign}
              testId="hand-out-low-change"
              title={t('lowChange.title')}
              detail={t('lowChange.detail', {
                denominations: lowChange.values.map(value => formatCurrency(value)).join(' · '),
              })}
              tag={t('handOut.tags.warn')}
              tone="amber"
            />
          )}
          {printer && (
            <PreparedRow
              icon={Printer}
              testId="hand-out-printer"
              title={t('printer.title')}
              detail={t('printer.detail', {
                count: printer.count,
                time: printer.since ? formatTime(printer.since) : '',
              })}
              tag={t('handOut.tags.info')}
              tone="neutral"
            />
          )}
          {nothingPrepared && (
            <li className="border-t border-line py-3 text-sm text-fg3">
              {t('handOut.nothingPrepared')}
            </li>
          )}
        </ul>
      </section>

      <section>
        <label
          htmlFor="hand-out-note"
          className="text-xs font-semibold tracking-[0.14em] text-fg3 uppercase"
        >
          {t('handOut.noteLabel')}
        </label>
        <textarea
          id="hand-out-note"
          rows={3}
          maxLength={NOTE_MAX_LENGTH}
          value={note}
          onChange={event => onNote(event.target.value)}
          className="mt-2 w-full rounded-[14px] border-2 border-line-strong bg-surface px-3.5 py-3 text-base text-fg1 outline-none focus:border-primary-600"
          data-testid="hand-out-note"
        />
      </section>
    </div>
  );
}

const TAG_TONES = {
  go: 'bg-primary-100 text-primary-800',
  red: 'bg-danger-50 text-danger-700',
  amber: 'bg-warning-50 text-warning-700',
  neutral: 'bg-surface-3 text-fg2',
} as const;

function PreparedRow({
  icon: Icon,
  title,
  detail,
  tag,
  tone,
  testId,
}: {
  icon: typeof Printer;
  title: string;
  detail: string;
  tag: string;
  tone: keyof typeof TAG_TONES;
  testId: string;
}) {
  return (
    <li
      className="flex min-h-[62px] items-center gap-3 border-t border-line py-2"
      data-testid={testId}
    >
      <Icon className="h-5 w-5 shrink-0 text-fg2" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-fg1">{title}</p>
        <p className="truncate text-[13px] text-fg3">{detail}</p>
      </div>
      <span
        className={cn(
          'inline-flex h-[30px] items-center rounded-full px-3 text-[13px] font-bold whitespace-nowrap',
          TAG_TONES[tone]
        )}
      >
        {tag}
      </span>
    </li>
  );
}
