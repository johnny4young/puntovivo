import { lazy, Suspense, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Plus,
  RefreshCw,
  UsersRound,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { KpiTile, StatusStrip, Button } from '@/components/ui';
import { useToast } from '@/components/feedback/ToastProvider';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { translateServerError } from '@/lib/translateServerError';
import { ScheduleShiftCard } from './ScheduleShiftCard';
import { ScheduleShiftModal } from './ScheduleShiftModal';
import {
  addCalendarDays,
  calendarDateAt,
  formatShiftTime,
  startOfWeek,
  wallFieldsAt,
} from './scheduleDate';
import type { ScheduledShift, ScheduleFormValues } from './scheduleTypes';
const TeamAttendancePanel = lazy(() =>
  import('./TeamAttendancePanel').then(module => ({
    default: module.TeamAttendancePanel,
  }))
);
const EmploymentPanel = lazy(() =>
  import('./EmploymentPanel').then(module => ({ default: module.EmploymentPanel }))
);

const TimeOffPanel = lazy(() =>
  import('./TimeOffPanel').then(module => ({ default: module.TimeOffPanel }))
);

const AvailabilityPanel = lazy(() =>
  import('./AvailabilityPanel').then(module => ({ default: module.AvailabilityPanel }))
);
const SchedulePlansPanel = lazy(() =>
  import('./SchedulePlansPanel').then(module => ({ default: module.SchedulePlansPanel }))
);
const ShiftSwapManagerPanel = lazy(() =>
  import('./ShiftSwapManagerPanel').then(module => ({ default: module.ShiftSwapManagerPanel }))
);
const PlanActualPanel = lazy(() =>
  import('./PlanActualPanel').then(module => ({ default: module.PlanActualPanel }))
);

/** Employment administration is loaded only when requested, not during the weekly schedule boot. */
export function TeamSchedulePage() {
  const { t } = useTranslation('schedule');
  const [view, setView] = useState<
    'schedule' | 'planActual' | 'employment' | 'timeOff' | 'availability' | 'plans' | 'exchanges'
  >('schedule');
  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap gap-2" aria-label={t('views.label')}>
        <Button
          variant={view === 'schedule' ? 'primary' : 'outline'}
          aria-pressed={view === 'schedule'}
          onClick={() => setView('schedule')}
        >
          {t('views.schedule')}
        </Button>
        <Button
          variant={view === 'planActual' ? 'primary' : 'outline'}
          aria-pressed={view === 'planActual'}
          onClick={() => setView('planActual')}
        >
          {t('views.planActual')}
        </Button>
        <Button
          variant={view === 'employment' ? 'primary' : 'outline'}
          aria-pressed={view === 'employment'}
          onClick={() => setView('employment')}
        >
          {t('views.employment')}
        </Button>
        <Button
          variant={view === 'timeOff' ? 'primary' : 'outline'}
          aria-pressed={view === 'timeOff'}
          onClick={() => setView('timeOff')}
        >
          {t('views.timeOff')}
        </Button>
        <Button
          variant={view === 'availability' ? 'primary' : 'outline'}
          aria-pressed={view === 'availability'}
          onClick={() => setView('availability')}
        >
          {t('views.availability')}
        </Button>
        <Button
          variant={view === 'plans' ? 'primary' : 'outline'}
          aria-pressed={view === 'plans'}
          onClick={() => setView('plans')}
        >
          {t('views.plans')}
        </Button>
        <Button
          variant={view === 'exchanges' ? 'primary' : 'outline'}
          aria-pressed={view === 'exchanges'}
          onClick={() => setView('exchanges')}
        >
          {t('views.exchanges')}
        </Button>
      </nav>
      {view === 'schedule' ? (
        <WeeklySchedulePanel />
      ) : (
        <Suspense fallback={<p role="status">{t('loading')}</p>}>
          {view === 'employment' ? (
            <EmploymentPanel />
          ) : view === 'planActual' ? (
            <PlanActualPanel />
          ) : view === 'timeOff' ? (
            <TimeOffPanel />
          ) : view === 'availability' ? (
            <AvailabilityPanel />
          ) : view === 'plans' ? (
            <SchedulePlansPanel />
          ) : (
            <ShiftSwapManagerPanel />
          )}
        </Suspense>
      )}
    </div>
  );
}
function calendarDateValue(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}
function defaultFormValues(date: string, employeeId: string, siteId: string): ScheduleFormValues {
  return {
    userId: employeeId,
    siteId,
    startDate: date,
    startTime: '09:00',
    endDate: date,
    endTime: '17:00',
    notes: '',
  };
}
function editFormValues(shift: ScheduledShift): ScheduleFormValues {
  const start = wallFieldsAt(shift.startsAt, shift.timeZone);
  const end = wallFieldsAt(shift.endsAt, shift.timeZone);
  return {
    userId: shift.userId,
    siteId: shift.siteId,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    notes: shift.notes ?? '',
  };
}

/** responsive, tenant-timezone weekly schedule editor. */
function WeeklySchedulePanel() {
  const { t, i18n } = useTranslation(['schedule', 'errors', 'workforceErrors']);
  const locale = useResolvedLocale();
  const toast = useToast();
  const utils = trpc.useUtils();
  const contextQuery = trpc.employeeShifts.schedule.context.useQuery();
  const context = contextQuery.data;
  const activeLocale = i18n.resolvedLanguage ?? i18n.language;
  const today = calendarDateAt(new Date(), context?.timeZone ?? locale.timezone);
  const [weekAnchor, setWeekAnchor] = useState<string | null>(null);
  const [siteId, setSiteId] = useState('');
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [editingShift, setEditingShift] = useState<ScheduledShift | null>(null);
  const [formDate, setFormDate] = useState<string | null>(null);
  const [cancelShift, setCancelShift] = useState<ScheduledShift | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [cancelError, setCancelError] = useState<unknown>(null);
  const firstDayOfWeek = context?.firstDayOfWeek ?? locale.firstDayOfWeek;
  const weekStart = startOfWeek(weekAnchor ?? today, firstDayOfWeek);
  const weekEnd = addCalendarDays(weekStart, 7);
  const weekDays = Array.from(
    {
      length: 7,
    },
    (_, index) => addCalendarDays(weekStart, index)
  );
  const listInput = {
    fromDate: weekStart,
    toDate: weekEnd,
    includeCancelled,
    ...(siteId
      ? {
          siteId,
        }
      : {}),
  };
  const listQuery = trpc.employeeShifts.schedule.list.useQuery(listInput, {
    enabled: contextQuery.isSuccess,
  });
  const shifts = listQuery.data ?? [];
  const invalidateSchedule = async () => {
    await utils.employeeShifts.schedule.list.invalidate();
  };
  const createMutation = useCriticalMutation('employeeShifts.schedule.create', {
    onSuccess: async () => {
      await invalidateSchedule();
      setFormDate(null);
      toast.success({
        title: t('schedule:toast.created'),
      });
    },
    onError: setSaveError,
  });
  const updateMutation = useCriticalMutation('employeeShifts.schedule.update', {
    onSuccess: async () => {
      await invalidateSchedule();
      setEditingShift(null);
      toast.success({
        title: t('schedule:toast.updated'),
      });
    },
    onError: setSaveError,
  });
  const cancelMutation = useCriticalMutation('employeeShifts.schedule.cancel', {
    onSuccess: async () => {
      await invalidateSchedule();
      setCancelShift(null);
      toast.success({
        title: t('schedule:toast.cancelled'),
      });
    },
    onError: setCancelError,
  });
  const formatDate = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(activeLocale, {
      ...options,
      timeZone: 'UTC',
    }).format(calendarDateValue(date));
  const activeShifts = shifts.filter(shift => shift.status === 'scheduled');
  const plannedHours = activeShifts.reduce(
    (total, shift) => total + (Date.parse(shift.endsAt) - Date.parse(shift.startsAt)) / 3_600_000,
    0
  );
  const scheduledStaff = new Set(activeShifts.map(shift => shift.userId)).size;
  const number = new Intl.NumberFormat(activeLocale, {
    maximumFractionDigits: 1,
  });
  const employees = context?.employees ?? [];
  const sites = context?.sites ?? [];
  const canCreate = employees.length > 0 && sites.length > 0;
  const selectedCreateDate = formDate ?? weekStart;
  const initialValues = editingShift
    ? editFormValues(editingShift)
    : defaultFormValues(selectedCreateDate, employees[0]?.id ?? '', siteId || sites[0]?.id || '');
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDeciding = isSaving || cancelMutation.isPending;
  const openCreate = (date: string) => {
    if (isDeciding) return;
    setSaveError(null);
    setFormDate(date);
  };
  const openEdit = (shift: ScheduledShift) => {
    if (isDeciding) return;
    setSaveError(null);
    setEditingShift(shift);
  };
  const openCancel = (shift: ScheduledShift) => {
    if (isDeciding) return;
    setCancelError(null);
    setCancelShift(shift);
  };

  const submitForm = (values: ScheduleFormValues) => {
    if (isDeciding) return;
    setSaveError(null);
    const input = {
      ...values,
      notes: values.notes.trim() || null,
    };
    if (editingShift) {
      updateMutation.mutate({
        id: editingShift.id,
        version: editingShift.version,
        ...input,
      });
    } else {
      createMutation.mutate(input);
    }
  };
  const queryError = contextQuery.error ?? listQuery.error;
  return (
    <div className="space-y-6" data-testid="team-schedule-page">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="pv-kicker">{t('schedule:kicker')}</p>
          <h1 className="pv-title text-2xl">{t('schedule:title')}</h1>
          <p className="mt-2 max-w-3xl text-sm text-secondary-500">{t('schedule:description')}</p>
          {context && (
            <p className="mt-2 text-xs font-medium text-secondary-500">
              {t('schedule:timezone', {
                timeZone: context.timeZone,
              })}
            </p>
          )}
        </div>
        <Button
          type="button"
          className="justify-center"
          disabled={!canCreate || isDeciding}
          onClick={() => openCreate(weekStart)}
          variant="primary"
        >
          <Plus aria-hidden="true" />
          {t('schedule:actions.new')}
        </Button>
      </header>

      {queryError && (
        <StatusStrip
          tone="danger"
          icon={AlertTriangle}
          title={translateServerError(queryError, t, t('schedule:error'))}
          role="alert"
        />
      )}

      {(contextQuery.isPending || listQuery.isPending) && !queryError && (
        <div className="card p-8 text-center text-sm text-secondary-500" role="status">
          {t('schedule:loading')}
        </div>
      )}

      {context && !canCreate && (
        <EmptyState
          icon={CalendarDays}
          title={t('schedule:empty.noContextTitle')}
          description={t('schedule:empty.noContextDescription')}
        />
      )}

      {context && canCreate && (
        <>
          <section className="grid gap-3 sm:grid-cols-3" aria-label={t('schedule:title')}>
            <KpiTile
              icon={CalendarCheck2}
              label={t('schedule:summary.shifts')}
              value={number.format(activeShifts.length)}
              tone="primary"
            />
            <KpiTile
              icon={Clock3}
              label={t('schedule:summary.hours')}
              value={number.format(plannedHours)}
              tone="success"
            />
            <KpiTile
              icon={UsersRound}
              label={t('schedule:summary.staff')}
              value={number.format(scheduledStaff)}
              tone="ink"
            />
          </section>

          <section className="card space-y-4 p-4 sm:p-5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-sm font-semibold text-secondary-950">
                  {t('schedule:week.range', {
                    start: formatDate(weekStart, {
                      month: 'short',
                      day: 'numeric',
                    }),
                    end: formatDate(addCalendarDays(weekEnd, -1), {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    }),
                  })}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    aria-label={t('schedule:actions.previousWeek')}
                    onClick={() => setWeekAnchor(addCalendarDays(weekStart, -7))}
                    variant="outline"
                    size="compact"
                  >
                    <ChevronLeft aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setWeekAnchor(null)}
                    variant="outline"
                    size="compact"
                  >
                    {t('schedule:actions.today')}
                  </Button>
                  <Button
                    type="button"
                    aria-label={t('schedule:actions.nextWeek')}
                    onClick={() => setWeekAnchor(addCalendarDays(weekStart, 7))}
                    variant="outline"
                    size="compact"
                  >
                    <ChevronRight aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    disabled={listQuery.isFetching}
                    onClick={() => void listQuery.refetch()}
                    variant="ghost"
                    size="compact"
                  >
                    <RefreshCw
                      className={listQuery.isFetching ? 'animate-spin' : ''}
                      aria-hidden="true"
                    />
                    {t('schedule:actions.refresh')}
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="block min-w-52">
                  <span className="label">{t('schedule:filters.site')}</span>
                  <select
                    className="input mt-1"
                    value={siteId}
                    onChange={event => setSiteId(event.target.value)}
                  >
                    <option value="">{t('schedule:filters.allSites')}</option>
                    {sites.map(site => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-h-10 items-center gap-2 rounded-xl border border-secondary-200 px-3 text-sm text-secondary-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-secondary-300"
                    checked={includeCancelled}
                    onChange={event => setIncludeCancelled(event.target.checked)}
                  />
                  {t('schedule:filters.includeCancelled')}
                </label>
              </div>
            </div>

            <div
              className="grid gap-3 md:grid-cols-2 xl:grid-cols-7"
              data-testid="schedule-week-grid"
            >
              {weekDays.map(day => {
                const dayShifts = shifts.filter(
                  shift => wallFieldsAt(shift.startsAt, shift.timeZone).date === day
                );
                const dateLabel = formatDate(day, {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
                });
                const compactDateLabel = formatDate(day, {
                  weekday: 'short',
                  day: 'numeric',
                });
                return (
                  <section
                    key={day}
                    className={`min-w-0 rounded-2xl border p-3 ${day === today ? 'border-primary-300 bg-primary-50/60' : 'border-secondary-200 bg-secondary-50/50'}`}
                    data-schedule-day={day}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h2
                        className="truncate text-sm font-semibold capitalize text-secondary-950"
                        aria-label={dateLabel}
                        title={dateLabel}
                      >
                        <span className="xl:hidden">{dateLabel}</span>
                        <span className="hidden xl:inline" aria-hidden="true">
                          {compactDateLabel}
                        </span>
                      </h2>
                      <button
                        type="button"
                        className="btn-ghost btn-icon h-8 w-8 shrink-0"
                        aria-label={`${t('schedule:actions.new')} · ${dateLabel}`}
                        onClick={() => openCreate(day)}
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {dayShifts.length === 0 && (
                        <p className="rounded-xl border border-dashed border-secondary-200 px-2 py-4 text-center text-xs text-secondary-400">
                          {t('schedule:week.emptyDay')}
                        </p>
                      )}
                      {dayShifts.map(shift => (
                        <ScheduleShiftCard
                          key={shift.id}
                          shift={shift}
                          dateLabel={dateLabel}
                          locale={activeLocale}
                          onEdit={openEdit}
                          onCancel={openCancel}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </section>
        </>
      )}

      {context && canCreate && (
        <ScheduleShiftModal
          key={editingShift?.id ?? formDate ?? 'closed'}
          isOpen={Boolean(editingShift || formDate)}
          isSaving={isSaving}
          error={saveError ? translateServerError(saveError, t, t('errors:server.unknown')) : null}
          employees={employees}
          sites={sites}
          initialValues={initialValues}
          isEditing={Boolean(editingShift)}
          onClose={() => {
            if (isSaving) return;
            setEditingShift(null);
            setFormDate(null);
          }}
          onSubmit={submitForm}
        />
      )}

      {context && (
        <Suspense
          fallback={
            <section
              aria-busy="true"
              className="rounded-2xl border border-secondary-200 bg-surface p-5 text-sm text-secondary-500"
            >
              {t('schedule:attendance.loading')}
            </section>
          }
        >
          <TeamAttendancePanel
            key={`${weekStart}:${siteId}`}
            fromDate={weekStart}
            toDate={weekEnd}
            siteId={siteId}
            enabled={contextQuery.isSuccess}
          />
        </Suspense>
      )}

      <Modal
        isOpen={Boolean(cancelShift)}
        onClose={() => {
          if (!cancelMutation.isPending) setCancelShift(null);
        }}
        closeOnEsc={!cancelMutation.isPending}
        closeOnBackdrop={!cancelMutation.isPending}
        showCloseButton={!cancelMutation.isPending}
        title={t('schedule:cancelDialog.title')}
        size="sm"
        footer={
          <>
            <ModalButton onClick={() => setCancelShift(null)} disabled={cancelMutation.isPending}>
              {t('schedule:cancelDialog.keep')}
            </ModalButton>
            <ModalButton
              variant="danger"
              disabled={cancelMutation.isPending}
              onClick={() => {
                if (cancelShift && !cancelMutation.isPending) {
                  setCancelError(null);
                  cancelMutation.mutate({
                    id: cancelShift.id,
                    version: cancelShift.version,
                  });
                }
              }}
            >
              {t(
                cancelMutation.isPending
                  ? 'schedule:cancelDialog.cancelling'
                  : 'schedule:cancelDialog.confirm'
              )}
            </ModalButton>
          </>
        }
      >
        {Boolean(cancelError) && (
          <StatusStrip
            tone="danger"
            role="alert"
            className="mb-4"
            title={translateServerError(cancelError, t, t('errors:server.unknown'))}
          />
        )}
        {cancelShift && (
          <p className="text-sm text-secondary-600">
            {t('schedule:cancelDialog.description', {
              employee: cancelShift.userName,
              date: formatDate(wallFieldsAt(cancelShift.startsAt, cancelShift.timeZone).date, {
                dateStyle: 'medium',
              }),
              time: t('schedule:week.hours', {
                start: formatShiftTime(cancelShift.startsAt, cancelShift.timeZone, activeLocale),
                end: formatShiftTime(cancelShift.endsAt, cancelShift.timeZone, activeLocale),
              }),
            })}
          </p>
        )}
      </Modal>
    </div>
  );
}
