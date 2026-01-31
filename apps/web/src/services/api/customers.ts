import api from './client';
import type { Customer, PaginatedResponse } from '@/types';

export interface CustomerListParams {
  page?: number;
  perPage?: number;
  filter?: string;
  sort?: string;
  search?: string;
  isActive?: boolean;
}

export interface CreateCustomerData {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  taxId?: string;
  notes?: string;
  isActive?: boolean;
}

export type UpdateCustomerData = Partial<CreateCustomerData>;

const COLLECTION = 'customers';

/**
 * Get paginated list of customers with optional filtering and sorting
 */
export async function getCustomers(
  params: CustomerListParams = {}
): Promise<PaginatedResponse<Customer>> {
  const { page = 1, perPage = 50, filter = '', sort = '-created', search, isActive } = params;

  // Build filter string
  const filters: string[] = [];

  if (filter) {
    filters.push(filter);
  }

  if (search) {
    filters.push(
      `(name ~ "${search}" || email ~ "${search}" || phone ~ "${search}" || taxId ~ "${search}")`
    );
  }

  if (isActive !== undefined) {
    filters.push(`isActive = ${isActive}`);
  }

  const combinedFilter = filters.join(' && ');

  const result = await api.getList<Customer>(COLLECTION, page, perPage, combinedFilter, sort);

  return {
    items: result.items,
    page,
    perPage,
    totalItems: result.totalItems,
    totalPages: result.totalPages,
  };
}

/**
 * Get a single customer by ID
 */
export async function getCustomerById(id: string): Promise<Customer> {
  return await api.getOne<Customer>(COLLECTION, id);
}

/**
 * Create a new customer
 */
export async function createCustomer(data: CreateCustomerData): Promise<Customer> {
  return await api.create<Customer>(COLLECTION, {
    ...data,
    isActive: data.isActive ?? true,
  });
}

/**
 * Update an existing customer
 */
export async function updateCustomer(id: string, data: UpdateCustomerData): Promise<Customer> {
  return await api.update<Customer>(COLLECTION, id, data);
}

/**
 * Delete a customer by ID
 */
export async function deleteCustomer(id: string): Promise<boolean> {
  return await api.delete(COLLECTION, id);
}

/**
 * Search customers by name, email, phone, or tax ID
 */
export async function searchCustomers(
  query: string,
  params: Omit<CustomerListParams, 'search'> = {}
): Promise<PaginatedResponse<Customer>> {
  return getCustomers({ ...params, search: query });
}

/**
 * Get customers by city
 */
export async function getCustomersByCity(
  city: string,
  params: CustomerListParams = {}
): Promise<PaginatedResponse<Customer>> {
  return getCustomers({
    ...params,
    filter: `city = "${city}"`,
  });
}
