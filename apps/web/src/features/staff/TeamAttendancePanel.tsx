import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { ChevronLeft, ChevronRight, RefreshCw, UsersRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { formatAttendanceDateTime, formatAttendanceTime, formatDuration } from './attendanceFormat';

type AttendanceRow =
  inferRouterOutputs<AppRouter>['employeeShifts']['attendance']['list']['rows'][number];

interface TeamAttendancePanelProps {
  fromDate: string;
  toDate: string;
  siteId: string;
  enabled: boolean;
}

const PAGE_SIZE = 10;

function AttendanceCard({
  row,
  timeZone,
  locale,
  observedAt,
}: {
  row: AttendanceRow;
  timeZone: string;
  locale: string;
  observedAt: string;
}) {
  const { t } = useTranslation('schedule');
  return (
    <article
      className="rounded-2xl border border-secondary-200 bg-secondary-50/50 p-4"
      data-testid={`attendance-shift-${row.id}`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-secondary-950">{row.userName}</h3>
          <p className="mt-1 text-xs text-secondary-500">{row.siteName}</p>
        </div>
        <span
          className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${
            row.status === 'active'
              ? 'bg-success-100 text-success-800'
              : 'bg-secondary-100 text-secondary-700'
          }`}
        >
          {t(`attendance.status.${row.status}`)}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div>
          <dt className="text-xs text-secondary-500">{t('attendance.labels.clockedIn')}</dt>
          <dd className="mt-1 text-xs font-semibold text-secondary-900">
            {formatAttendanceDateTime(row.clockedInAt, timeZone, locale)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-secondary-500">{t('attendance.labels.clockedOut')}</dt>
          <dd className="mt-1 text-xs font-semibold text-secondary-900">
            {row.clockedOutAt
              ? formatAttendanceDateTime(row.clockedOutAt, timeZone, locale)
              : t('attendance.labels.inProgress')}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-secondary-500">{t('attendance.labels.worked')}</dt>
          <dd className="mt-1 text-sm font-semibold text-primary-800">
            {formatDuration(row.workedSeconds)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-secondary-500">{t('attendance.labels.breaks')}</dt>
          <dd className="mt-1 text-sm font-semibold text-secondary-900">
            {formatDuration(row.breakSeconds)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-secondary-500">{t('attendance.labels.elapsed')}</dt>
          <dd className="mt-1 text-sm font-semibold text-secondary-900">
            {formatDuration(row.elapsedSeconds)}
          </dd>
        </div>
      </dl>

      {row.breaks.length > 0 && (
        <details className="mt-4 border-t border-secondary-200 pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-secondary-700">
            {t('attendance.labels.breakDetails', { count: row.breaks.length })}
          </summary>
          <ul className="mt-2 space-y-2">
            {row.breaks.map(item => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2 text-xs text-secondary-700"
              >
                <span>
                  {formatAttendanceTime(item.startedAt, timeZone, locale)} –{' '}
                  {item.endedAt
                    ? formatAttendanceTime(item.endedAt, timeZone, locale)
                    : t('attendance.labels.activeBreak')}
                </span>
                <span className="font-semibold">
                  {formatDuration(
                    Math.max(
                      0,
                      (Date.parse(item.endedAt ?? row.clockedOutAt ?? observedAt) -
                        Date.parse(item.startedAt)) /
                        1_000
                    )
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

/** ENG-140b — manager/admin evidence of actual attendance and explicit breaks. */
export function TeamAttendancePanel({
  fromDate,
  toDate,
  siteId,
  enabled,
}: TeamAttendancePanelProps) {
  const { t, i18n } = useTranslation(['schedule', 'common', 'errors']);
  const locale = useResolvedLocale();
  const [page, setPage] = useState(1);
  const query = trpc.employeeShifts.attendance.list.useQuery(
    {
      fromDate,
      toDate,
      page,
      perPage: PAGE_SIZE,
      ...(siteId ? { siteId } : {}),
    },
    { enabled }
  );
  const result = query.data;
  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeLocale = i18n.resolvedLanguage ?? i18n.language;
  const timeZone = result?.timeZone ?? locale.timezone;
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <section className="card space-y-4 p-4 sm:p-5" data-testid="team-attendance-panel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="pv-kicker">{t('schedule:attendance.kicker')}</p>
          <h2 className="text-lg font-semibold text-secondary-950">
            {t('schedule:attendance.title')}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-secondary-500">
            {t('schedule:attendance.description')}
          </p>
          {result && (
            <p className="mt-2 text-xs font-medium text-secondary-500">
              {t('schedule:attendance.timezone', { timeZone })}
            </p>
          )}
        </div>
        <button
          type="button"
          className="pv-btn ghost compact self-start"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw className={query.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
          {t('common:actions.refresh')}
        </button>
      </div>

      {query.isPending ? (
        <div className="py-8 text-center text-sm text-secondary-500" role="status">
          {t('schedule:attendance.loading')}
        </div>
      ) : query.error ? (
        <div className="pv-strip danger" role="alert">
          <span className="msg">
            {translateServerError(query.error, t, t('schedule:attendance.error'))}
          </span>
          <button
            type="button"
            className="pv-btn outline compact"
            onClick={() => void query.refetch()}
          >
            {t('common:actions.retry')}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title={t('schedule:attendance.emptyTitle')}
          description={t('schedule:attendance.emptyDescription')}
        />
      ) : (
        <div className="space-y-3">
          {rows.map(row => (
            <AttendanceCard
              key={row.id}
              row={row}
              timeZone={timeZone}
              locale={activeLocale}
              observedAt={result?.generatedAt ?? row.clockedOutAt ?? row.clockedInAt}
            />
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <nav
          className="flex flex-col gap-3 border-t border-secondary-200 pt-4 sm:flex-row sm:items-center sm:justify-between"
          aria-label={t('common:pagination.navigation')}
        >
          <p className="text-xs text-secondary-500">
            {t('schedule:attendance.pagination', {
              from: rangeStart,
              to: rangeEnd,
              total,
            })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="pv-btn outline compact"
              aria-label={t('schedule:attendance.previous')}
              disabled={page <= 1 || query.isFetching}
              onClick={() => setPage(current => Math.max(1, current - 1))}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <span className="inline-flex min-w-16 items-center justify-center text-xs font-semibold text-secondary-700">
              {page} / {pages}
            </span>
            <button
              type="button"
              className="pv-btn outline compact"
              aria-label={t('schedule:attendance.next')}
              disabled={page >= pages || query.isFetching}
              onClick={() => setPage(current => Math.min(pages, current + 1))}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        </nav>
      )}
    </section>
  );
}
