import api from './client';
import type { InventoryMovement, Product, PaginatedResponse, MovementType } from '@/types';

export interface InventoryMovementListParams {
  page?: number;
  perPage?: number;
  filter?: string;
  sort?: string;
  productId?: string;
  type?: MovementType;
  dateFrom?: string;
  dateTo?: string;
}

export interface CreateMovementData {
  productId: string;
  type: MovementType;
  quantity: number;
  reference?: string;
  notes?: string;
}

export interface AdjustStockData {
  quantity: number;
  reason: string;
}

export interface ProductStockInfo {
  productId: string;
  productName: string;
  currentStock: number;
  minStock: number;
  isLowStock: boolean;
  lastMovement?: InventoryMovement;
}

const MOVEMENTS_COLLECTION = 'inventory_movements';
const PRODUCTS_COLLECTION = 'products';

/**
 * Get paginated list of inventory movements with optional filtering and sorting
 */
export async function getInventoryMovements(
  params: InventoryMovementListParams = {}
): Promise<PaginatedResponse<InventoryMovement>> {
  const {
    page = 1,
    perPage = 50,
    filter = '',
    sort = '-created',
    productId,
    type,
    dateFrom,
    dateTo,
  } = params;

  // Build filter string
  const filters: string[] = [];

  if (filter) {
    filters.push(filter);
  }

  if (productId) {
    filters.push(`productId = "${productId}"`);
  }

  if (type) {
    filters.push(`type = "${type}"`);
  }

  if (dateFrom) {
    filters.push(`created >= "${dateFrom}"`);
  }

  if (dateTo) {
    filters.push(`created <= "${dateTo}"`);
  }

  const combinedFilter = filters.join(' && ');

  const result = await api.getList<InventoryMovement>(
    MOVEMENTS_COLLECTION,
    page,
    perPage,
    combinedFilter,
    sort
  );

  return {
    items: result.items,
    page,
    perPage,
    totalItems: result.totalItems,
    totalPages: result.totalPages,
  };
}

/**
 * Get a single inventory movement by ID
 */
export async function getMovementById(id: string): Promise<InventoryMovement> {
  return await api.getOne<InventoryMovement>(MOVEMENTS_COLLECTION, id);
}

/**
 * Create a new inventory movement and update product stock
 */
export async function createMovement(data: CreateMovementData): Promise<InventoryMovement> {
  // Get current product stock
  const product = await api.getOne<Product>(PRODUCTS_COLLECTION, data.productId);
  const previousStock = product.stock;

  // Calculate new stock based on movement type
  let newStock: number;
  switch (data.type) {
    case 'purchase':
    case 'return':
      newStock = previousStock + Math.abs(data.quantity);
      break;
    case 'sale':
      newStock = previousStock - Math.abs(data.quantity);
      break;
    case 'adjustment':
    case 'transfer':
      // For adjustments, quantity can be positive or negative
      newStock = previousStock + data.quantity;
      break;
    default:
      newStock = previousStock + data.quantity;
  }

  // Ensure stock doesn't go negative
  if (newStock < 0) {
    throw new Error(
      `Insufficient stock. Current: ${previousStock}, Requested: ${Math.abs(data.quantity)}`
    );
  }

  // Create the movement record
  const movement = await api.create<InventoryMovement>(MOVEMENTS_COLLECTION, {
    productId: data.productId,
    type: data.type,
    quantity: data.quantity,
    previousStock,
    newStock,
    reference: data.reference,
    notes: data.notes,
  });

  // Update product stock
  await api.update<Product>(PRODUCTS_COLLECTION, data.productId, {
    stock: newStock,
  });

  return movement;
}

/**
 * Get current stock for a product
 */
export async function getProductStock(productId: string): Promise<ProductStockInfo> {
  const product = await api.getOne<Product>(PRODUCTS_COLLECTION, productId);

  // Get last movement
  const movements = await api.getList<InventoryMovement>(
    MOVEMENTS_COLLECTION,
    1,
    1,
    `productId = "${productId}"`,
    '-created'
  );

  return {
    productId: product.id,
    productName: product.name,
    currentStock: product.stock,
    minStock: product.minStock,
    isLowStock: product.stock < product.minStock,
    lastMovement: movements.items[0],
  };
}

/**
 * Adjust stock for a product with reason
 */
export async function adjustStock(
  productId: string,
  quantity: number,
  reason: string
): Promise<InventoryMovement> {
  return createMovement({
    productId,
    type: 'adjustment',
    quantity,
    notes: reason,
  });
}

/**
 * Get movements by product
 */
export async function getMovementsByProduct(
  productId: string,
  params: Omit<InventoryMovementListParams, 'productId'> = {}
): Promise<PaginatedResponse<InventoryMovement>> {
  return getInventoryMovements({ ...params, productId });
}

/**
 * Get movements by type
 */
export async function getMovementsByType(
  type: MovementType,
  params: Omit<InventoryMovementListParams, 'type'> = {}
): Promise<PaginatedResponse<InventoryMovement>> {
  return getInventoryMovements({ ...params, type });
}

/**
 * Get movements within a date range
 */
export async function getMovementsByDateRange(
  dateFrom: string,
  dateTo: string,
  params: Omit<InventoryMovementListParams, 'dateFrom' | 'dateTo'> = {}
): Promise<PaginatedResponse<InventoryMovement>> {
  return getInventoryMovements({ ...params, dateFrom, dateTo });
}

/**
 * Get stock summary for all products (low stock alerts)
 */
export async function getLowStockProducts(): Promise<ProductStockInfo[]> {
  const result = await api.getList<Product>(
    PRODUCTS_COLLECTION,
    1,
    100,
    'stock < minStock && isActive = true',
    'stock'
  );

  return result.items.map(product => ({
    productId: product.id,
    productName: product.name,
    currentStock: product.stock,
    minStock: product.minStock,
    isLowStock: true,
  }));
}
