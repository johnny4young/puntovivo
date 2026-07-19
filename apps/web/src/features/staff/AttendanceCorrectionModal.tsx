import { useFieldArray, useForm } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { wallFieldsAt } from './scheduleDate';

interface EffectiveBreak {
  id: string;
  startedAt: string;
  endedAt: string | null;
}

export interface AttendanceCorrectionFormValues {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  breaks: Array<{
    id?: string;
    startDate: string;
    startTime: string;
    endDate: string;
    endTime: string;
  }>;
  reason: string;
}

interface AttendanceCorrectionModalProps {
  isOpen: boolean;
  isSaving: boolean;
  employeeName: string;
  clockedInAt: string;
  clockedOutAt: string;
  breaks: EffectiveBreak[];
  timeZone: string;
  onClose: () => void;
  onSubmit: (values: AttendanceCorrectionFormValues) => void;
}

function defaultValues(
  clockedInAt: string,
  clockedOutAt: string,
  breaks: EffectiveBreak[],
  timeZone: string
): AttendanceCorrectionFormValues {
  const start = wallFieldsAt(clockedInAt, timeZone);
  const end = wallFieldsAt(clockedOutAt, timeZone);
  return {
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    breaks: breaks.flatMap(item => {
      if (!item.endedAt) return [];
      const breakStart = wallFieldsAt(item.startedAt, timeZone);
      const breakEnd = wallFieldsAt(item.endedAt, timeZone);
      return [
        {
          id: item.id,
          startDate: breakStart.date,
          startTime: breakStart.time,
          endDate: breakEnd.date,
          endTime: breakEnd.time,
        },
      ];
    }),
    reason: '',
  };
}

/** ENG-140e — author one complete effective snapshot while raw evidence stays immutable. */
export function AttendanceCorrectionModal({
  isOpen,
  isSaving,
  employeeName,
  clockedInAt,
  clockedOutAt,
  breaks,
  timeZone,
  onClose,
  onSubmit,
}: AttendanceCorrectionModalProps) {
  const { t } = useTranslation('schedule');
  const form = useForm<AttendanceCorrectionFormValues>({
    defaultValues: defaultValues(clockedInAt, clockedOutAt, breaks, timeZone),
  });
  const fields = useFieldArray({ control: form.control, name: 'breaks', keyName: 'fieldKey' });
  const required = t('attendance.correction.required');

  const addBreak = () => {
    const start = new Date(clockedInAt);
    start.setTime(start.getTime() + 60 * 60_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    const startFields = wallFieldsAt(start.toISOString(), timeZone);
    const endFields = wallFieldsAt(end.toISOString(), timeZone);
    fields.append({
      startDate: startFields.date,
      startTime: startFields.time,
      endDate: endFields.date,
      endTime: endFields.time,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('attendance.correction.title', { employee: employeeName })}
      size="lg"
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('attendance.correction.cancel')}
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={() => void form.handleSubmit(onSubmit)()}
            disabled={isSaving}
          >
            {t(isSaving ? 'attendance.correction.saving' : 'attendance.correction.save')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-5" onSubmit={event => void form.handleSubmit(onSubmit)(event)}>
        <div className="pv-strip info" role="note">
          <span className="msg">{t('attendance.correction.immutableNotice')}</span>
        </div>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-sm font-semibold text-secondary-950">
            {t('attendance.correction.shiftWindow')}
          </legend>
          <label className="block">
            <span className="label">{t('attendance.correction.startDate')}</span>
            <input
              type="date"
              className="input mt-1"
              {...form.register('startDate', { required })}
            />
          </label>
          <label className="block">
            <span className="label">{t('attendance.correction.startTime')}</span>
            <input
              type="time"
              className="input mt-1"
              {...form.register('startTime', { required })}
            />
          </label>
          <label className="block">
            <span className="label">{t('attendance.correction.endDate')}</span>
            <input type="date" className="input mt-1" {...form.register('endDate', { required })} />
          </label>
          <label className="block">
            <span className="label">{t('attendance.correction.endTime')}</span>
            <input type="time" className="input mt-1" {...form.register('endTime', { required })} />
          </label>
        </fieldset>

        <fieldset>
          <div className="flex items-center justify-between gap-3">
            <legend className="text-sm font-semibold text-secondary-950">
              {t('attendance.correction.breaks')}
            </legend>
            <button type="button" className="pv-btn outline compact" onClick={addBreak}>
              <Plus aria-hidden="true" />
              {t('attendance.correction.addBreak')}
            </button>
          </div>
          {fields.fields.length === 0 ? (
            <p className="mt-3 text-xs text-secondary-500">{t('attendance.correction.noBreaks')}</p>
          ) : (
            <div className="mt-3 space-y-3">
              {fields.fields.map((field, index) => (
                <div
                  key={field.fieldKey}
                  className="grid gap-3 rounded-2xl border border-secondary-200 bg-secondary-50/50 p-3 sm:grid-cols-2"
                >
                  <input type="hidden" {...form.register(`breaks.${index}.id`)} />
                  <label className="block">
                    <span className="label">{t('attendance.correction.breakStartDate')}</span>
                    <input
                      type="date"
                      className="input mt-1"
                      {...form.register(`breaks.${index}.startDate`, { required })}
                    />
                  </label>
                  <label className="block">
                    <span className="label">{t('attendance.correction.breakStartTime')}</span>
                    <input
                      type="time"
                      className="input mt-1"
                      {...form.register(`breaks.${index}.startTime`, { required })}
                    />
                  </label>
                  <label className="block">
                    <span className="label">{t('attendance.correction.breakEndDate')}</span>
                    <input
                      type="date"
                      className="input mt-1"
                      {...form.register(`breaks.${index}.endDate`, { required })}
                    />
                  </label>
                  <label className="block">
                    <span className="label">{t('attendance.correction.breakEndTime')}</span>
                    <input
                      type="time"
                      className="input mt-1"
                      {...form.register(`breaks.${index}.endTime`, { required })}
                    />
                  </label>
                  <button
                    type="button"
                    className="pv-btn ghost compact justify-self-start text-danger-700 sm:col-span-2"
                    onClick={() => fields.remove(index)}
                  >
                    <Trash2 aria-hidden="true" />
                    {t('attendance.correction.removeBreak')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </fieldset>

        <label className="block">
          <span className="label">{t('attendance.correction.reason')}</span>
          <textarea
            className="input mt-1 min-h-24 resize-y"
            maxLength={500}
            placeholder={t('attendance.correction.reasonPlaceholder')}
            {...form.register('reason', {
              required,
              minLength: { value: 10, message: t('attendance.correction.reasonMinimum') },
            })}
          />
          {form.formState.errors.reason && (
            <span className="mt-1 block text-xs text-danger-700" role="alert">
              {form.formState.errors.reason.message}
            </span>
          )}
        </label>
      </form>
    </Modal>
  );
}
