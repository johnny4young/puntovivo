import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('settings');
  const form = useForm<CityFormValues>({
    defaultValues: mapCityToForm(city),
  });

  const handleSubmit = form.handleSubmit(onSubmit);
  const isCreate = !city;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCreate ? t('geography.form.city.createTitle') : t('geography.form.city.editTitle')}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('geography.form.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? t('geography.form.submitting') : isCreate ? t('geography.form.city.create') : t('geography.form.saveChanges')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="city-department" className="label">
            {t('geography.form.city.fields.department')}
          </label>
          <select
            id="city-department"
            className="input mt-1"
            {...form.register('departmentId', { required: t('geography.form.city.fields.departmentRequired') })}
          >
            <option value="">{t('geography.form.city.fields.selectDepartment')}</option>
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
              {t('geography.form.city.fields.code')}
            </label>
            <input
              id="city-code"
              className="input mt-1"
              {...form.register('code', { required: t('geography.form.city.fields.codeRequired') })}
            />
            {form.formState.errors.code && (
              <p className="mt-1 text-sm text-danger-500">{form.formState.errors.code.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="city-name" className="label">
              {t('geography.form.city.fields.name')}
            </label>
            <input
              id="city-name"
              className="input mt-1"
              {...form.register('name', { required: t('geography.form.city.fields.nameRequired') })}
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
          {t('geography.form.city.fields.isActive')}
        </label>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
