import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Product } from '@/types';
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  type ProductListParams,
  type CreateProductData,
  type UpdateProductData,
} from '@/services/api/products';

// Query Keys
export const productKeys = {
  all: ['products'] as const,
  lists: () => [...productKeys.all, 'list'] as const,
  list: (params: ProductListParams) => [...productKeys.lists(), params] as const,
  details: () => [...productKeys.all, 'detail'] as const,
  detail: (id: string) => [...productKeys.details(), id] as const,
};

/**
 * Hook to fetch paginated list of products
 */
export function useProducts(params: ProductListParams = {}) {
  return useQuery({
    queryKey: productKeys.list(params),
    queryFn: () => getProducts(params),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch a single product by ID
 */
export function useProduct(id: string) {
  return useQuery({
    queryKey: productKeys.detail(id),
    queryFn: () => getProductById(id),
    enabled: !!id,
  });
}

/**
 * Hook to create a new product
 */
export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateProductData) => createProduct(data),
    onSuccess: newProduct => {
      // Invalidate all product lists
      queryClient.invalidateQueries({ queryKey: productKeys.lists() });

      // Optionally set the new product in cache
      queryClient.setQueryData(productKeys.detail(newProduct.id), newProduct);
    },
    onError: error => {
      console.error('Failed to create product:', error);
    },
  });
}

/**
 * Hook to update an existing product
 */
export function useUpdateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProductData }) => updateProduct(id, data),
    onSuccess: updatedProduct => {
      // Update the cached product detail
      queryClient.setQueryData(productKeys.detail(updatedProduct.id), updatedProduct);

      // Invalidate product lists to reflect changes
      queryClient.invalidateQueries({ queryKey: productKeys.lists() });
    },
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: productKeys.detail(id) });

      // Snapshot the previous value
      const previousProduct = queryClient.getQueryData<Product>(productKeys.detail(id));

      // Optimistically update the cache
      if (previousProduct) {
        queryClient.setQueryData(productKeys.detail(id), {
          ...previousProduct,
          ...data,
        });
      }

      return { previousProduct };
    },
    onError: (error, { id }, context) => {
      // Rollback on error
      if (context?.previousProduct) {
        queryClient.setQueryData(productKeys.detail(id), context.previousProduct);
      }
      console.error('Failed to update product:', error);
    },
  });
}

/**
 * Hook to delete a product
 */
export function useDeleteProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteProduct(id),
    onSuccess: (_, deletedId) => {
      // Remove from cache
      queryClient.removeQueries({ queryKey: productKeys.detail(deletedId) });

      // Invalidate product lists
      queryClient.invalidateQueries({ queryKey: productKeys.lists() });
    },
    onError: error => {
      console.error('Failed to delete product:', error);
    },
  });
}

/**
 * Hook to search products
 */
export function useSearchProducts(query: string, params: Omit<ProductListParams, 'search'> = {}) {
  return useProducts({ ...params, search: query });
}

/**
 * Hook to get products by category
 */
export function useProductsByCategory(
  categoryId: string,
  params: Omit<ProductListParams, 'categoryId'> = {}
) {
  return useProducts({ ...params, categoryId });
}

/**
 * Hook to get low stock products
 */
export function useLowStockProducts(params: ProductListParams = {}) {
  return useQuery({
    queryKey: [...productKeys.lists(), 'low-stock', params] as const,
    queryFn: () => getProducts({ ...params, filter: 'stock < minStock' }),
    staleTime: 60 * 1000, // 1 minute - more frequent updates for stock alerts
  });
}

/**
 * Hook to prefetch a product (for hover/navigation optimization)
 */
export function usePrefetchProduct() {
  const queryClient = useQueryClient();

  return (id: string) => {
    queryClient.prefetchQuery({
      queryKey: productKeys.detail(id),
      queryFn: () => getProductById(id),
      staleTime: 5 * 60 * 1000,
    });
  };
}
