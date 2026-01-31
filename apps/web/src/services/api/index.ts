// API Client
export { default as api, pb } from './client';

// Products API
export type { ProductListParams, CreateProductData, UpdateProductData } from './products';
export {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductsByCategory,
  searchProducts,
  getLowStockProducts,
} from './products';

// Customers API
export type { CustomerListParams, CreateCustomerData, UpdateCustomerData } from './customers';
export {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  searchCustomers,
  getCustomersByCity,
} from './customers';

// Sales API
export type { SaleListParams, CreateSaleData, CreateSaleItemData, UpdateSaleData } from './sales';
export {
  getSales,
  getSaleById,
  createSale,
  updateSale,
  voidSale,
  cancelSale,
  getSaleItems,
  getSalesByCustomer,
  getSalesByDateRange,
  getTodaySales,
} from './sales';

// Inventory API
export type {
  InventoryMovementListParams,
  CreateMovementData,
  AdjustStockData,
  ProductStockInfo,
} from './inventory';
export {
  getInventoryMovements,
  getMovementById,
  createMovement,
  getProductStock,
  adjustStock,
  getMovementsByProduct,
  getMovementsByType,
  getMovementsByDateRange,
  getLowStockProducts as getInventoryLowStock,
} from './inventory';
