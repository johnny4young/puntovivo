/**
 * Shared by every checkout that offers the buyer an electronic invoice.
 * @module features/sales/electronicInvoiceRequest
 */
import type { UseFormReturn } from 'react-hook-form';

import type {
  ElectronicInvoiceFormValues,
  SaleElectronicInvoiceBuyer,
} from './salePaymentModal.types';

/** Cédula de ciudadanía: the most common ID at a Colombian counter. */
export const EMPTY_INVOICE_BUYER = {
  name: '',
  identificationTypeCode: '13',
  identificationNumber: '',
  email: '',
} as const;

/** RHF forms are invariant in their values; any form carrying the invoice fields fits. */
export function asElectronicInvoiceForm<TValues extends ElectronicInvoiceFormValues>(
  form: UseFormReturn<TValues>
): UseFormReturn<ElectronicInvoiceFormValues> {
  return form as unknown as UseFormReturn<ElectronicInvoiceFormValues>;
}

/** The `electronicInvoice` input for `sales.create`, or undefined when not requested. */
export function buildElectronicInvoiceRequest(
  available: boolean,
  { invoiceRequested, invoiceBuyer }: ElectronicInvoiceFormValues
): { buyer: SaleElectronicInvoiceBuyer } | undefined {
  if (!available || !invoiceRequested || !invoiceBuyer) return undefined;
  const email = invoiceBuyer.email?.trim();
  return {
    buyer: {
      name: invoiceBuyer.name.trim(),
      identificationTypeCode: invoiceBuyer.identificationTypeCode,
      identificationNumber: invoiceBuyer.identificationNumber.trim(),
      ...(email ? { email } : {}),
    },
  };
}
