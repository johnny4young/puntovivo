import { useEffect, useRef } from 'react';
import { useForm, useWatch, useFieldArray } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { Button } from '@/components/ui';
import {
  UnsavedChangesActions,
  UnsavedChangesBody,
} from '@/components/navigation/UnsavedChangesPrompt';
import { useUnsavedChangesGuard } from '@/components/navigation/useUnsavedChangesGuard';
import { WorkforceEmployeePicker } from './WorkforceEmployeePicker';
import { isEmploymentDate } from './employmentTypes';
import {
  availabilityWindowFields,
  normalizeAvailabilityWindows,
  type AvailabilityEditor,
  type AvailabilityFormValues,
} from './availabilityTypes';

/** Explicit effective decisions preserve dirty values and the displayed version across failures/refetches. */
export function AvailabilityForm({
  editor,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  editor: AvailabilityEditor;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: AvailabilityFormValues) => Promise<void>;
}) {
  const { t } = useTranslation(['availability', 'common']);
  const row = editor.action === 'create' ? null : editor.row;
  const form = useForm<AvailabilityFormValues>({
    defaultValues: {
      userId: row?.userId ?? '',
      fromDate: '',
      untilDate: row?.untilDate ?? '',
      windows: availabilityWindowFields(row?.slots ?? []),
      emptyConfirmed: false,
      reason: '',
    },
  });
  const fields = useFieldArray({ control: form.control, name: 'windows' });
  const employee = useWatch({ control: form.control, name: 'userId' });
  const windows = useWatch({ control: form.control, name: 'windows' });
  const formRef = useRef<HTMLFormElement>(null);
  const guard = useUnsavedChangesGuard({ when: form.formState.isDirty, onClose });
  useEffect(() => {
    if (guard.isExitConfirmationOpen) document.getElementById('availability-keep-editing')?.focus();
  }, [guard.isExitConfirmationOpen]);
  const submit = form.handleSubmit(async values => {
    form.clearErrors('root');
    if (editor.action !== 'void') {
      const validDates =
        isEmploymentDate(values.fromDate) &&
        (editor.action === 'create'
          ? !values.untilDate ||
            (isEmploymentDate(values.untilDate) && values.untilDate > values.fromDate)
          : values.fromDate > editor.row.fromDate &&
            (!editor.row.untilDate || values.fromDate < editor.row.untilDate));
      if (!validDates) {
        form.setError('root', { message: t('invalidDates') });
        return;
      }
      if (normalizeAvailabilityWindows(values.windows) === null) {
        form.setError('root', { message: t('invalidWindows') });
        return;
      }
      if (!values.windows.length && !values.emptyConfirmed) {
        form.setError('root', { message: t('emptyAcknowledgement') });
        return;
      }
    }
    await onSubmit(values);
  });
  return (
    <Modal
      isOpen
      size="lg"
      title={
        guard.isExitConfirmationOpen
          ? t('common:unsavedChanges.summary')
          : t(`actions.${editor.action}`)
      }
      onClose={() => {
        if (!saving) guard.requestClose();
      }}
      closeOnBackdrop={!saving && !guard.isExitConfirmationOpen}
      closeOnEsc={!saving && !guard.isExitConfirmationOpen}
      showCloseButton={!saving && !guard.isExitConfirmationOpen}
      footer={
        guard.isExitConfirmationOpen ? (
          <UnsavedChangesActions
            keepEditingId="availability-keep-editing"
            keepEditingLabel={t('common:unsavedChanges.keepEditingAction')}
            discardLabel={t('common:unsavedChanges.discardAction')}
            onKeepEditing={guard.keepEditing}
            onDiscard={guard.discardChanges}
          />
        ) : (
          <>
            <ModalButton variant="secondary" disabled={saving} onClick={guard.requestClose}>
              {t('close')}
            </ModalButton>
            <ModalButton disabled={saving} onClick={() => formRef.current?.requestSubmit()}>
              {saving ? t('saving') : t('confirm')}
            </ModalButton>
          </>
        )
      }
    >
      {guard.isExitConfirmationOpen && (
        <UnsavedChangesBody
          summary={t('common:unsavedChanges.summary')}
          message={t('common:unsavedChanges.message')}
        />
      )}
      <form
        ref={formRef}
        hidden={guard.isExitConfirmationOpen}
        aria-hidden={guard.isExitConfirmationOpen}
        noValidate
        onSubmit={submit}
        className="space-y-4"
      >
        <p className="text-sm text-secondary-600">{t(`${editor.action}Notice`)}</p>
        {row ? (
          <p className="break-words font-medium">
            {row.userName} · {row.fromDate} → {row.untilDate ?? t('openEnd')} · {row.timeZone} ·{' '}
            {t('version', { version: row.version })}
          </p>
        ) : (
          <>
            <WorkforceEmployeePicker
              domain="availability"
              value={employee}
              onChange={id =>
                form.setValue('userId', id, { shouldDirty: true, shouldValidate: true })
              }
              disabled={saving}
            />
            <input type="hidden" {...form.register('userId', { required: t('required') })} />
            {form.formState.errors.userId && <p role="alert">{t('required')}</p>}
          </>
        )}
        {editor.action !== 'void' && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">{t('fromDate')}</span>
                <input
                  className="input"
                  type="date"
                  disabled={saving}
                  {...form.register('fromDate')}
                />
              </label>
              {editor.action === 'create' && (
                <label className="block">
                  <span className="label">{t('untilDate')}</span>
                  <input
                    className="input"
                    type="date"
                    disabled={saving}
                    {...form.register('untilDate')}
                  />
                </label>
              )}
            </div>
            <p className="text-sm text-secondary-600">{t('datesNotice')}</p>
            <fieldset disabled={saving} className="space-y-3">
              <legend className="mb-2 font-semibold">{t('weeklyWindows')}</legend>
              {fields.fields.map((field, index) => (
                <fieldset key={field.id} className="rounded-lg border border-line p-3">
                  <legend className="px-1 text-sm">
                    {t('windowNumber', { number: index + 1 })}
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label>
                      <span className="label">{t('weekday')}</span>
                      <select
                        className="input"
                        {...form.register(`windows.${index}.weekday`, { valueAsNumber: true })}
                      >
                        {[1, 2, 3, 4, 5, 6, 7].map(day => (
                          <option key={day} value={day}>
                            {t(`days.${day}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="label">{t('start')}</span>
                      <input
                        className="input"
                        type="time"
                        step={60}
                        {...form.register(`windows.${index}.start`)}
                      />
                    </label>
                    <label>
                      <span className="label">{t('end')}</span>
                      <input
                        className="input"
                        type="time"
                        step={60}
                        {...form.register(`windows.${index}.end`)}
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" {...form.register(`windows.${index}.nextDay`)} />
                      <span className="text-sm">{t('nextDay')}</span>
                    </label>
                    <Button
                      variant="outline"
                      disabled={saving}
                      onClick={() => fields.remove(index)}
                    >
                      {t('removeWindow', { number: index + 1 })}
                    </Button>
                  </div>
                </fieldset>
              ))}
              <Button
                variant="outline"
                disabled={saving || fields.fields.length >= 56}
                onClick={() =>
                  fields.append({ weekday: 1, start: '09:00', end: '17:00', nextDay: false })
                }
              >
                {t('addWindow')}
              </Button>
            </fieldset>
            <p className="text-sm text-secondary-600">{t('windowsNotice')}</p>
            {!windows.length && (
              <label className="flex items-start gap-2 rounded-lg border border-line p-3">
                <input
                  className="mt-1"
                  type="checkbox"
                  disabled={saving}
                  {...form.register('emptyConfirmed')}
                />
                <span>{t('emptyAcknowledgement')}</span>
              </label>
            )}
          </>
        )}
        <label className="block">
          <span className="label">{t('reason')}</span>
          <textarea
            className="input"
            rows={3}
            maxLength={500}
            disabled={saving}
            {...form.register('reason', {
              validate: value =>
                (value.trim().length >= 10 && value.trim().length <= 500) || t('reasonLength'),
            })}
          />
        </label>
        <p className="text-sm text-secondary-600">{t('privacyNotice')}</p>
        {form.formState.errors.reason && <p role="alert">{t('reasonLength')}</p>}
        {form.formState.errors.root && <p role="alert">{form.formState.errors.root.message}</p>}
        {error && <p role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
