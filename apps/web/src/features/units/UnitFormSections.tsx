import { Ruler } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { UNIT_DIMENSIONS } from '@puntovivo/shared/units';

import { QuickFormSection } from '@/components/experience/QuickFormSection';
import type { UnitFormValues } from './unitForm.types';

interface UnitEssentialSectionProps {
  form: UseFormReturn<UnitFormValues>;
}

export function UnitEssentialSection({ form }: UnitEssentialSectionProps): React.ReactElement {
  const { t } = useTranslation('settings');

  return (
    <QuickFormSection
      icon={Ruler}
      eyebrow={t('units.form.essential.eyebrow')}
      title={t('units.form.essential.title')}
      description={t('units.form.essential.description')}
      headingLevel={4}
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_10rem]">
        <div>
          <label htmlFor="unit-name" className="label">
            {t('units.form.fields.name')}
          </label>
          <input
            id="unit-name"
            className="input mt-1"
            autoComplete="off"
            {...form.register('name', {
              required: t('units.form.fields.nameRequired'),
            })}
          />
          {form.formState.errors.name ? (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="unit-abbreviation" className="label">
            {t('units.form.fields.abbreviation')}
          </label>
          <input
            id="unit-abbreviation"
            className="input mt-1"
            autoComplete="off"
            {...form.register('abbreviation', {
              required: t('units.form.fields.abbreviationRequired'),
            })}
          />
          {form.formState.errors.abbreviation ? (
            <p className="mt-1 text-sm text-danger-500">
              {form.formState.errors.abbreviation.message}
            </p>
          ) : null}
        </div>
      </div>
    </QuickFormSection>
  );
}

interface UnitAdvancedFieldsProps {
  form: UseFormReturn<UnitFormValues>;
}

export function UnitAdvancedFields({ form }: UnitAdvancedFieldsProps): React.ReactElement {
  const { t } = useTranslation('settings');

  return (
    <>
      <fieldset className="grid gap-4 rounded-xl border border-line bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-secondary-900">
          {t('units.form.advanced.classificationTitle')}
        </legend>

        <div>
          <label htmlFor="unit-dimension" className="label">
            {t('units.form.fields.dimension')}
          </label>
          <select id="unit-dimension" className="input mt-1" {...form.register('dimension')}>
            <option value="">{t('units.form.fields.dimensionAuto')}</option>
            {UNIT_DIMENSIONS.map(dimension => (
              <option key={dimension} value={dimension}>
                {t(`units.dimensions.${dimension}`)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs leading-5 text-secondary-500">
            {t('units.form.fields.dimensionHint')}
          </p>
        </div>

        <div>
          <label htmlFor="unit-standard-code" className="label">
            {t('units.form.fields.standardCode')}
          </label>
          <input
            id="unit-standard-code"
            className="input mt-1"
            placeholder={t('units.form.fields.standardCodePlaceholder')}
            autoComplete="off"
            {...form.register('standardCode')}
          />
          <p className="mt-1 text-xs leading-5 text-secondary-500">
            {t('units.form.fields.standardCodeHint')}
          </p>
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-line bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-secondary-900">
          {t('units.form.advanced.statusTitle')}
        </legend>
        <label className="flex items-center gap-3 text-sm text-secondary-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-secondary-300"
            {...form.register('isActive')}
          />
          {t('units.form.fields.isActive')}
        </label>
      </fieldset>
    </>
  );
}
