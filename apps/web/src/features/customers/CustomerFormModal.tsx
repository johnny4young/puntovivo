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
  // ENG-089 — cupo de crédito (0 = sin cupo). Stored as a number;
  // negative values blocked at the form layer + Zod.
  creditLimit: number;
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
  creditLimit: 0,
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
    creditLimit: customer.creditLimit ?? 0,
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
  /**
   * Persists the form. May optionally return the newly created
   * customer so the quick-create flow (ENG-105c) can attach it to
   * the in-flight sale via `onCreated`. Existing callers that
   * return `Promise<void>` stay backward compatible.
   */
  onSubmit: (values: CustomerFormValues) => Promise<Customer | void>;
  /**
   * ENG-105c — pre-fill the `name` field when opening in create
   * mode from the empty-state CTA. Ignored on edit-mode submits.
   */
  defaultName?: string;
  /**
   * ENG-105c — fired once `onSubmit` succeeds in create mode AND
   * resolves to a customer. The caller attaches the new customer
   * to the active sale. Skipped on errors and on edit-mode submits.
   */
  onCreated?: (customer: Customer) => void;
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
  defaultName,
  onCreated,
}: CustomerFormModalProps) {
  const { t } = useTranslation('customers');
  const isCreate = !customer;
  const form = useForm<CustomerFormValues>({
    defaultValues: (() => {
      const base = mapCustomerToForm(customer);
      // ENG-105c — pre-fill the name on create mode when caller
      // supplied a defaultName (e.g. from the customer-picker
      // empty-state in SalePaymentModal).
      if (isCreate && defaultName && defaultName.length > 0) {
        return { ...base, name: defaultName };
      }
      return base;
    })(),
  });

  const handleSubmit = form.handleSubmit(async values => {
    const result = await onSubmit(values);
    if (isCreate && result && onCreated) {
      onCreated(result);
    }
  });

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

        {/* ENG-089 — cupo de crédito (per-customer ceiling). */}
        <div>
          <label htmlFor="customer-credit-limit" className="label">
            {t('form.fields.creditLimit.label')}
          </label>
          <input
            id="customer-credit-limit"
            type="number"
            min={0}
            step="0.01"
            className="input mt-1"
            placeholder={t('form.fields.creditLimit.placeholder')}
            data-testid="customer-credit-limit-input"
            {...form.register('creditLimit', {
              valueAsNumber: true,
              min: {
                value: 0,
                message: t('form.fields.creditLimit.invalid'),
              },
              validate: value =>
                Number.isFinite(value) || t('form.fields.creditLimit.invalid'),
            })}
          />
          <p className="mt-1 text-xs text-secondary-500">
            {t('form.fields.creditLimit.help')}
          </p>
          {form.formState.errors.creditLimit && (
            <p className="mt-1 text-sm text-danger-500">
              {form.formState.errors.creditLimit.message}
            </p>
          )}
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
