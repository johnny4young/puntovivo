import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Sale } from '@/types';
import {
  getSales,
  getSaleById,
  createSale,
  updateSale,
  voidSale,
  getSaleItems,
  type SaleListParams,
  type CreateSaleData,
  type UpdateSaleData,
} from '@/services/api/sales';
import { productKeys } from './useProducts';

// Query Keys
export const saleKeys = {
  all: ['sales'] as const,
  lists: () => [...saleKeys.all, 'list'] as const,
  list: (params: SaleListParams) => [...saleKeys.lists(), params] as const,
  details: () => [...saleKeys.all, 'detail'] as const,
  detail: (id: string) => [...saleKeys.details(), id] as const,
  items: (saleId: string) => [...saleKeys.all, 'items', saleId] as const,
  today: () => [...saleKeys.lists(), 'today'] as const,
};

/**
 * Hook to fetch paginated list of sales
 */
export function useSales(params: SaleListParams = {}) {
  return useQuery({
    queryKey: saleKeys.list(params),
    queryFn: () => getSales(params),
    staleTime: 2 * 60 * 1000, // 2 minutes - sales data changes frequently
  });
}

/**
 * Hook to fetch a single sale by ID with items expanded
 */
export function useSale(id: string) {
  return useQuery({
    queryKey: saleKeys.detail(id),
    queryFn: () => getSaleById(id),
    enabled: !!id,
  });
}

/**
 * Hook to fetch sale items separately
 */
export function useSaleItems(saleId: string) {
  return useQuery({
    queryKey: saleKeys.items(saleId),
    queryFn: () => getSaleItems(saleId),
    enabled: !!saleId,
  });
}

/**
 * Hook to create a new sale with items
 */
export function useCreateSale() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSaleData) => createSale(data),
    onSuccess: newSale => {
      // Invalidate all sale lists
      queryClient.invalidateQueries({ queryKey: saleKeys.lists() });

      // Set the new sale in cache
      queryClient.setQueryData(saleKeys.detail(newSale.id), newSale);

      // Invalidate product stock queries since sale affects inventory
      queryClient.invalidateQueries({ queryKey: productKeys.lists() });
    },
    onError: error => {
      console.error('Failed to create sale:', error);
    },
  });
}

/**
 * Hook to update an existing sale
 */
export function useUpdateSale() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSaleData }) => updateSale(id, data),
    onSuccess: updatedSale => {
      // Update the cached sale detail
      queryClient.setQueryData(saleKeys.detail(updatedSale.id), updatedSale);

      // Invalidate sale lists to reflect changes
      queryClient.invalidateQueries({ queryKey: saleKeys.lists() });
    },
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: saleKeys.detail(id) });

      // Snapshot the previous value
      const previousSale = queryClient.getQueryData<Sale>(saleKeys.detail(id));

      // Optimistically update the cache
      if (previousSale) {
        queryClient.setQueryData(saleKeys.detail(id), {
          ...previousSale,
          ...data,
        });
      }

      return { previousSale };
    },
    onError: (error, { id }, context) => {
      // Rollback on error
      if (context?.previousSale) {
        queryClient.setQueryData(saleKeys.detail(id), context.previousSale);
      }
      console.error('Failed to update sale:', error);
    },
  });
}

/**
 * Hook to void a sale
 */
export function useVoidSale() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => voidSale(id, reason),
    onSuccess: voidedSale => {
      // Update the cached sale detail
      queryClient.setQueryData(saleKeys.detail(voidedSale.id), voidedSale);

      // Invalidate sale lists
      queryClient.invalidateQueries({ queryKey: saleKeys.lists() });

      // Invalidate product stock queries since void may affect inventory
      queryClient.invalidateQueries({ queryKey: productKeys.lists() });
    },
    onError: error => {
      console.error('Failed to void sale:', error);
    },
  });
}

/**
 * Hook to get sales by customer
 */
export function useSalesByCustomer(
  customerId: string,
  params: Omit<SaleListParams, 'customerId'> = {}
) {
  return useSales({ ...params, customerId });
}

/**
 * Hook to get sales by date range
 */
export function useSalesByDateRange(
  dateFrom: string,
  dateTo: string,
  params: Omit<SaleListParams, 'dateFrom' | 'dateTo'> = {}
) {
  return useSales({ ...params, dateFrom, dateTo });
}

/**
 * Hook to get today's sales
 */
export function useTodaySales(params: Omit<SaleListParams, 'dateFrom' | 'dateTo'> = {}) {
  const today = new Date().toISOString().split('T')[0];

  return useQuery({
    queryKey: saleKeys.today(),
    queryFn: () =>
      getSales({
        ...params,
        dateFrom: today,
        dateTo: today + 'T23:59:59',
      }),
    staleTime: 60 * 1000, // 1 minute for today's sales
    refetchInterval: 5 * 60 * 1000, // Auto-refresh every 5 minutes
  });
}

/**
 * Hook to get completed sales
 */
export function useCompletedSales(params: Omit<SaleListParams, 'status'> = {}) {
  return useSales({ ...params, status: 'completed' });
}

/**
 * Hook to get pending payment sales
 */
export function usePendingPaymentSales(params: Omit<SaleListParams, 'paymentStatus'> = {}) {
  return useSales({ ...params, paymentStatus: 'pending' });
}

/**
 * Hook to prefetch a sale (for hover/navigation optimization)
 */
export function usePrefetchSale() {
  const queryClient = useQueryClient();

  return (id: string) => {
    queryClient.prefetchQuery({
      queryKey: saleKeys.detail(id),
      queryFn: () => getSaleById(id),
      staleTime: 2 * 60 * 1000,
    });
  };
}

/**
 * Hook to calculate sales summary
 */
export function useSalesSummary(params: SaleListParams = {}) {
  return useQuery({
    queryKey: [...saleKeys.list(params), 'summary'] as const,
    queryFn: async () => {
      const sales = await getSales({ ...params, perPage: 1000 });

      return {
        totalSales: sales.totalItems,
        totalRevenue: sales.items.reduce((sum, sale) => sum + sale.total, 0),
        totalTax: sales.items.reduce((sum, sale) => sum + sale.taxAmount, 0),
        averageSale:
          sales.items.length > 0
            ? sales.items.reduce((sum, sale) => sum + sale.total, 0) / sales.items.length
            : 0,
        completedCount: sales.items.filter(s => s.status === 'completed').length,
        voidedCount: sales.items.filter(s => s.status === 'voided').length,
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}
