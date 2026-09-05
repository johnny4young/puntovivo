import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import {
  UnsavedChangesActions,
  UnsavedChangesBody,
} from '@/components/navigation/UnsavedChangesPrompt';
import { useUnsavedChangesGuard } from '@/components/navigation/useUnsavedChangesGuard';
import { EmploymentEmployeePicker } from './EmploymentEmployeePicker';
import {
  isEmploymentDate,
  parseEmploymentMoney,
  type EmploymentEditor,
  type EmploymentFormValues,
} from './employmentTypes';

/** Explicit lifecycle input; selected employee, version and previous end cannot be silently replaced. */
export function EmploymentForm({
  editor,
  currencyCode: currentCurrencyCode,
  timeZone,
  sites,
  defaultSiteId,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  editor: EmploymentEditor;
  currencyCode: string;
  timeZone: string;
  sites: ReadonlyArray<{ id: string; name: string; isActive: boolean | null }>;
  defaultSiteId: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: EmploymentFormValues, currencyCode: string) => Promise<void>;
}) {
  const { t } = useTranslation(['workforce', 'common']);
  // A background currency refresh must not relabel already-entered amounts.
  // The writer rejects a stale currency; closing/reopening starts a new explicit form.
  const [currencyCode] = useState(currentCurrencyCode);
  const formRef = useRef<HTMLFormElement>(null);
  const row = editor.action === 'create' ? null : editor.contract;
  const editsTerms = editor.action === 'create' || editor.action === 'replace';
  const form = useForm<EmploymentFormValues>({
    defaultValues: {
      userId: row?.userId ?? '',
      siteId: row?.siteId ?? defaultSiteId,
      position: row?.position ?? '',
      effectiveFrom: '',
      effectiveUntil: row?.effectiveUntil ?? '',
      payBasis: row?.payBasis ?? 'hourly',
      payAmount: row && row.currencyCode === currencyCode ? String(row.payAmount) : '',
      costingHourlyRate:
        row?.costingHourlyRate === null || !row || row.currencyCode !== currencyCode
          ? ''
          : String(row.costingHourlyRate),
      reason: '',
    },
  });
  const basis = useWatch({ control: form.control, name: 'payBasis' });
  const selectedUserId = useWatch({ control: form.control, name: 'userId' });
  const required = t('required');
  const submit = form.handleSubmit(values => onSubmit(values, currencyCode));
  const { requestClose, isExitConfirmationOpen, keepEditing, discardChanges } =
    useUnsavedChangesGuard({ when: form.formState.isDirty, onClose });
  useEffect(() => {
    if (isExitConfirmationOpen) document.getElementById('employment-keep-editing')?.focus();
  }, [isExitConfirmationOpen]);
  return (
    <Modal
      isOpen
      title={
        isExitConfirmationOpen ? t('common:unsavedChanges.summary') : t(`actions.${editor.action}`)
      }
      size="lg"
      onClose={() => {
        if (!saving) requestClose();
      }}
      closeOnBackdrop={!saving && !isExitConfirmationOpen}
      closeOnEsc={!saving && !isExitConfirmationOpen}
      showCloseButton={!saving && !isExitConfirmationOpen}
      footer={
        isExitConfirmationOpen ? (
          <UnsavedChangesActions
            keepEditingId="employment-keep-editing"
            keepEditingLabel={t('common:unsavedChanges.keepEditingAction')}
            discardLabel={t('common:unsavedChanges.discardAction')}
            onKeepEditing={() => {
              keepEditing();
              setTimeout(
                () =>
                  formRef.current
                    ?.querySelector<HTMLElement>('input:not([type=hidden]):not(:disabled),textarea')
                    ?.focus(),
                0
              );
            }}
            onDiscard={discardChanges}
          />
        ) : (
          <>
            <ModalButton disabled={saving} onClick={requestClose}>
              {t('close')}
            </ModalButton>
            <ModalButton
              variant={editor.action === 'void' ? 'danger' : 'primary'}
              disabled={saving}
              onClick={() => void submit()}
            >
              {t(saving ? 'saving' : 'save')}
            </ModalButton>
          </>
        )
      }
    >
      {isExitConfirmationOpen && (
        <UnsavedChangesBody
          summary={t('common:unsavedChanges.summary')}
          message={t('common:unsavedChanges.message')}
        />
      )}
      <form
        ref={formRef}
        hidden={isExitConfirmationOpen}
        aria-hidden={isExitConfirmationOpen}
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={event => void submit(event)}
      >
        <p className="text-sm text-secondary-600 sm:col-span-2">{t(`notices.${editor.action}`)}</p>
        {row && (
          <p className="font-medium sm:col-span-2">
            {row.userName} · {t('version', { version: row.version })}
          </p>
        )}
        {editsTerms && row && row.currencyCode !== currencyCode && (
          <p role="alert" className="text-warning-700 sm:col-span-2">
            {t('currencyChanged', { from: row.currencyCode, to: currencyCode })}
          </p>
        )}
        <p className="text-xs text-secondary-500 sm:col-span-2">{t('timezone', { timeZone })}</p>
        {editor.action === 'create' && (
          <>
            <input type="hidden" {...form.register('userId', { required })} />
            <EmploymentEmployeePicker
              value={selectedUserId}
              disabled={saving}
              onChange={id =>
                form.setValue('userId', id, { shouldValidate: true, shouldDirty: true })
              }
            />
          </>
        )}
        {editsTerms && (
          <>
            <label className="block">
              <span className="label">{t('position')}</span>
              <input
                className="input mt-1"
                disabled={saving}
                maxLength={100}
                {...form.register('position', { validate: value => !!value.trim() || required })}
              />
            </label>
            <label className="block">
              <span className="label">{t('site')}</span>
              <select
                className="input mt-1"
                disabled={saving}
                {...form.register('siteId', {
                  validate: value =>
                    sites.some(site => site.id === value && site.isActive) ||
                    t('activeSiteRequired'),
                })}
              >
                <option value="">{t('chooseSite')}</option>
                {row && !sites.some(site => site.id === row.siteId && site.isActive) && (
                  <option value={row.siteId} disabled>
                    {t('archivedSite', { site: row.siteName })}
                  </option>
                )}
                {sites
                  .filter(site => site.isActive)
                  .map(site => (
                    <option value={site.id} key={site.id}>
                      {site.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block">
              <span className="label">{t('effectiveFrom')}</span>
              <input
                type="date"
                className="input mt-1"
                disabled={saving}
                {...form.register('effectiveFrom', {
                  validate: value =>
                    (isEmploymentDate(value) &&
                      (!row ||
                        (value > row.effectiveFrom &&
                          (!row.effectiveUntil || value < row.effectiveUntil)))) ||
                    t('invalidStart'),
                })}
              />
            </label>
          </>
        )}
        {editor.action !== 'void' && (
          <label className="block">
            <span className="label">{t('effectiveUntil')}</span>
            <input
              type="date"
              className="input mt-1"
              disabled={saving || editor.action === 'replace'}
              {...form.register('effectiveUntil', {
                validate: value => {
                  if (editor.action === 'replace') return true;
                  if (editor.action === 'create')
                    return (
                      !value ||
                      (isEmploymentDate(value) && value > form.getValues('effectiveFrom')) ||
                      t('invalidEnd')
                    );
                  return (
                    (isEmploymentDate(value) &&
                      !!row &&
                      value > row.effectiveFrom &&
                      (!row.effectiveUntil || value < row.effectiveUntil)) ||
                    t('invalidEnd')
                  );
                },
              })}
            />
            <span className="mt-1 block text-xs text-secondary-500">
              {t(
                editor.action === 'replace'
                  ? 'preservedEnd'
                  : editor.action === 'create'
                    ? 'optionalEnd'
                    : 'exclusiveEnd'
              )}
            </span>
          </label>
        )}
        {editsTerms && (
          <>
            <label className="block">
              <span className="label">{t('payBasis')}</span>
              <select className="input mt-1" disabled={saving} {...form.register('payBasis')}>
                <option value="hourly">{t('basis.hourly')}</option>
                <option value="monthly">{t('basis.monthly')}</option>
              </select>
            </label>
            <label className="block">
              <span className="label">{t('payAmount', { currencyCode })}</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max="1000000000000"
                step="0.01"
                className="input mt-1"
                disabled={saving}
                {...form.register('payAmount', {
                  validate: value => parseEmploymentMoney(value) !== null || t('invalidMoney'),
                })}
              />
            </label>
            {basis === 'monthly' && (
              <label className="block sm:col-span-2">
                <span className="label">{t('costingRate', { currencyCode })}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="1000000000000"
                  step="0.01"
                  className="input mt-1"
                  disabled={saving}
                  {...form.register('costingHourlyRate', {
                    validate: value =>
                      form.getValues('payBasis') !== 'monthly' ||
                      !value.trim() ||
                      parseEmploymentMoney(value) !== null ||
                      t('invalidMoney'),
                  })}
                />
                <span className="mt-1 block text-xs text-secondary-500">{t('costingNotice')}</span>
              </label>
            )}
          </>
        )}
        <label className="block sm:col-span-2">
          <span className="label">{t('reason')}</span>
          <textarea
            className="input mt-1 min-h-24"
            disabled={saving}
            maxLength={500}
            {...form.register('reason', {
              validate: value => value.trim().length >= 10 || t('reasonMinimum'),
            })}
          />
        </label>
        {Object.keys(form.formState.errors).length > 0 && (
          <div role="alert" className="text-danger-700 sm:col-span-2">
            <p>{t('checkFields')}</p>
            <ul className="list-inside list-disc">
              {Object.entries(form.formState.errors).map(([key, issue]) => (
                <li key={key}>{key === 'userId' ? t('chooseEmployee') : issue.message}</li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p role="alert" className="text-danger-700 sm:col-span-2">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
