import { useEffect, useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import {
  UnsavedChangesActions,
  UnsavedChangesBody,
} from '@/components/navigation/UnsavedChangesPrompt';
import { useUnsavedChangesGuard } from '@/components/navigation/useUnsavedChangesGuard';
import { TimeOffEmployeePicker } from './TimeOffEmployeePicker';
import { isEmploymentDate } from './employmentTypes';
import type { TimeOffEditor, TimeOffFormValues } from './timeOffTypes';

/** The saved interval and optimistic version never follow background refreshes while deciding. */
export function TimeOffForm({
  editor,
  sites,
  defaultSiteId,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  editor: TimeOffEditor;
  sites: ReadonlyArray<{ id: string; name: string; isActive: boolean | null }>;
  defaultSiteId: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: TimeOffFormValues) => Promise<void>;
}) {
  const { t } = useTranslation(['timeOff', 'common']);
  const formRef = useRef<HTMLFormElement>(null);
  const row = editor.action === 'create' ? null : editor.row;
  const form = useForm<TimeOffFormValues>({
    defaultValues: {
      userId: row?.userId ?? '',
      siteId: row?.siteId ?? defaultSiteId,
      kind: row?.kind ?? 'vacation',
      fromDate: row?.fromDate ?? '',
      untilDate: row?.untilDate ?? '',
      reason: '',
    },
  });
  const employee = useWatch({ control: form.control, name: 'userId' });
  const guard = useUnsavedChangesGuard({ when: form.formState.isDirty, onClose });
  const required = t('required');
  useEffect(() => {
    if (guard.isExitConfirmationOpen) document.getElementById('time-off-keep-editing')?.focus();
  }, [guard.isExitConfirmationOpen]);
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
            keepEditingId="time-off-keep-editing"
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
        hidden={guard.isExitConfirmationOpen}
        aria-hidden={guard.isExitConfirmationOpen}
        noValidate
        ref={formRef}
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4"
      >
        <p className="text-sm text-secondary-600">
          {t(editor.action === 'approved' ? 'approvalNotice' : 'formNotice')}
        </p>
        {row ? (
          <p className="font-medium">
            {row.userName} · {row.siteName} · {row.fromDate} → {row.untilDate} · {row.timeZone}
          </p>
        ) : (
          <>
            <TimeOffEmployeePicker
              value={employee}
              onChange={id =>
                form.setValue('userId', id, { shouldDirty: true, shouldValidate: true })
              }
              disabled={saving}
            />
            <input type="hidden" {...form.register('userId', { required })} />
            {form.formState.errors.userId && <p role="alert">{required}</p>}
            <label className="block">
              <span className="label">{t('site')}</span>
              <select
                className="input"
                disabled={saving}
                {...form.register('siteId', { required })}
              >
                <option value="">{t('chooseSite')}</option>
                {sites
                  .filter(site => site.isActive)
                  .map(site => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
              </select>
            </label>
            {form.formState.errors.siteId && <p role="alert">{required}</p>}
            <label className="block">
              <span className="label">{t('kind')}</span>
              <select className="input" disabled={saving} {...form.register('kind')}>
                {(['vacation', 'leave', 'absence'] as const).map(kind => (
                  <option key={kind} value={kind}>
                    {t(`kinds.${kind}`)}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">{t('fromDate')}</span>
                <input
                  className="input"
                  type="date"
                  disabled={saving}
                  {...form.register('fromDate', {
                    validate: value => isEmploymentDate(value) || t('invalidDates'),
                  })}
                />
              </label>
              <label className="block">
                <span className="label">{t('untilDate')}</span>
                <input
                  className="input"
                  type="date"
                  disabled={saving}
                  {...form.register('untilDate', {
                    validate: value => {
                      const days =
                        (Date.parse(value) - Date.parse(form.getValues('fromDate'))) / 86_400_000;
                      return (
                        (isEmploymentDate(value) && days >= 1 && days <= 366) || t('invalidDates')
                      );
                    },
                  })}
                />
              </label>
            </div>
            {(form.formState.errors.fromDate || form.formState.errors.untilDate) && (
              <p role="alert">{t('invalidDates')}</p>
            )}
            <p className="text-sm text-secondary-600">{t('dateNotice')}</p>
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
              validate: value => value.trim().length >= 10 || t('reasonLength'),
            })}
          />
        </label>
        <p className="text-sm text-secondary-600">{t('privacyNotice')}</p>
        {form.formState.errors.reason && <p role="alert">{t('reasonLength')}</p>}
        {error && <p role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
