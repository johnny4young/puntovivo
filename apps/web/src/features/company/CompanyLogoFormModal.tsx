import { useForm } from 'react-hook-form';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import type { Logo } from '@/types';

export interface CompanyLogoFormValues {
  name: string;
  imageUrl: string;
  isActive: boolean;
}

const defaultValues: CompanyLogoFormValues = {
  name: '',
  imageUrl: '',
  isActive: true,
};

function mapLogoToForm(logo: Logo | null): CompanyLogoFormValues {
  if (!logo) {
    return defaultValues;
  }

  return {
    name: logo.name,
    imageUrl: logo.imageUrl,
    isActive: logo.isActive,
  };
}

interface CompanyLogoFormModalProps {
  isOpen: boolean;
  logo: Logo | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: CompanyLogoFormValues) => Promise<void>;
}

export function CompanyLogoFormModal({
  isOpen,
  logo,
  isSaving,
  error,
  onClose,
  onSubmit,
}: CompanyLogoFormModalProps) {
  const form = useForm<CompanyLogoFormValues>({
    defaultValues: mapLogoToForm(logo),
  });
  const handleSubmit = form.handleSubmit(onSubmit);
  const isCreate = !logo;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCreate ? 'Add Logo' : 'Edit Logo'}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            Cancel
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving...' : isCreate ? 'Create Logo' : 'Save Changes'}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="company-logo-name" className="label">
            Logo Name
          </label>
          <input
            id="company-logo-name"
            className="input mt-1"
            {...form.register('name', { required: 'Logo name is required' })}
          />
          {form.formState.errors.name && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="company-logo-image-url" className="label">
            Image URL
          </label>
          <input
            id="company-logo-image-url"
            className="input mt-1"
            placeholder="https://example.com/logo.png"
            {...form.register('imageUrl', {
              required: 'Image URL is required',
              pattern: {
                value: /^https?:\/\/.+/i,
                message: 'Enter a valid image URL',
              },
            })}
          />
          {form.formState.errors.imageUrl && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.imageUrl.message}</p>
          )}
        </div>

        <label className="flex items-center gap-3 text-sm text-secondary-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-secondary-300"
            {...form.register('isActive')}
          />
          Logo is active
        </label>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
