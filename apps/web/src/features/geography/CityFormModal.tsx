import { useForm } from 'react-hook-form';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import type { City, Department } from '@/types';

export interface CityFormValues {
  departmentId: string;
  code: string;
  name: string;
  isActive: boolean;
}

const defaultValues: CityFormValues = {
  departmentId: '',
  code: '',
  name: '',
  isActive: true,
};

function mapCityToForm(city: City | null): CityFormValues {
  if (!city) {
    return defaultValues;
  }

  return {
    departmentId: city.departmentId,
    code: city.code,
    name: city.name,
    isActive: city.isActive,
  };
}

interface CityFormModalProps {
  isOpen: boolean;
  city: City | null;
  departments: Department[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: CityFormValues) => Promise<void>;
}

export function CityFormModal({
  isOpen,
  city,
  departments,
  isSaving,
  error,
  onClose,
  onSubmit,
}: CityFormModalProps) {
  const form = useForm<CityFormValues>({
    defaultValues: mapCityToForm(city),
  });

  const handleSubmit = form.handleSubmit(onSubmit);
  const isCreate = !city;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCreate ? 'Create City' : 'Edit City'}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            Cancel
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving...' : isCreate ? 'Create City' : 'Save Changes'}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="city-department" className="label">
            Department
          </label>
          <select
            id="city-department"
            className="input mt-1"
            {...form.register('departmentId', { required: 'Department is required' })}
          >
            <option value="">Select a department</option>
            {departments.map(department => (
              <option key={department.id} value={department.id} disabled={!department.isActive}>
                {department.name} ({department.code})
                {department.countryName ? ` - ${department.countryName}` : ''}
              </option>
            ))}
          </select>
          {form.formState.errors.departmentId && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.departmentId.message}</p>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="city-code" className="label">
              Code
            </label>
            <input
              id="city-code"
              className="input mt-1"
              {...form.register('code', { required: 'City code is required' })}
            />
            {form.formState.errors.code && (
              <p className="mt-1 text-sm text-danger-500">{form.formState.errors.code.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="city-name" className="label">
              Name
            </label>
            <input
              id="city-name"
              className="input mt-1"
              {...form.register('name', { required: 'City name is required' })}
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
          City is active
        </label>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
