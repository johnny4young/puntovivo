import type { VatRate } from '@/types';

export interface VatRateFormValues {
  name: string;
  rate: number;
  isActive: boolean;
}

const defaultValues: VatRateFormValues = {
  name: '',
  rate: 0,
  isActive: true,
};

export function createVatRateFormValues(vatRate: VatRate | null): VatRateFormValues {
  if (!vatRate) return defaultValues;

  return {
    name: vatRate.name,
    rate: vatRate.rate,
    isActive: vatRate.isActive,
  };
}
