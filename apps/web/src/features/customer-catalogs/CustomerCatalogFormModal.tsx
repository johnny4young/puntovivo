import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Modal } from '@/components/form-controls/Modal';
import { SimpleFormField } from '@/components/form-controls/FormField';
import { cn } from '@/lib/utils';
import type { CustomerCatalogItem } from '@/types';

export interface CustomerCatalogFormValues {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
}

const defaultValues: CustomerCatalogFormValues = {
  code: '',
  name: '',
  description: '',
  isActive: true,
};

function mapCatalogItemToForm(item: CustomerCatalogItem | null): CustomerCatalogFormValues {
  if (!item) {
    return defaultValues;
  }

  return {
    code: item.code,
    name: item.name,
    description: item.description ?? '',
    isActive: item.isActive,
  };
}

/**
 * construye la prop `error` de SimpleFormField bajo
 * `exactOptionalPropertyTypes`: la prop se omite por completo cuando no hay
 * mensaje, en vez de pasarla como `undefined`.
 */
function errorProp(message: string | undefined): { error?: string } {
  return message ? { error: message } : {};
}

interface CustomerCatalogFormModalProps {
  isOpen: boolean;
  item: CustomerCatalogItem | null;
  singularLabel: string;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: CustomerCatalogFormValues) => Promise<void>;
}

export function CustomerCatalogFormModal({
  isOpen,
  item,
  singularLabel,
  isSaving,
  error,
  onClose,
  onSubmit,
}: CustomerCatalogFormModalProps) {
  const { t } = useTranslation('customers');
  const form = useForm<CustomerCatalogFormValues>({
    defaultValues: mapCatalogItemToForm(item),
  });

  const handleSubmit = form.handleSubmit(onSubmit);
  const isCreate = !item;
  const { errors } = form.formState;
  const isActive = useWatch({ control: form.control, name: 'isActive' });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        isCreate
          ? t('catalogs.form.createTitle', { type: singularLabel })
          : t('catalogs.form.editTitle', { type: singularLabel })
      }
      footer={
        <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            id="catalog-is-active"
            className="inline-flex items-center gap-2.5 text-sm text-secondary-600"
            onClick={() =>
              form.setValue('isActive', !isActive, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
          >
            <span className={cn('pv-switch', isActive && 'on')} aria-hidden="true" />
            {t('catalogs.form.isActive', { type: singularLabel })}
          </button>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
            <button type="button" className="pv-btn outline" onClick={onClose} disabled={isSaving}>
              {t('catalogs.form.cancel')}
            </button>
            <button
              type="button"
              className="pv-btn primary"
              onClick={handleSubmit}
              disabled={isSaving}
            >
              {isCreate && <Plus aria-hidden="true" />}
              {isSaving
                ? t('catalogs.form.saving')
                : isCreate
                  ? t('catalogs.form.create', { type: singularLabel })
                  : t('catalogs.form.save')}
            </button>
          </div>
        </div>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <SimpleFormField
            label={t('catalogs.form.code')}
            htmlFor="catalog-code"
            required
            {...errorProp(errors.code?.message)}
          >
            <input
              id="catalog-code"
              aria-required="true"
              className={cn('pv-input', errors.code && 'error')}
              {...form.register('code', {
                required: t('catalogs.form.codeRequired', { type: singularLabel }),
              })}
            />
          </SimpleFormField>

          <SimpleFormField
            label={t('catalogs.form.name')}
            htmlFor="catalog-name"
            required
            {...errorProp(errors.name?.message)}
          >
            <input
              id="catalog-name"
              aria-required="true"
              className={cn('pv-input', errors.name && 'error')}
              {...form.register('name', {
                required: t('catalogs.form.nameRequired', { type: singularLabel }),
              })}
            />
          </SimpleFormField>
        </div>

        <SimpleFormField label={t('catalogs.form.description')} htmlFor="catalog-description">
          <textarea
            id="catalog-description"
            className="pv-input area"
            {...form.register('description')}
          />
        </SimpleFormField>

        {error && (
          <p className="err-msg" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
