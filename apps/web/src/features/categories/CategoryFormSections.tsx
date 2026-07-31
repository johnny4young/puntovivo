import { FolderTree } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { QuickFormSection } from '@/components/experience/QuickFormSection';
import type { CategoryFormValues, CategoryLookupOption } from './categoryForm.types';

interface CategoryEssentialSectionProps {
  form: UseFormReturn<CategoryFormValues>;
}

export function CategoryEssentialSection({
  form,
}: CategoryEssentialSectionProps): React.ReactElement {
  const { t } = useTranslation('categories');

  return (
    <QuickFormSection
      icon={FolderTree}
      eyebrow={t('columns.category')}
      title={t('form.essential.title')}
      description={t('form.essential.description')}
      headingLevel={4}
    >
      <div>
        <label htmlFor="category-name" className="label">
          {t('form.fields.name')}
        </label>
        <input
          id="category-name"
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
    </QuickFormSection>
  );
}

interface CategoryAdvancedFieldsProps {
  form: UseFormReturn<CategoryFormValues>;
  parentOptions: CategoryLookupOption[];
}

export function CategoryAdvancedFields({
  form,
  parentOptions,
}: CategoryAdvancedFieldsProps): React.ReactElement {
  const { t } = useTranslation('categories');

  return (
    <>
      <div className="rounded-xl border border-line bg-card p-4">
        <label htmlFor="category-parent" className="label">
          {t('form.fields.parentCategory')}
        </label>
        <select id="category-parent" className="input mt-1" {...form.register('parentId')}>
          <option value="">{t('form.fields.noParent')}</option>
          {parentOptions.map(option => (
            <option key={option.id} value={option.id}>
              {`${'— '.repeat(option.depth)}${option.name}`}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-secondary-500">{t('form.fields.parentHelp')}</p>
      </div>

      <div className="rounded-xl border border-line bg-card p-4">
        <label htmlFor="category-description" className="label">
          {t('form.fields.description')}
        </label>
        <textarea
          id="category-description"
          className="input mt-1 min-h-[88px]"
          {...form.register('description')}
        />
      </div>
    </>
  );
}
