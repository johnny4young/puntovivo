import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('settings');
  const form = useForm<CompanyLogoFormValues>({
    defaultValues: mapLogoToForm(logo),
  });
  const handleSubmit = form.handleSubmit(onSubmit);
  const isCreate = !logo;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCreate ? t('company.logo.form.addTitle') : t('company.logo.form.editTitle')}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('company.logo.form.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? t('company.logo.form.saving') : isCreate ? t('company.logo.form.create') : t('company.logo.form.saveChanges')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="company-logo-name" className="label">
            {t('company.logo.form.logoName')}
          </label>
          <input
            id="company-logo-name"
            className="input mt-1"
            {...form.register('name', { required: t('company.logo.form.logoNameRequired') })}
          />
          {form.formState.errors.name && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="company-logo-image-url" className="label">
            {t('company.logo.form.imageUrl')}
          </label>
          <input
            id="company-logo-image-url"
            className="input mt-1"
            placeholder="https://example.com/logo.png"
            {...form.register('imageUrl', {
              required: t('company.logo.form.imageUrlRequired'),
              pattern: {
                value: /^https?:\/\/.+/i,
                message: t('company.logo.form.imageUrlInvalid'),
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
          {t('company.logo.form.isActive')}
        </label>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
