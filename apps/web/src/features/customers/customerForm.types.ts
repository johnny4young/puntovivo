import type { Customer } from '@/types';

export interface CustomerFormValues {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  taxId: string;
  identificationTypeId: string;
  personTypeId: string;
  regimeTypeId: string;
  clientTypeId: string;
  commercialActivityId: string;
  notes: string;
  creditLimit: number;
  isActive: boolean;
}

const defaultValues: CustomerFormValues = {
  name: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  taxId: '',
  identificationTypeId: '',
  personTypeId: '',
  regimeTypeId: '',
  clientTypeId: '',
  commercialActivityId: '',
  notes: '',
  creditLimit: 0,
  isActive: true,
};

export function createCustomerFormValues(
  customer: Customer | null,
  defaultName?: string
): CustomerFormValues {
  if (!customer) {
    return defaultName ? { ...defaultValues, name: defaultName } : defaultValues;
  }

  return {
    name: customer.name,
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    address: customer.address ?? '',
    city: customer.city ?? '',
    state: customer.state ?? '',
    postalCode: customer.postalCode ?? '',
    country: customer.country ?? '',
    taxId: customer.taxId ?? '',
    identificationTypeId: customer.identificationTypeId ?? '',
    personTypeId: customer.personTypeId ?? '',
    regimeTypeId: customer.regimeTypeId ?? '',
    clientTypeId: customer.clientTypeId ?? '',
    commercialActivityId: customer.commercialActivityId ?? '',
    notes: customer.notes ?? '',
    creditLimit: customer.creditLimit ?? 0,
    isActive: customer.isActive,
  };
}

export function hasAdvancedCustomerData(customer: Customer | null): boolean {
  if (!customer) return false;
  const values = createCustomerFormValues(customer);
  return Boolean(
    values.taxId ||
    values.identificationTypeId ||
    values.personTypeId ||
    values.regimeTypeId ||
    values.clientTypeId ||
    values.commercialActivityId ||
    values.address ||
    values.city ||
    values.state ||
    values.postalCode ||
    values.country ||
    values.notes ||
    values.creditLimit > 0 ||
    !values.isActive
  );
}
