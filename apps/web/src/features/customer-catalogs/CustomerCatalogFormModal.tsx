import { useForm } from 'react-hook-form';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
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
  const form = useForm<CustomerCatalogFormValues>({
    defaultValues: mapCatalogItemToForm(item),
  });

  const handleSubmit = form.handleSubmit(onSubmit);
  const isCreate = !item;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCreate ? `Create ${singularLabel}` : `Edit ${singularLabel}`}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            Cancel
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving...' : isCreate ? `Create ${singularLabel}` : 'Save Changes'}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="catalog-code" className="label">
              Code
            </label>
            <input
              id="catalog-code"
              className="input mt-1"
              {...form.register('code', { required: `${singularLabel} code is required` })}
            />
            {form.formState.errors.code && (
              <p className="mt-1 text-sm text-danger-500">{form.formState.errors.code.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="catalog-name" className="label">
              Name
            </label>
            <input
              id="catalog-name"
              className="input mt-1"
              {...form.register('name', { required: `${singularLabel} name is required` })}
            />
            {form.formState.errors.name && (
              <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="catalog-description" className="label">
            Description
          </label>
          <textarea
            id="catalog-description"
            className="input mt-1 min-h-[88px]"
            {...form.register('description')}
          />
        </div>

        <label className="flex items-center gap-3 text-sm text-secondary-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-secondary-300"
            {...form.register('isActive')}
          />
          {singularLabel} is active
        </label>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
