import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import type { Customer, CustomerCatalogItem } from '@/types';
import { CustomerCatalogSelect } from '@/features/customers/CustomerCatalogSelect';

export interface CustomerFormValues {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  taxId: string;
  identificationTypeId: string;
  personTypeId: string;
  regimeTypeId: string;
  clientTypeId: string;
  commercialActivityId: string;
  notes: string;
  isActive: boolean;
}

const defaultValues: CustomerFormValues = {
  name: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  taxId: '',
  identificationTypeId: '',
  personTypeId: '',
  regimeTypeId: '',
  clientTypeId: '',
  commercialActivityId: '',
  notes: '',
  isActive: true,
};

function mapCustomerToForm(customer: Customer | null): CustomerFormValues {
  if (!customer) {
    return defaultValues;
  }

  return {
    name: customer.name,
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    address: customer.address ?? '',
    city: customer.city ?? '',
    state: customer.state ?? '',
    postalCode: customer.postalCode ?? '',
    country: customer.country ?? '',
    taxId: customer.taxId ?? '',
    identificationTypeId: customer.identificationTypeId ?? '',
    personTypeId: customer.personTypeId ?? '',
    regimeTypeId: customer.regimeTypeId ?? '',
    clientTypeId: customer.clientTypeId ?? '',
    commercialActivityId: customer.commercialActivityId ?? '',
    notes: customer.notes ?? '',
    isActive: customer.isActive,
  };
}

interface CustomerFormModalProps {
  isOpen: boolean;
  customer: Customer | null;
  identificationTypes: CustomerCatalogItem[];
  personTypes: CustomerCatalogItem[];
  regimeTypes: CustomerCatalogItem[];
  clientTypes: CustomerCatalogItem[];
  commercialActivities: CustomerCatalogItem[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: CustomerFormValues) => Promise<void>;
}

export function CustomerFormModal({
  isOpen,
  customer,
  identificationTypes,
  personTypes,
  regimeTypes,
  clientTypes,
  commercialActivities,
  isSaving,
  error,
  onClose,
  onSubmit,
}: CustomerFormModalProps) {
  const { t } = useTranslation('customers');
  const form = useForm<CustomerFormValues>({
    defaultValues: mapCustomerToForm(customer),
  });

  const handleSubmit = form.handleSubmit(onSubmit);
  const isCreate = !customer;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCreate ? t('form.createTitle') : t('form.editTitle')}
      size="xl"
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('form.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? t('form.submitting') : isCreate ? t('form.create') : t('form.save')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="customer-name" className="label">
              {t('form.fields.name')}
            </label>
            <input
              id="customer-name"
              className="input mt-1"
              {...form.register('name', { required: t('form.fields.nameRequired') })}
            />
            {form.formState.errors.name && (
              <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="customer-tax-id" className="label">
              {t('form.fields.taxId')}
            </label>
            <input id="customer-tax-id" className="input mt-1" {...form.register('taxId')} />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="customer-email" className="label">
              {t('form.fields.email')}
            </label>
            <input
              id="customer-email"
              type="email"
              className="input mt-1"
              {...form.register('email', {
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: t('form.fields.emailInvalid'),
                },
              })}
            />
            {form.formState.errors.email && (
              <p className="mt-1 text-sm text-danger-500">{form.formState.errors.email.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="customer-phone" className="label">
              {t('form.fields.phone')}
            </label>
            <input id="customer-phone" className="input mt-1" {...form.register('phone')} />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <CustomerCatalogSelect
            id="customer-identification-type"
            label={t('form.fields.identificationType')}
            placeholder={t('form.fields.notSet')}
            options={identificationTypes}
            registration={form.register('identificationTypeId')}
          />

          <CustomerCatalogSelect
            id="customer-person-type"
            label={t('form.fields.personType')}
            placeholder={t('form.fields.notSet')}
            options={personTypes}
            registration={form.register('personTypeId')}
          />

          <CustomerCatalogSelect
            id="customer-regime-type"
            label={t('form.fields.regimeType')}
            placeholder={t('form.fields.notSet')}
            options={regimeTypes}
            registration={form.register('regimeTypeId')}
          />

          <CustomerCatalogSelect
            id="customer-client-type"
            label={t('form.fields.clientType')}
            placeholder={t('form.fields.notSet')}
            options={clientTypes}
            registration={form.register('clientTypeId')}
          />

          <CustomerCatalogSelect
            id="customer-commercial-activity"
            label={t('form.fields.commercialActivity')}
            placeholder={t('form.fields.notSet')}
            options={commercialActivities}
            registration={form.register('commercialActivityId')}
          />
        </div>

        <div>
          <label htmlFor="customer-address" className="label">
            {t('form.fields.address')}
          </label>
          <textarea
            id="customer-address"
            className="input mt-1 min-h-[88px]"
            {...form.register('address')}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label htmlFor="customer-city" className="label">
              {t('form.fields.city')}
            </label>
            <input id="customer-city" className="input mt-1" {...form.register('city')} />
          </div>

          <div>
            <label htmlFor="customer-state" className="label">
              {t('form.fields.state')}
            </label>
            <input id="customer-state" className="input mt-1" {...form.register('state')} />
          </div>

          <div>
            <label htmlFor="customer-postal-code" className="label">
              {t('form.fields.postalCode')}
            </label>
            <input
              id="customer-postal-code"
              className="input mt-1"
              {...form.register('postalCode')}
            />
          </div>

          <div>
            <label htmlFor="customer-country" className="label">
              {t('form.fields.country')}
            </label>
            <input id="customer-country" className="input mt-1" {...form.register('country')} />
          </div>
        </div>

        <div>
          <label htmlFor="customer-notes" className="label">
            {t('form.fields.notes')}
          </label>
          <textarea
            id="customer-notes"
            className="input mt-1 min-h-[96px]"
            {...form.register('notes')}
          />
        </div>

        <label className="flex items-center gap-3 text-sm text-secondary-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-secondary-300"
            {...form.register('isActive')}
          />
          {t('form.fields.isActive')}
        </label>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
