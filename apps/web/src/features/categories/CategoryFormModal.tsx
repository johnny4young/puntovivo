import { useForm } from 'react-hook-form';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import type { Category } from '@/types';

export interface CategoryLookupOption {
  id: string;
  name: string;
  depth: number;
}

export interface CategoryFormValues {
  name: string;
  description: string;
  parentId: string;
}

const defaultValues: CategoryFormValues = {
  name: '',
  description: '',
  parentId: '',
};

function mapCategoryToForm(category: Category | null): CategoryFormValues {
  if (!category) {
    return defaultValues;
  }

  return {
    name: category.name,
    description: category.description ?? '',
    parentId: category.parentId ?? '',
  };
}

interface CategoryFormModalProps {
  isOpen: boolean;
  category: Category | null;
  parentOptions: CategoryLookupOption[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: CategoryFormValues) => Promise<void>;
}

export function CategoryFormModal({
  isOpen,
  category,
  parentOptions,
  isSaving,
  error,
  onClose,
  onSubmit,
}: CategoryFormModalProps) {
  const form = useForm<CategoryFormValues>({
    defaultValues: mapCategoryToForm(category),
  });

  const handleSubmit = form.handleSubmit(onSubmit);
  const isCreate = !category;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCreate ? 'Create Category' : 'Edit Category'}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            Cancel
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving...' : isCreate ? 'Create Category' : 'Save Changes'}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="category-name" className="label">
            Category Name
          </label>
          <input
            id="category-name"
            className="input mt-1"
            {...form.register('name', { required: 'Category name is required' })}
          />
          {form.formState.errors.name && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="category-parent" className="label">
            Parent Category
          </label>
          <select id="category-parent" className="input mt-1" {...form.register('parentId')}>
            <option value="">No parent</option>
            {parentOptions.map(option => (
              <option key={option.id} value={option.id}>
                {`${'  '.repeat(option.depth)}${option.name}`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="category-description" className="label">
            Description
          </label>
          <textarea
            id="category-description"
            className="input mt-1 min-h-[96px]"
            {...form.register('description')}
          />
        </div>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
