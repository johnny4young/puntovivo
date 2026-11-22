import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { SeverityMark } from '@/components/ui';
import {
  ago,
  clip,
  percentChange,
  REASON_MAX,
  type OperationsToday,
} from '@/features/dashboard/today/todayModel';
import { cn, formatCurrency } from '@/lib/utils';
import { approvalWhat, requestedPercent, type QueueItem } from './companionApproval';
import { CompanionConnection } from './CompanionConnection';
import { CompanionRegisterList, type ClosedRegister } from './CompanionRegisters';
import { CompanionSalesCurve } from './CompanionSalesCurve';
import type { LiveState } from './useCompanionLive';

interface CompanionTodayProps {
  today: OperationsToday;
  queue: readonly QueueItem[];
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
  const [mine, ...moreMine] = queue;
  const queueIds = new Set(queue.map(item => item.id));
  const storePending = today.pending.filter(item => !queueIds.has(item.id)).length;

  return (
    <div className="space-y-5" data-testid="companion-today">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[1.9rem] leading-tight">{t('owner.title')}</h1>
          <p className="truncate text-sm text-fg3">{formatLongDate(today.generatedAt)}</p>
        </div>
        <div
          className={cn(
            'shrink-0 rounded-full px-3 py-1',
            liveState === 'open' ? 'bg-success-50' : 'bg-surface-2'
          )}
        >
          <CompanionConnection liveState={liveState} />
        </div>
      </header>

      <section
        className="rounded-[20px] border border-line bg-surface px-4 pt-3.5 pb-3"
        aria-labelledby="companion-sold"
      >
        <p
          id="companion-sold"
          className="text-[11px] font-semibold tracking-[0.14em] text-fg3 uppercase"
        >
          {t('owner.sold')}
        </p>
        <div className="flex items-baseline justify-between gap-3">
          <p
            className="font-numeric text-[2.4rem] leading-tight font-bold text-fg1"
            data-testid="companion-sold-total"
          >
            {formatCurrency(today.sales.total)}
          </p>
          {change !== null && (
            <p
              className={cn(
                'shrink-0 text-sm font-bold',
                change >= 0 ? 'text-success-700' : 'text-danger-700'
              )}
              data-testid="companion-sold-change"
            >
              <span aria-hidden="true">
                {change >= 0 ? '▲' : '▼'} {Math.abs(change)} %
              </span>
              <span className="sr-only">
                {t(change >= 0 ? 'owner.changeUp' : 'owner.changeDown', {
                  percent: Math.abs(change),
                  weekday,
                })}
              </span>
            </p>
          )}
        </div>
        <CompanionSalesCurve
          hourly={today.hourly}
          dayStartIso={today.dayStartIso}
          generatedAt={today.generatedAt}
          formatTime={formatTime}
          caption={t('owner.salesCount', { count: today.sales.orders })}
        />
      </section>

      {mine ? (
        <section aria-labelledby="companion-your-call" data-testid="companion-your-call">
          <div className="flex items-center justify-between gap-3">
            <h2
              id="companion-your-call"
              className="flex items-center gap-2 text-[15px] font-semibold text-fg1"
            >
              <SeverityMark severity="blocks" size={14} />
              {t('owner.yourCall')}
            </h2>
            <p className="text-[13px] text-fg3">{ago(mine.requestedAt, today.generatedAt, t)}</p>
          </div>
          <div className="mt-2 rounded-[18px] border-2 border-danger-500 bg-surface p-4">
            <p className="text-[17px] leading-snug font-semibold text-fg1">
              {t('owner.waiting', { what: approvalWhat(mine, t) })}
            </p>
            <p className="mt-1 text-[13px] text-fg3">{approvalDetail(mine, t)}</p>
            <Link
              to={decideHref(mine.id)}
              className="btn-primary mt-3 flex h-12 w-full items-center justify-center rounded-xl text-base"
              data-testid="companion-decide-open"
            >
              {t('owner.decide')}
            </Link>
          </div>
          {moreMine.length > 0 && (
            <Link
              to={decideHref(moreMine[0]!.id)}
              className="mt-2 flex min-h-11 items-center justify-between gap-3 text-sm text-fg2"
              data-testid="companion-more-approvals"
            >
              {t('owner.moreApprovals', { count: moreMine.length })}
              <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </Link>
          )}
        </section>
      ) : (
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

type Translate = ReturnType<typeof useTranslation>['t'];

/** What is asked: "12 % a Restaurante El Fogón", the share alone, or the clipped reason. */
function approvalWhatDetail(item: QueueItem, t: Translate): string {
  const share = requestedPercent(item);
  const customer = item.decisionContext?.customer?.name;
  if (share && customer) return t('companion:owner.discountTo', { percent: share, customer });
  return share ?? clip(item.reason, REASON_MAX);
}

/** "12 % a Restaurante El Fogón · lo pide Marta Ríos". */
function approvalDetail(item: QueueItem, t: Translate): string {
  return [
    approvalWhatDetail(item, t),
    t('companion:owner.requestedBy', { name: item.requesterName }),
  ].join(' · ');
}
