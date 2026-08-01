import { BadgeCheck } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { QuickFormSection } from '@/components/experience/QuickFormSection';
import type { CustomerCatalogFormValues } from './customerCatalogForm.types';

interface CustomerCatalogEssentialSectionProps {
  form: UseFormReturn<CustomerCatalogFormValues>;
  singularLabel: string;
}

export function CustomerCatalogEssentialSection({
  form,
  singularLabel,
}: CustomerCatalogEssentialSectionProps): React.ReactElement {
  const { t } = useTranslation('customerCatalogs');

  return (
    <QuickFormSection
      icon={BadgeCheck}
      eyebrow={singularLabel}
      title={t('form.essential.title')}
      description={t('form.essential.description')}
      headingLevel={4}
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(10rem,0.55fr)]">
        <div>
          <label htmlFor="catalog-name" className="label">
            {t('form.fields.name')}
          </label>
          <input
            id="catalog-name"
            className="input mt-1"
            autoComplete="off"
            maxLength={255}
            {...form.register('name', {
              required: t('form.fields.nameRequired', { type: singularLabel }),
              validate: value =>
                value.trim().length > 0 || t('form.fields.nameRequired', { type: singularLabel }),
            })}
          />
          {form.formState.errors.name ? (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="catalog-code" className="label">
            {t('form.fields.code')}
          </label>
          <input
            id="catalog-code"
            className="input mt-1 font-mono"
            autoComplete="off"
            maxLength={50}
            aria-describedby="catalog-code-help"
            {...form.register('code', {
              required: t('form.fields.codeRequired', { type: singularLabel }),
              validate: value =>
                value.trim().length > 0 || t('form.fields.codeRequired', { type: singularLabel }),
            })}
          />
          <p id="catalog-code-help" className="mt-2 text-xs leading-5 text-secondary-500">
            {t('form.fields.codeHelp')}
          </p>
          {form.formState.errors.code ? (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.code.message}</p>
          ) : null}
        </div>
      </div>
    </QuickFormSection>
  );
}

interface CustomerCatalogAdvancedFieldsProps {
  form: UseFormReturn<CustomerCatalogFormValues>;
}

export function CustomerCatalogAdvancedFields({
  form,
}: CustomerCatalogAdvancedFieldsProps): React.ReactElement {
  const { t } = useTranslation('customerCatalogs');

  return (
    <>
      <div className="rounded-xl border border-line bg-card p-4">
        <label htmlFor="catalog-description" className="label">
          {t('form.fields.description')}
        </label>
        <textarea
          id="catalog-description"
          className="input mt-1 min-h-[88px]"
          {...form.register('description')}
        />
        <p className="mt-2 text-xs leading-5 text-secondary-500">
          {t('form.fields.descriptionHelp')}
        </p>
      </div>

      <fieldset className="rounded-xl border border-line bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-secondary-900">
          {t('form.advanced.statusTitle')}
        </legend>
        <div className="flex items-start gap-3 text-sm text-secondary-700">
          <input
            id="catalog-is-active"
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-secondary-300"
            aria-describedby="catalog-is-active-help"
            {...form.register('isActive')}
          />
          <span>
            <label htmlFor="catalog-is-active" className="block font-medium text-secondary-900">
              {t('form.fields.isActive')}
            </label>
            <span
              id="catalog-is-active-help"
              className="mt-1 block text-xs leading-5 text-secondary-500"
            >
              {t('form.fields.isActiveHelp')}
            </span>
          </span>
        </div>
      </fieldset>
    </>
  );
}
