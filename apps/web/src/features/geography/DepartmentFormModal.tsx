import { useState } from 'react';
import { Building2, Settings2 } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { AdvancedDisclosure } from '@/components/experience/AdvancedDisclosure';
import { QuickFormSection } from '@/components/experience/QuickFormSection';
import type { Country, Department } from '@/types';
import { GeographyFormFrame } from './GeographyFormFrame';

export interface DepartmentFormValues {
  countryId: string;
  code: string;
  name: string;
  isActive: boolean;
}

function createDepartmentFormValues(
  department: Department | null,
  defaultCountryId: string
): DepartmentFormValues {
  return department
    ? {
        countryId: department.countryId ?? '',
        code: department.code,
        name: department.name,
        isActive: department.isActive,
      }
    : { countryId: defaultCountryId, code: '', name: '', isActive: true };
}

interface DepartmentFormModalProps {
  isOpen: boolean;
  department: Department | null;
  countries: Country[];
  defaultCountryId: string;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: DepartmentFormValues) => Promise<void>;
}

export function DepartmentFormModal({
  isOpen,
  department,
  countries,
  defaultCountryId,
  isSaving,
  error,
  onClose,
  onSubmit,
}: DepartmentFormModalProps): React.ReactElement {
  const { t } = useTranslation('geography');
  const [advancedOpen, setAdvancedOpen] = useState(!department);
  const form = useForm<DepartmentFormValues>({
    defaultValues: createDepartmentFormValues(department, defaultCountryId),
  });
  const countryId = useWatch({ control: form.control, name: 'countryId' });
  const code = useWatch({ control: form.control, name: 'code' });
  const isActive = useWatch({ control: form.control, name: 'isActive' });
  const selectedCountry = countries.find(country => country.id === countryId) ?? null;
  const submit = form.handleSubmit(onSubmit, errors => {
    if (errors.countryId || errors.code) setAdvancedOpen(true);
  });

  return (
    <GeographyFormFrame
      isOpen={isOpen}
      title={t(department ? 'form.department.editTitle' : 'form.department.createTitle')}
      submitLabel={t(department ? 'form.saveChanges' : 'form.department.create')}
      isSaving={isSaving}
      isDirty={form.formState.isDirty}
      firstFieldId="department-name"
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      {selectedCountry ? (
        <div className="rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-900">
          <span className="font-semibold">{t('form.context.country')}:</span> {selectedCountry.name}
        </div>
      ) : null}

      <QuickFormSection
        icon={Building2}
        eyebrow={t('levels.department')}
        title={t('form.essential.title')}
        description={t('form.department.essentialDescription')}
        headingLevel={4}
      >
        <div>
          <label htmlFor="department-name" className="label">
            {t('form.fields.visibleName')}
          </label>
          <input
            id="department-name"
            className="input mt-1"
            autoComplete="off"
            maxLength={255}
            {...form.register('name', {
              required: t('form.department.fields.nameRequired'),
              validate: value =>
                value.trim().length > 0 || t('form.department.fields.nameRequired'),
            })}
          />
          {form.formState.errors.name ? (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
          ) : null}
        </div>
      </QuickFormSection>

      <AdvancedDisclosure
        icon={Settings2}
        title={t('form.official.title')}
        description={t('form.department.officialDescription')}
        status={t('form.official.summary', {
          code: code.trim() || t('form.official.codePending'),
          status: isActive ? t('form.official.available') : t('form.official.unavailable'),
        })}
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
      >
        <div>
          <label htmlFor="department-country" className="label">
            {t('form.department.fields.country')}
          </label>
          <select
            id="department-country"
            className="input mt-1"
            {...form.register('countryId', {
              required: t('form.department.fields.countryRequired'),
            })}
          >
            <option value="">{t('form.department.fields.selectCountry')}</option>
            {countries.map(country => (
              <option key={country.id} value={country.id} disabled={!country.isActive}>
                {country.name} ({country.code})
              </option>
            ))}
          </select>
          {form.formState.errors.countryId ? (
            <p className="mt-1 text-sm text-danger-500">
              {form.formState.errors.countryId.message}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="department-code" className="label">
            {t('form.department.fields.code')}
          </label>
          <input
            id="department-code"
            className="input mt-1 font-mono uppercase"
            autoComplete="off"
            maxLength={50}
            aria-describedby="department-code-help"
            {...form.register('code', {
              required: t('form.department.fields.codeRequired'),
              validate: value =>
                value.trim().length > 0 || t('form.department.fields.codeRequired'),
            })}
          />
          <p id="department-code-help" className="mt-2 text-xs leading-5 text-secondary-500">
            {t('form.department.fields.codeHelp')}
          </p>
          {form.formState.errors.code ? (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.code.message}</p>
          ) : null}
        </div>
        <label className="flex items-start gap-3 rounded-xl border border-line bg-card p-4 text-sm text-secondary-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-secondary-300"
            {...form.register('isActive')}
          />
          <span>
            <span className="block font-medium text-secondary-900">
              {t('form.fields.available')}
            </span>
            <span className="mt-1 block text-xs leading-5 text-secondary-500">
              {t('form.department.fields.availabilityHelp')}
            </span>
          </span>
        </label>
      </AdvancedDisclosure>
    </GeographyFormFrame>
  );
}
