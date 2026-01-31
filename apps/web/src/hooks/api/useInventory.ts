import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { MovementType } from '@/types';
import {
  getInventoryMovements,
  getMovementById,
  createMovement,
  getProductStock,
  adjustStock,
  getLowStockProducts,
  type InventoryMovementListParams,
  type CreateMovementData,
  type AdjustStockData,
} from '@/services/api/inventory';
import { productKeys } from './useProducts';

// Query Keys
export const inventoryKeys = {
  all: ['inventory'] as const,
  movements: () => [...inventoryKeys.all, 'movements'] as const,
  movementsList: (params: InventoryMovementListParams) =>
    [...inventoryKeys.movements(), params] as const,
  movementDetail: (id: string) => [...inventoryKeys.movements(), 'detail', id] as const,
  stock: () => [...inventoryKeys.all, 'stock'] as const,
  productStock: (productId: string) => [...inventoryKeys.stock(), productId] as const,
  lowStock: () => [...inventoryKeys.all, 'low-stock'] as const,
};

/**
 * Hook to fetch paginated list of inventory movements
 */
export function useInventoryMovements(params: InventoryMovementListParams = {}) {
  return useQuery({
    queryKey: inventoryKeys.movementsList(params),
    queryFn: () => getInventoryMovements(params),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Hook to fetch a single movement by ID
 */
export function useMovement(id: string) {
  return useQuery({
    queryKey: inventoryKeys.movementDetail(id),
    queryFn: () => getMovementById(id),
    enabled: !!id,
  });
}

/**
 * Hook to get current stock for a product
 */
export function useProductStock(productId: string) {
  return useQuery({
    queryKey: inventoryKeys.productStock(productId),
    queryFn: () => getProductStock(productId),
    enabled: !!productId,
    staleTime: 60 * 1000, // 1 minute - stock data should be relatively fresh
  });
}

/**
 * Hook to get low stock products
 */
export function useLowStockProducts() {
  return useQuery({
    queryKey: inventoryKeys.lowStock(),
    queryFn: () => getLowStockProducts(),
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 5 * 60 * 1000, // Auto-refresh every 5 minutes
  });
}

/**
 * Hook to create a new inventory movement
 */
export function useCreateMovement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateMovementData) => createMovement(data),
    onSuccess: newMovement => {
      // Invalidate all movement lists
      queryClient.invalidateQueries({ queryKey: inventoryKeys.movements() });

      // Invalidate product stock for the affected product
      queryClient.invalidateQueries({
        queryKey: inventoryKeys.productStock(newMovement.productId),
      });

      // Invalidate product queries since stock changed
      queryClient.invalidateQueries({ queryKey: productKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: productKeys.detail(newMovement.productId),
      });

      // Invalidate low stock queries
      queryClient.invalidateQueries({ queryKey: inventoryKeys.lowStock() });
    },
    onError: error => {
      console.error('Failed to create movement:', error);
    },
  });
}

/**
 * Hook to adjust stock for a product
 */
export function useAdjustStock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ productId, quantity, reason }: { productId: string } & AdjustStockData) =>
      adjustStock(productId, quantity, reason),
    onSuccess: movement => {
      // Invalidate all movement lists
      queryClient.invalidateQueries({ queryKey: inventoryKeys.movements() });

      // Invalidate product stock for the affected product
      queryClient.invalidateQueries({
        queryKey: inventoryKeys.productStock(movement.productId),
      });

      // Invalidate product queries since stock changed
      queryClient.invalidateQueries({ queryKey: productKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: productKeys.detail(movement.productId),
      });

      // Invalidate low stock queries
      queryClient.invalidateQueries({ queryKey: inventoryKeys.lowStock() });
    },
    onError: error => {
      console.error('Failed to adjust stock:', error);
    },
  });
}

/**
 * Hook to get movements by product
 */
export function useMovementsByProduct(
  productId: string,
  params: Omit<InventoryMovementListParams, 'productId'> = {}
) {
  return useInventoryMovements({ ...params, productId });
}

/**
 * Hook to get movements by type
 */
export function useMovementsByType(
  type: MovementType,
  params: Omit<InventoryMovementListParams, 'type'> = {}
) {
  return useInventoryMovements({ ...params, type });
}

/**
 * Hook to get movements by date range
 */
export function useMovementsByDateRange(
  dateFrom: string,
  dateTo: string,
  params: Omit<InventoryMovementListParams, 'dateFrom' | 'dateTo'> = {}
) {
  return useInventoryMovements({ ...params, dateFrom, dateTo });
}

/**
 * Hook to get purchase movements
 */
export function usePurchaseMovements(params: Omit<InventoryMovementListParams, 'type'> = {}) {
  return useMovementsByType('purchase', params);
}

/**
 * Hook to get sale movements
 */
export function useSaleMovements(params: Omit<InventoryMovementListParams, 'type'> = {}) {
  return useMovementsByType('sale', params);
}

/**
 * Hook to get adjustment movements
 */
export function useAdjustmentMovements(params: Omit<InventoryMovementListParams, 'type'> = {}) {
  return useMovementsByType('adjustment', params);
}

/**
 * Hook to calculate inventory summary
 */
export function useInventorySummary(params: InventoryMovementListParams = {}) {
  return useQuery({
    queryKey: [...inventoryKeys.movementsList(params), 'summary'] as const,
    queryFn: async () => {
      const movements = await getInventoryMovements({ ...params, perPage: 1000 });

      const summary = {
        totalMovements: movements.totalItems,
        purchases: 0,
        sales: 0,
        adjustments: 0,
        returns: 0,
        transfers: 0,
        netChange: 0,
      };

      for (const movement of movements.items) {
        summary.netChange += movement.newStock - movement.previousStock;

        switch (movement.type) {
          case 'purchase':
            summary.purchases += Math.abs(movement.quantity);
            break;
          case 'sale':
            summary.sales += Math.abs(movement.quantity);
            break;
          case 'adjustment':
            summary.adjustments += movement.quantity;
            break;
          case 'return':
            summary.returns += Math.abs(movement.quantity);
            break;
          case 'transfer':
            summary.transfers += Math.abs(movement.quantity);
            break;
        }
      }

      return summary;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to prefetch product stock
 */
export function usePrefetchProductStock() {
  const queryClient = useQueryClient();

  return (productId: string) => {
    queryClient.prefetchQuery({
      queryKey: inventoryKeys.productStock(productId),
      queryFn: () => getProductStock(productId),
      staleTime: 60 * 1000,
    });
  };
}
