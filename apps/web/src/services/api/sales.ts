import api from './client';
import type {
  Sale,
  SaleItem,
  PaginatedResponse,
  PaymentMethod,
  PaymentStatus,
  SaleStatus,
} from '@/types';

export interface SaleListParams {
  page?: number;
  perPage?: number;
  filter?: string;
  sort?: string;
  customerId?: string;
  status?: SaleStatus;
  paymentStatus?: PaymentStatus;
  paymentMethod?: PaymentMethod;
  dateFrom?: string;
  dateTo?: string;
}

export interface CreateSaleItemData {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRate: number;
}

export interface CreateSaleData {
  customerId?: string;
  items: CreateSaleItemData[];
  discountAmount?: number;
  paymentMethod: PaymentMethod;
  notes?: string;
}

export interface UpdateSaleData {
  customerId?: string;
  discountAmount?: number;
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus;
  status?: SaleStatus;
  notes?: string;
}

const SALES_COLLECTION = 'sales';
const SALE_ITEMS_COLLECTION = 'sale_items';

/**
 * Get paginated list of sales with optional filtering and sorting
 */
export async function getSales(params: SaleListParams = {}): Promise<PaginatedResponse<Sale>> {
  const {
    page = 1,
    perPage = 50,
    filter = '',
    sort = '-created',
    customerId,
    status,
    paymentStatus,
    paymentMethod,
    dateFrom,
    dateTo,
  } = params;

  // Build filter string
  const filters: string[] = [];

  if (filter) {
    filters.push(filter);
  }

  if (customerId) {
    filters.push(`customerId = "${customerId}"`);
  }

  if (status) {
    filters.push(`status = "${status}"`);
  }

  if (paymentStatus) {
    filters.push(`paymentStatus = "${paymentStatus}"`);
  }

  if (paymentMethod) {
    filters.push(`paymentMethod = "${paymentMethod}"`);
  }

  if (dateFrom) {
    filters.push(`created >= "${dateFrom}"`);
  }

  if (dateTo) {
    filters.push(`created <= "${dateTo}"`);
  }

  const combinedFilter = filters.join(' && ');

  const result = await api.getList<Sale>(SALES_COLLECTION, page, perPage, combinedFilter, sort);

  return {
    items: result.items,
    page,
    perPage,
    totalItems: result.totalItems,
    totalPages: result.totalPages,
  };
}

/**
 * Get a single sale by ID with items expanded
 */
export async function getSaleById(id: string): Promise<Sale> {
  const sale = await api.getOne<Sale>(SALES_COLLECTION, id);

  // Get sale items separately
  const items = await getSaleItems(id);
  return { ...sale, items };
}

/**
 * Get items for a specific sale
 */
export async function getSaleItems(saleId: string): Promise<SaleItem[]> {
  const result = await api.getList<SaleItem>(SALE_ITEMS_COLLECTION, 1, 100, `saleId = "${saleId}"`);

  return result.items;
}

/**
 * Create a new sale with items
 */
export async function createSale(data: CreateSaleData): Promise<Sale> {
  // Calculate totals from items
  let subtotal = 0;
  let taxAmount = 0;

  const itemsWithTotals = data.items.map(item => {
    const itemDiscount = item.discount || 0;
    const itemSubtotal = item.quantity * item.unitPrice - itemDiscount;
    const itemTax = itemSubtotal * (item.taxRate / 100);
    const itemTotal = itemSubtotal + itemTax;

    subtotal += itemSubtotal;
    taxAmount += itemTax;

    return {
      ...item,
      discount: itemDiscount,
      taxAmount: itemTax,
      total: itemTotal,
    };
  });

  const discountAmount = data.discountAmount || 0;
  const total = subtotal + taxAmount - discountAmount;

  // Create the sale
  const sale = await api.create<Sale>(SALES_COLLECTION, {
    customerId: data.customerId,
    subtotal,
    taxAmount,
    discountAmount,
    total,
    paymentMethod: data.paymentMethod,
    paymentStatus: 'pending',
    status: 'completed',
    notes: data.notes,
  });

  // Create sale items
  const createdItems: SaleItem[] = [];
  for (const item of itemsWithTotals) {
    const saleItem = await api.create<SaleItem>(SALE_ITEMS_COLLECTION, {
      saleId: sale.id,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      taxRate: item.taxRate,
      taxAmount: item.taxAmount,
      total: item.total,
    });
    createdItems.push(saleItem);
  }

  return { ...sale, items: createdItems };
}

/**
 * Update an existing sale
 */
export async function updateSale(id: string, data: UpdateSaleData): Promise<Sale> {
  return await api.update<Sale>(SALES_COLLECTION, id, data);
}

/**
 * Void a sale (marks as voided, keeps record)
 */
export async function voidSale(id: string, reason?: string): Promise<Sale> {
  return await api.update<Sale>(SALES_COLLECTION, id, {
    status: 'voided',
    notes: reason,
  });
}

/**
 * Cancel a sale (marks as cancelled)
 */
export async function cancelSale(id: string): Promise<Sale> {
  return await api.update<Sale>(SALES_COLLECTION, id, {
    status: 'cancelled',
  });
}

/**
 * Get sales by customer
 */
export async function getSalesByCustomer(
  customerId: string,
  params: Omit<SaleListParams, 'customerId'> = {}
): Promise<PaginatedResponse<Sale>> {
  return getSales({ ...params, customerId });
}

/**
 * Get sales within a date range
 */
export async function getSalesByDateRange(
  dateFrom: string,
  dateTo: string,
  params: Omit<SaleListParams, 'dateFrom' | 'dateTo'> = {}
): Promise<PaginatedResponse<Sale>> {
  return getSales({ ...params, dateFrom, dateTo });
}

/**
 * Get today's sales
 */
export async function getTodaySales(
  params: Omit<SaleListParams, 'dateFrom' | 'dateTo'> = {}
): Promise<PaginatedResponse<Sale>> {
  const today = new Date().toISOString().split('T')[0];
  return getSales({ ...params, dateFrom: today, dateTo: today + 'T23:59:59' });
}
