import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { Button, StatusStrip } from '@/components/ui';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { formatAttendanceDateTime, formatDuration } from './attendanceFormat';
import { addCalendarDays, calendarDateAt, startOfWeek } from './scheduleDate';
import type {
  OperationalLaborCostReport,
  PlanActualCursor,
  PlanActualRow,
} from './planActualTypes';

const HISTORY_DAYS = 366;
const FUTURE_DAYS = 120;

export function PlanActualPanel() {
  const { t, i18n } = useTranslation(['schedule', 'errors']);
  const locale = useResolvedLocale();
  const toast = useToast();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const contextQuery = trpc.employeeShifts.schedule.context.useQuery();
  const context = contextQuery.data;
  const today = calendarDateAt(new Date(), context?.timeZone ?? locale.timezone);
  const [weekAnchor, setWeekAnchor] = useState<string | null>(null);
  const [siteId, setSiteId] = useState('');
  const [userId, setUserId] = useState('');
  const [cursors, setCursors] = useState<PlanActualCursor[]>([]);
  const [editing, setEditing] = useState<PlanActualRow | null>(null);
  const firstDayOfWeek = context?.firstDayOfWeek ?? locale.firstDayOfWeek;
  const weekStart = startOfWeek(weekAnchor ?? today, firstDayOfWeek);
  const weekEnd = addCalendarDays(weekStart, 7);
  const oldestStart = startOfWeek(addCalendarDays(today, -HISTORY_DAYS), firstDayOfWeek);
  const newestStart = startOfWeek(addCalendarDays(today, FUTURE_DAYS), firstDayOfWeek);
  const cursor = cursors.at(-1);
  const query = trpc.employeeShifts.attendance.planActual.list.useQuery(
    {
      fromDate: weekStart,
      toDate: weekEnd,
      limit: 20,
      ...(siteId ? { siteId } : {}),
      ...(userId ? { userId } : {}),
      ...(cursor ? { cursor } : {}),
    },
    { enabled: contextQuery.isSuccess, staleTime: 0 }
  );
  const costs = trpc.employeeShifts.attendance.costs.useQuery(
    {
      fromDate: weekStart,
      toDate: weekEnd,
      ...(siteId ? { siteId } : {}),
      ...(userId ? { userId } : {}),
    },
    { enabled: user?.role === 'admin', staleTime: 0 }
  );
  const activeLocale = i18n.resolvedLanguage ?? i18n.language;
  const dateRange = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(activeLocale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
    return `${formatter.format(new Date(`${weekStart}T12:00:00.000Z`))} – ${formatter.format(
      new Date(`${addCalendarDays(weekEnd, -1)}T12:00:00.000Z`)
    )}`;
  }, [activeLocale, weekEnd, weekStart]);
  const resetPage = () => setCursors([]);
  const refresh = async () => {
    resetPage();
    await Promise.all([
      utils.employeeShifts.attendance.planActual.invalidate(),
      // Reconciliation freezes the matching planned shift. The application-wide
      // five-minute query freshness window must not leave destructive schedule
      // actions visible after this command commits.
      utils.employeeShifts.schedule.list.invalidate(),
    ]);
  };

  return (
    <section className="space-y-5" data-testid="plan-actual-panel">
      <header>
        <p className="pv-kicker">{t('schedule:planActual.kicker')}</p>
        <h1 className="pv-title text-2xl">{t('schedule:planActual.title')}</h1>
        <p className="mt-2 max-w-3xl text-sm text-secondary-600">
          {t('schedule:planActual.description')}
        </p>
      </header>

      <StatusStrip tone="info" title={t('schedule:planActual.noticeTitle')}>
        {t('schedule:planActual.notice')}
      </StatusStrip>

      {user?.role === 'admin' && (
        <LaborCostSummary report={costs.data} loading={costs.isPending} error={costs.error} />
      )}

      <div className="card space-y-4 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-secondary-950">{dateRange}</p>
            <div className="mt-2 flex gap-2">
              <Button
                variant="outline"
                size="compact"
                aria-label={t('schedule:planActual.previousWeek')}
                disabled={weekStart <= oldestStart}
                onClick={() => {
                  setWeekAnchor(addCalendarDays(weekStart, -7));
                  resetPage();
                }}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="compact"
                onClick={() => {
                  setWeekAnchor(null);
                  resetPage();
                }}
              >
                {t('schedule:actions.today')}
              </Button>
              <Button
                variant="outline"
                size="compact"
                aria-label={t('schedule:planActual.nextWeek')}
                disabled={weekStart >= newestStart}
                onClick={() => {
                  setWeekAnchor(addCalendarDays(weekStart, 7));
                  resetPage();
                }}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="compact"
                disabled={query.isFetching}
                onClick={() => void refresh()}
              >
                <RefreshCw className={query.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
                {t('schedule:actions.refresh')}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <label>
              <span className="label">{t('schedule:filters.site')}</span>
              <select
                className="input"
                value={siteId}
                onChange={event => {
                  setSiteId(event.target.value);
                  resetPage();
                }}
              >
                <option value="">{t('schedule:filters.allSites')}</option>
                {context?.sites.map(site => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">{t('schedule:planActual.employee')}</span>
              <select
                className="input"
                value={userId}
                onChange={event => {
                  setUserId(event.target.value);
                  resetPage();
                }}
              >
                <option value="">{t('schedule:planActual.allEmployees')}</option>
                {context?.employees.map(employee => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      {(contextQuery.isPending || query.isPending) && (
        <p role="status">{t('schedule:planActual.loading')}</p>
      )}
      {(contextQuery.error || query.error) && (
        <StatusStrip
          tone="danger"
          icon={AlertTriangle}
          role="alert"
          title={translateServerError(
            contextQuery.error ?? query.error,
            t,
            t('schedule:planActual.loadError')
          )}
        />
      )}
      {!query.isPending && !query.error && query.data?.items.length === 0 && (
        <p className="card p-5 text-sm text-secondary-600">{t('schedule:planActual.empty')}</p>
      )}
      {!query.error && (
        <ul className="space-y-3">
          {query.data?.items.map(row => (
            <PlanActualCard
              key={row.scheduledShiftId}
              row={row}
              locale={activeLocale}
              onReview={() => setEditing(row)}
            />
          ))}
        </ul>
      )}
      <nav className="flex gap-3" aria-label={t('schedule:planActual.pages')}>
        <Button
          variant="outline"
          disabled={!cursors.length || query.isFetching}
          onClick={() => setCursors(previous => previous.slice(0, -1))}
        >
          {t('schedule:planActual.previousPage')}
        </Button>
        <Button
          variant="outline"
          disabled={!query.data?.nextCursor || query.isFetching || !!query.error}
          onClick={() => {
            if (query.data?.nextCursor)
              setCursors(previous => [...previous, query.data!.nextCursor!]);
          }}
        >
          {t('schedule:planActual.nextPage')}
        </Button>
      </nav>
      {editing && (
        <ReconciliationDialog
          key={`${editing.scheduledShiftId}:${editing.reconciliation?.version ?? 0}`}
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
            toast.success({ title: t('schedule:planActual.saved') });
          }}
        />
      )}
    </section>
  );
}

function LaborCostSummary({
  report,
  loading,
  error,
}: {
  report: OperationalLaborCostReport | undefined;
  loading: boolean;
  error: unknown;
}) {
  const { t, i18n } = useTranslation(['schedule', 'errors']);
  if (loading) return <p role="status">{t('schedule:planActual.cost.loading')}</p>;
  if (error)
    return (
      <StatusStrip tone="danger" role="alert" title={t('schedule:planActual.cost.error')}>
        {translateServerError(error, t, t('schedule:planActual.cost.error'))}
      </StatusStrip>
    );
  if (!report) return null;
  const activeLocale = i18n.resolvedLanguage ?? i18n.language;
  return (
    <section className="card space-y-3 p-4" aria-labelledby="labor-cost-title">
      <div>
        <h2 id="labor-cost-title" className="font-semibold text-secondary-950">
          {t('schedule:planActual.cost.title')}
        </h2>
        <p className="mt-1 text-xs text-secondary-600">
          {t('schedule:planActual.cost.description')}
        </p>
      </div>
      <div className="flex flex-wrap gap-4">
        {report.totals.length === 0 && report.pricedSeconds === 0 ? (
          <strong>{t('schedule:planActual.cost.noPricedTime')}</strong>
        ) : (
          report.totals.map(total => (
            <strong key={total.currencyCode}>
              {new Intl.NumberFormat(activeLocale, {
                style: 'currency',
                currency: total.currencyCode,
              }).format(total.amount)}
            </strong>
          ))
        )}
        <span className="text-sm text-secondary-600">
          {t('schedule:planActual.cost.priced', {
            duration: formatDuration(report.pricedSeconds),
          })}
        </span>
        {report.unavailableSeconds > 0 && (
          <span className="text-sm font-medium text-warning-800">
            {t('schedule:planActual.cost.unavailable', {
              duration: formatDuration(report.unavailableSeconds),
            })}
          </span>
        )}
      </div>
      {report.unavailableTotalCurrencies.length > 0 && (
        <p className="text-sm font-medium text-danger-800" role="alert">
          {t('schedule:planActual.cost.unsafeTotal', {
            currencies: report.unavailableTotalCurrencies.join(', '),
          })}
        </p>
      )}
    </section>
  );
}

function PlanActualCard({
  row,
  locale,
  onReview,
}: {
  row: PlanActualRow;
  locale: string;
  onReview: () => void;
}) {
  const { t } = useTranslation('schedule');
  const actual = row.actual;
  return (
    <li
      className="rounded-2xl border border-line bg-surface p-4"
      data-testid={`plan-actual-${row.scheduledShiftId}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-semibold text-secondary-950">{row.userName}</h2>
          <p className="mt-1 text-sm text-secondary-600">
            {row.plannedSiteName} ·{' '}
            {formatAttendanceDateTime(row.plannedStartsAt, row.plannedTimeZone, locale)}
          </p>
        </div>
        <span className="w-fit rounded-full bg-secondary-100 px-2.5 py-1 text-xs font-semibold text-secondary-800">
          {t(`planActual.states.${row.state}`)}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label={t('planActual.planned')} value={formatDuration(row.plannedSeconds)} />
        <Metric
          label={t('planActual.worked')}
          value={actual ? formatDuration(actual.workedSeconds) : t('planActual.notAvailable')}
        />
        <Metric
          label={t('planActual.breaks')}
          value={actual ? formatDuration(actual.breakSeconds) : t('planActual.notAvailable')}
        />
        <Metric
          label={t('planActual.lateness')}
          value={actual ? formatDuration(actual.lateSeconds) : t('planActual.notAvailable')}
        />
        <Metric
          label={t('planActual.variance')}
          value={actual ? signedDuration(actual.varianceSeconds) : t('planActual.notAvailable')}
        />
      </dl>
      {actual?.siteMismatch && (
        <p className="mt-3 text-xs font-medium text-warning-800">
          {t('planActual.siteMismatch', { site: actual.siteName })}
        </p>
      )}
      {actual?.correctionVersion && (
        <p className="mt-2 text-xs text-secondary-600">
          {t('planActual.corrected', { version: actual.correctionVersion })}
        </p>
      )}
      <Button className="mt-4" variant="outline" onClick={onReview}>
        <Scale aria-hidden="true" />
        {row.reconciliation ? t('planActual.revise') : t('planActual.review')}
      </Button>
    </li>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-secondary-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-secondary-950">{value}</dd>
    </div>
  );
}

function signedDuration(seconds: number) {
  return `${seconds > 0 ? '+' : seconds < 0 ? '−' : ''}${formatDuration(Math.abs(seconds))}`;
}

function ReconciliationDialog({
  row,
  onClose,
  onSaved,
}: {
  row: PlanActualRow;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation(['schedule', 'errors']);
  const locale = useResolvedLocale();
  const [outcome, setOutcome] = useState<'attended' | 'no_show'>(
    row.reconciliation?.outcome ?? 'attended'
  );
  const [employeeShiftId, setEmployeeShiftId] = useState(row.actual?.id ?? '');
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<unknown>(null);
  const candidates = trpc.employeeShifts.attendance.planActual.candidates.useQuery(
    { scheduledShiftId: row.scheduledShiftId },
    { enabled: outcome === 'attended' }
  );
  const save = useCriticalMutation('employeeShifts.attendance.planActual.record');
  const canSave =
    reason.trim().length >= 10 && (outcome === 'no_show' || employeeShiftId.length > 0);
  const submit = async () => {
    if (!canSave || save.isPending) return;
    setFailure(null);
    try {
      const common = {
        scheduledShiftId: row.scheduledShiftId,
        scheduledShiftVersion: row.scheduledShiftVersion,
        expectedVersion: row.reconciliation?.version ?? 0,
        reason: reason.trim(),
      };
      if (outcome === 'attended') {
        await save.mutateAsync({ ...common, outcome, employeeShiftId });
      } else {
        await save.mutateAsync({ ...common, outcome, employeeShiftId: null });
      }
      await onSaved();
    } catch (error) {
      setFailure(error);
    }
  };
  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('schedule:planActual.dialog.title', { employee: row.userName })}
      footer={
        <>
          <ModalButton onClick={onClose}>{t('schedule:planActual.dialog.cancel')}</ModalButton>
          <ModalButton
            variant="primary"
            disabled={!canSave || save.isPending}
            onClick={() => void submit()}
          >
            {save.isPending
              ? t('schedule:planActual.dialog.saving')
              : t('schedule:planActual.dialog.save')}
          </ModalButton>
        </>
      }
    >
      <p className="text-sm text-secondary-600">{t('schedule:planActual.dialog.notice')}</p>
      <fieldset className="mt-4 space-y-2">
        <legend className="label">{t('schedule:planActual.dialog.outcome')}</legend>
        {(['attended', 'no_show'] as const).map(value => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="reconciliation-outcome"
              value={value}
              checked={outcome === value}
              disabled={value === 'no_show' && !row.canConfirmNoShow}
              onChange={() => setOutcome(value)}
            />
            {t(`schedule:planActual.dialog.outcomes.${value}`)}
          </label>
        ))}
      </fieldset>
      {!row.canConfirmNoShow && (
        <p className="mt-2 text-xs text-secondary-600">
          {t('schedule:planActual.dialog.noShowAfterEnd')}
        </p>
      )}
      {outcome === 'attended' && (
        <label className="mt-4 block">
          <span className="label">{t('schedule:planActual.dialog.attendance')}</span>
          <select
            className="input"
            value={employeeShiftId}
            disabled={candidates.isPending || !!candidates.error}
            onChange={event => setEmployeeShiftId(event.target.value)}
          >
            <option value="">{t('schedule:planActual.dialog.selectAttendance')}</option>
            {candidates.data?.map(candidate => (
              <option key={candidate.id} value={candidate.id}>
                {formatAttendanceDateTime(
                  candidate.clockedInAt,
                  row.plannedTimeZone,
                  locale.locale
                )}{' '}
                · {candidate.siteName}
              </option>
            ))}
          </select>
          {candidates.isPending && (
            <span role="status">{t('schedule:planActual.dialog.loading')}</span>
          )}
          {candidates.error && (
            <span role="alert" className="text-danger-700">
              {translateServerError(candidates.error, t, t('schedule:planActual.dialog.loadError'))}
            </span>
          )}
        </label>
      )}
      <label className="mt-4 block">
        <span className="label">{t('schedule:planActual.dialog.reason')}</span>
        <textarea
          className="input min-h-24"
          value={reason}
          maxLength={500}
          onChange={event => setReason(event.target.value)}
          placeholder={t('schedule:planActual.dialog.reasonPlaceholder')}
        />
        {reason.length > 0 && reason.trim().length < 10 && (
          <span className="text-xs text-danger-700">
            {t('schedule:planActual.dialog.reasonMinimum')}
          </span>
        )}
      </label>
      {Boolean(failure) && (
        <p role="alert" className="mt-4 text-sm text-danger-700">
          {translateServerError(failure, t, t('schedule:planActual.saveError'))}
        </p>
      )}
    </Modal>
  );
}
