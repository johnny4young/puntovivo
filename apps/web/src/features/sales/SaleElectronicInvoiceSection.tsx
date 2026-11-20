/**
 * Buyer data is asked for only when the buyer wants an invoice in their name
 * (Res. DIAN 227/2025 art. 1.5.1.12.3); see docs/FISCAL-INTEGRATION.md.
 * @module features/sales/SaleElectronicInvoiceSection
 */
import { useEffect, useMemo, useRef } from 'react';
import { CircleCheck, ReceiptText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useController, useWatch, type UseFormReturn } from 'react-hook-form';

import type { Customer } from '@/types';
import type { ElectronicInvoiceFormValues } from './salePaymentModal.types';
import { EMPTY_INVOICE_BUYER } from './electronicInvoiceRequest';
import {
  buyerIdKey,
  buyerIdProblem,
  expectedNitDigit,
  NIT_TYPE_CODE,
  nitDigit,
  splitNit,
} from './invoiceBuyerNit';

type BuyerField = keyof typeof EMPTY_INVOICE_BUYER;
type InvoiceCustomer = Pick<Customer, 'id' | 'name' | 'taxId' | 'email'>;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_LOOKUP_LENGTH = 5;
const NO_CUSTOMERS: readonly InvoiceCustomer[] = [];

export interface ElectronicInvoiceIdentificationType {
  code: string;
  abbr: string;
  nameEs: string;
  nameEn: string;
}

interface SaleElectronicInvoiceSectionProps {
  form: UseFormReturn<ElectronicInvoiceFormValues>;
  identificationTypes: ElectronicInvoiceIdentificationType[];
  selectedCustomer: InvoiceCustomer | null;
  /** Saved customers a typed ID is matched against, so their data fills itself. */
  savedCustomers?: readonly InvoiceCustomer[] | undefined;
  /** One column with 44 px targets, for the touch cart rail. */
  touch?: boolean;
}

export function SaleElectronicInvoiceSection({
  form,
  identificationTypes,
  selectedCustomer,
  savedCustomers = NO_CUSTOMERS,
  touch = false,
}: SaleElectronicInvoiceSectionProps) {
  // Lazy fiscal copy: only tenants that can issue an FEV pay for these strings.
  const { t, i18n } = useTranslation('fiscal');
  const requested = useWatch({ control: form.control, name: 'invoiceRequested' }) ?? false;
  const typeCode = useWatch({ control: form.control, name: 'invoiceBuyer.identificationTypeCode' });
  const errors = form.formState.errors.invoiceBuyer;
  const usesSpanish = i18n.language.startsWith('es');
  const inputClass = touch ? 'input mt-1 min-h-[44px] w-full' : 'input mt-1';
  const isNit = typeCode === NIT_TYPE_CODE;

  const isRequested = () => form.getValues('invoiceRequested') === true;
  const required = (value: string | undefined) =>
    !isRequested() || (value ?? '').trim().length > 0 || t('electronicInvoiceRequest.required');

  const {
    field: {
      ref: idInputRef,
      name: idFieldName,
      value: idValue,
      onChange: setIdNumber,
      onBlur: onIdBlur,
    },
  } = useController({
    control: form.control,
    name: 'invoiceBuyer.identificationNumber',
    rules: {
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
    },
  });
  const idNumber = idValue ?? '';
  const nit = splitNit(idNumber);
  const computedDv = isNit ? nitDigit(nit.base) : '';
  const dvConfirmed =
    isNit && nit.dv !== '' && computedDv === nit.dv && !errors?.identificationNumber;

  const typedKey = buyerIdKey(idNumber, isNit);
  const customersById = useMemo(
    () =>
      new Map(
        savedCustomers.flatMap(customer =>
          customer.taxId ? [[buyerIdKey(customer.taxId), customer] as const] : []
        )
      ),
    [savedCustomers]
  );
  const lookupMatch =
    !selectedCustomer && typedKey.length >= MIN_LOOKUP_LENGTH
      ? (customersById.get(typedKey) ?? null)
      : null;
  const sourceCustomer = selectedCustomer ?? lookupMatch;
  const isSavedBuyer =
    sourceCustomer?.taxId != null &&
    typedKey.length > 0 &&
    buyerIdKey(sourceCustomer.taxId) === typedKey;
  const typeAbbr = identificationTypes.find(type => type.code === typeCode)?.abbr ?? '';

  // What a saved customer filled in, so a change of customer can take it back.
  const prefilled = useRef<Partial<Record<BuyerField, string>>>({});
  const appliedCustomerId = useRef<string | null>(null);
  const sourceCustomerId = sourceCustomer?.id ?? null;

  useEffect(() => {
    if (!requested) {
      // A reset form starts the next ticket with nothing to take back.
      appliedCustomerId.current = null;
      prefilled.current = {};
      return;
    }
    if (appliedCustomerId.current === sourceCustomerId) return;
    appliedCustomerId.current = sourceCustomerId;
    // Getters hand back the live form object, so read field by field.
    const valueOf = (field: BuyerField) => form.getValues(`invoiceBuyer.${field}`) ?? '';
    const set = (field: BuyerField, value: string) =>
      form.setValue(`invoiceBuyer.${field}`, value, { shouldDirty: true });
    // Clear what an earlier fill put in and the cashier left untouched.
    for (const [field, value] of Object.entries(prefilled.current) as [BuyerField, string][]) {
      if (valueOf(field) === value) set(field, EMPTY_INVOICE_BUYER[field]);
    }
    prefilled.current = {};
    if (!sourceCustomer) return;
    // Fill only blank fields so a correction the cashier typed survives.
    const fill = (field: BuyerField, value: string) => {
      set(field, value);
      prefilled.current[field] = value;
    };
    const { name, taxId, email } = sourceCustomer;
    if (name && !valueOf('name').trim()) fill('name', name);
    if (taxId && !valueOf('identificationNumber').trim()) fill('identificationNumber', taxId);
    // Only a NIT carries a dashed verification digit in Colombia.
    if (taxId && /-\s*\d$/.test(taxId) && valueOf('identificationTypeCode') !== NIT_TYPE_CODE) {
      fill('identificationTypeCode', NIT_TYPE_CODE);
    }
    if (email && !valueOf('email').trim()) fill('email', email);
  }, [requested, sourceCustomerId, form, sourceCustomer]);

  const fieldError = (message: string | undefined, id: string) =>
    message ? (
      <p id={id} className="mt-1 text-xs text-danger-600" role="alert">
        {message}
      </p>
    ) : null;
  const idError = errors?.identificationNumber?.message;
  const idErrorId = 'sale-invoice-buyer-id-number-error';
  const typeRegistration = form.register('invoiceBuyer.identificationTypeCode', {
    validate: required,
    deps: ['invoiceBuyer.identificationNumber'],
  });

  return (
    <section
      className={
        touch
          ? 'rounded-lg border border-line/50 bg-surface-2/40 p-3'
          : 'rounded-xl border border-line p-4'
      }
      data-testid="sale-electronic-invoice"
    >
      <label className={`flex cursor-pointer items-center gap-3 ${touch ? 'min-h-[44px]' : ''}`}>
        <input
          type="checkbox"
          role="switch"
          className="pv-switch"
          data-testid="sale-electronic-invoice-toggle"
          {...form.register('invoiceRequested')}
        />
        <span
          className={touch ? 'text-sm font-semibold text-secondary-900' : 'sale-pay-step-title'}
        >
          {t('electronicInvoiceRequest.toggle')}
        </span>
      </label>

      {requested && (
        <div className="mt-3 space-y-3">
          <div
            className={touch ? 'grid gap-3' : 'sale-pay-invoice-id'}
            data-nit={isNit || undefined}
          >
            <div>
              <label htmlFor="sale-invoice-buyer-id-type" className="label">
                {t('electronicInvoiceRequest.idType')}
              </label>
              <select
                id="sale-invoice-buyer-id-type"
                className={inputClass}
                {...typeRegistration}
                onChange={event => {
                  // A DV belongs to a NIT; another type would read it as part of the number.
                  if (isNit && event.target.value !== NIT_TYPE_CODE && nit.dv) {
                    setIdNumber(nit.base);
                  }
                  void typeRegistration.onChange(event);
                }}
              >
                {identificationTypes.map(type => (
                  <option
                    key={type.code}
                    value={type.code}
                    title={usesSpanish ? type.nameEs : type.nameEn}
                  >
                    {type.abbr}
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
                ref={idInputRef}
                name={idFieldName}
                className={inputClass}
                autoComplete="off"
                inputMode={isNit ? 'numeric' : 'text'}
                value={isNit ? nit.base : idNumber}
                aria-invalid={idError ? true : undefined}
                aria-describedby={idError ? idErrorId : undefined}
                onBlur={onIdBlur}
                onChange={event => {
                  const typed = event.target.value;
                  // Typing the whole NIT with its dash still lands the DV in its box.
                  const keepsDv = isNit && nit.dv && typed.trim() !== '' && !/-/.test(typed);
                  setIdNumber(keepsDv ? `${typed}-${nit.dv}` : typed);
                }}
              />
            </div>
            {isNit && (
              <div>
                <label htmlFor="sale-invoice-buyer-nit-dv" className="label">
                  <abbr title={t('electronicInvoiceRequest.dvName')} className="no-underline">
                    {t('electronicInvoiceRequest.dv')}
                  </abbr>
                </label>
                <div className="relative">
                  <input
                    id="sale-invoice-buyer-nit-dv"
                    className={`${inputClass} pr-9`}
                    autoComplete="off"
                    inputMode="numeric"
                    maxLength={1}
                    placeholder={computedDv}
                    value={nit.dv}
                    aria-invalid={idError && nit.dv ? true : undefined}
                    aria-describedby={idError ? idErrorId : undefined}
                    data-testid="sale-invoice-nit-dv"
                    onChange={event => {
                      const dv = event.target.value.replace(/\D/g, '').slice(-1);
                      setIdNumber(dv ? `${nit.base.trim()}-${dv}` : nit.base);
                    }}
                  />
                  {dvConfirmed && (
                    <CircleCheck
                      className="sale-pay-dv-ok"
                      aria-label={t('electronicInvoiceRequest.dvOk')}
                      role="img"
                      data-testid="sale-invoice-nit-dv-ok"
                    />
                  )}
                </div>
              </div>
            )}
            {fieldError(idError, idErrorId)}
          </div>
          <div>
            <label htmlFor="sale-invoice-buyer-name" className="label">
              {t('electronicInvoiceRequest.name')}
            </label>
            <input
              id="sale-invoice-buyer-name"
              className={`${inputClass} w-full`}
              autoComplete="off"
              maxLength={200}
              aria-invalid={errors?.name ? true : undefined}
              aria-describedby={errors?.name ? 'sale-invoice-buyer-name-error' : undefined}
              {...form.register('invoiceBuyer.name', { validate: required })}
            />
            {fieldError(errors?.name?.message, 'sale-invoice-buyer-name-error')}
          </div>
          <div>
            <label htmlFor="sale-invoice-buyer-email" className="label">
              {t('electronicInvoiceRequest.email')}
            </label>
            <input
              id="sale-invoice-buyer-email"
              type="email"
              className={`${inputClass} w-full`}
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
          {isSavedBuyer && typeAbbr && (
            <p className="sale-pay-note" data-tone="ok" data-testid="sale-invoice-saved-buyer">
              <CircleCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
              {t('electronicInvoiceRequest.savedBuyer', { type: typeAbbr })}
            </p>
          )}
          <p className="sale-pay-note" data-tone="muted">
            <ReceiptText className="h-5 w-5 shrink-0" aria-hidden="true" />
            {t('electronicInvoiceRequest.queueNote')}
          </p>
        </div>
      )}
    </section>
  );
}
