// Products hooks
export {
  productKeys,
  useProducts,
  useProduct,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useSearchProducts,
  useProductsByCategory,
  useLowStockProducts as useProductsLowStock,
  usePrefetchProduct,
} from './useProducts';

// Customers hooks
export {
  customerKeys,
  useCustomers,
  useCustomer,
  useCreateCustomer,
  useUpdateCustomer,
  useDeleteCustomer,
  useSearchCustomers,
  useActiveCustomers,
  usePrefetchCustomer,
  useCustomerOptions,
} from './useCustomers';

// Sales hooks
export {
  saleKeys,
  useSales,
  useSale,
  useSaleItems,
  useCreateSale,
  useUpdateSale,
  useVoidSale,
  useSalesByCustomer,
  useSalesByDateRange,
  useTodaySales,
  useCompletedSales,
  usePendingPaymentSales,
  usePrefetchSale,
  useSalesSummary,
} from './useSales';

// Inventory hooks
export {
  inventoryKeys,
  useInventoryMovements,
  useMovement,
  useProductStock,
  useLowStockProducts,
  useCreateMovement,
  useAdjustStock,
  useMovementsByProduct,
  useMovementsByType,
  useMovementsByDateRange,
  usePurchaseMovements,
  useSaleMovements,
  useAdjustmentMovements,
  useInventorySummary,
  usePrefetchProductStock,
} from './useInventory';

// Re-export types
export type {
  ProductListParams,
  CreateProductData,
  UpdateProductData,
} from '@/services/api/products';
export type {
  CustomerListParams,
  CreateCustomerData,
  UpdateCustomerData,
} from '@/services/api/customers';
export type {
  SaleListParams,
  CreateSaleData,
  CreateSaleItemData,
  UpdateSaleData,
} from '@/services/api/sales';
export type {
  InventoryMovementListParams,
  CreateMovementData,
  AdjustStockData,
  ProductStockInfo,
} from '@/services/api/inventory';
