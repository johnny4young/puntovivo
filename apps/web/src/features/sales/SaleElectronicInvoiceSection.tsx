/**
 * Buyer data is asked for only when the buyer wants an invoice in their name
 * (Res. DIAN 227/2025 art. 1.5.1.12.3); see docs/FISCAL-INTEGRATION.md.
 * @module features/sales/SaleElectronicInvoiceSection
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { CheckCircle2, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWatch, type UseFormReturn } from 'react-hook-form';

import type { Customer } from '@/types';
import type { ElectronicInvoiceFormValues } from './salePaymentModal.types';
import { EMPTY_INVOICE_BUYER } from './electronicInvoiceRequest';
import { cn } from '@/lib/utils';
import {
  buyerIdProblem,
  expectedNitDigit,
  NIT_TYPE_CODE,
  nitDigitState,
  nitPreview,
} from './invoiceBuyerNit';

type BuyerField = keyof typeof EMPTY_INVOICE_BUYER;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ElectronicInvoiceIdentificationType {
  code: string;
  abbr: string;
  nameEs: string;
  nameEn: string;
}

interface SaleElectronicInvoiceSectionProps {
  form: UseFormReturn<ElectronicInvoiceFormValues>;
  identificationTypes: ElectronicInvoiceIdentificationType[];
  selectedCustomer: Pick<Customer, 'id' | 'name' | 'taxId' | 'email'> | null;
  /** One column with 44 px targets, for the touch cart rail. */
  touch?: boolean;
  /** Secondary chips shown beside the toggle in the payment sheet. */
  aside?: ReactNode;
}

export function SaleElectronicInvoiceSection({
  form,
  identificationTypes,
  selectedCustomer,
  touch = false,
  aside,
}: SaleElectronicInvoiceSectionProps) {
  // Lazy fiscal copy: only tenants that can issue an FEV pay for these strings.
  const { t, i18n } = useTranslation('fiscal');
  const requested = useWatch({ control: form.control, name: 'invoiceRequested' }) ?? false;
  const typeCode = useWatch({ control: form.control, name: 'invoiceBuyer.identificationTypeCode' });
  const idNumber = useWatch({ control: form.control, name: 'invoiceBuyer.identificationNumber' });
  const recordedNit = typeCode === NIT_TYPE_CODE ? nitPreview(idNumber ?? '') : null;
  const errors = form.formState.errors.invoiceBuyer;
  const usesSpanish = i18n.language.startsWith('es');
  const nitDigit = typeCode === NIT_TYPE_CODE ? nitDigitState(idNumber ?? '') : null;
  const inputClass = touch
    ? 'input mt-1 min-h-[44px] w-full'
    : 'mt-1.5 h-[52px] w-full min-w-0 rounded-[13px] border-[1.5px] border-line-strong bg-background px-3.5 text-base font-semibold text-foreground outline-none focus-visible:border-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500/40';
  const labelClass = touch
    ? 'label'
    : 'block text-xs font-semibold uppercase tracking-[0.1em] text-fg3';

  const isRequested = () => form.getValues('invoiceRequested') === true;
  const required = (value: string | undefined) =>
    !isRequested() || (value ?? '').trim().length > 0 || t('electronicInvoiceRequest.required');

  // What the customer filled in, so a customer change can take it back.
  const prefilled = useRef<Partial<Record<BuyerField, string>>>({});
  const appliedCustomerId = useRef<string | null>(null);
  const customerId = selectedCustomer?.id ?? null;

  useEffect(() => {
    if (!requested) {
      // A reset form starts the next ticket with nothing to take back.
      appliedCustomerId.current = null;
      prefilled.current = {};
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

  const nameField = (
    <div>
      <label htmlFor="sale-invoice-buyer-name" className={labelClass}>
        {t('electronicInvoiceRequest.name')}
      </label>
      <input
        id="sale-invoice-buyer-name"
        className={inputClass}
        autoComplete="off"
        maxLength={200}
        aria-invalid={errors?.name ? true : undefined}
        aria-describedby={errors?.name ? 'sale-invoice-buyer-name-error' : undefined}
        {...form.register('invoiceBuyer.name', { validate: required })}
      />
      {fieldError(errors?.name?.message, 'sale-invoice-buyer-name-error')}
    </div>
  );
  const typeField = (
    <div>
      <label htmlFor="sale-invoice-buyer-id-type" className={labelClass}>
        {t('electronicInvoiceRequest.idType')}
      </label>
      <select
        id="sale-invoice-buyer-id-type"
        className={inputClass}
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
  );
  const numberField = (
    <div>
      <label htmlFor="sale-invoice-buyer-id-number" className={labelClass}>
        {t('electronicInvoiceRequest.idNumber')}
      </label>
      <input
        id="sale-invoice-buyer-id-number"
        className={inputClass}
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
      {fieldError(errors?.identificationNumber?.message, 'sale-invoice-buyer-id-number-error')}
      {recordedNit && !errors?.identificationNumber && (
        <p className="mt-1 text-xs text-fg2" data-testid="sale-invoice-nit-preview">
          {t('electronicInvoiceRequest.nitPreview', { nit: recordedNit })}
        </p>
      )}
    </div>
  );
  const emailField = (
    <div>
      <label htmlFor="sale-invoice-buyer-email" className={labelClass}>
        {t('electronicInvoiceRequest.email')}
      </label>
      <input
        id="sale-invoice-buyer-email"
        type="email"
        className={inputClass}
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
  );

  if (touch) {
    return (
      <div
        className="rounded-lg border border-line/50 bg-surface-2/40 p-3"
        data-testid="sale-electronic-invoice"
      >
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-medium text-secondary-900">
          <input
            type="checkbox"
            className="h-5 w-5 shrink-0"
            data-testid="sale-electronic-invoice-toggle"
            {...form.register('invoiceRequested')}
          />
          {t('electronicInvoiceRequest.toggle')}
        </label>
        {requested && (
          <div className="mt-3 grid grid-cols-1 gap-3">
            {nameField}
            {typeField}
            {numberField}
            {emailField}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="sale-electronic-invoice">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[14px] border-[1.5px] border-line-strong bg-surface px-3.5 text-sm font-semibold text-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-500">
          <input
            type="checkbox"
            className="peer sr-only"
            data-testid="sale-electronic-invoice-toggle"
            {...form.register('invoiceRequested')}
          />
          <span
            aria-hidden="true"
            className="relative h-5 w-9 shrink-0 rounded-full bg-fg4 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-surface after:transition-transform peer-checked:bg-success-500 peer-checked:after:translate-x-4 motion-reduce:transition-none motion-reduce:after:transition-none"
          />
          {t('electronicInvoiceRequest.toggle')}
        </label>
        {aside}
      </div>

      {requested && (
        <div className="space-y-3">
          <div
            className={cn(
              'grid gap-2',
              nitDigit
                ? 'grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,5rem)]'
                : 'grid-cols-[minmax(0,10rem)_minmax(0,1fr)]'
            )}
          >
            {typeField}
            {numberField}
            {nitDigit && (
              <div>
                <p className={labelClass}>{t('electronicInvoiceRequest.dv')}</p>
                <output
                  htmlFor="sale-invoice-buyer-id-number"
                  className="mt-1.5 flex h-[52px] items-center justify-between gap-1 rounded-[13px] border-[1.5px] border-line-strong bg-background px-3.5 text-base font-semibold text-foreground"
                  data-testid="sale-invoice-nit-dv"
                >
                  {nitDigit.digit}
                  {nitDigit.valid && (
                    <>
                      <CheckCircle2 className="h-5 w-5 text-success-700" aria-hidden="true" />
                      <span className="sr-only">{t('electronicInvoiceRequest.dvValid')}</span>
                    </>
                  )}
                </output>
              </div>
            )}
          </div>
          {nameField}
          {emailField}
          {selectedCustomer?.taxId && (
            <p
              className="flex items-center gap-2 text-sm font-semibold text-success-700"
              data-testid="sale-invoice-saved-customer"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t('electronicInvoiceRequest.savedCustomer')}
            </p>
          )}
          <p className="flex items-start gap-2.5 rounded-[13px] bg-surface-3 px-3.5 py-3 text-sm text-fg2">
            <FileText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('electronicInvoiceRequest.queueNote')}
          </p>
        </div>
      )}
    </div>
  );
}
