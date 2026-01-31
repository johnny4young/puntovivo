import api from './client';
import type { Product, PaginatedResponse } from '@/types';

export interface ProductListParams {
  page?: number;
  perPage?: number;
  filter?: string;
  sort?: string;
  search?: string;
  categoryId?: string;
  isActive?: boolean;
}

export interface CreateProductData {
  name: string;
  sku: string;
  description?: string;
  categoryId: string;
  price: number;
  cost: number;
  taxRate: number;
  stock?: number;
  minStock?: number;
  isActive?: boolean;
  barcode?: string;
  imageUrl?: string;
}

export interface UpdateProductData extends Partial<CreateProductData> {}

const COLLECTION = 'products';

/**
 * Get paginated list of products with optional filtering and sorting
 */
export async function getProducts(
  params: ProductListParams = {}
): Promise<PaginatedResponse<Product>> {
  const {
    page = 1,
    perPage = 50,
    filter = '',
    sort = '-created',
    search,
    categoryId,
    isActive,
  } = params;

  // Build filter string
  const filters: string[] = [];

  if (filter) {
    filters.push(filter);
  }

  if (search) {
    filters.push(`(name ~ "${search}" || sku ~ "${search}" || barcode ~ "${search}")`);
  }

  if (categoryId) {
    filters.push(`categoryId = "${categoryId}"`);
  }

  if (isActive !== undefined) {
    filters.push(`isActive = ${isActive}`);
  }

  const combinedFilter = filters.join(' && ');

  const result = await api.getList<Product>(COLLECTION, page, perPage, combinedFilter, sort);

  return {
    items: result.items,
    page,
    perPage,
    totalItems: result.totalItems,
    totalPages: result.totalPages,
  };
}

/**
 * Get a single product by ID
 */
export async function getProductById(id: string): Promise<Product> {
  return await api.getOne<Product>(COLLECTION, id);
}

/**
 * Create a new product
 */
export async function createProduct(data: CreateProductData): Promise<Product> {
  return await api.create<Product>(COLLECTION, {
    ...data,
    stock: data.stock ?? 0,
    minStock: data.minStock ?? 0,
    isActive: data.isActive ?? true,
  });
}

/**
 * Update an existing product
 */
export async function updateProduct(id: string, data: UpdateProductData): Promise<Product> {
  return await api.update<Product>(COLLECTION, id, data);
}

/**
 * Delete a product by ID
 */
export async function deleteProduct(id: string): Promise<boolean> {
  return await api.delete(COLLECTION, id);
}

/**
 * Get products by category
 */
export async function getProductsByCategory(
  categoryId: string,
  params: Omit<ProductListParams, 'categoryId'> = {}
): Promise<PaginatedResponse<Product>> {
  return getProducts({ ...params, categoryId });
}

/**
 * Search products by name, SKU, or barcode
 */
export async function searchProducts(
  query: string,
  params: Omit<ProductListParams, 'search'> = {}
): Promise<PaginatedResponse<Product>> {
  return getProducts({ ...params, search: query });
}

/**
 * Get low stock products (stock below minStock threshold)
 */
export async function getLowStockProducts(
  params: ProductListParams = {}
): Promise<PaginatedResponse<Product>> {
  return getProducts({
    ...params,
    filter: 'stock < minStock',
  });
}
