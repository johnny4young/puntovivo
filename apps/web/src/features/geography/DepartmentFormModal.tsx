import { useForm } from 'react-hook-form';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import type { Country, Department } from '@/types';

export interface DepartmentFormValues {
  countryId: string;
  code: string;
  name: string;
  isActive: boolean;
}

const defaultValues: DepartmentFormValues = {
  countryId: '',
  code: '',
  name: '',
  isActive: true,
};

function mapDepartmentToForm(department: Department | null): DepartmentFormValues {
  if (!department) {
    return defaultValues;
  }

  return {
    countryId: department.countryId ?? '',
    code: department.code,
    name: department.name,
    isActive: department.isActive,
  };
}

interface DepartmentFormModalProps {
  isOpen: boolean;
  department: Department | null;
  countries: Country[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: DepartmentFormValues) => Promise<void>;
}

export function DepartmentFormModal({
  isOpen,
  department,
  countries,
  isSaving,
  error,
  onClose,
  onSubmit,
}: DepartmentFormModalProps) {
  const form = useForm<DepartmentFormValues>({
    defaultValues: mapDepartmentToForm(department),
  });

  const handleSubmit = form.handleSubmit(onSubmit);
  const isCreate = !department;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCreate ? 'Create Department' : 'Edit Department'}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            Cancel
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving...' : isCreate ? 'Create Department' : 'Save Changes'}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="department-country" className="label">
            Country
          </label>
          <select
            id="department-country"
            className="input mt-1"
            {...form.register('countryId', { required: 'Country is required' })}
          >
            <option value="">Select a country</option>
            {countries.map(country => (
              <option key={country.id} value={country.id} disabled={!country.isActive}>
                {country.name} ({country.code})
              </option>
            ))}
          </select>
          {form.formState.errors.countryId && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.countryId.message}</p>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="department-code" className="label">
              Code
            </label>
            <input
              id="department-code"
              className="input mt-1"
              {...form.register('code', { required: 'Department code is required' })}
            />
            {form.formState.errors.code && (
              <p className="mt-1 text-sm text-danger-500">{form.formState.errors.code.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="department-name" className="label">
              Name
            </label>
            <input
              id="department-name"
              className="input mt-1"
              {...form.register('name', { required: 'Department name is required' })}
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
          Department is active
        </label>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
