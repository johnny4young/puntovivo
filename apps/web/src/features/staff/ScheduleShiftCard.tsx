import { Ban, MapPin, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatShiftTime } from './scheduleDate';
import type { ScheduledShift } from './scheduleTypes';

interface ScheduleShiftCardProps {
  shift: ScheduledShift;
  dateLabel: string;
  locale: string;
  onEdit: (shift: ScheduledShift) => void;
  onCancel: (shift: ScheduledShift) => void;
}

/** ENG-140a — dense weekly-card presentation with full accessible labels. */
export function ScheduleShiftCard({
  shift,
  dateLabel,
  locale,
  onEdit,
  onCancel,
}: ScheduleShiftCardProps) {
  const { t } = useTranslation('schedule');
  const startTime = formatShiftTime(shift.startsAt, shift.timeZone, locale);
  const endTime = formatShiftTime(shift.endsAt, shift.timeZone, locale);
  const time = t('week.hours', { start: startTime, end: endTime });
  const cancelled = shift.status === 'cancelled';

  return (
    <article
      className={`rounded-xl border bg-surface p-3 shadow-sm ${
        cancelled ? 'border-secondary-200 opacity-60' : 'border-primary-100'
      }`}
      data-testid={`scheduled-shift-${shift.id}`}
    >
      <div className="flex items-start justify-between gap-2 xl:block 2xl:flex">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-secondary-950" title={shift.userName}>
            {shift.userName}
          </p>
          <p className="mt-1 text-xs font-medium tabular-nums text-primary-700" title={time}>
            <span className="whitespace-nowrap">{startTime}</span>
            <span className="whitespace-nowrap xl:block 2xl:inline">–{endTime}</span>
          </p>
        </div>
        {!cancelled && (
          <div className="flex shrink-0 gap-1 xl:mt-2 2xl:mt-0">
            <button
              type="button"
              className="btn-ghost btn-icon h-7 w-7"
              aria-label={t('actions.editLabel', {
                employee: shift.userName,
                date: dateLabel,
              })}
              onClick={() => onEdit(shift)}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn-ghost btn-icon h-7 w-7 text-danger-600"
              aria-label={t('actions.cancelLabel', {
                employee: shift.userName,
                date: dateLabel,
              })}
              onClick={() => onCancel(shift)}
            >
              <Ban className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <p className="mt-2 flex items-center gap-1 text-xs text-secondary-500">
        <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{shift.siteName}</span>
      </p>
      {shift.notes && (
        <p className="mt-2 line-clamp-2 break-words text-xs text-secondary-500">
          {t('week.notes', { notes: shift.notes })}
        </p>
      )}
      {cancelled && (
        <span className="mt-2 inline-flex rounded-full bg-secondary-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-secondary-600">
          {t('week.cancelled')}
        </span>
      )}
    </article>
  );
}
