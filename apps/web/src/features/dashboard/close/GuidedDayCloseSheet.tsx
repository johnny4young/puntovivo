import { memo, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, MessageCircle, PenLine } from 'lucide-react';
import { ConfirmModal, Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { Button, StatusStrip } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { HandoffStepper } from '@/features/sales/handoff/HandoffFrame';
import { invalidateGroups } from '@/lib/invalidateGroups';
import { onErrorToast } from '@/lib/mutationHelpers';
import { extractServerErrorCode, translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { cn } from '@/lib/utils';
import type { OperationsToday } from '../today/todayModel';
import {
  buildOwnerSummaryUrl,
  closeProgress,
  electronicTotal,
  type CloseDraft,
  type CloseReport,
} from './closeModel';
import { CloseRow, DifferenceRow, DraftRow, FiscalRow, RegistersRow } from './CloseRows';
import { DayArc } from './DayArc';
import { SignatureBlock } from './SignatureBlock';
import { useSignatureDraft } from './useSignatureDraft';

interface GuidedDayCloseSheetProps {
  isOpen: boolean;
  onClose: () => void;
  date: string;
  /** Today's hour-by-hour sales; the arc shows only when the close is for today. */
  today: OperationsToday | null;
  formatCurrency: (value: number) => string;
}

/** Count, compare, sign: the manager closes the day from Hoy and seals it. */
export function GuidedDayCloseSheet({
  isOpen,
  onClose,
  date,
  today,
  formatCurrency,
}: GuidedDayCloseSheetProps) {
  const { t, i18n } = useTranslation(['dayCloseGuide', 'common', 'errors']);
  const titleId = useId();
  const toast = useToast();
  const utils = trpc.useUtils();
  const { user } = useAuth();

  const signoffQuery = trpc.reports.dayClose.signoff.useQuery({ date }, { enabled: isOpen });
  const signoff = signoffQuery.data ?? null;
  const previewQuery = trpc.reports.dayClose.preview.useQuery(
    { date },
    { enabled: isOpen && signoffQuery.isSuccess && !signoff }
  );
  const checklistQuery = trpc.reports.dayClose.checklist.useQuery({ date }, { enabled: isOpen });
  const signerQuery = trpc.cashSessions.mySigner.useQuery(undefined, {
    enabled: isOpen,
    staleTime: 60_000,
  });
  const report = signoff?.report ?? previewQuery.data ?? null;
  const checklist = checklistQuery.data ?? null;
  const queryError = signoffQuery.error ?? previewQuery.error ?? checklistQuery.error;

  const signature = useSignatureDraft();
  const [discardTarget, setDiscardTarget] = useState<CloseDraft | null>(null);

  const refreshChecklist = () =>
    invalidateGroups(utils, [u => u.reports.dayClose.checklist, u => u.reports.dayClose.preview]);
  const explainMutation = useCriticalMutation('cashSessions.explainDifference', {
    onSuccess: refreshChecklist,
    onError: onErrorToast(toast, t, { titleKey: 'dayCloseGuide:errors.explain' }),
  });
  const carryMutation = useCriticalMutation('sales.carryOver', {
    onSuccess: refreshChecklist,
    onError: onErrorToast(toast, t, { titleKey: 'dayCloseGuide:errors.carry' }),
  });
  const discardMutation = useCriticalMutation('sales.discardDraft', {
    onSuccess: async () => {
      setDiscardTarget(null);
      await refreshChecklist();
      await invalidateGroups(utils, [u => u.sales.listDrafts]);
    },
    onError: onErrorToast(toast, t, { titleKey: 'dayCloseGuide:errors.discard' }),
  });
  const signMutation = useCriticalMutation('reports.dayClose.signOff', {
    onSuccess: async () => {
      signature.clearPin();
      await invalidateGroups(utils, [
        u => u.reports.dayClose.signoff,
        u => u.reports.dayClose.signoffMetadata,
      ]);
      toast.success({ title: t('dayCloseGuide:toast.signed') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'dayCloseGuide:errors.sign',
      extra: (_description, error) =>
        signature.setInvalid(extractServerErrorCode(error) === 'DAY_CLOSE_PIN_INVALID'),
    }),
  });

  const timeZone = report?.timeZone;
  const format = useMemo(() => {
    const time = new Intl.DateTimeFormat(i18n.language, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    });
    const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: 'long', timeZone: 'UTC' });
    const day = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', timeZone: 'UTC' });
    return {
      time: (iso: string) => time.format(new Date(iso)),
      // Weekday and day apart: English and Spanish put them in different orders.
      title: (calendarDay: string) => {
        const noon = new Date(`${calendarDay}T12:00:00.000Z`);
        return t('dayCloseGuide:title', { weekday: weekday.format(noon), day: day.format(noon) });
      },
    };
  }, [i18n.language, t, timeZone]);

  const signed = signoff !== null;
  const progress = useMemo(
    () => (report && checklist ? closeProgress(report, checklist, signed) : null),
    [report, checklist, signed]
  );
  const closedAt = useMemo(
    () =>
      progress?.closedRegisters.flatMap(session => (session.closedAt ? [session.closedAt] : [])) ??
      [],
    [progress]
  );
  const signerName = signoff?.signedBy.name ?? user?.name ?? '';
  const roleLabel = user ? t(`common:userMenu.roles.${user.role}`) : '';
  const hasPin = signerQuery.data?.hasPin ?? false;
  const canSign =
    !signed && !!report?.readiness.readyToSign && signature.ready && !signMutation.isPending;
  const busy = explainMutation.isPending || carryMutation.isPending || discardMutation.isPending;

  const sign = () => {
    signature.setInvalid(false);
    signMutation.mutate({ date, attestationAccepted: true, signature: signature.payload() });
  };

  const ownerSummaryUrl = report
    ? buildOwnerSummaryUrl({
        title: format.title(date),
        lines: [
          t('dayCloseGuide:summary.sold', {
            amount: formatCurrency(report.sales.netRevenue),
            count: report.sales.count,
          }),
          t('dayCloseGuide:summary.cash', { amount: formatCurrency(report.cash.counted) }),
          t('dayCloseGuide:summary.electronic', {
            amount: formatCurrency(electronicTotal(report)),
          }),
          t('dayCloseGuide:summary.difference', { amount: formatCurrency(report.cash.overShort) }),
        ],
        footer: signoff
          ? t('dayCloseGuide:summary.signed', {
              name: signoff.signedBy.name,
              time: format.time(signoff.signedAt),
            })
          : t('dayCloseGuide:summary.unsigned'),
      })
    : null;

  const header = (
    <header className="shrink-0 border-b-[1.5px] border-line bg-surface px-5 pb-4 pt-5 sm:px-7">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="font-display text-[1.8rem] font-bold leading-[1.1] text-fg1">
            {format.title(date)}
          </h2>
          {progress && (
            <p className="text-sm text-fg3" data-testid="day-close-progress">
              {t('dayCloseGuide:subtitle', {
                time: format.time(signoff?.signedAt ?? new Date().toISOString()),
                ready: progress.ready,
                total: progress.total,
              })}
            </p>
          )}
        </div>
        {progress && (
          <HandoffStepper
            className="mt-0"
            testId="day-close-stepper"
            labels={[
              t('dayCloseGuide:steps.count'),
              t('dayCloseGuide:steps.compare'),
              t('dayCloseGuide:steps.sign'),
            ]}
            step={!progress.counted ? 1 : !progress.compared ? 2 : signed ? 4 : 3}
          />
        )}
      </div>
    </header>
  );

  const footer = (
    <>
      {ownerSummaryUrl ? (
        <a
          href={ownerSummaryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-outline h-14 shrink-0 rounded-2xl px-5 text-[15.5px]"
          data-testid="day-close-owner-summary"
        >
          <MessageCircle className="h-5 w-5" aria-hidden="true" />
          {t('dayCloseGuide:footer.owner')}
        </a>
      ) : (
        <span />
      )}
      {!signed && progress && (
        <p className="hidden flex-1 text-[13.5px] text-fg3 md:block" data-testid="day-close-hint">
          {report?.readiness.readyToSign
            ? t('dayCloseGuide:footer.sealHint')
            : t('dayCloseGuide:footer.pending', {
                count: progress.total - progress.ready - 1,
              })}
        </p>
      )}
      {signed ? (
        <Button
          className="h-14 rounded-2xl px-7 text-[17px]"
          onClick={onClose}
          data-testid="day-close-done"
        >
          {t('dayCloseGuide:footer.done')}
        </Button>
      ) : (
        <Button
          className="h-14 rounded-2xl px-6 text-[17px]"
          disabled={!canSign}
          onClick={sign}
          data-testid="day-close-sign"
        >
          <PenLine className="h-5 w-5" aria-hidden="true" />
          {t('dayCloseGuide:footer.sign')}
        </Button>
      )}
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy={titleId}
      showCloseButton={false}
      className="max-w-[60rem] bg-surface sm:h-[min(92vh,70rem)]"
      contentClassName="flex min-h-0 flex-col overflow-hidden p-0 sm:p-0"
      footerClassName="flex-row flex-wrap items-center gap-3.5 bg-surface sm:justify-between"
      footer={footer}
    >
      <div data-testid="day-close-sheet" className="contents">
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4 sm:px-7">
          {queryError && (
            <StatusStrip
              tone="danger"
              icon={AlertTriangle}
              title={translateServerError(queryError, t, t('dayCloseGuide:error'))}
              role="alert"
            />
          )}
          {!report || !checklist || !progress ? (
            !queryError && (
              <div
                className="min-h-64 animate-pulse rounded-[22px] bg-surface-2"
                role="status"
                aria-label={t('dayCloseGuide:loading')}
              />
            )
          ) : (
            <>
              <DayFigures
                report={report}
                today={today}
                closedAt={closedAt}
                formatCurrency={formatCurrency}
              />
              <ul className="mt-2" data-testid="day-close-checklist-rows">
                <RegistersRow
                  open={progress.openRegisters}
                  closed={progress.closedRegisters}
                  formatTime={format.time}
                />
                {progress.differences.length === 0 ? (
                  <CloseRow
                    state="done"
                    title={t('dayCloseGuide:difference.balanced')}
                    testId="day-close-row-balanced"
                  />
                ) : (
                  progress.differences.map(session => (
                    <DifferenceRow
                      key={session.id}
                      session={session}
                      frozen={signed}
                      busy={busy}
                      formatCurrency={formatCurrency}
                      formatTime={format.time}
                      onExplain={(reason, note) =>
                        explainMutation.mutate({ sessionId: session.id, reason, note })
                      }
                    />
                  ))
                )}
                {progress.pendingDrafts.map(draft => (
                  <DraftRow
                    key={draft.id}
                    draft={draft}
                    frozen={signed}
                    busy={busy}
                    formatCurrency={formatCurrency}
                    formatTime={format.time}
                    onDiscard={() => setDiscardTarget(draft)}
                    onCarry={() => carryMutation.mutate({ saleId: draft.id })}
                  />
                ))}
                {progress.carriedDrafts.length > 0 && (
                  <CloseRow
                    state="done"
                    testId="day-close-row-drafts-carried"
                    title={t('dayCloseGuide:drafts.resolved', {
                      count: progress.carriedDrafts.length,
                    })}
                    detail={t('dayCloseGuide:drafts.carried', {
                      amount: formatCurrency(progress.carriedTotal),
                    })}
                  />
                )}
                {report.fiscal.total > 0 && <FiscalRow report={report} />}
                <CloseRow
                  state={report.anomalies.high > 0 ? 'info' : 'done'}
                  testId="day-close-row-anomalies"
                  title={
                    report.anomalies.high > 0
                      ? t('dayCloseGuide:anomalies.some', { count: report.anomalies.high })
                      : t('dayCloseGuide:anomalies.none')
                  }
                  detail={report.anomalies.high > 0 ? t('dayCloseGuide:nonBlocking') : undefined}
                />
              </ul>
              <SignatureBlock
                signoff={signoff}
                rank={progress.total}
                signerName={signerName}
                roleLabel={roleLabel}
                hasPin={hasPin}
                draft={signature}
                disabled={signMutation.isPending}
              />
            </>
          )}
        </div>
      </div>
      <ConfirmModal
        isOpen={discardTarget !== null}
        onClose={() => setDiscardTarget(null)}
        onConfirm={() => discardTarget && discardMutation.mutate({ saleId: discardTarget.id })}
        title={t('dayCloseGuide:drafts.discardTitle')}
        message={
          discardTarget
            ? t('dayCloseGuide:drafts.discardMessage', {
                name: discardTarget.label ?? discardTarget.saleNumber,
                amount: formatCurrency(discardTarget.total),
              })
            : ''
        }
        confirmText={t('dayCloseGuide:drafts.discard')}
        variant="danger"
        loading={discardMutation.isPending}
      />
    </Modal>
  );
}

const DayFigures = memo(function DayFigures({
  report,
  today,
  closedAt,
  formatCurrency,
}: {
  report: CloseReport;
  today: OperationsToday | null;
  closedAt: string[];
  formatCurrency: (value: number) => string;
}) {
  const { t, i18n } = useTranslation('dayCloseGuide');
  const total = (testId?: string) => (
    <div className="flex flex-col items-center text-center" data-testid={testId}>
      <span className="sales-cap text-[11px] text-fg3">{t('sold.label')}</span>
      <span className="font-numeric whitespace-nowrap text-[clamp(1.9rem,5vw,3.4rem)] font-extrabold leading-[1.05] text-fg1">
        {formatCurrency(report.sales.netRevenue)}
      </span>
      <span className="text-[13.5px] text-fg2">
        {t('sold.count', { count: report.sales.count })}
      </span>
    </div>
  );
  const difference = report.cash.overShort;
  return (
    <section className="grid items-start gap-4 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
      <dl className="text-sm leading-[1.6] text-fg2" data-testid="day-close-figures">
        <dt className="sales-cap text-fg3">{t('figures.cap')}</dt>
        <dd className="mt-1">
          {t('figures.cash')}{' '}
          <b className="font-numeric whitespace-nowrap text-[17px] text-fg1">
            {formatCurrency(report.cash.counted)}
          </b>
        </dd>
        <dd>
          {t('figures.electronic')}{' '}
          <b className="font-numeric whitespace-nowrap text-[17px] text-fg1">
            {formatCurrency(electronicTotal(report))}
          </b>
        </dd>
        <dd>
          {t('figures.difference')}{' '}
          <b
            className={cn(
              'font-numeric whitespace-nowrap text-[17px]',
              difference < 0 ? 'text-danger-700' : 'text-fg1'
            )}
            data-testid="day-close-difference"
          >
            {formatCurrency(difference)}
          </b>
        </dd>
      </dl>
      {today ? (
        <DayArc
          hourly={today.hourly}
          dayStartIso={today.dayStartIso}
          timeZone={report.timeZone}
          locale={i18n.language}
          marks={closedAt}
        >
          {/* Below sm the centre of the dial is too narrow for the total, so it moves under the arc. */}
          <div className="hidden sm:block">{total('day-close-sold')}</div>
        </DayArc>
      ) : (
        <div className="py-6">{total('day-close-sold')}</div>
      )}
      {today && <div className="sm:hidden">{total()}</div>}
    </section>
  );
});
