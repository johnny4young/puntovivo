import { useMemo } from 'react';
import { ISO_DATE_ONLY_PATTERN } from '@puntovivo/shared/iso-date';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { DayArc } from '@/features/dashboard/close/DayArc';
import { SignaturePreview } from '@/features/dashboard/close/SignaturePreview';
import {
  closeProgress,
  fiscalInProgress,
  type CloseChecklist,
  type CloseSignoff,
} from '@/features/dashboard/close/closeModel';
import { trpc } from '@/lib/trpc';
import { dateTimeFormatter } from '@/lib/dateTimeFormatter';
import { cn, formatCurrency } from '@/lib/utils';
import { CompanionError, CompanionSkeleton } from './CompanionStatus';
import { capitalize, sealedDayDate } from './companionViews';

interface CompanionSealedDayProps {
  businessDay: string;
  requestedDate: string | null;
}

/** The signed day as the owner reads it at night: the figures, the differences and who signed. */
export function CompanionSealedDay({ businessDay, requestedDate }: CompanionSealedDayProps) {
  const { t } = useTranslation('companion');
  const explicit = requestedDate !== null && ISO_DATE_ONLY_PATTERN.test(requestedDate);
  const todaySigned = trpc.reports.dayClose.signoffMetadata.useQuery(
    { date: businessDay },
    { enabled: !explicit, staleTime: 60_000 }
  );
  const ready = explicit || todaySigned.isSuccess || todaySigned.isError;
  const date = sealedDayDate(requestedDate, businessDay, Boolean(todaySigned.data));
  // A past signed day cannot change; today's still moves until the day_close event.
  const staleTime = date < businessDay ? Infinity : 60_000;
  const signoffQuery = trpc.reports.dayClose.signoff.useQuery(
    { date },
    { enabled: ready, staleTime }
  );
  const checklistQuery = trpc.reports.dayClose.checklist.useQuery(
    { date },
    { enabled: ready, staleTime }
  );
  const curveQuery = trpc.operations.dayCurve.useQuery({ date }, { enabled: ready, staleTime });

  if (!ready || signoffQuery.isPending) return <CompanionSkeleton />;
  if (signoffQuery.isError) return <CompanionError message={t('day.unavailable')} />;
  if (!signoffQuery.data) return <UnsignedDay date={date} />;
  return (
    <SealedDay
      signoff={signoffQuery.data}
      checklist={checklistQuery.data ?? null}
      curve={curveQuery.data ?? null}
    />
  );
}

function dayParts(date: string, language: string) {
  // Noon UTC keeps the calendar day whatever the device's zone.
  const noon = new Date(`${date}T12:00:00.000Z`);
  const weekday = dateTimeFormatter(language, { weekday: 'long', timeZone: 'UTC' }).format(noon);
  const day = dateTimeFormatter(language, { day: 'numeric', timeZone: 'UTC' }).format(noon);
  return { weekday: capitalize(weekday, language), day };
}

function UnsignedDay({ date }: { date: string }) {
  const { t, i18n } = useTranslation('companion');
  return (
    <div className="space-y-4" data-testid="companion-day-unsigned">
      <h1 className="text-[1.6rem] leading-tight">
        {t('day.unsigned', dayParts(date, i18n.language))}
      </h1>
      <a
        href={`/?close=${date}`}
        className="btn-outline flex h-12 items-center justify-center gap-2 rounded-2xl"
        data-testid="companion-day-open-close"
      >
        {t('day.openClose')}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </a>
    </div>
  );
}

function SealedDay({
  signoff,
  checklist,
  curve,
}: {
  signoff: CloseSignoff;
  checklist: CloseChecklist | null;
  curve: { dayStartIso: string; hourly: Array<{ hour: number; revenue: number }> } | null;
}) {
  const { t, i18n } = useTranslation(['companion', 'dayCloseGuide']);
  const { report } = signoff;
  const money = (value: number) => formatCurrency(value, signoff.currencyCode);
  const time = dateTimeFormatter(i18n.language, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: signoff.timeZone,
  }).format(new Date(signoff.signedAt));
  const progress = useMemo(
    () => (checklist ? closeProgress(report, checklist, true) : null),
    [report, checklist]
  );
  const hourly = useMemo(
    () => curve?.hourly.map(row => ({ hour: row.hour, today: row.revenue })) ?? [],
    [curve]
  );
  const closedAt = useMemo(
    () => progress?.closedRegisters.flatMap(session => session.closedAt ?? []) ?? [],
    [progress]
  );
  const difference = report.cash.overShort;
  const differences = progress?.differences ?? [];
  const differenceDetail =
    differences.length === 0
      ? t('day.balanced')
      : differences.length === 1 && differences[0]!.differenceReason
        ? t('day.explained', {
            reason: t(`dayCloseGuide:difference.reasons.${differences[0]!.differenceReason}`),
          })
        : t('day.explainedMany', { count: differences.length });
  const inProgress = fiscalInProgress(report);
  const explained =
    progress !== null && differences.every(session => session.differenceReason !== null);

  return (
    // Tall enough that the full-day link sits just above the tab bar.
    <div
      className="flex min-h-[calc(100dvh-9.5rem)] flex-col gap-5"
      data-testid="companion-day-sealed"
    >
      <header>
        <p className="flex items-center gap-1.5 text-[13px] font-bold tracking-[0.04em] text-success-700 uppercase">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          {t('day.sealedAt', { time })}
        </p>
        <h1 className="mt-1 text-[1.75rem] leading-tight">
          {t('day.title', dayParts(signoff.date, i18n.language))}
        </h1>
      </header>

      <DayArc
        hourly={hourly}
        dayStartIso={curve?.dayStartIso ?? report.window.start}
        timeZone={report.timeZone}
        locale={i18n.language}
        marks={closedAt}
      >
        <span className="text-[11px] font-semibold tracking-[0.14em] text-fg3 uppercase">
          {t('day.sold')}
        </span>
        <span
          className="font-numeric text-[clamp(1.4rem,7.4vw,2.1rem)] leading-[1.05] font-extrabold whitespace-nowrap text-fg1"
          data-testid="companion-day-sold"
        >
          {money(report.sales.netRevenue)}
        </span>
        <span className="text-[12px] text-fg2">
          {t('dayCloseGuide:sold.count', { count: report.sales.count })}
        </span>
      </DayArc>

      <dl className="divide-y divide-line border-y border-line" data-testid="companion-day-figures">
        {progress && (
          <Figure
            title={t('day.cash')}
            detail={t('day.cashDetail', { count: progress.closedRegisters.length })}
            value={money(progress.cashToDeposit)}
            testId="companion-day-cash"
          />
        )}
        <Figure
          title={t('day.difference')}
          detail={progress ? differenceDetail : null}
          value={money(difference)}
          negative={difference < 0 && !explained}
          testId="companion-day-difference"
        />
        {report.fiscal.total > 0 && (
          <Figure
            title={t('day.fiscal')}
            detail={inProgress > 0 ? t('day.fiscalInProgress', { count: inProgress }) : null}
            value={t('day.fiscalValue', {
              accepted: report.fiscal.byStatus.accepted,
              total: report.fiscal.total,
            })}
            testId="companion-day-fiscal"
          />
        )}
      </dl>

      <section
        className="flex items-center gap-4 rounded-[18px] bg-surface-2 px-4 py-3"
        data-testid="companion-day-signer"
      >
        {signoff.signaturePath && (
          <SignaturePreview
            path={signoff.signaturePath}
            className="h-10 w-20 shrink-0"
            strokeWidth={7}
          />
        )}
        <p className="text-[15px] font-semibold text-fg1">
          {t('day.signedBy', { name: signoff.signedBy.name })}
        </p>
      </section>

      <a
        href={`/?close=${signoff.date}`}
        className="btn-outline mt-auto flex h-12 items-center justify-center gap-2 rounded-2xl"
        data-testid="companion-day-full"
      >
        {t('day.full')}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </a>
    </div>
  );
}

function Figure({
  title,
  detail,
  value,
  negative = false,
  testId,
}: {
  title: string;
  detail: string | null;
  value: string;
  negative?: boolean;
  testId: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3" data-testid={testId}>
      <div className="min-w-0">
        <dt className="text-[15px] font-semibold text-fg1">{title}</dt>
        {detail && <dd className="text-[13px] text-fg3">{detail}</dd>}
      </div>
      <dd
        className={cn(
          'font-numeric shrink-0 text-[17px] font-bold',
          negative ? 'text-danger-700' : 'text-fg1'
        )}
      >
        {value}
      </dd>
    </div>
  );
}
