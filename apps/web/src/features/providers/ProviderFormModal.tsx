import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import type { City, Provider } from '@/types';

export interface ProviderFormValues {
  name: string;
  contactName: string;
  taxId: string;
  email: string;
  phone: string;
  address: string;
  cityId: string;
  isActive: boolean;
}

const defaultValues: ProviderFormValues = {
  name: '',
  contactName: '',
  taxId: '',
  email: '',
  phone: '',
  address: '',
  cityId: '',
  isActive: true,
};

function mapProviderToForm(provider: Provider | null): ProviderFormValues {
  if (!provider) {
    return defaultValues;
  }

  return {
    name: provider.name,
    contactName: provider.contactName ?? '',
    taxId: provider.taxId ?? '',
    email: provider.email ?? '',
    phone: provider.phone ?? '',
    address: provider.address ?? '',
    cityId: provider.cityId ?? '',
    isActive: provider.isActive,
  };
}

interface ProviderFormModalProps {
  isOpen: boolean;
  provider: Provider | null;
  cities: City[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: ProviderFormValues) => Promise<void>;
}

export function ProviderFormModal({
  isOpen,
  provider,
  cities,
  isSaving,
  error,
  onClose,
  onSubmit,
}: ProviderFormModalProps) {
  const { t } = useTranslation('settings');
  const form = useForm<ProviderFormValues>({
    defaultValues: mapProviderToForm(provider),
  });

  const handleSubmit = form.handleSubmit(onSubmit);
  const isCreate = !provider;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCreate ? t('providers.form.createTitle') : t('providers.form.editTitle')}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('providers.form.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? t('providers.form.submitting') : isCreate ? t('providers.form.create') : t('providers.form.save')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="provider-name" className="label">
            {t('providers.form.fields.name')}
          </label>
          <input
            id="provider-name"
            className="input mt-1"
            {...form.register('name', { required: t('providers.form.fields.nameRequired') })}
          />
          {form.formState.errors.name && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="provider-contact" className="label">
            {t('providers.form.fields.contactName')}
          </label>
          <input id="provider-contact" className="input mt-1" {...form.register('contactName')} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="provider-tax-id" className="label">
              {t('providers.form.fields.taxId')}
            </label>
            <input id="provider-tax-id" className="input mt-1" {...form.register('taxId')} />
          </div>

          <div>
            <label htmlFor="provider-phone" className="label">
              {t('providers.form.fields.phone')}
            </label>
            <input id="provider-phone" className="input mt-1" {...form.register('phone')} />
          </div>
        </div>

        <div>
          <label htmlFor="provider-email" className="label">
            {t('providers.form.fields.email')}
          </label>
          <input
            id="provider-email"
            type="email"
            className="input mt-1"
            {...form.register('email', {
              pattern: {
                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                message: t('providers.form.fields.emailInvalid'),
              },
            })}
          />
          {form.formState.errors.email && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.email.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="provider-city" className="label">
            {t('providers.form.fields.city')}
          </label>
          <select id="provider-city" className="input mt-1" {...form.register('cityId')}>
            <option value="">{t('providers.form.fields.noCity')}</option>
            {cities.map(city => (
              <option key={city.id} value={city.id} disabled={!city.isActive}>
                {city.name}
                {city.departmentName ? ` - ${city.departmentName}` : ''}
                {city.countryName ? `, ${city.countryName}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="provider-address" className="label">
            {t('providers.form.fields.address')}
          </label>
          <textarea
            id="provider-address"
            className="input mt-1 min-h-[88px]"
            {...form.register('address')}
          />
        </div>

        <label className="flex items-center gap-3 text-sm text-secondary-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-secondary-300"
            {...form.register('isActive')}
          />
          {t('providers.form.fields.isActive')}
        </label>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
