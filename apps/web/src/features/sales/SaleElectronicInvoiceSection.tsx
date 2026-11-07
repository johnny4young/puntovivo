/**
 * Buyer data is asked for only when the buyer wants an invoice in their name
 * (Res. DIAN 227/2025 art. 1.5.1.12.3); see docs/FISCAL-INTEGRATION.md.
 * @module features/sales/SaleElectronicInvoiceSection
 */
import { useTranslation } from 'react-i18next';
import { useWatch, type UseFormReturn } from 'react-hook-form';

import type { Customer } from '@/types';
import type { SalePaymentValues } from './salePaymentModal.types';
import { expectedNitDigit, nitPreview } from './invoiceBuyerNit';

const NIT_TYPE_CODE = '31';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ElectronicInvoiceIdentificationType {
  code: string;
  abbr: string;
  nameEs: string;
  nameEn: string;
}

interface SaleElectronicInvoiceSectionProps {
  form: UseFormReturn<SalePaymentValues>;
  identificationTypes: ElectronicInvoiceIdentificationType[];
  selectedCustomer: Customer | null;
}

export function SaleElectronicInvoiceSection({
  form,
  identificationTypes,
  selectedCustomer,
}: SaleElectronicInvoiceSectionProps) {
  // Lazy fiscal copy: only tenants that can issue an FEV pay for these strings.
  const { t, i18n } = useTranslation('fiscal');
  const requested = useWatch({ control: form.control, name: 'invoiceRequested' }) ?? false;
  const typeCode = useWatch({ control: form.control, name: 'invoiceBuyer.identificationTypeCode' });
  const idNumber = useWatch({ control: form.control, name: 'invoiceBuyer.identificationNumber' });
  const recordedNit = typeCode === NIT_TYPE_CODE ? nitPreview(idNumber ?? '') : null;
  const errors = form.formState.errors.invoiceBuyer;
  const usesSpanish = i18n.language.startsWith('es');

  const isRequested = () => form.getValues('invoiceRequested') === true;
  const required = (value: string | undefined) =>
    !isRequested() || (value ?? '').trim().length > 0 || t('electronicInvoiceRequest.required');

  // Fill only blank fields so a correction the cashier typed survives a re-toggle.
  const prefillFromCustomer = () => {
    if (!selectedCustomer) return;
    // Copy the values out: getValues hands back the live form object.
    const current = { ...form.getValues('invoiceBuyer') };
    const fill = (field: 'name' | 'identificationNumber' | 'email', value?: string | null) => {
      if (value && !current[field]?.trim()) {
        form.setValue(`invoiceBuyer.${field}`, value, { shouldDirty: true });
      }
    };
    fill('name', selectedCustomer.name);
    fill('identificationNumber', selectedCustomer.taxId);
    fill('email', selectedCustomer.email);
    // Only a NIT carries a dashed verification digit in Colombia.
    if (!current.identificationNumber?.trim() && /-\s*\d$/.test(selectedCustomer.taxId ?? '')) {
      form.setValue('invoiceBuyer.identificationTypeCode', NIT_TYPE_CODE, { shouldDirty: true });
    }
  };

  const fieldError = (message: string | undefined, id: string) =>
    message ? (
      <p id={id} className="mt-1 text-xs text-danger-600" role="alert">
        {message}
      </p>
    ) : null;

  return (
    <div
      className="rounded-xl border border-secondary-200 p-4"
      data-testid="sale-electronic-invoice"
    >
      <label className="flex items-center gap-2 text-sm font-medium text-secondary-900">
        <input
          type="checkbox"
          data-testid="sale-electronic-invoice-toggle"
          {...form.register('invoiceRequested', {
            onChange: event => {
              if ((event.target as HTMLInputElement).checked) prefillFromCustomer();
            },
          })}
        />
        {t('electronicInvoiceRequest.toggle')}
      </label>

      {requested && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="sale-invoice-buyer-name" className="label">
              {t('electronicInvoiceRequest.name')}
            </label>
            <input
              id="sale-invoice-buyer-name"
              className="input mt-1"
              autoComplete="off"
              aria-invalid={errors?.name ? true : undefined}
              aria-describedby={errors?.name ? 'sale-invoice-buyer-name-error' : undefined}
              {...form.register('invoiceBuyer.name', { validate: required })}
            />
            {fieldError(errors?.name?.message, 'sale-invoice-buyer-name-error')}
          </div>
          <div>
            <label htmlFor="sale-invoice-buyer-id-type" className="label">
              {t('electronicInvoiceRequest.idType')}
            </label>
            <select
              id="sale-invoice-buyer-id-type"
              className="input mt-1"
              {...form.register('invoiceBuyer.identificationTypeCode', {
                validate: required,
                deps: ['invoiceBuyer.identificationNumber'],
              })}
            >
              {identificationTypes.map(type => (
                <option key={type.code} value={type.code}>
                  {`${type.abbr} · ${usesSpanish ? type.nameEs : type.nameEn}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sale-invoice-buyer-id-number" className="label">
              {t('electronicInvoiceRequest.idNumber')}
            </label>
            <input
              id="sale-invoice-buyer-id-number"
              className="input mt-1"
              autoComplete="off"
              inputMode="text"
              aria-invalid={errors?.identificationNumber ? true : undefined}
              aria-describedby={
                errors?.identificationNumber ? 'sale-invoice-buyer-id-number-error' : undefined
              }
              {...form.register('invoiceBuyer.identificationNumber', {
                validate: value => {
                  const missing = required(value);
                  if (missing !== true || !isRequested()) return missing;
                  if (form.getValues('invoiceBuyer.identificationTypeCode') !== NIT_TYPE_CODE) {
                    return true;
                  }
                  const dv = expectedNitDigit(value ?? '');
                  return dv === null || t('electronicInvoiceRequest.nitDvMismatch', { dv });
                },
              })}
            />
            {fieldError(
              errors?.identificationNumber?.message,
              'sale-invoice-buyer-id-number-error'
            )}
            {recordedNit && !errors?.identificationNumber && (
              <p className="mt-1 text-xs text-secondary-600" data-testid="sale-invoice-nit-preview">
                {t('electronicInvoiceRequest.nitPreview', { nit: recordedNit })}
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="sale-invoice-buyer-email" className="label">
              {t('electronicInvoiceRequest.email')}
            </label>
            <input
              id="sale-invoice-buyer-email"
              type="email"
              className="input mt-1"
              autoComplete="off"
              aria-invalid={errors?.email ? true : undefined}
              aria-describedby={errors?.email ? 'sale-invoice-buyer-email-error' : undefined}
              {...form.register('invoiceBuyer.email', {
                validate: value =>
                  !isRequested() ||
                  !value?.trim() ||
                  EMAIL_PATTERN.test(value.trim()) ||
                  t('electronicInvoiceRequest.emailInvalid'),
              })}
            />
            {fieldError(errors?.email?.message, 'sale-invoice-buyer-email-error')}
          </div>
        </div>
      )}
    </div>
  );
}
