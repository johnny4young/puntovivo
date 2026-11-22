import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useTodayFormatters } from '@/features/dashboard/today/useTodayFormatters';
import { trpc } from '@/lib/trpc';
import { CompanionDecideSheet } from './CompanionDecideSheet';
import { CompanionRegisters, type ClosedRegister } from './CompanionRegisters';
import { CompanionSealedDay } from './CompanionSealedDay';
import { CompanionError, CompanionSkeleton } from './CompanionStatus';
import { CompanionToday } from './CompanionToday';
import type { CompanionView } from './companionViews';
import type { LiveState } from './useCompanionLive';

const TODAY_REFRESH_MS = 30_000;
const DECIDE_PARAM = 'decide';

interface CompanionOwnerViewsProps {
  view: Exclude<CompanionView, 'more'>;
  liveState: LiveState;
  businessDay: string;
}

export function CompanionOwnerViews({ view, liveState, businessDay }: CompanionOwnerViewsProps) {
  const { t, i18n } = useTranslation('companion');
  const [searchParams, setSearchParams] = useSearchParams();
  const utils = trpc.useUtils();
  const decideId = searchParams.get(DECIDE_PARAM);
  // On the sealed day the decide sheet names the site instead of polling Hoy for the register.
  const todayQuery = trpc.operations.today.useQuery(undefined, {
    enabled: view !== 'day',
    refetchInterval: TODAY_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
  const queueQuery = trpc.managerApprovals.queue.useQuery(
    { limit: 20 },
    { enabled: view === 'today' || decideId !== null, refetchInterval: TODAY_REFRESH_MS }
  );
  const today = todayQuery.data;
  const checklistQuery = trpc.reports.dayClose.checklist.useQuery(
    { date: businessDay },
    { enabled: view !== 'day', refetchInterval: TODAY_REFRESH_MS }
  );

  const format = useTodayFormatters(i18n.language, today?.timezone);

  // A register handed over or reopened already shows as open or waiting.
  const closed = useMemo<ClosedRegister[]>(() => {
    if (!today || !checklistQuery.data) return [];
    const live = new Set([
      ...today.registers.map(register => register.registerName),
      ...today.awaitingHandoffs.map(handoff => handoff.registerName),
    ]);
    return checklistQuery.data.sessions.filter(
      session => session.status === 'closed' && !live.has(session.registerName)
    );
  }, [today, checklistQuery.data]);

  const decideHref = (requestId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set(DECIDE_PARAM, requestId);
    return `/c/?${next.toString()}`;
  };
  const closeDecide = () =>
    setSearchParams(
      params => {
        const next = new URLSearchParams(params);
        next.delete(DECIDE_PARAM);
        return next;
      },
      { replace: true }
    );

  const queue = queueQuery.data;
  const decideItem = decideId ? (queue?.items.find(item => item.id === decideId) ?? null) : null;

  const renderScreen = () => {
    if (view === 'day') {
      return (
        <CompanionSealedDay businessDay={businessDay} requestedDate={searchParams.get('date')} />
      );
    }
    if (!today) {
      return todayQuery.isError ? (
        <CompanionError message={t('owner.unavailable')} />
      ) : (
        <CompanionSkeleton />
      );
    }
    if (view === 'registers') {
      return <CompanionRegisters today={today} closed={closed} formatTime={format.time} />;
    }
    return (
      <CompanionToday
        today={today}
        queue={queue?.items ?? []}
        closed={closed}
        liveState={liveState}
        formatTime={format.time}
        formatLongDate={format.longDate}
        formatWeekday={format.weekday}
        decideHref={decideHref}
      />
    );
  };

  return (
    <>
      {renderScreen()}
      {decideId && (
        <CompanionDecideSheet
          key={decideId}
          item={decideItem}
          loading={queueQuery.isPending}
          approverId={queue?.approver.hasPin ? queue.approver.id : null}
          today={today}
          formatTime={format.time}
          onClose={closeDecide}
          onDecided={() => {
            closeDecide();
            void utils.operations.today.invalidate();
          }}
        />
      )}
    </>
  );
}
