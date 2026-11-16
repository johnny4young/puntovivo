import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { MessageCircle, PenLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Overlay } from '@/components/overlay/Overlay';
import { useToast } from '@/components/feedback/ToastProvider';
import { Button, SeverityMark, type Severity } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { StepPills } from '@/features/shift-handoff/DenominationCount';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { cn } from '@/lib/utils';
import { SignaturePad } from './SignaturePad';
import { SoldArc } from './SoldArc';
import {
  VARIANCE_REASONS,
  buildOwnerSummary,
  closeGuideStep,
  ownerWhatsAppUrl,
  pendingDrafts,
  type CloseGuide,
  type CloseGuideDifference,
  type VarianceReason,
} from './closeGuideModel';

const PIN_LENGTH = 6;

interface DayCloseGuideProps {
  isOpen: boolean;
  onClose: () => void;
  formatCurrency: (value: number) => string;
}

type Formatters = {
  money: (value: number) => string;
  time: (iso: string) => string;
};

/** The manager's guided close inside Hoy: count, compare, sign. */
export function DayCloseGuide({ isOpen, onClose, formatCurrency }: DayCloseGuideProps) {
  const { t, i18n } = useTranslation(['closeGuide', 'common', 'errors']);
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const guideQuery = trpc.reports.dayClose.guide.useQuery(undefined, {
    enabled: isOpen,
    refetchOnWindowFocus: true,
  });
  const guide = guideQuery.data;
  const [method, setMethod] = useState<'drawn' | 'pin'>('drawn');
  const [image, setImage] = useState<string | null>(null);
  const [pin, setPin] = useState('');

  const formatters = useMemo(() => {
    const timeZone = guide?.timezone;
    const time = new Intl.DateTimeFormat(i18n.language, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    });
    const day = new Intl.DateTimeFormat(i18n.language, {
      weekday: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
    const stamp = new Intl.DateTimeFormat(i18n.language, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
    return {
      money: formatCurrency,
      time: (iso: string) => time.format(new Date(iso)),
      day: (date: string) => day.format(new Date(`${date}T12:00:00Z`)),
      stamp: (date: string) => stamp.format(new Date(`${date}T12:00:00Z`)),
    };
  }, [formatCurrency, guide?.timezone, i18n.language]);

  const refresh = () =>
    Promise.all([utils.reports.dayClose.guide.invalidate(), utils.operations.today.invalidate()]);

  const signOff = useCriticalMutation('reports.dayClose.signOff', {
    onSuccess: async () => {
      await Promise.all([refresh(), utils.reports.dayClose.signoffMetadata.invalidate()]);
      toast.success({ title: t('closeGuide:toast.signed') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'closeGuide:toast.signError' }),
  });

  if (!guide) {
    return (
      <Overlay isOpen={isOpen} onClose={onClose} size="xl" title={t('closeGuide:kicker')}>
        <div
          className="min-h-64 animate-pulse rounded-[18px] bg-surface-2 motion-reduce:animate-none"
          role="status"
          aria-label={t('closeGuide:loading')}
        />
      </Overlay>
    );
  }

  const step = closeGuideStep(guide);
  const sealed = guide.signoff !== null;
  const totalRegisters = guide.sessions.closed + guide.sessions.open;
  const signature =
    method === 'drawn'
      ? image
        ? ({ method: 'drawn', image } as const)
        : null
      : pin.length === PIN_LENGTH
        ? ({ method: 'pin', pin } as const)
        : null;
  const canSign = guide.readyToSign && signature !== null && !signOff.isPending;
  const roleLabel = user?.role ? t(`common:userMenu.roles.${user.role}`) : '';
  const summary = buildOwnerSummary(
    {
      title: t('closeGuide:summary.title', { date: formatters.day(guide.date) }),
      sold: t('closeGuide:summary.sold'),
      cashToDeposit: t('closeGuide:figures.cashToDeposit'),
      electronic: t('closeGuide:figures.electronic'),
      cashDifference: t('closeGuide:figures.cashDifference'),
      signedBy: guide.signoff
        ? t('closeGuide:summary.signedBy', { name: guide.signoff.signedByName })
        : null,
    },
    {
      sold: formatCurrency(guide.figures.sold),
      cashToDeposit: formatCurrency(guide.figures.cashToDeposit),
      electronic: formatCurrency(guide.figures.electronic),
      cashDifference: formatCurrency(guide.figures.cashDifference),
    }
  );

  return (
    <Overlay
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      kicker={t('closeGuide:kicker')}
      title={t('closeGuide:title', { date: formatters.day(guide.date) })}
      description={t('closeGuide:subtitle', {
        closed: guide.sessions.closed,
        count: totalRegisters,
      })}
      headerAside={
        <StepPills
          steps={[
            t('closeGuide:steps.count'),
            t('closeGuide:steps.compare'),
            t('closeGuide:steps.sign'),
          ]}
          current={step}
          label={t('closeGuide:steps.label')}
        />
      }
      footer={
        <div className="flex w-full flex-wrap items-center gap-3" data-testid="close-guide-footer">
          <a
            href={ownerWhatsAppUrl(summary)}
            target="_blank"
            rel="noreferrer"
            className="btn-outline min-h-11 px-4"
            data-testid="close-guide-share"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            {t('closeGuide:footer.share')}
          </a>
          {sealed ? (
            <Button className="ml-auto" onClick={onClose} data-testid="close-guide-done">
              {t('closeGuide:footer.done')}
            </Button>
          ) : (
            <>
              <p className="ml-auto hidden max-w-[18rem] text-right text-[13px] text-fg3 md:block">
                {t('closeGuide:footer.hint')}
              </p>
              <Button
                className="min-h-12 px-5 text-base"
                disabled={!canSign}
                onClick={() =>
                  signature &&
                  signOff.mutate({ date: guide.date, attestationAccepted: true, signature })
                }
                data-testid="close-guide-sign"
              >
                <PenLine className="h-4 w-4" aria-hidden="true" />
                {signOff.isPending ? t('closeGuide:footer.signing') : t('closeGuide:footer.sign')}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-5" data-testid="close-guide">
        <div className={cn('grid gap-5', sealed && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]')}>
          <section aria-labelledby="close-guide-figures">
            <h3
              id="close-guide-figures"
              className="text-xs font-semibold tracking-[0.14em] text-fg3 uppercase"
            >
              {t('closeGuide:figures.title')}
            </h3>
            <dl className="mt-2 grid gap-1 text-base" data-testid="close-guide-figures">
              <Figure
                label={t('closeGuide:figures.cashToDeposit')}
                value={formatCurrency(guide.figures.cashToDeposit)}
              />
              <Figure
                label={t('closeGuide:figures.electronic')}
                value={formatCurrency(guide.figures.electronic)}
              />
              <Figure
                label={t('closeGuide:figures.cashDifference')}
                value={formatCurrency(guide.figures.cashDifference)}
                tone={guide.figures.cashDifference < 0 ? 'danger' : undefined}
                testId="close-guide-cash-difference"
              />
            </dl>
          </section>
          {sealed && (
            <SoldArc
              sold={guide.figures.sold}
              comparison={guide.figures.comparisonTotal}
              salesCount={guide.figures.salesCount}
              formatCurrency={formatCurrency}
            />
          )}
        </div>

        <ul className="border-t border-line" data-testid="close-guide-checklist">
          <RegistersRow guide={guide} formatters={formatters} />
          <DifferencesRows
            guide={guide}
            formatters={formatters}
            sealed={sealed}
            onSaved={refresh}
          />
          <DraftsRows guide={guide} formatters={formatters} sealed={sealed} onChanged={refresh} />
          <CheckRow
            severity="whenPossible"
            testId="close-guide-fiscal"
            title={t('closeGuide:fiscal.title', {
              accepted: guide.fiscal.accepted,
              inProcess: guide.fiscal.inProcess,
            })}
            detail={
              guide.fiscal.rejected > 0
                ? t('closeGuide:fiscal.rejected', { count: guide.fiscal.rejected })
                : t('closeGuide:fiscal.detail')
            }
            action={
              <Link
                to="/fiscal-documents"
                className="btn-ghost min-h-11 px-3 text-sm font-semibold"
              >
                {t('closeGuide:fiscal.view')}
              </Link>
            }
          />
          <CheckRow
            severity={guide.highAnomalies === 0 ? 'ready' : 'beforeClose'}
            testId="close-guide-anomalies"
            title={
              guide.highAnomalies === 0
                ? t('closeGuide:anomalies.none')
                : t('closeGuide:anomalies.some', { count: guide.highAnomalies })
            }
            detail={t('closeGuide:anomalies.detail')}
          />
        </ul>

        <section
          className={cn(
            'relative rounded-[18px] border-2 p-4',
            sealed ? 'border-line bg-surface' : 'border-fg1 bg-surface'
          )}
          aria-labelledby="close-guide-signature"
          data-testid="close-guide-signature"
        >
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 id="close-guide-signature" className="text-base font-semibold text-fg1">
                {t('closeGuide:signature.title')}
              </h3>
              <p className="text-sm text-fg2">
                {sealed && guide.signoff
                  ? t('closeGuide:signature.signedBy', {
                      name: guide.signoff.signedByName,
                      time: formatters.time(guide.signoff.signedAt),
                    })
                  : t('closeGuide:signature.detail', { name: user?.name ?? '', role: roleLabel })}
              </p>
            </div>
            {!sealed && (
              <div
                role="radiogroup"
                aria-label={t('closeGuide:signature.methodsLabel')}
                className="flex gap-1"
              >
                {(['drawn', 'pin'] as const).map(option => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={method === option}
                    onClick={() => setMethod(option)}
                    data-testid={`close-guide-method-${option}`}
                    className={cn(
                      'min-h-11 rounded-full px-4 text-sm font-semibold',
                      method === option
                        ? 'bg-fg1 text-[var(--background)]'
                        : 'bg-surface-3 text-fg2'
                    )}
                  >
                    {t(`closeGuide:signature.${option}`)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3">
            {sealed && guide.signoff ? (
              <div className="flex min-h-[150px] items-center gap-4">
                {guide.signoff.signatureImage ? (
                  <img
                    src={guide.signoff.signatureImage}
                    alt={t('closeGuide:signature.imageAlt', { name: guide.signoff.signedByName })}
                    className="h-[120px] max-w-[60%] rounded-[12px] bg-white object-contain"
                    data-testid="close-guide-signature-image"
                  />
                ) : (
                  <p className="text-sm text-fg2">
                    {t('closeGuide:signature.signedWithPin', { name: guide.signoff.signedByName })}
                  </p>
                )}
                <DayClosedStamp
                  day={formatters.stamp(guide.date)}
                  time={formatters.time(guide.signoff.signedAt)}
                  label={t('closeGuide:stamp')}
                />
              </div>
            ) : method === 'drawn' ? (
              <SignaturePad
                onChange={setImage}
                label={t('closeGuide:signature.padLabel')}
                disabled={signOff.isPending}
              />
            ) : (
              <label className="flex flex-col gap-1 text-sm text-fg2">
                {t('closeGuide:signature.pinLabel')}
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="[0-9]*"
                  maxLength={PIN_LENGTH}
                  value={pin}
                  onChange={event => setPin(event.target.value.replace(/\D/g, ''))}
                  className="h-12 w-44 rounded-xl border-2 border-line-strong bg-surface px-3 font-mono text-xl tracking-[0.4em] text-fg1 outline-none focus:border-primary-600"
                  data-testid="close-guide-pin"
                />
              </label>
            )}
          </div>
        </section>
      </div>
    </Overlay>
  );
}

function Figure({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone?: 'danger' | undefined;
  testId?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-fg2">{label}</dt>
      <dd
        className={cn('font-numeric text-xl', tone === 'danger' ? 'text-danger-700' : 'text-fg1')}
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}

function CheckRow({
  severity,
  title,
  detail,
  action,
  children,
  testId,
}: {
  severity: Severity;
  title: string;
  detail?: string | undefined;
  action?: ReactNode;
  children?: ReactNode;
  testId: string;
}) {
  return (
    <li className="border-b border-line py-3" data-testid={testId} data-severity={severity}>
      <div className="flex flex-wrap items-center gap-3">
        <SeverityMark severity={severity} size={22} />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-fg1">{title}</p>
          {detail && <p className="text-sm text-fg3">{detail}</p>}
        </div>
        {action}
      </div>
      {children}
    </li>
  );
}

function RegistersRow({ guide, formatters }: { guide: CloseGuide; formatters: Formatters }) {
  const { t } = useTranslation('closeGuide');
  const total = guide.sessions.closed + guide.sessions.open;
  if (guide.sessions.open > 0) {
    return (
      <CheckRow
        severity="blocks"
        testId="close-guide-registers"
        title={t('registers.open', { count: guide.sessions.open })}
        detail={t('registers.openDetail')}
        action={
          <Link to="/operations?tab=cash" className="btn-outline min-h-11 px-3 text-sm">
            {t('registers.countAndClose')}
          </Link>
        }
      />
    );
  }
  const last = guide.sessions.lastClosed;
  return (
    <CheckRow
      severity="ready"
      testId="close-guide-registers"
      title={
        total === 0
          ? t('registers.none')
          : t('registers.closed', { closed: guide.sessions.closed, count: total })
      }
      detail={
        last
          ? t('registers.lastClosed', {
              register: last.registerName,
              cashier: last.cashierName,
              time: formatters.time(last.closedAt),
            })
          : undefined
      }
    />
  );
}

function DifferencesRows({
  guide,
  formatters,
  sealed,
  onSaved,
}: {
  guide: CloseGuide;
  formatters: Formatters;
  sealed: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const { t } = useTranslation('closeGuide');
  const over = guide.differences.filter(row => row.overTolerance);
  const within = guide.differences.filter(row => !row.overTolerance);
  const withinText =
    within.length > 0
      ? t('difference.within', {
          list: within
            .map(row => `${row.registerName} ${formatters.money(row.overShort)}`)
            .join(' · '),
        })
      : undefined;

  // A recount that differs never touches a session's over/short, so it is shown here.
  const handoffRows = guide.handoffs
    .filter(entry => entry.recountDifference !== null && Math.abs(entry.recountDifference) > 0.009)
    .map(entry => (
      <CheckRow
        key={entry.id}
        severity="beforeClose"
        testId={`close-guide-handoff-${entry.id}`}
        title={t('difference.handoff', {
          register: entry.registerName,
          amount: formatters.money(entry.recountDifference ?? 0),
        })}
        detail={t('difference.handoffDetail', {
          from: entry.fromUserName,
          to: entry.toUserName ?? '',
        })}
      />
    ));

  if (over.length === 0) {
    return (
      <>
        <CheckRow
          severity="ready"
          testId="close-guide-differences"
          title={within.length > 0 ? t('difference.allWithin') : t('difference.none')}
          detail={withinText}
        />
        {handoffRows}
      </>
    );
  }
  return (
    <>
      {handoffRows}
      {over.map((row, index) => (
        <DifferenceRow
          key={row.sessionId}
          row={row}
          tolerance={guide.differenceTolerance}
          formatters={formatters}
          sealed={sealed}
          extra={index === over.length - 1 ? withinText : undefined}
          onSaved={onSaved}
        />
      ))}
    </>
  );
}

function DifferenceRow({
  row,
  tolerance,
  formatters,
  sealed,
  extra,
  onSaved,
}: {
  row: CloseGuideDifference;
  tolerance: number;
  formatters: Formatters;
  sealed: boolean;
  extra: string | undefined;
  onSaved: () => Promise<unknown>;
}) {
  const { t } = useTranslation(['closeGuide', 'errors']);
  const toast = useToast();
  const [choice, setChoice] = useState<VarianceReason | null>(row.reason);
  const [note, setNote] = useState(row.note ?? '');
  const explain = trpc.reports.dayClose.explainDifference.useMutation({
    onSuccess: () => onSaved(),
    onError: onErrorToast(toast, t, { titleKey: 'closeGuide:difference.errorTitle' }),
  });
  const explained = row.reason !== null;
  const amount = formatters.money(row.overShort);
  const save = (reason: VarianceReason) => {
    setChoice(reason);
    if (reason !== 'other') explain.mutate({ sessionId: row.sessionId, reason, note: null });
  };

  return (
    <CheckRow
      severity={explained ? 'ready' : 'beforeClose'}
      testId={`close-guide-difference-${row.sessionId}`}
      title={
        explained
          ? t('closeGuide:difference.explained', { register: row.registerName, amount })
          : t('closeGuide:difference.title', { register: row.registerName, amount })
      }
      detail={[
        t('closeGuide:difference.overTolerance', {
          tolerance: formatters.money(tolerance),
          cashier: row.cashierName,
        }),
        extra,
      ]
        .filter(Boolean)
        .join(' · ')}
      action={
        sealed ? undefined : (
          <div
            role="radiogroup"
            aria-label={t('closeGuide:difference.reasonsLabel', { register: row.registerName })}
            className="flex flex-wrap gap-1.5"
          >
            {VARIANCE_REASONS.map(reason => (
              <button
                key={reason}
                type="button"
                role="radio"
                aria-checked={choice === reason}
                disabled={explain.isPending}
                onClick={() => save(reason)}
                data-testid={`close-guide-reason-${reason}`}
                className={cn(
                  'min-h-11 rounded-full border px-3.5 text-sm font-semibold',
                  choice === reason
                    ? 'border-fg1 bg-fg1 text-[var(--background)]'
                    : 'border-line-strong bg-surface text-fg2'
                )}
              >
                {t(`closeGuide:difference.reasons.${reason}`)}
              </button>
            ))}
          </div>
        )
      }
    >
      {!sealed && choice === 'other' && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2 pl-[34px]"
          onSubmit={event => {
            event.preventDefault();
            explain.mutate({ sessionId: row.sessionId, reason: 'other', note });
          }}
        >
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-sm text-fg2">
            {t('closeGuide:difference.noteLabel')}
            <input
              value={note}
              maxLength={240}
              onChange={event => setNote(event.target.value)}
              className="h-11 rounded-xl border-2 border-line-strong bg-surface px-3 text-base text-fg1 outline-none focus:border-primary-600"
              data-testid="close-guide-reason-note"
            />
          </label>
          <Button
            type="submit"
            variant="outline"
            disabled={explain.isPending || note.trim().length < 3}
            data-testid="close-guide-reason-save"
          >
            {t('closeGuide:difference.save')}
          </Button>
        </form>
      )}
      {sealed && row.note && <p className="mt-1 pl-[34px] text-sm text-fg2">{row.note}</p>}
    </CheckRow>
  );
}

function DraftsRows({
  guide,
  formatters,
  sealed,
  onChanged,
}: {
  guide: CloseGuide;
  formatters: Formatters;
  sealed: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation(['closeGuide', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const onError = onErrorToast(toast, t, { titleKey: 'closeGuide:drafts.errorTitle' });
  const carryOver = trpc.reports.dayClose.carryOverDraft.useMutation({
    onSuccess: () => onChanged(),
    onError,
  });
  const discard = useCriticalMutation('sales.discardDraft', {
    onSuccess: async () => {
      await Promise.all([onChanged(), utils.sales.listDrafts.invalidate()]);
    },
    onError,
  });
  const pending = pendingDrafts(guide);
  const resolved = guide.drafts.filter(draft => draft.carriedOver);
  const busy = carryOver.isPending || discard.isPending;

  return (
    <>
      {pending.map(draft => (
        <CheckRow
          key={draft.id}
          severity="beforeClose"
          testId={`close-guide-draft-${draft.id}`}
          title={t('closeGuide:drafts.pending', {
            label: draft.label,
            amount: formatters.money(draft.total),
          })}
          detail={t('closeGuide:drafts.pendingDetail', {
            time: formatters.time(draft.suspendedAt),
          })}
          action={
            sealed ? undefined : (
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="compact"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => discard.mutate({ saleId: draft.id })}
                  data-testid="close-guide-draft-discard"
                >
                  {t('closeGuide:drafts.discard')}
                </Button>
                <Button
                  size="compact"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => carryOver.mutate({ saleId: draft.id })}
                  data-testid="close-guide-draft-carry"
                >
                  {t('closeGuide:drafts.carryOver')}
                </Button>
              </div>
            )
          }
        />
      ))}
      {pending.length === 0 && (
        <CheckRow
          severity="ready"
          testId="close-guide-drafts"
          title={
            resolved.length > 0
              ? t('closeGuide:drafts.resolved', { count: resolved.length })
              : t('closeGuide:drafts.none')
          }
          detail={
            resolved.length > 0
              ? resolved
                  .map(draft => `${draft.label} · ${formatters.money(draft.total)}`)
                  .join(' · ')
              : undefined
          }
        />
      )}
    </>
  );
}

function DayClosedStamp({ day, time, label }: { day: string; time: string; label: string }) {
  return (
    <div
      className="ml-auto flex h-32 w-32 shrink-0 -rotate-12 flex-col items-center justify-center rounded-full border-[3px] border-double border-success-700 text-success-700"
      data-testid="close-guide-stamp"
    >
      <span className="text-[11px] font-bold tracking-[0.14em] uppercase">{label}</span>
      <span className="font-display text-2xl leading-none font-bold uppercase">{day}</span>
      <span className="font-mono text-[11px]">{time}</span>
    </div>
  );
}
