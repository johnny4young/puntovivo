import { useEffect } from 'react';
import type { UseFormReturn } from 'react-hook-form';

import { trpc } from '@/lib/trpc';
import type { ElectronicInvoiceFormValues } from './salePaymentModal.types';

/** Whether this site can issue an FEV; clears a pending request when it cannot. */
export function useElectronicInvoiceAvailability(
  form: UseFormReturn<ElectronicInvoiceFormValues>,
  enabled: boolean
) {
  const query = trpc.sales.electronicInvoiceAvailability.useQuery(undefined, {
    enabled,
    staleTime: 60_000,
  });
  const available = query.data?.available === true;
  useEffect(() => {
    if (!available && form.getValues('invoiceRequested')) {
      form.setValue('invoiceRequested', false);
    }
  }, [form, available]);
  return { available, identificationTypes: query.data?.identificationTypes ?? [] };
}
