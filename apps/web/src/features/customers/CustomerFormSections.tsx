import { ContactRound } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { QuickFormSection } from '@/components/experience/QuickFormSection';
import type { CustomerCatalogItem } from '@/types';
import { CustomerCatalogSelect } from './CustomerCatalogSelect';
import type { CustomerFormValues } from './customerForm.types';

interface CustomerEssentialSectionProps {
  form: UseFormReturn<CustomerFormValues>;
}

export function CustomerEssentialSection({
  form,
}: CustomerEssentialSectionProps): React.ReactElement {
  const { t } = useTranslation('customers');

  return (
    <QuickFormSection
      icon={ContactRound}
      eyebrow={t('form.essential.eyebrow')}
      title={t('form.essential.title')}
      description={t('form.essential.description')}
      headingLevel={4}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label htmlFor="customer-name" className="label">
            {t('form.fields.name')}
          </label>
          <input
            id="customer-name"
            className="input mt-1"
            autoComplete="name"
            {...form.register('name', { required: t('form.fields.nameRequired') })}
          />
          {form.formState.errors.name ? (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="customer-phone" className="label">
            {t('form.fields.phone')}
          </label>
          <input
            id="customer-phone"
            type="tel"
            className="input mt-1"
            autoComplete="tel"
            {...form.register('phone')}
          />
        </div>

        <div>
          <label htmlFor="customer-email" className="label">
            {t('form.fields.email')}
          </label>
          <input
            id="customer-email"
            type="email"
            className="input mt-1"
            autoComplete="email"
            {...form.register('email', {
              pattern: {
                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                message: t('form.fields.emailInvalid'),
              },
            })}
          />
          {form.formState.errors.email ? (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.email.message}</p>
          ) : null}
        </div>
      </div>
    </QuickFormSection>
  );
}

interface CustomerAdvancedFieldsProps {
  form: UseFormReturn<CustomerFormValues>;
  identificationTypes: CustomerCatalogItem[];
  personTypes: CustomerCatalogItem[];
  regimeTypes: CustomerCatalogItem[];
  clientTypes: CustomerCatalogItem[];
  commercialActivities: CustomerCatalogItem[];
}

export function CustomerAdvancedFields({
  form,
  identificationTypes,
  personTypes,
  regimeTypes,
  clientTypes,
  commercialActivities,
}: CustomerAdvancedFieldsProps): React.ReactElement {
  const { t } = useTranslation('customers');

  return (
    <>
      <fieldset className="grid gap-4 rounded-xl border border-line bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-secondary-900">
          {t('form.advanced.billingTitle')}
        </legend>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="customer-tax-id" className="label">
              {t('form.fields.taxId')}
            </label>
            <input id="customer-tax-id" className="input mt-1" {...form.register('taxId')} />
          </div>
          <CustomerCatalogSelect
            catalog="identificationTypes"
            id="customer-identification-type"
            label={t('form.fields.identificationType')}
            placeholder={t('form.fields.notSet')}
            options={identificationTypes}
            registration={form.register('identificationTypeId')}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <CustomerCatalogSelect
            catalog="personTypes"
            id="customer-person-type"
            label={t('form.fields.personType')}
            placeholder={t('form.fields.notSet')}
            options={personTypes}
            registration={form.register('personTypeId')}
          />
          <CustomerCatalogSelect
            catalog="regimeTypes"
            id="customer-regime-type"
            label={t('form.fields.regimeType')}
            placeholder={t('form.fields.notSet')}
            options={regimeTypes}
            registration={form.register('regimeTypeId')}
          />
          <CustomerCatalogSelect
            catalog="clientTypes"
            id="customer-client-type"
            label={t('form.fields.clientType')}
            placeholder={t('form.fields.notSet')}
            options={clientTypes}
            registration={form.register('clientTypeId')}
          />
          <CustomerCatalogSelect
            catalog="commercialActivities"
            id="customer-commercial-activity"
            label={t('form.fields.commercialActivity')}
            placeholder={t('form.fields.notSet')}
            options={commercialActivities}
            registration={form.register('commercialActivityId')}
          />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 rounded-xl border border-line bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-secondary-900">
          {t('form.advanced.locationTitle')}
        </legend>
        <div>
          <label htmlFor="customer-address" className="label">
            {t('form.fields.address')}
          </label>
          <textarea
            id="customer-address"
            className="input mt-1 min-h-[88px]"
            autoComplete="street-address"
            {...form.register('address')}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label htmlFor="customer-city" className="label">
              {t('form.fields.city')}
            </label>
            <input
              id="customer-city"
              className="input mt-1"
              autoComplete="address-level2"
              {...form.register('city')}
            />
          </div>
          <div>
            <label htmlFor="customer-state" className="label">
              {t('form.fields.state')}
            </label>
            <input
              id="customer-state"
              className="input mt-1"
              autoComplete="address-level1"
              {...form.register('state')}
            />
          </div>
          <div>
            <label htmlFor="customer-postal-code" className="label">
              {t('form.fields.postalCode')}
            </label>
            <input
              id="customer-postal-code"
              className="input mt-1"
              autoComplete="postal-code"
              {...form.register('postalCode')}
            />
          </div>
          <div>
            <label htmlFor="customer-country" className="label">
              {t('form.fields.country')}
            </label>
            <input
              id="customer-country"
              className="input mt-1"
              autoComplete="country-name"
              {...form.register('country')}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 rounded-xl border border-line bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-secondary-900">
          {t('form.advanced.accountTitle')}
        </legend>
        <div>
          <label htmlFor="customer-notes" className="label">
            {t('form.fields.notes')}
          </label>
          <textarea
            id="customer-notes"
            className="input mt-1 min-h-[96px]"
            {...form.register('notes')}
          />
        </div>
        <div>
          <label htmlFor="customer-credit-limit" className="label">
            {t('form.fields.creditLimit.label')}
          </label>
          <input
            id="customer-credit-limit"
            type="number"
            min={0}
            step="0.01"
            className="input mt-1"
            placeholder={t('form.fields.creditLimit.placeholder')}
            data-testid="customer-credit-limit-input"
            {...form.register('creditLimit', {
              valueAsNumber: true,
              min: {
                value: 0,
                message: t('form.fields.creditLimit.invalid'),
              },
              validate: value => Number.isFinite(value) || t('form.fields.creditLimit.invalid'),
            })}
          />
          <p className="mt-1 text-xs text-secondary-500">{t('form.fields.creditLimit.help')}</p>
          {form.formState.errors.creditLimit ? (
            <p className="mt-1 text-sm text-danger-500">
              {form.formState.errors.creditLimit.message}
            </p>
          ) : null}
        </div>
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
