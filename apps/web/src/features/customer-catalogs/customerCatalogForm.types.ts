import type { CustomerCatalogItem } from '@/types';

export interface CustomerCatalogFormValues {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
}

const defaultValues: CustomerCatalogFormValues = {
  code: '',
  name: '',
  description: '',
  isActive: true,
};

export function createCustomerCatalogFormValues(
  item: CustomerCatalogItem | null
): CustomerCatalogFormValues {
  if (!item) return defaultValues;

  return {
    code: item.code,
    name: item.name,
    description: item.description ?? '',
    isActive: item.isActive,
  };
}
