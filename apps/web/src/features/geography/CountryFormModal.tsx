import { useForm } from 'react-hook-form';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import type { Country } from '@/types';

export interface CountryFormValues {
  code: string;
  name: string;
  isActive: boolean;
}

const defaultValues: CountryFormValues = {
  code: '',
  name: '',
  isActive: true,
};

function mapCountryToForm(country: Country | null): CountryFormValues {
  if (!country) {
    return defaultValues;
  }

  return {
    code: country.code,
    name: country.name,
    isActive: country.isActive,
  };
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
}: CountryFormModalProps) {
  const form = useForm<CountryFormValues>({
    defaultValues: mapCountryToForm(country),
  });

  const handleSubmit = form.handleSubmit(onSubmit);
  const isCreate = !country;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCreate ? 'Create Country' : 'Edit Country'}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            Cancel
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving...' : isCreate ? 'Create Country' : 'Save Changes'}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="country-code" className="label">
              Code
            </label>
            <input
              id="country-code"
              className="input mt-1"
              {...form.register('code', { required: 'Country code is required' })}
            />
            {form.formState.errors.code && (
              <p className="mt-1 text-sm text-danger-500">{form.formState.errors.code.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="country-name" className="label">
              Name
            </label>
            <input
              id="country-name"
              className="input mt-1"
              {...form.register('name', { required: 'Country name is required' })}
            />
            {form.formState.errors.name && (
              <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
            )}
          </div>
        </div>

        <label className="flex items-center gap-3 text-sm text-secondary-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-secondary-300"
            {...form.register('isActive')}
          />
          Country is active
        </label>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
