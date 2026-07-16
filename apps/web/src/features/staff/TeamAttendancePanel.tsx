import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import {
  ChevronLeft,
  ChevronRight,
  History,
  Info,
  PencilLine,
  RefreshCw,
  UsersRound,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import {
  AttendanceCorrectionModal,
  type AttendanceCorrectionFormValues,
} from './AttendanceCorrectionModal';
import {
  formatAttendanceDate,
  formatAttendanceDateTime,
  formatAttendanceTime,
  formatDuration,
} from './attendanceFormat';

export type AttendanceRow =
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
  onCorrect,
}: {
  row: AttendanceRow;
  timeZone: string;
  locale: string;
  observedAt: string;
  onCorrect: (row: AttendanceRow) => void;
}) {
  const { t } = useTranslation('schedule');
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyQuery = trpc.employeeShifts.attendance.corrections.list.useQuery(
    { employeeShiftId: row.id },
    { enabled: historyOpen && row.correction !== null }
  );
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
        <div className="flex flex-wrap items-center gap-2">
          {row.correction && (
            <span className="rounded-full bg-warning-100 px-2.5 py-1 text-xs font-semibold text-warning-900">
              {t('attendance.correction.badge', { version: row.correction.version })}
            </span>
          )}
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
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
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
        <div>
          <dt className="text-xs text-secondary-500">{t('attendance.labels.regular')}</dt>
          <dd className="mt-1 text-sm font-semibold text-secondary-900">
            {row.overtime
              ? formatDuration(row.overtime.regularSeconds)
              : t('attendance.labels.notClassified')}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-secondary-500">{t('attendance.labels.overtime')}</dt>
          <dd
            className={`mt-1 text-sm font-semibold ${
              row.overtime && row.overtime.overtimeSeconds > 0
                ? 'text-warning-800'
                : 'text-secondary-900'
            }`}
          >
            {row.overtime
              ? formatDuration(row.overtime.overtimeSeconds)
              : t('attendance.labels.notClassified')}
          </dd>
        </div>
      </dl>

      {row.overtime && row.overtime.premiums.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" data-testid="attendance-premiums">
          {row.overtime.premiums.map(premium => (
            <span
              key={premium.code}
              className="rounded-full bg-warning-100 px-2.5 py-1 text-xs font-semibold text-warning-900"
            >
              {t(`attendance.premiums.${premium.code}`, {
                duration: formatDuration(premium.seconds),
                multiplier: premium.multiplier,
              })}
            </span>
          ))}
        </div>
      )}

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

      <div className="mt-4 flex flex-wrap gap-2 border-t border-secondary-200 pt-3">
        {row.status === 'closed' && row.clockedOutAt && (
          <button type="button" className="pv-btn outline compact" onClick={() => onCorrect(row)}>
            <PencilLine aria-hidden="true" />
            {t('attendance.correction.action')}
          </button>
        )}
        {row.correction && (
          <button
            type="button"
            className="pv-btn ghost compact"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen(value => !value)}
          >
            <History aria-hidden="true" />
            {t('attendance.correction.historyAction')}
          </button>
        )}
      </div>

      {row.correction && (
        <div className="mt-3 rounded-xl bg-warning-50 p-3 text-xs text-warning-950">
          <p className="font-semibold">
            {t('attendance.correction.latestBy', {
              author: row.correction.createdByName,
              date: formatAttendanceDateTime(row.correction.createdAt, timeZone, locale),
            })}
          </p>
          <p className="mt-1">{row.correction.reason}</p>
          <p className="mt-2 text-warning-800">
            {t('attendance.correction.originalWindow', {
              start: formatAttendanceDateTime(row.original.clockedInAt, timeZone, locale),
              end: row.original.clockedOutAt
                ? formatAttendanceDateTime(row.original.clockedOutAt, timeZone, locale)
                : t('attendance.labels.inProgress'),
            })}
          </p>
        </div>
      )}

      {historyOpen && row.correction && (
        <div className="mt-3 rounded-xl border border-secondary-200 bg-surface p-3">
          <p className="text-xs font-semibold text-secondary-900">
            {t('attendance.correction.historyTitle')}
          </p>
          {historyQuery.isPending ? (
            <p className="mt-2 text-xs text-secondary-500" role="status">
              {t('attendance.correction.historyLoading')}
            </p>
          ) : historyQuery.error ? (
            <p className="mt-2 text-xs text-danger-700" role="alert">
              {translateServerError(historyQuery.error, t, t('attendance.correction.historyError'))}
            </p>
          ) : (
            <ol className="mt-2 space-y-2">
              {(historyQuery.data ?? []).map(item => (
                <li key={item.id} className="text-xs text-secondary-700">
                  <span className="font-semibold">
                    {t('attendance.correction.historyVersion', {
                      version: item.version,
                      author: item.createdByName,
                    })}
                  </span>{' '}
                  · {item.reason}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </article>
  );
}

/** ENG-140b/c — manager evidence plus advisory country overtime classification. */
export function TeamAttendancePanel({
  fromDate,
  toDate,
  siteId,
  enabled,
}: TeamAttendancePanelProps) {
  const { t, i18n } = useTranslation(['schedule', 'common', 'errors']);
  const locale = useResolvedLocale();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [correctingRow, setCorrectingRow] = useState<AttendanceRow | null>(null);
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
  const policy = result?.overtimePolicy;
  const correctionMutation = useCriticalMutation('employeeShifts.attendance.corrections.create', {
    onSuccess: async () => {
      await utils.employeeShifts.attendance.list.invalidate();
      setCorrectingRow(null);
      toast.success({ title: t('schedule:attendance.correction.saved') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'schedule:attendance.correction.saveError',
    }),
  });

  const submitCorrection = (values: AttendanceCorrectionFormValues) => {
    if (!correctingRow) return;
    correctionMutation.mutate({
      employeeShiftId: correctingRow.id,
      expectedVersion: correctingRow.correction?.version ?? 0,
      ...values,
      reason: values.reason.trim(),
    });
  };

  return (
    <>
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

        {policy && (
          <div className="pv-strip info" role="status" data-testid="overtime-policy">
            <Info className="ic" aria-hidden="true" />
            <div className="msg space-y-1">
              <p className="font-semibold">
                {policy.supported
                  ? t('schedule:attendance.policy.title', { countryCode: policy.countryCode })
                  : t('schedule:attendance.policy.unsupported', {
                      countryCode: policy.countryCode,
                    })}
              </p>
              {policy.supported && policy.profiles.length > 0 ? (
                <>
                  {policy.profiles.map(profile => (
                    <p key={profile.id}>
                      {profile.effectiveFrom
                        ? t('schedule:attendance.policy.baseline', {
                            hours: profile.weeklyRegularSeconds / 3_600,
                            date: formatAttendanceDate(profile.effectiveFrom, activeLocale),
                            policyId: profile.id,
                          })
                        : t('schedule:attendance.policy.baselineCurrent', {
                            hours: profile.weeklyRegularSeconds / 3_600,
                            policyId: profile.id,
                          })}
                    </p>
                  ))}
                  <p>{t('schedule:attendance.policy.advisory')}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {policy.sourceUrls.map((sourceUrl, index) => (
                      <a
                        key={sourceUrl}
                        className="font-semibold underline underline-offset-2"
                        href={sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('schedule:attendance.policy.source', { number: index + 1 })}
                      </a>
                    ))}
                  </div>
                </>
              ) : (
                <p>{t('schedule:attendance.policy.unsupportedDescription')}</p>
              )}
            </div>
          </div>
        )}

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
                onCorrect={setCorrectingRow}
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
      {correctingRow?.clockedOutAt && (
        <AttendanceCorrectionModal
          key={`${correctingRow.id}-${correctingRow.correction?.version ?? 0}`}
          isOpen
          isSaving={correctionMutation.isPending}
          employeeName={correctingRow.userName}
          clockedInAt={correctingRow.clockedInAt}
          clockedOutAt={correctingRow.clockedOutAt}
          breaks={correctingRow.breaks}
          timeZone={timeZone}
          onClose={() => setCorrectingRow(null)}
          onSubmit={submitCorrection}
        />
      )}
    </>
  );
}
