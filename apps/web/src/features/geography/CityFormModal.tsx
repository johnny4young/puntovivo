import { useState } from 'react';
import { MapPinned, Settings2 } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { AdvancedDisclosure } from '@/components/experience/AdvancedDisclosure';
import { QuickFormSection } from '@/components/experience/QuickFormSection';
import type { City, Department } from '@/types';
import { GeographyFormFrame } from './GeographyFormFrame';

export interface CityFormValues {
  departmentId: string;
  code: string;
  name: string;
  isActive: boolean;
}

function createCityFormValues(city: City | null, defaultDepartmentId: string): CityFormValues {
  return city
    ? {
        departmentId: city.departmentId,
        code: city.code,
        name: city.name,
        isActive: city.isActive,
      }
    : { departmentId: defaultDepartmentId, code: '', name: '', isActive: true };
}

interface CityFormModalProps {
  isOpen: boolean;
  city: City | null;
  departments: Department[];
  defaultDepartmentId: string;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: CityFormValues) => Promise<void>;
}

export function CityFormModal({
  isOpen,
  city,
  departments,
  defaultDepartmentId,
  isSaving,
  error,
  onClose,
  onSubmit,
}: CityFormModalProps): React.ReactElement {
  const { t } = useTranslation('geography');
  const [advancedOpen, setAdvancedOpen] = useState(!city);
  const form = useForm<CityFormValues>({
    defaultValues: createCityFormValues(city, defaultDepartmentId),
  });
  const departmentId = useWatch({ control: form.control, name: 'departmentId' });
  const code = useWatch({ control: form.control, name: 'code' });
  const isActive = useWatch({ control: form.control, name: 'isActive' });
  const selectedDepartment = departments.find(department => department.id === departmentId) ?? null;
  const submit = form.handleSubmit(onSubmit, errors => {
    if (errors.departmentId || errors.code) setAdvancedOpen(true);
  });

  return (
    <GeographyFormFrame
      isOpen={isOpen}
      title={t(city ? 'form.city.editTitle' : 'form.city.createTitle')}
      submitLabel={t(city ? 'form.saveChanges' : 'form.city.create')}
      isSaving={isSaving}
      isDirty={form.formState.isDirty}
      firstFieldId="city-name"
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      {selectedDepartment ? (
        <div className="rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-900">
          <span className="font-semibold">{t('form.context.location')}:</span>{' '}
          {[selectedDepartment.countryName, selectedDepartment.name].filter(Boolean).join(' / ')}
        </div>
      ) : null}

      <QuickFormSection
        icon={MapPinned}
        eyebrow={t('levels.city')}
        title={t('form.essential.title')}
        description={t('form.city.essentialDescription')}
        headingLevel={4}
      >
        <div>
          <label htmlFor="city-name" className="label">
            {t('form.fields.visibleName')}
          </label>
          <input
            id="city-name"
            className="input mt-1"
            autoComplete="off"
            maxLength={255}
            {...form.register('name', {
              required: t('form.city.fields.nameRequired'),
              validate: value => value.trim().length > 0 || t('form.city.fields.nameRequired'),
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
        description={t('form.city.officialDescription')}
        status={t('form.official.summary', {
          code: code.trim() || t('form.official.codePending'),
          status: isActive ? t('form.official.available') : t('form.official.unavailable'),
        })}
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
      >
        <div>
          <label htmlFor="city-department" className="label">
            {t('form.city.fields.department')}
          </label>
          <select
            id="city-department"
            className="input mt-1"
            {...form.register('departmentId', {
              required: t('form.city.fields.departmentRequired'),
            })}
          >
            <option value="">{t('form.city.fields.selectDepartment')}</option>
            {departments.map(department => (
              <option key={department.id} value={department.id} disabled={!department.isActive}>
                {department.name} ({department.code})
                {department.countryName ? ` - ${department.countryName}` : ''}
              </option>
            ))}
          </select>
          {form.formState.errors.departmentId ? (
            <p className="mt-1 text-sm text-danger-500">
              {form.formState.errors.departmentId.message}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="city-code" className="label">
            {t('form.city.fields.code')}
          </label>
          <input
            id="city-code"
            className="input mt-1 font-mono uppercase"
            autoComplete="off"
            maxLength={50}
            aria-describedby="city-code-help"
            {...form.register('code', {
              required: t('form.city.fields.codeRequired'),
              validate: value => value.trim().length > 0 || t('form.city.fields.codeRequired'),
            })}
          />
          <p id="city-code-help" className="mt-2 text-xs leading-5 text-secondary-500">
            {t('form.city.fields.codeHelp')}
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
              {t('form.city.fields.availabilityHelp')}
            </span>
          </span>
        </label>
      </AdvancedDisclosure>
    </GeographyFormFrame>
  );
}
