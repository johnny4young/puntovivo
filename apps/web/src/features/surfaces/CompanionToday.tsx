import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SeverityMark } from '@/components/ui';
import { percentChange, type OperationsToday } from '@/features/dashboard/today/todayModel';
import { formatCurrency } from '@/lib/utils';
import type { QueueItem } from './companionApproval';
import { CompanionLivePill } from './CompanionConnection';
import { CompanionFigureCard } from './CompanionFigureCard';
import { CompanionRegisterList, type ClosedRegister } from './CompanionRegisters';
import { CompanionSalesCurve } from './CompanionSalesCurve';
import { CompanionError } from './CompanionStatus';
import { CompanionYourCall } from './CompanionYourCall';
import type { LiveState } from './useCompanionLive';

interface CompanionTodayProps {
  today: OperationsToday;
  /** Null until the approvals queue has loaded. */
  queue: readonly QueueItem[] | null;
  queueFailed: boolean;
  closed: readonly ClosedRegister[];
  liveState: LiveState;
  formatTime: (iso: string) => string;
  formatLongDate: (iso: string) => string;
  formatWeekday: (iso: string) => string;
  decideHref: (requestId: string) => string;
}

/** The owner away from the store: what sold, what waits on them, how the registers are. */
export function CompanionToday({
  today,
  queue,
  queueFailed,
  closed,
  liveState,
  formatTime,
  formatLongDate,
  formatWeekday,
  decideHref,
}: CompanionTodayProps) {
  const { t } = useTranslation(['companion', 'dashboard', 'common']);
  const change = percentChange(today.sales.total, today.sales.comparisonTotal);
  const weekday = formatWeekday(today.dayStartIso);
  const mine = queue?.[0];
  const queueIds = new Set((queue ?? []).map(item => item.id));
  // Until the queue answers, approvals are neither the owner's nor the store's.
  const storePending = today.pending.filter(item =>
    queue ? !queueIds.has(item.id) : item.kind !== 'approval'
  ).length;

  return (
    <div className="space-y-5" data-testid="companion-today">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[1.9rem] leading-tight">{t('owner.title')}</h1>
          <p className="truncate text-sm text-fg3">{formatLongDate(today.generatedAt)}</p>
        </div>
        <CompanionLivePill liveState={liveState} />
      </header>

      <CompanionFigureCard
        id="companion-sold"
        kicker={t('owner.sold')}
        total={formatCurrency(today.sales.total)}
        change={change}
        weekday={weekday}
        testId="companion-sold"
      >
        <CompanionSalesCurve
          hourly={today.hourly}
          dayStartIso={today.dayStartIso}
          live={{ generatedAt: today.generatedAt, formatTime }}
          caption={t('owner.salesCount', { count: today.sales.orders })}
        />
      </CompanionFigureCard>

      {mine ? (
        <CompanionYourCall
          items={queue ?? []}
          generatedAt={today.generatedAt}
          decideHref={decideHref}
        />
      ) : queueFailed ? (
        <CompanionError message={t('owner.queueUnavailable')} />
      ) : queue === null ? null : (
        <p
          className="flex items-center gap-2 text-sm text-fg2"
          data-testid="companion-nothing-waiting"
        >
          <SeverityMark severity="ready" size={16} />
          {t('owner.nothingWaiting')}
        </p>
      )}

      {storePending > 0 && (
        <a
          href="/"
          className="flex min-h-11 items-center gap-2 border-b border-line py-2 text-sm text-fg2"
          data-testid="companion-store-pending"
        >
          <SeverityMark severity="beforeClose" size={14} />
          <span className="flex-1">{t('owner.morePending', { count: storePending })}</span>
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </a>
      )}

      <CompanionRegisterList today={today} closed={closed} formatTime={formatTime} />
    </div>
  );
}
