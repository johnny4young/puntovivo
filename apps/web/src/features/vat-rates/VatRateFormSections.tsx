import { BadgePercent } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { QuickFormSection } from '@/components/experience/QuickFormSection';
import type { VatRateFormValues } from './vatRateForm.types';

interface VatRateEssentialSectionProps {
  form: UseFormReturn<VatRateFormValues>;
}

export function VatRateEssentialSection({
  form,
}: VatRateEssentialSectionProps): React.ReactElement {
  const { t } = useTranslation('vatRates');

  return (
    <QuickFormSection
      icon={BadgePercent}
      eyebrow={t('form.essential.eyebrow')}
      title={t('form.essential.title')}
      description={t('form.essential.description')}
      headingLevel={4}
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_10rem]">
        <div>
          <label htmlFor="vat-rate-name" className="label">
            {t('form.fields.name')}
          </label>
          <input
            id="vat-rate-name"
            className="input mt-1"
            autoComplete="off"
            {...form.register('name', {
              required: t('form.fields.nameRequired'),
              validate: value => value.trim().length > 0 || t('form.fields.nameRequired'),
            })}
          />
          {form.formState.errors.name ? (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="vat-rate-value" className="label">
            {t('form.fields.percentage')}
          </label>
          <div className="relative mt-1">
            <input
              id="vat-rate-value"
              type="number"
              min="0"
              max="100"
              step="0.01"
              inputMode="decimal"
              className="input pr-10"
              {...form.register('rate', {
                valueAsNumber: true,
                required: t('form.fields.rateRequired'),
                validate: value => Number.isFinite(value) || t('form.fields.rateRequired'),
                min: {
                  value: 0,
                  message: t('form.fields.rateNonNegative'),
                },
                max: {
                  value: 100,
                  message: t('form.fields.rateMax'),
                },
              })}
            />
            <span
              className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-secondary-500"
              aria-hidden="true"
            >
              %
            </span>
          </div>
          {form.formState.errors.rate ? (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.rate.message}</p>
          ) : null}
        </div>
      </div>
    </QuickFormSection>
  );
}

interface VatRateAvailabilityFieldsProps {
  form: UseFormReturn<VatRateFormValues>;
}

export function VatRateAvailabilityFields({
  form,
}: VatRateAvailabilityFieldsProps): React.ReactElement {
  const { t } = useTranslation('vatRates');

  return (
    <fieldset className="rounded-xl border border-line bg-card p-4">
      <legend className="px-1 text-sm font-semibold text-secondary-900">
        {t('form.advanced.statusTitle')}
      </legend>
      <div className="flex items-start gap-3 text-sm text-secondary-700">
        <input
          id="vat-rate-active"
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-secondary-300"
          aria-describedby="vat-rate-active-help"
          {...form.register('isActive')}
        />
        <span>
          <label htmlFor="vat-rate-active" className="block font-medium text-secondary-900">
            {t('form.fields.isActive')}
          </label>
          <span
            id="vat-rate-active-help"
            className="mt-1 block text-xs leading-5 text-secondary-500"
          >
            {t('form.fields.isActiveHelp')}
          </span>
        </span>
      </div>
    </fieldset>
  );
}
