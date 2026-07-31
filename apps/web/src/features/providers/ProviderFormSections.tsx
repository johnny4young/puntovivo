import { ContactRound } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { QuickFormSection } from '@/components/experience/QuickFormSection';
import type { City } from '@/types';
import type { ProviderFormValues } from './providerForm.types';

interface ProviderEssentialSectionProps {
  form: UseFormReturn<ProviderFormValues>;
}

export function ProviderEssentialSection({
  form,
}: ProviderEssentialSectionProps): React.ReactElement {
  const { t } = useTranslation('settings');

  return (
    <QuickFormSection
      icon={ContactRound}
      eyebrow={t('providers.form.essential.eyebrow')}
      title={t('providers.form.essential.title')}
      description={t('providers.form.essential.description')}
      headingLevel={4}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label htmlFor="provider-name" className="label">
            {t('providers.form.fields.name')}
          </label>
          <input
            id="provider-name"
            className="input mt-1"
            autoComplete="organization"
            {...form.register('name', { required: t('providers.form.fields.nameRequired') })}
          />
          {form.formState.errors.name ? (
            <p className="mt-1 text-sm text-danger-500">
              {form.formState.errors.name.message}
            </p>
          ) : null}
        </div>

        <div className="md:col-span-2">
          <label htmlFor="provider-contact" className="label">
            {t('providers.form.fields.contactName')}
          </label>
          <input
            id="provider-contact"
            className="input mt-1"
            autoComplete="name"
            {...form.register('contactName')}
          />
        </div>

        <div>
          <label htmlFor="provider-phone" className="label">
            {t('providers.form.fields.phone')}
          </label>
          <input
            id="provider-phone"
            type="tel"
            className="input mt-1"
            autoComplete="tel"
            {...form.register('phone')}
          />
        </div>

        <div>
          <label htmlFor="provider-email" className="label">
            {t('providers.form.fields.email')}
          </label>
          <input
            id="provider-email"
            type="email"
            className="input mt-1"
            autoComplete="email"
            {...form.register('email', {
              pattern: {
                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                message: t('providers.form.fields.emailInvalid'),
              },
            })}
          />
          {form.formState.errors.email ? (
            <p className="mt-1 text-sm text-danger-500">
              {form.formState.errors.email.message}
            </p>
          ) : null}
        </div>
      </div>
    </QuickFormSection>
  );
}

interface ProviderAdvancedFieldsProps {
  form: UseFormReturn<ProviderFormValues>;
  cities: City[];
}

export function ProviderAdvancedFields({
  form,
  cities,
}: ProviderAdvancedFieldsProps): React.ReactElement {
  const { t } = useTranslation('settings');

  return (
    <>
      <fieldset className="grid gap-4 rounded-xl border border-line bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-secondary-900">
          {t('providers.form.advanced.billingTitle')}
        </legend>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="provider-tax-id" className="label">
              {t('providers.form.fields.taxId')}
            </label>
            <input id="provider-tax-id" className="input mt-1" {...form.register('taxId')} />
          </div>

          <div>
            <label htmlFor="provider-city" className="label">
              {t('providers.form.fields.city')}
            </label>
            <select id="provider-city" className="input mt-1" {...form.register('cityId')}>
              <option value="">{t('providers.form.fields.noCity')}</option>
              {cities.map(city => (
                <option key={city.id} value={city.id} disabled={!city.isActive}>
                  {city.name}
                  {city.departmentName ? ` - ${city.departmentName}` : ''}
                  {city.countryName ? `, ${city.countryName}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="provider-address" className="label">
            {t('providers.form.fields.address')}
          </label>
          <textarea
            id="provider-address"
            className="input mt-1 min-h-[88px]"
            autoComplete="street-address"
            {...form.register('address')}
          />
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-line bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-secondary-900">
          {t('providers.form.advanced.statusTitle')}
        </legend>
        <label className="flex items-center gap-3 text-sm text-secondary-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-secondary-300"
            {...form.register('isActive')}
          />
          {t('providers.form.fields.isActive')}
        </label>
      </fieldset>
    </>
  );
}
