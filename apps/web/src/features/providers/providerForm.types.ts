import type { Provider } from '@/types';

export interface ProviderFormValues {
  name: string;
  contactName: string;
  taxId: string;
  email: string;
  phone: string;
  address: string;
  cityId: string;
  isActive: boolean;
}

const defaultValues: ProviderFormValues = {
  name: '',
  contactName: '',
  taxId: '',
  email: '',
  phone: '',
  address: '',
  cityId: '',
  isActive: true,
};

export function createProviderFormValues(provider: Provider | null): ProviderFormValues {
  if (!provider) return defaultValues;

  return {
    name: provider.name,
    contactName: provider.contactName ?? '',
    taxId: provider.taxId ?? '',
    email: provider.email ?? '',
    phone: provider.phone ?? '',
    address: provider.address ?? '',
    cityId: provider.cityId ?? '',
    isActive: provider.isActive,
  };
}

export function hasAdvancedProviderData(provider: Provider | null): boolean {
  if (!provider) return false;
  const values = createProviderFormValues(provider);
  return Boolean(values.taxId || values.address || values.cityId || !values.isActive);
}
