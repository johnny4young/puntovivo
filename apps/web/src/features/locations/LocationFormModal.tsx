import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import type { Location } from '@/types';

export interface LocationFormValues {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
}

const defaultValues: LocationFormValues = {
  code: '',
  name: '',
  description: '',
  isActive: true,
};

function mapLocationToForm(location: Location | null): LocationFormValues {
  if (!location) {
    return defaultValues;
  }

  return {
    code: location.code,
    name: location.name,
    description: location.description ?? '',
    isActive: location.isActive,
  };
}

interface LocationFormModalProps {
  isOpen: boolean;
  location: Location | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: LocationFormValues) => Promise<void>;
}

export function LocationFormModal({
  isOpen,
  location,
  isSaving,
  error,
  onClose,
  onSubmit,
}: LocationFormModalProps) {
  const { t } = useTranslation('settings');
  const form = useForm<LocationFormValues>({
    defaultValues: mapLocationToForm(location),
  });

  const handleSubmit = form.handleSubmit(onSubmit);
  const isCreate = !location;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCreate ? t('locations.form.createTitle') : t('locations.form.editTitle')}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('locations.form.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? t('locations.form.submitting') : isCreate ? t('locations.form.create') : t('locations.form.save')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="location-code" className="label">
              {t('locations.form.fields.code')}
            </label>
            <input
              id="location-code"
              className="input mt-1"
              {...form.register('code', { required: t('locations.form.fields.codeRequired') })}
            />
            {form.formState.errors.code && (
              <p className="mt-1 text-sm text-danger-500">{form.formState.errors.code.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="location-name" className="label">
              {t('locations.form.fields.name')}
            </label>
            <input
              id="location-name"
              className="input mt-1"
              {...form.register('name', { required: t('locations.form.fields.nameRequired') })}
            />
            {form.formState.errors.name && (
              <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="location-description" className="label">
            {t('locations.form.fields.description')}
          </label>
          <textarea
            id="location-description"
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
          {t('locations.form.fields.isActive')}
        </label>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
