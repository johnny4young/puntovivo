import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('settings');
  const form = useForm<DepartmentFormValues>({
    defaultValues: mapDepartmentToForm(department),
  });

  const handleSubmit = form.handleSubmit(onSubmit);
  const isCreate = !department;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCreate ? t('geography.form.department.createTitle') : t('geography.form.department.editTitle')}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('geography.form.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? t('geography.form.submitting') : isCreate ? t('geography.form.department.create') : t('geography.form.saveChanges')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="department-country" className="label">
            {t('geography.form.department.fields.country')}
          </label>
          <select
            id="department-country"
            className="input mt-1"
            {...form.register('countryId', { required: t('geography.form.department.fields.countryRequired') })}
          >
            <option value="">{t('geography.form.department.fields.selectCountry')}</option>
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
              {t('geography.form.department.fields.code')}
            </label>
            <input
              id="department-code"
              className="input mt-1"
              {...form.register('code', { required: t('geography.form.department.fields.codeRequired') })}
            />
            {form.formState.errors.code && (
              <p className="mt-1 text-sm text-danger-500">{form.formState.errors.code.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="department-name" className="label">
              {t('geography.form.department.fields.name')}
            </label>
            <input
              id="department-name"
              className="input mt-1"
              {...form.register('name', { required: t('geography.form.department.fields.nameRequired') })}
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
          {t('geography.form.department.fields.isActive')}
        </label>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
