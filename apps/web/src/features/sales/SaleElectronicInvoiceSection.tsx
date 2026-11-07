/**
 * Buyer data is asked for only when the buyer wants an invoice in their name
 * (Res. DIAN 227/2025 art. 1.5.1.12.3); see docs/FISCAL-INTEGRATION.md.
 * @module features/sales/SaleElectronicInvoiceSection
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useWatch, type UseFormReturn } from 'react-hook-form';

import type { Customer } from '@/types';
import type { SalePaymentValues } from './salePaymentModal.types';
import { EMPTY_INVOICE_BUYER } from './salePaymentModal.constants';
import { buyerIdProblem, expectedNitDigit, NIT_TYPE_CODE, nitPreview } from './invoiceBuyerNit';

type BuyerField = keyof typeof EMPTY_INVOICE_BUYER;
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

  // What the customer filled in, so a customer change can take it back.
  const prefilled = useRef<Partial<Record<BuyerField, string>>>({});
  const appliedCustomerId = useRef<string | null>(null);
  const customerId = selectedCustomer?.id ?? null;

  useEffect(() => {
    if (!requested) {
      appliedCustomerId.current = null;
      return;
    }
    if (appliedCustomerId.current === customerId) return;
    appliedCustomerId.current = customerId;
    // Getters hand back the live form object, so read field by field.
    const valueOf = (field: BuyerField) => form.getValues(`invoiceBuyer.${field}`) ?? '';
    const set = (field: BuyerField, value: string) =>
      form.setValue(`invoiceBuyer.${field}`, value, { shouldDirty: true });
    // Clear what an earlier fill put in and the cashier left untouched.
    for (const [field, value] of Object.entries(prefilled.current) as [BuyerField, string][]) {
      if (valueOf(field) === value) set(field, EMPTY_INVOICE_BUYER[field]);
    }
    prefilled.current = {};
    if (!selectedCustomer) return;
    // Fill only blank fields so a correction the cashier typed survives.
    const fill = (field: BuyerField, value: string) => {
      set(field, value);
      prefilled.current[field] = value;
    };
    const { name, taxId, email } = selectedCustomer;
    if (name && !valueOf('name').trim()) fill('name', name);
    if (taxId && !valueOf('identificationNumber').trim()) {
      fill('identificationNumber', taxId);
      // Only a NIT carries a dashed verification digit in Colombia.
      if (/-\s*\d$/.test(taxId)) fill('identificationTypeCode', NIT_TYPE_CODE);
    }
    if (email && !valueOf('email').trim()) fill('email', email);
  }, [requested, customerId, form, selectedCustomer]);

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
          {...form.register('invoiceRequested')}
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
              maxLength={200}
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
                  const type = form.getValues('invoiceBuyer.identificationTypeCode') ?? '';
                  const problem = buyerIdProblem(type, value ?? '');
                  if (problem) return t(`electronicInvoiceRequest.${problem}`);
                  if (type !== NIT_TYPE_CODE) return true;
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
