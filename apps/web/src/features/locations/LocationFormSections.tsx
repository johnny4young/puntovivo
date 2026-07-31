import { MapPinned } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { QuickFormSection } from '@/components/experience/QuickFormSection';
import type { LocationFormValues } from './locationForm.types';

interface LocationEssentialSectionProps {
  form: UseFormReturn<LocationFormValues>;
}

export function LocationEssentialSection({
  form,
}: LocationEssentialSectionProps): React.ReactElement {
  const { t } = useTranslation('locations');

  return (
    <QuickFormSection
      icon={MapPinned}
      eyebrow={t('columns.location')}
      title={t('form.essential.title')}
      description={t('form.essential.description')}
      headingLevel={4}
    >
      <div className="grid gap-4 md:grid-cols-[11rem_minmax(0,1fr)]">
        <div>
          <label htmlFor="location-code" className="label">
            {t('form.fields.code')}
          </label>
          <input
            id="location-code"
            className="input mt-1"
            autoComplete="off"
            {...form.register('code', {
              required: t('form.fields.codeRequired'),
            })}
          />
          {form.formState.errors.code ? (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.code.message}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="location-name" className="label">
            {t('form.fields.name')}
          </label>
          <input
            id="location-name"
            className="input mt-1"
            autoComplete="off"
            {...form.register('name', {
              required: t('form.fields.nameRequired'),
            })}
          />
          {form.formState.errors.name ? (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
          ) : null}
        </div>
      </div>
    </QuickFormSection>
  );
}

interface LocationAdvancedFieldsProps {
  form: UseFormReturn<LocationFormValues>;
}

export function LocationAdvancedFields({
  form,
}: LocationAdvancedFieldsProps): React.ReactElement {
  const { t } = useTranslation('locations');

  return (
    <>
      <div className="rounded-xl border border-line bg-card p-4">
        <label htmlFor="location-description" className="label">
          {t('form.fields.description')}
        </label>
        <textarea
          id="location-description"
          className="input mt-1 min-h-[88px]"
          {...form.register('description')}
        />
      </div>

      <fieldset className="rounded-xl border border-line bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-secondary-900">
          {t('columns.status')}
        </legend>
        <label className="flex items-center gap-3 text-sm text-secondary-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-secondary-300"
            {...form.register('isActive')}
          />
          {t('form.fields.isActive')}
        </label>
      </fieldset>
    </>
  );
}
