import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import type { ScheduleContext, ScheduleFormValues } from './scheduleTypes';

interface ScheduleShiftModalProps {
  isOpen: boolean;
  isSaving: boolean;
  employees: ScheduleContext['employees'];
  sites: ScheduleContext['sites'];
  initialValues: ScheduleFormValues;
  isEditing: boolean;
  onClose: () => void;
  onSubmit: (values: ScheduleFormValues) => void;
}

export function ScheduleShiftModal({
  isOpen,
  isSaving,
  employees,
  sites,
  initialValues,
  isEditing,
  onClose,
  onSubmit,
}: ScheduleShiftModalProps) {
  const { t } = useTranslation('schedule');
  const form = useForm<ScheduleFormValues>({ defaultValues: initialValues });
  const required = t('form.required');
  const initialEmployeeUnavailable =
    isEditing && !employees.some(employee => employee.id === initialValues.userId);
  const initialSiteUnavailable = isEditing && !sites.some(site => site.id === initialValues.siteId);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t(isEditing ? 'form.editTitle' : 'form.createTitle')}
      size="lg"
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('form.close')}
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={() => void form.handleSubmit(onSubmit)()}
            disabled={isSaving}
          >
            {t(isSaving ? 'form.saving' : 'form.save')}
          </ModalButton>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={event => void form.handleSubmit(onSubmit)(event)}
      >
        <label className="block sm:col-span-2">
          <span className="label">{t('form.employee')}</span>
          <select className="input mt-1" {...form.register('userId', { required })}>
            {initialEmployeeUnavailable && (
              <option value={initialValues.userId} disabled>
                {t('form.unavailableEmployee')}
              </option>
            )}
            {employees.map(employee => (
              <option key={employee.id} value={employee.id}>
                {employee.name} · {t(`roles.${employee.role}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="block sm:col-span-2">
          <span className="label">{t('form.site')}</span>
          <select className="input mt-1" {...form.register('siteId', { required })}>
            {initialSiteUnavailable && (
              <option value={initialValues.siteId} disabled>
                {t('form.unavailableSite')}
              </option>
            )}
            {sites.map(site => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label">{t('form.startDate')}</span>
          <input type="date" className="input mt-1" {...form.register('startDate', { required })} />
        </label>
        <label className="block">
          <span className="label">{t('form.startTime')}</span>
          <input type="time" className="input mt-1" {...form.register('startTime', { required })} />
        </label>
        <label className="block">
          <span className="label">{t('form.endDate')}</span>
          <input type="date" className="input mt-1" {...form.register('endDate', { required })} />
        </label>
        <label className="block">
          <span className="label">{t('form.endTime')}</span>
          <input type="time" className="input mt-1" {...form.register('endTime', { required })} />
        </label>

        <label className="block sm:col-span-2">
          <span className="label">{t('form.notes')}</span>
          <textarea
            className="input mt-1 min-h-24 resize-y"
            maxLength={500}
            placeholder={t('form.notesPlaceholder')}
            {...form.register('notes')}
          />
        </label>
      </form>
    </Modal>
  );
}
