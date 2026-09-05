import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { Button } from '@/components/ui';
import {
  UnsavedChangesActions,
  UnsavedChangesBody,
} from '@/components/navigation/UnsavedChangesPrompt';
import { useUnsavedChangesGuard } from '@/components/navigation/useUnsavedChangesGuard';
import { WorkforceEmployeePicker } from './WorkforceEmployeePicker';
import {
  schedulePlanInput,
  type SchedulePlanEditor,
  type SchedulePlanFormValues,
  type SchedulePlanInput,
} from './schedulePlanTypes';

/** One captured draft decision. Refetches cannot replace the edited intent or expected version. */
export function SchedulePlanForm({
  editor,
  defaultSiteId,
  sites,
  timeZone,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  editor: SchedulePlanEditor;
  defaultSiteId: string;
  sites: ReadonlyArray<{ id: string; name: string; isActive: boolean | null }>;
  timeZone: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: SchedulePlanInput, reason: string) => Promise<void>;
}) {
  const { t } = useTranslation(['schedulePlans', 'common']);
  const view = editor.action === 'regenerate' ? editor.view : null;
  const [values, setValues] = useState<SchedulePlanFormValues>(() => ({
    title: view?.plan.title ?? '',
    siteId: view?.plan.siteId ?? defaultSiteId,
    fromDate: view?.plan.fromDate ?? '',
    untilDate: view?.plan.untilDate ?? '',
    anchorWeekStart: view?.plan.anchorWeekStart ?? '',
    rules: view?.plan.rules.map(rule => ({ ...rule, notes: rule.notes ?? '' })) ?? [],
  }));
  const [reason, setReason] = useState(''),
    [dirty, setDirty] = useState(false),
    [validation, setValidation] = useState(false);
  const formRef = useRef<HTMLFormElement>(null),
    busy = useRef(false);
  const guard = useUnsavedChangesGuard({ when: dirty, onClose });
  useEffect(() => {
    if (guard.isExitConfirmationOpen)
      document.getElementById('schedule-plan-keep-editing')?.focus();
  }, [guard.isExitConfirmationOpen]);
  const change = (next: SchedulePlanFormValues) => {
    if (!saving && !busy.current) {
      setValues(next);
      setDirty(true);
      setValidation(false);
    }
  };
  const ruleChange = (id: string, patch: Partial<SchedulePlanFormValues['rules'][number]>) =>
    change({
      ...values,
      rules: values.rules.map(rule => (rule.id === id ? { ...rule, ...patch } : rule)),
    });
  return (
    <Modal
      isOpen
      size="xl"
      title={
        guard.isExitConfirmationOpen
          ? t('common:unsavedChanges.summary')
          : t(`actions.${editor.action}`)
      }
      onClose={() => {
        if (!saving && !busy.current) guard.requestClose();
      }}
      closeOnBackdrop={!saving && !guard.isExitConfirmationOpen}
      closeOnEsc={!saving && !guard.isExitConfirmationOpen}
      showCloseButton={!saving && !guard.isExitConfirmationOpen}
      footer={
        guard.isExitConfirmationOpen ? (
          <UnsavedChangesActions
            keepEditingId="schedule-plan-keep-editing"
            keepEditingLabel={t('common:unsavedChanges.keepEditingAction')}
            discardLabel={t('common:unsavedChanges.discardAction')}
            onKeepEditing={guard.keepEditing}
            onDiscard={guard.discardChanges}
          />
        ) : (
          <>
            <ModalButton
              variant="secondary"
              disabled={saving}
              onClick={() => {
                if (!busy.current) guard.requestClose();
              }}
            >
              {t('close')}
            </ModalButton>
            <ModalButton disabled={saving} onClick={() => formRef.current?.requestSubmit()}>
              {saving ? t('saving') : t('saveDraft')}
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
        className="space-y-4"
        noValidate
        onSubmit={async event => {
          event.preventDefault();
          if (saving || busy.current) return;
          const input = schedulePlanInput(values);
          if (!input || (view && (reason.trim().length < 10 || reason.trim().length > 500))) {
            setValidation(true);
            return;
          }
          busy.current = true;
          try {
            await onSubmit(input, reason.trim());
          } finally {
            busy.current = false;
          }
        }}
      >
        <p className="text-sm text-secondary-600">{t('draftNotice')}</p>
        <p className="text-sm">
          {t('zone', { zone: view?.plan.timeZone ?? timeZone })}
          {view && ` · ${t('version', { version: view.plan.version })}`}
        </p>
        <fieldset disabled={saving} className="space-y-4">
          <label className="block">
            <span className="label">{t('name')}</span>
            <input
              className="input"
              value={values.title}
              maxLength={100}
              onChange={event => change({ ...values, title: event.target.value })}
            />
          </label>
          <label className="block">
            <span className="label">{t('site')}</span>
            <select
              className="input"
              value={values.siteId}
              onChange={event => change({ ...values, siteId: event.target.value })}
            >
              <option value="">{t('chooseSite')}</option>
              {sites.map(site => (
                <option key={site.id} value={site.id} disabled={!site.isActive}>
                  {site.name}
                  {!site.isActive ? ` (${t('inactive')})` : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            {(['fromDate', 'untilDate', 'anchorWeekStart'] as const).map(field => (
              <label key={field}>
                <span className="label">{t(field)}</span>
                <input
                  className="input"
                  type="date"
                  value={values[field]}
                  onChange={event => change({ ...values, [field]: event.target.value })}
                />
              </label>
            ))}
          </div>
          <p className="text-sm text-secondary-600">{t('datesNotice')}</p>
          {values.rules.map((rule, index) => (
            <fieldset key={rule.id} className="space-y-3 rounded-lg border border-line p-3">
              <legend className="px-1 font-semibold">{t('rule', { number: index + 1 })}</legend>
              <WorkforceEmployeePicker
                domain="schedulePlans"
                value={rule.userId}
                selectedLabel={
                  view?.display.employees.find(employee => employee.id === rule.userId)?.name ?? ''
                }
                disabled={saving}
                onChange={userId => ruleChange(rule.id, { userId })}
              />
              <div className="flex flex-wrap gap-3">
                {[1, 2, 3, 4, 5, 6, 7].map(day => (
                  <label key={day} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rule.weekdays.includes(day)}
                      onChange={event =>
                        ruleChange(rule.id, {
                          weekdays: event.target.checked
                            ? [...rule.weekdays, day].sort((a, b) => a - b)
                            : rule.weekdays.filter(value => value !== day),
                        })
                      }
                    />
                    <span>{t(`days.${day}`)}</span>
                  </label>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label>
                  <span className="label">{t('interval')}</span>
                  <select
                    className="input"
                    value={rule.intervalWeeks}
                    onChange={event =>
                      ruleChange(rule.id, { intervalWeeks: Number(event.target.value) })
                    }
                  >
                    {[1, 2, 3, 4].map(weeks => (
                      <option key={weeks} value={weeks}>
                        {t('weeks', { count: weeks })}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="label">{t('startTime')}</span>
                  <input
                    className="input"
                    type="time"
                    step={60}
                    value={rule.startTime}
                    onChange={event => ruleChange(rule.id, { startTime: event.target.value })}
                  />
                </label>
                <label>
                  <span className="label">{t('endTime')}</span>
                  <input
                    className="input"
                    type="time"
                    step={60}
                    value={rule.endTime}
                    onChange={event => ruleChange(rule.id, { endTime: event.target.value })}
                  />
                </label>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={rule.endDayOffset === 1}
                  onChange={event =>
                    ruleChange(rule.id, { endDayOffset: event.target.checked ? 1 : 0 })
                  }
                />
                <span>{t('overnight')}</span>
              </label>
              <label className="block">
                <span className="label">{t('notes')}</span>
                <textarea
                  className="input"
                  rows={2}
                  maxLength={500}
                  value={rule.notes}
                  onChange={event => ruleChange(rule.id, { notes: event.target.value })}
                />
              </label>
              <Button
                variant="outline"
                disabled={saving}
                onClick={() =>
                  change({ ...values, rules: values.rules.filter(value => value.id !== rule.id) })
                }
              >
                {t('removeRule', { number: index + 1 })}
              </Button>
            </fieldset>
          ))}
          <Button
            variant="outline"
            disabled={saving || values.rules.length >= 100}
            onClick={() =>
              change({
                ...values,
                rules: [
                  ...values.rules,
                  {
                    id: crypto.randomUUID(),
                    userId: '',
                    weekdays: [1],
                    intervalWeeks: 1,
                    startTime: '09:00',
                    endTime: '17:00',
                    endDayOffset: 0,
                    notes: '',
                  },
                ],
              })
            }
          >
            {t('addRule')}
          </Button>
          {view && (
            <label className="block">
              <span className="label">{t('reason')}</span>
              <textarea
                className="input"
                value={reason}
                rows={3}
                maxLength={500}
                onChange={event => {
                  setReason(event.target.value);
                  setDirty(true);
                }}
              />
            </label>
          )}
        </fieldset>
        <p className="text-sm text-secondary-600">{t('privacyNotice')}</p>
        {validation && <p role="alert">{t('invalid')}</p>}
        {error && <p role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
