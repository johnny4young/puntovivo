import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Customer } from '@/types';
import {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  type CustomerListParams,
  type CreateCustomerData,
  type UpdateCustomerData,
} from '@/services/api/customers';

// Query Keys
export const customerKeys = {
  all: ['customers'] as const,
  lists: () => [...customerKeys.all, 'list'] as const,
  list: (params: CustomerListParams) => [...customerKeys.lists(), params] as const,
  details: () => [...customerKeys.all, 'detail'] as const,
  detail: (id: string) => [...customerKeys.details(), id] as const,
};

/**
 * Hook to fetch paginated list of customers
 */
export function useCustomers(params: CustomerListParams = {}) {
  return useQuery({
    queryKey: customerKeys.list(params),
    queryFn: () => getCustomers(params),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch a single customer by ID
 */
export function useCustomer(id: string) {
  return useQuery({
    queryKey: customerKeys.detail(id),
    queryFn: () => getCustomerById(id),
    enabled: !!id,
  });
}

/**
 * Hook to create a new customer
 */
export function useCreateCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCustomerData) => createCustomer(data),
    onSuccess: newCustomer => {
      // Invalidate all customer lists
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });

      // Set the new customer in cache
      queryClient.setQueryData(customerKeys.detail(newCustomer.id), newCustomer);
    },
    onError: error => {
      console.error('Failed to create customer:', error);
    },
  });
}

/**
 * Hook to update an existing customer
 */
export function useUpdateCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCustomerData }) =>
      updateCustomer(id, data),
    onSuccess: updatedCustomer => {
      // Update the cached customer detail
      queryClient.setQueryData(customerKeys.detail(updatedCustomer.id), updatedCustomer);

      // Invalidate customer lists to reflect changes
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
    },
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: customerKeys.detail(id) });

      // Snapshot the previous value
      const previousCustomer = queryClient.getQueryData<Customer>(customerKeys.detail(id));

      // Optimistically update the cache
      if (previousCustomer) {
        queryClient.setQueryData(customerKeys.detail(id), {
          ...previousCustomer,
          ...data,
        });
      }

      return { previousCustomer };
    },
    onError: (error, { id }, context) => {
      // Rollback on error
      if (context?.previousCustomer) {
        queryClient.setQueryData(customerKeys.detail(id), context.previousCustomer);
      }
      console.error('Failed to update customer:', error);
    },
  });
}

/**
 * Hook to delete a customer
 */
export function useDeleteCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteCustomer(id),
    onSuccess: (_, deletedId) => {
      // Remove from cache
      queryClient.removeQueries({ queryKey: customerKeys.detail(deletedId) });

      // Invalidate customer lists
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
    },
    onError: error => {
      console.error('Failed to delete customer:', error);
    },
  });
}

/**
 * Hook to search customers
 */
export function useSearchCustomers(query: string, params: Omit<CustomerListParams, 'search'> = {}) {
  return useCustomers({ ...params, search: query });
}

/**
 * Hook to get active customers only
 */
export function useActiveCustomers(params: Omit<CustomerListParams, 'isActive'> = {}) {
  return useCustomers({ ...params, isActive: true });
}

/**
 * Hook to prefetch a customer (for hover/navigation optimization)
 */
export function usePrefetchCustomer() {
  const queryClient = useQueryClient();

  return (id: string) => {
    queryClient.prefetchQuery({
      queryKey: customerKeys.detail(id),
      queryFn: () => getCustomerById(id),
      staleTime: 5 * 60 * 1000,
    });
  };
}

/**
 * Hook to get customer for select/dropdown components
 */
export function useCustomerOptions(search?: string) {
  return useQuery({
    queryKey: [...customerKeys.lists(), 'options', search] as const,
    queryFn: () =>
      getCustomers({
        search,
        isActive: true,
        perPage: 50,
        sort: 'name',
      }),
    staleTime: 5 * 60 * 1000,
    select: data =>
      data.items.map(customer => ({
        value: customer.id,
        label: customer.name,
        customer,
      })),
  });
}
