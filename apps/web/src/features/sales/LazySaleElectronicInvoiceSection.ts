import { lazy } from 'react';

/** One lazy loader for every checkout that offers the electronic-invoice request. */
export const SaleElectronicInvoiceSection = lazy(async () => {
  const module = await import('./SaleElectronicInvoiceSection');
  return { default: module.SaleElectronicInvoiceSection };
});
