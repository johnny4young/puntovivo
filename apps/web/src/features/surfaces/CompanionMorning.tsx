import { useId, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, Pause, Printer, type LucideIcon } from 'lucide-react';
import { SeverityMark } from '@/components/ui';
import {
  hourToIso,
  percentChange,
  type OperationsToday,
} from '@/features/dashboard/today/todayModel';
import { dateTimeFormatter } from '@/lib/dateTimeFormatter';
import { formatCurrency, formatCurrencyCompact } from '@/lib/utils';
import type { QueueItem } from './companionApproval';
import { CompanionLivePill } from './CompanionConnection';
import { CompanionFigureCard } from './CompanionFigureCard';
import {
  curvePeaks,
  floatSummary,
  greetingAt,
  groupBySite,
  openingIn,
  type Opening,
  type MorningRecap,
} from './morningModel';
import { CompanionSalesCurve } from './CompanionSalesCurve';
import { CompanionError, CompanionSkeleton } from './CompanionStatus';
import { CompanionYourCall } from './CompanionYourCall';
import type { LiveState } from './useCompanionLive';

// Sooner than this reads as a countdown; later, as a time.
const OPENS_SOON_MINUTES = 90;

interface CompanionMorningProps {
  today: OperationsToday;
  liveState: LiveState;
  recap: MorningRecap | undefined;
  recapFailed: boolean;
  queue: readonly QueueItem[] | null;
  queueFailed: boolean;
  formatTime: (iso: string) => string;
  formatLongDate: (iso: string) => string;
  formatWeekday: (iso: string) => string;
  decideHref: (requestId: string) => string;
}

/** Before the store opens: how yesterday ended, what to do before opening, what today should look like. */
export function CompanionMorning({
  today,
  liveState,
  recap,
  recapFailed,
  queue,
  queueFailed,
  formatTime,
  formatLongDate,
  formatWeekday,
  decideHref,
}: CompanionMorningProps) {
  const { t, i18n } = useTranslation('companion');
  const list = useMemo(
    () => new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' }),
    [i18n.language]
  );
  const peaks = curvePeaks(today.hourly.map(row => ({ hour: row.hour, value: row.comparison })));

  return (
    <div
      className="flex min-h-[calc(100dvh-9.5rem)] flex-col gap-5"
      data-testid="companion-morning"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-fg3">{formatLongDate(today.generatedAt)}</p>
          <h1 className="text-[1.9rem] leading-tight">
            {t(`morning.greeting.${greetingAt(today)}`)}
          </h1>
        </div>
        <CompanionLivePill liveState={liveState} />
      </header>

      {queue && (
        <CompanionYourCall items={queue} generatedAt={today.generatedAt} decideHref={decideHref} />
      )}
      {queueFailed && <CompanionError message={t('owner.queueUnavailable')} />}

      {recap ? (
        <>
          <Yesterday recap={recap} timeZone={today.timezone} formatWeekday={formatWeekday} />
          <BeforeOpening
            recap={recap}
            opening={openingIn(today)}
            formatTime={formatTime}
            list={list}
          />
        </>
      ) : recapFailed ? (
        <CompanionError message={t('morning.unavailable')} />
      ) : (
        <CompanionSkeleton />
      )}

      {today.sales.comparisonTotal > 0 && (
        <section
          className="mt-auto rounded-[20px] border border-dashed border-line-strong px-4 pt-3 pb-3"
          aria-labelledby="companion-expected"
          data-testid="companion-morning-expected"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 id="companion-expected" className="text-[13px] font-semibold text-fg1">
              {t('morning.expected')}
            </h2>
            <p className="text-[12px] text-fg3">
              {t('morning.expectedLike', {
                weekday: formatWeekday(today.generatedAt),
                amount: formatCurrencyCompact(today.sales.comparisonTotal),
              })}
            </p>
          </div>
          <CompanionSalesCurve
            hourly={today.hourly}
            dayStartIso={today.dayStartIso}
            live={{ generatedAt: today.generatedAt, formatTime }}
            caption={
              peaks.length > 0
                ? t('morning.peaks', {
                    count: peaks.length,
                    times: list.format(
                      peaks.map(hour => formatTime(hourToIso(hour, today.dayStartIso)))
                    ),
                  })
                : ''
            }
          />
        </section>
      )}
    </div>
  );
}

function Yesterday({
  recap,
  timeZone,
  formatWeekday,
}: {
  recap: MorningRecap;
  timeZone: string;
  formatWeekday: (iso: string) => string;
}) {
  const { t, i18n } = useTranslation('companion');
  const { yesterday, seal, fiscal, backup } = recap;

  const notes: string[] = [];
  let severity: 'ready' | 'beforeClose' | 'blocks' = 'ready';
  const raise = (to: 'beforeClose' | 'blocks') => {
    if (severity !== 'blocks') severity = to;
  };
  if (fiscal) {
    if (fiscal.accepted > 0) {
      notes.push(
        t(
          fiscal.inProgress === 0 && fiscal.rejected === 0
            ? 'morning.fiscalAcceptedAll'
            : 'morning.fiscalAccepted',
          { count: fiscal.accepted }
        )
      );
    }
    if (fiscal.inProgress > 0) {
      notes.push(t('morning.fiscalInProgress', { count: fiscal.inProgress }));
      raise('beforeClose');
    }
    if (fiscal.rejected > 0) {
      notes.push(t('morning.fiscalRejected', { count: fiscal.rejected }));
      raise('blocks');
    }
  }
  if (backup) {
    if (backup.state === 'ok') notes.push(t('morning.backupOk'));
    if (backup.state === 'failed') {
      notes.push(t('morning.backupFailed'));
      raise('blocks');
    }
    if (backup.state === 'late') {
      const date = dateTimeFormatter(i18n.language, {
        day: 'numeric',
        month: 'long',
        timeZone,
      }).format(new Date(backup.at));
      notes.push(t('morning.backupLate', { date }));
      raise('beforeClose');
    }
  }

  const notesLine = notes.length > 0 && (
    <p
      className="mt-2.5 flex items-start gap-2 text-[13px] text-fg2"
      data-testid="companion-morning-notes"
    >
      <span className="mt-0.5 shrink-0">
        <SeverityMark severity={severity} size={14} />
      </span>
      <span>{notes.join(' ')}</span>
    </p>
  );
  // A day without sales has no card, but a failed or late backup still needs saying.
  if (!seal && yesterday.total === 0) return notesLine || null;

  return (
    <CompanionFigureCard
      id="companion-morning-yesterday-title"
      kicker={t(seal ? 'morning.yesterdaySealed' : 'morning.yesterdayUnsigned')}
      total={formatCurrency(seal ? seal.netRevenue : yesterday.total)}
      change={percentChange(yesterday.total, yesterday.comparisonTotal)}
      weekday={formatWeekday(yesterday.dayStartIso)}
      testId="companion-morning-yesterday"
    >
      <CompanionSalesCurve
        hourly={yesterday.hourly.map(row => ({ hour: row.hour, today: row.revenue }))}
        dayStartIso={yesterday.dayStartIso}
        caption={seal ? t('owner.salesCount', { count: seal.salesCount }) : ''}
      />
      {notesLine}
    </CompanionFigureCard>
  );
}

function BeforeOpening({
  recap,
  opening,
  formatTime,
  list,
}: {
  recap: MorningRecap;
  opening: Opening | null;
  formatTime: (iso: string) => string;
  list: Intl.ListFormat;
}) {
  const { t } = useTranslation('companion');
  const groups = groupBySite(recap.registersToOpen);
  const rows: ReactNode[] = [];

  if (!recap.seal && recap.yesterday.total !== 0) {
    rows.push(
      <Row
        key="close"
        icon={ClipboardCheck}
        title={t('morning.closeYesterday')}
        action={t('morning.closeAction')}
        href={`/?close=${recap.date}`}
        testId="companion-morning-close"
      />
    );
  }
  for (const group of groups) {
    const summary = floatSummary(group);
    const detail = [
      groups.length > 1 ? group[0]!.siteName : null,
      summary
        ? t(`morning.float.${summary.kind}`, { amount: formatCurrency(summary.amount) })
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
    rows.push(
      <Row
        key={`open:${group[0]!.siteId}`}
        icon={Printer}
        title={t('morning.openRegisters', {
          registers: list.format(group.map(register => register.registerName)),
        })}
        detail={detail || null}
        action={t('morning.openAction')}
        href="/sales"
        testId="companion-morning-open"
      />
    );
  }
  for (const sale of recap.carriedSales) {
    rows.push(
      <Row
        key={sale.id}
        icon={Pause}
        title={`${sale.label ?? sale.saleNumber} · ${formatCurrency(sale.total)}`}
        detail={t('morning.carried')}
        action={t('morning.viewAction')}
        href="/sales"
        testId="companion-morning-carried"
      />
    );
  }

  const opens = !opening
    ? null
    : opening.minutes <= OPENS_SOON_MINUTES
      ? t('morning.opensIn', { minutes: opening.minutes })
      : t('morning.opensAt', { time: formatTime(opening.at) });

  return (
    <section aria-labelledby="companion-before-opening" data-testid="companion-before-opening">
      <div className="flex items-center justify-between gap-3">
        <h2
          id="companion-before-opening"
          className="flex items-center gap-2 text-[15px] font-semibold text-fg1"
        >
          <SeverityMark severity={rows.length > 0 ? 'beforeClose' : 'ready'} size={14} />
          {t('morning.beforeOpening')}
          {rows.length > 0 && <span className="font-normal text-fg3">{rows.length}</span>}
        </h2>
        {opens && (
          <p className="shrink-0 text-[13px] text-fg3" data-testid="companion-morning-opens">
            {opens}
          </p>
        )}
      </div>
      {rows.length > 0 ? (
        <ul className="mt-2 divide-y divide-line border-t border-line">{rows}</ul>
      ) : (
        <p className="mt-1 text-sm text-fg3" data-testid="companion-morning-ready">
          {t('morning.nothingBeforeOpening')}
        </p>
      )}
    </section>
  );
}

function Row({
  icon: Icon,
  title,
  detail = null,
  action,
  href,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  detail?: string | null;
  action: string;
  href: string;
  testId: string;
}) {
  const titleId = useId();
  return (
    <li className="flex items-center gap-3 py-2.5" data-testid={testId}>
      <Icon className="h-[18px] w-[18px] shrink-0 text-fg2" strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p id={titleId} className="text-[15px] leading-snug font-semibold text-fg1">
          {title}
        </p>
        {detail && <p className="text-[13px] text-fg3">{detail}</p>}
      </div>
      <a
        href={href}
        aria-describedby={titleId}
        className="btn-outline flex h-11 shrink-0 items-center rounded-xl px-4 text-sm"
      >
        {action}
      </a>
    </li>
  );
}
