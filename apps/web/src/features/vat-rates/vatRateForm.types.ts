import type { VatRate } from '@/types';

export interface VatRateFormValues {
  name: string;
  rate: number;
  kind: 'iva' | 'inc';
  isActive: boolean;
}

const defaultValues: VatRateFormValues = {
  name: '',
  rate: 0,
  kind: 'iva',
  isActive: true,
};

export function createVatRateFormValues(vatRate: VatRate | null): VatRateFormValues {
  if (!vatRate) return defaultValues;

  return {
    name: vatRate.name,
    rate: vatRate.rate,
    kind: vatRate.kind ?? 'iva',
    isActive: vatRate.isActive,
  };
}
