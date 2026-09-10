import { useEffect, useRef } from 'react';
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
  isPayrollWindow,
  type PayrollProfile,
  type PayrollProfileFormValues,
} from './payrollTypes';

export type PayrollProfileEditor =
  { action: 'create' } | { action: 'replace' | 'end' | 'void'; profile: PayrollProfile };

/** Explicit private profile editor; changing effective terms always appends ledger evidence. */
export function PayrollProfileForm({
  editor,
  sites,
  defaultSiteId,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  editor: PayrollProfileEditor;
  sites: ReadonlyArray<{ id: string; name: string; isActive: boolean | null }>;
  defaultSiteId: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: PayrollProfileFormValues) => Promise<void>;
}) {
  const { t } = useTranslation(['payroll', 'common']);
  const row = editor.action === 'create' ? null : editor.profile;
  const editsTerms = editor.action === 'create' || editor.action === 'replace';
  const formRef = useRef<HTMLFormElement>(null);
  const form = useForm<PayrollProfileFormValues>({
    defaultValues: {
      userId: row?.userId ?? '',
      siteId: row?.siteId ?? defaultSiteId,
      identificationType: row?.identificationType ?? 'CC',
      identificationNumber: row?.identificationNumber ?? '',
      contributorType: row?.contributorType ?? '01',
      contributorSubtype: row?.contributorSubtype ?? '',
      contractKind: row?.contractKind ?? 'indefinite',
      integralSalary: row?.integralSalary ?? false,
      arlRiskClass: String(row?.arlRiskClass ?? 1),
      healthEntity: row?.healthEntity ?? '',
      pensionEntity: row?.pensionEntity ?? '',
      compensationFund: row?.compensationFund ?? '',
      transportAssistanceEligible: row?.transportAssistanceEligible ?? false,
      paymentMethod: row?.paymentMethod ?? 'cash',
      paymentAccountLast4: row?.paymentAccountLast4 ?? '',
      effectiveFrom: editor.action === 'replace' ? '' : (row?.effectiveFrom ?? ''),
      effectiveUntil: row?.effectiveUntil ?? '',
      reason: '',
    },
  });
  const selectedUserId = useWatch({ control: form.control, name: 'userId' });
  const paymentMethod = useWatch({ control: form.control, name: 'paymentMethod' });
  const required = t('validation.required');
  const submit = form.handleSubmit(values => onSubmit(values));
  const { requestClose, isExitConfirmationOpen, keepEditing, discardChanges } =
    useUnsavedChangesGuard({ when: form.formState.isDirty, onClose });
  useEffect(() => {
    if (isExitConfirmationOpen) document.getElementById('payroll-profile-keep-editing')?.focus();
  }, [isExitConfirmationOpen]);

  return (
    <Modal
      isOpen
      title={
        isExitConfirmationOpen
          ? t('common:unsavedChanges.summary')
          : t(`profiles.actions.${editor.action}`)
      }
      size="xl"
      onClose={() => {
        if (!saving) requestClose();
      }}
      closeOnBackdrop={!saving && !isExitConfirmationOpen}
      closeOnEsc={!saving && !isExitConfirmationOpen}
      showCloseButton={!saving && !isExitConfirmationOpen}
      footer={
        isExitConfirmationOpen ? (
          <UnsavedChangesActions
            keepEditingId="payroll-profile-keep-editing"
            keepEditingLabel={t('common:unsavedChanges.keepEditingAction')}
            discardLabel={t('common:unsavedChanges.discardAction')}
            onKeepEditing={keepEditing}
            onDiscard={discardChanges}
          />
        ) : (
          <>
            <ModalButton disabled={saving} onClick={requestClose}>
              {t('actions.close')}
            </ModalButton>
            <ModalButton
              variant={editor.action === 'void' ? 'danger' : 'primary'}
              disabled={saving}
              onClick={() => void submit()}
            >
              {t(saving ? 'actions.saving' : 'actions.save')}
            </ModalButton>
          </>
        )
      }
    >
      {isExitConfirmationOpen ? (
        <UnsavedChangesBody
          summary={t('common:unsavedChanges.summary')}
          message={t('common:unsavedChanges.message')}
        />
      ) : (
        <form
          ref={formRef}
          className="grid gap-4 sm:grid-cols-2"
          noValidate
          onSubmit={event => void submit(event)}
        >
          <p className="text-sm text-secondary-600 sm:col-span-2">
            {t(`profiles.notices.${editor.action}`)}
          </p>
          {row && (
            <p className="font-medium sm:col-span-2">
              {row.userName} · {t('profiles.version', { version: row.version })}
            </p>
          )}
          {editsTerms && editor.action === 'create' && (
            <>
              <input type="hidden" {...form.register('userId', { required })} />
              <EmploymentEmployeePicker
                value={selectedUserId}
                disabled={saving}
                onChange={id =>
                  form.setValue('userId', id, { shouldDirty: true, shouldValidate: true })
                }
              />
            </>
          )}
          {editsTerms && (
            <>
              <label className="block">
                <span className="label">{t('profiles.fields.site')}</span>
                <select
                  className="input mt-1"
                  disabled={saving}
                  {...form.register('siteId', {
                    validate: value =>
                      sites.some(site => site.id === value && site.isActive) || required,
                  })}
                >
                  <option value="">{t('profiles.fields.chooseSite')}</option>
                  {sites
                    .filter(site => site.isActive)
                    .map(site => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block">
                <span className="label">{t('profiles.fields.effectiveFrom')}</span>
                <input
                  type="date"
                  className="input mt-1"
                  disabled={saving}
                  {...form.register('effectiveFrom', {
                    validate: value => {
                      if (!isPayrollWindow(value, form.getValues('effectiveUntil')))
                        return t('validation.window');
                      if (
                        editor.action === 'replace' &&
                        row &&
                        (value <= row.effectiveFrom ||
                          (row.effectiveUntil !== null && value >= row.effectiveUntil))
                      )
                        return t('validation.replacementDate');
                      return true;
                    },
                  })}
                />
              </label>
              <label className="block">
                <span className="label">{t('profiles.fields.effectiveUntil')}</span>
                <input
                  type="date"
                  className="input mt-1"
                  disabled={saving || editor.action === 'replace'}
                  {...form.register('effectiveUntil')}
                />
              </label>
              <label className="block">
                <span className="label">{t('profiles.fields.identificationType')}</span>
                <input
                  className="input mt-1"
                  maxLength={20}
                  disabled={saving}
                  {...form.register('identificationType', {
                    validate: value => !!value.trim() || required,
                  })}
                />
              </label>
              <label className="block">
                <span className="label">{t('profiles.fields.identificationNumber')}</span>
                <input
                  className="input mt-1"
                  maxLength={40}
                  autoComplete="off"
                  disabled={saving}
                  {...form.register('identificationNumber', {
                    validate: value => value.trim().length >= 3 || required,
                  })}
                />
              </label>
              <label className="block">
                <span className="label">{t('profiles.fields.contributorType')}</span>
                <input
                  className="input mt-1"
                  maxLength={20}
                  disabled={saving}
                  {...form.register('contributorType', {
                    validate: value => !!value.trim() || required,
                  })}
                />
              </label>
              <label className="block">
                <span className="label">{t('profiles.fields.contributorSubtype')}</span>
                <input
                  className="input mt-1"
                  maxLength={20}
                  disabled={saving}
                  {...form.register('contributorSubtype')}
                />
              </label>
              <label className="block">
                <span className="label">{t('profiles.fields.contractKind')}</span>
                <select className="input mt-1" disabled={saving} {...form.register('contractKind')}>
                  {(
                    ['indefinite', 'fixed_term', 'work_or_task', 'apprenticeship', 'other'] as const
                  ).map(kind => (
                    <option key={kind} value={kind}>
                      {t(`profiles.contractKinds.${kind}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">{t('profiles.fields.arlRiskClass')}</span>
                <select className="input mt-1" disabled={saving} {...form.register('arlRiskClass')}>
                  {[1, 2, 3, 4, 5].map(value => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              {(['healthEntity', 'pensionEntity', 'compensationFund'] as const).map(field => (
                <label className="block" key={field}>
                  <span className="label">{t(`profiles.fields.${field}`)}</span>
                  <input
                    className="input mt-1"
                    maxLength={120}
                    disabled={saving}
                    {...form.register(field)}
                  />
                </label>
              ))}
              <label className="block">
                <span className="label">{t('profiles.fields.paymentMethod')}</span>
                <select
                  className="input mt-1"
                  disabled={saving}
                  {...form.register('paymentMethod')}
                >
                  {(['cash', 'transfer', 'other'] as const).map(method => (
                    <option key={method} value={method}>
                      {t(`profiles.paymentMethods.${method}`)}
                    </option>
                  ))}
                </select>
              </label>
              {paymentMethod === 'transfer' && (
                <label className="block">
                  <span className="label">{t('profiles.fields.paymentAccountLast4')}</span>
                  <input
                    className="input mt-1"
                    inputMode="numeric"
                    maxLength={4}
                    autoComplete="off"
                    disabled={saving}
                    {...form.register('paymentAccountLast4', {
                      validate: value => /^\d{4}$/.test(value) || t('validation.accountLast4'),
                    })}
                  />
                </label>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" disabled={saving} {...form.register('integralSalary')} />
                {t('profiles.fields.integralSalary')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={saving}
                  {...form.register('transportAssistanceEligible')}
                />
                {t('profiles.fields.transportAssistanceEligible')}
              </label>
            </>
          )}
          {editor.action === 'end' && (
            <label className="block sm:col-span-2">
              <span className="label">{t('profiles.fields.effectiveUntil')}</span>
              <input
                type="date"
                className="input mt-1"
                disabled={saving}
                {...form.register('effectiveUntil', {
                  validate: value =>
                    (!!row &&
                      isPayrollWindow(row.effectiveFrom, value) &&
                      (row.effectiveUntil === null || value < row.effectiveUntil)) ||
                    t('validation.window'),
                })}
              />
            </label>
          )}
          <label className="block sm:col-span-2">
            <span className="label">{t('fields.reason')}</span>
            <textarea
              className="input mt-1 min-h-24"
              maxLength={500}
              disabled={saving}
              {...form.register('reason', {
                validate: value => value.trim().length >= 10 || t('validation.reason'),
              })}
            />
          </label>
          {error && (
            <p role="alert" className="text-danger-700 sm:col-span-2">
              {error}
            </p>
          )}
        </form>
      )}
    </Modal>
  );
}
