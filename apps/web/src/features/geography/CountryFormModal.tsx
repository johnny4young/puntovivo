import { useState } from 'react';
import { Flag, Settings2 } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { AdvancedDisclosure } from '@/components/experience/AdvancedDisclosure';
import { QuickFormSection } from '@/components/experience/QuickFormSection';
import type { Country } from '@/types';
import { GeographyFormFrame } from './GeographyFormFrame';

export interface CountryFormValues {
  code: string;
  name: string;
  isActive: boolean;
}

function createCountryFormValues(country: Country | null): CountryFormValues {
  return country
    ? { code: country.code, name: country.name, isActive: country.isActive }
    : { code: '', name: '', isActive: true };
}

interface CountryFormModalProps {
  isOpen: boolean;
  country: Country | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: CountryFormValues) => Promise<void>;
}

export function CountryFormModal({
  isOpen,
  country,
  isSaving,
  error,
  onClose,
  onSubmit,
}: CountryFormModalProps): React.ReactElement {
  const { t } = useTranslation('geography');
  const [advancedOpen, setAdvancedOpen] = useState(!country);
  const form = useForm<CountryFormValues>({ defaultValues: createCountryFormValues(country) });
  const isActive = useWatch({ control: form.control, name: 'isActive' });
  const code = useWatch({ control: form.control, name: 'code' });
  const submit = form.handleSubmit(onSubmit, errors => {
    if (errors.code) setAdvancedOpen(true);
  });

  return (
    <GeographyFormFrame
      isOpen={isOpen}
      title={t(country ? 'form.country.editTitle' : 'form.country.createTitle')}
      submitLabel={t(country ? 'form.saveChanges' : 'form.country.create')}
      isSaving={isSaving}
      isDirty={form.formState.isDirty}
      firstFieldId="country-name"
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <QuickFormSection
        icon={Flag}
        eyebrow={t('levels.country')}
        title={t('form.essential.title')}
        description={t('form.country.essentialDescription')}
        headingLevel={4}
      >
        <div>
          <label htmlFor="country-name" className="label">
            {t('form.fields.visibleName')}
          </label>
          <input
            id="country-name"
            className="input mt-1"
            autoComplete="off"
            maxLength={255}
            {...form.register('name', {
              required: t('form.country.fields.nameRequired'),
              validate: value => value.trim().length > 0 || t('form.country.fields.nameRequired'),
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
        description={t('form.country.officialDescription')}
        status={t('form.official.summary', {
          code: code.trim() || t('form.official.codePending'),
          status: isActive ? t('form.official.available') : t('form.official.unavailable'),
        })}
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
      >
        <div>
          <label htmlFor="country-code" className="label">
            {t('form.country.fields.code')}
          </label>
          <input
            id="country-code"
            className="input mt-1 font-mono uppercase"
            autoComplete="off"
            maxLength={50}
            aria-describedby="country-code-help"
            {...form.register('code', {
              required: t('form.country.fields.codeRequired'),
              validate: value => value.trim().length > 0 || t('form.country.fields.codeRequired'),
            })}
          />
          <p id="country-code-help" className="mt-2 text-xs leading-5 text-secondary-500">
            {t('form.country.fields.codeHelp')}
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
              {t('form.country.fields.availabilityHelp')}
            </span>
          </span>
        </label>
      </AdvancedDisclosure>
    </GeographyFormFrame>
  );
}
