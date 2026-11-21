import { CheckCircle2, ChevronDown, ChevronUp, PenLine } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Button } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { trpc } from '@/lib/trpc';
import { calendarDayAt } from '@/lib/utils';
import { ISO_DATE_ONLY_PATTERN } from '@puntovivo/shared/iso-date';
import { DayBand, EXPANDED_AXIS_Y } from './DayBand';
import { PendingQueue } from './PendingQueue';
import { RegistersColumn } from './RegistersColumn';
import { percentChange } from './todayModel';

// Only the expanded day draws the arc, so compact Hoy never downloads it.
const TodayArc = lazy(() => import('./TodayArc').then(module => ({ default: module.TodayArc })));
const GuidedDayCloseSheet = lazy(() =>
  import('../close/GuidedDayCloseSheet').then(module => ({ default: module.GuidedDayCloseSheet }))
);

const EXPANDED_KEY = 'puntovivo.today.expanded';
const CLOSE_PARAM = 'close';

function readExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) === '1';
  } catch {
    return false;
  }
}

interface TodayOverviewProps {
  formatCurrency: (value: number) => string;
}

/** The manager's day: what sold, the day band, what is pending and how the registers are. */
export function TodayOverview({ formatCurrency }: TodayOverviewProps) {
  const { t, i18n } = useTranslation(['dashboard', 'dayCloseGuide']);
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(readExpanded);
  // A phone-width band has no room beside it, so the arc is not mounted or fetched there.
  const roomForArc = useMediaQuery('(min-width: 768px)');
  const [searchParams, setSearchParams] = useSearchParams();
  const query = trpc.operations.today.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const approverQuery = trpc.managerApprovals.queue.useQuery({ limit: 1 }, { staleTime: 60_000 });
  const today = query.data;
  const businessDay = today ? calendarDayAt(new Date(today.generatedAt), today.timezone) : null;
  const closeParam = searchParams.get(CLOSE_PARAM);
  const closeDate =
    closeParam !== null
      ? ISO_DATE_ONLY_PATTERN.test(closeParam)
        ? closeParam
        : businessDay
      : null;
  const signoffQuery = trpc.reports.dayClose.signoffMetadata.useQuery(
    { date: businessDay ?? '' },
    { enabled: businessDay !== null, staleTime: 60_000 }
  );
  const daySigned = Boolean(signoffQuery.data);
  const setCloseDate = (date: string | null) =>
    setSearchParams(
      params => {
        const next = new URLSearchParams(params);
        if (date) next.set(CLOSE_PARAM, date);
        else next.delete(CLOSE_PARAM);
        return next;
      },
      { replace: true }
    );

  const formatters = useMemo(() => {
    const timeZone = today?.timezone;
    const time = new Intl.DateTimeFormat(i18n.language, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    });
    const long = new Intl.DateTimeFormat(i18n.language, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone,
    });
    const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: 'long', timeZone });
    return {
      time: (iso: string) => time.format(new Date(iso)),
      longDate: (iso: string) => {
        const text = long.format(new Date(iso));
        return text.charAt(0).toLocaleUpperCase(i18n.language) + text.slice(1);
      },
      weekday: (iso: string) => weekday.format(new Date(iso)),
    };
  }, [i18n.language, today?.timezone]);

  const numbered = useMemo(
    () => (today?.pending ?? []).map((item, index) => ({ item, rank: index + 1 })),
    [today?.pending]
  );

  const closeSheet = closeDate && (
    <Suspense fallback={null}>
      <GuidedDayCloseSheet
        isOpen
        onClose={() => setCloseDate(null)}
        date={closeDate}
        today={today && closeDate === businessDay ? today : null}
        formatCurrency={formatCurrency}
      />
    </Suspense>
  );

  if (!today) {
    // A dated ?close= link still opens while Hoy loads or fails.
    return (
      <>
        {query.isLoading && (
          <div
            className="min-h-64 animate-pulse rounded-[22px] bg-surface-2 motion-reduce:animate-none"
            role="status"
            aria-label={t('today.loading')}
          />
        )}
        {closeSheet}
      </>
    );
  }

  const change = percentChange(today.sales.total, today.sales.comparisonTotal);
  const fiscalPending = today.pending.some(
    item => item.kind === 'attention' && item.area === 'fiscal'
  );
  const toggleExpanded = () => {
    setExpanded(value => {
      try {
        localStorage.setItem(EXPANDED_KEY, value ? '0' : '1');
      } catch {
        // Per-viewer convenience only; the page works without storage.
      }
      return !value;
    });
  };

  return (
    <section className="flex flex-col gap-5" data-testid="today-overview">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-[2rem] leading-tight">
          {t('today.title', { date: formatters.longDate(today.generatedAt) })}
        </h1>
        <span
          className={
            fiscalPending
              ? 'ml-auto rounded-full bg-warning-50 px-3 py-1.5 text-sm font-semibold text-warning-700'
              : 'ml-auto rounded-full bg-success-50 px-3 py-1.5 text-sm font-semibold text-success-700'
          }
          data-testid="today-status-pill"
        >
          {fiscalPending ? t('today.status.fiscalPending') : t('today.status.ready')}
        </span>
        <Button
          variant="outline"
          size="compact"
          onClick={() => setCloseDate(businessDay)}
          data-testid="today-close-day"
        >
          {daySigned ? (
            <CheckCircle2 className="h-4 w-4 text-success-700" aria-hidden="true" />
          ) : (
            <PenLine className="h-4 w-4" aria-hidden="true" />
          )}
          {daySigned ? t('dayCloseGuide:openSigned') : t('dayCloseGuide:open')}
        </Button>
      </header>

      <div className="rounded-[22px] border border-line bg-surface px-5 pt-4 pb-3">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-fg3 uppercase">
              {t('today.sold')}
            </p>
            <p className="font-numeric text-[3.4rem] leading-none" data-testid="today-sales-total">
              {formatCurrency(today.sales.total)}
            </p>
          </div>
          <p className="pb-2 text-sm text-fg2" data-testid="today-sales-context">
            {change !== null && (
              <b className={change >= 0 ? 'text-success-700' : 'text-danger-700'}>
                {change >= 0 ? '▲' : '▼'} {Math.abs(change)} %{' '}
              </b>
            )}
            {t('today.salesContext', {
              weekday: formatters.weekday(today.dayStartIso),
              count: today.sales.orders,
              ticket: formatCurrency(today.sales.averageTicket),
            })}
          </p>
          <Button
            variant="outline"
            size="compact"
            className="ml-auto"
            aria-expanded={expanded}
            onClick={toggleExpanded}
            data-testid="today-expand"
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            )}
            {expanded ? t('today.collapse') : t('today.expand')}
          </Button>
        </div>
        <div className="flex items-start gap-6">
          <div className="min-w-0 flex-1">
            <DayBand
              today={today}
              numbered={numbered}
              expanded={expanded}
              formatCurrency={formatCurrency}
              formatTime={formatters.time}
            />
          </div>
          {expanded && roomForArc && (
            <Suspense fallback={null}>
              <TodayArc
                today={today}
                formatTime={formatters.time}
                baselineY={EXPANDED_AXIS_Y}
                className="shrink-0"
              />
            </Suspense>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <PendingQueue
          numbered={numbered}
          canAct
          approverId={approverQuery.data?.approver.hasPin ? (user?.id ?? null) : null}
          nowIso={today.generatedAt}
          formatCurrency={formatCurrency}
          formatTime={formatters.time}
        />
        <RegistersColumn
          today={today}
          numbered={numbered}
          canOpenRegister
          formatCurrency={formatCurrency}
          formatTime={formatters.time}
        />
      </div>
      {closeSheet}
    </section>
  );
}
