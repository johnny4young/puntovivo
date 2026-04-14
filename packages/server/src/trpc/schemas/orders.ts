import { z } from 'zod';
import { paginationInput } from './common.js';

export const orderStatusEnum = z.enum(['submitted', 'partial_received', 'received', 'voided']);

export const orderItemInput = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  unitId: z.string().min(1, 'Unit ID is required'),
  quantity: z.number().positive('Quantity must be greater than zero'),
  costPerUnit: z.number().min(0, 'Cost per unit must be non-negative'),
});

export const listOrdersInput = paginationInput.extend({
  providerId: z.string().optional(),
  status: orderStatusEnum.optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export const getOrderInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const createOrderInput = z.object({
  providerId: z.string().min(1, 'Provider is required'),
  items: z.array(orderItemInput).min(1, 'At least one item is required'),
  notes: z.string().optional(),
});

export const voidOrderInput = z.object({
  id: z.string().min(1, 'ID is required'),
  reason: z.string().optional(),
});

export type OrderItemInput = z.infer<typeof orderItemInput>;
export type ListOrdersInput = z.infer<typeof listOrdersInput>;
export type CreateOrderInput = z.infer<typeof createOrderInput>;
export type VoidOrderInput = z.infer<typeof voidOrderInput>;
