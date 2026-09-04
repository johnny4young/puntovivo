/** Bounded fulfillment inputs. Sale-backed orders never accept client-supplied totals or items. */
import { z } from 'zod';
import { deliveryOrderStatusEnum } from '../../db/schema.js';

const id = z.string().trim().min(1).max(128);
const money = z
  .number()
  .finite()
  .min(0)
  .max(1_000_000_000)
  .refine(
    value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001,
    'Amount must have at most two decimals'
  );
const recipient = z
  .object({
    siteId: id,
    customerName: z.string().trim().min(1).max(160),
    customerPhone: z.string().trim().max(40).optional(),
    address: z.string().trim().min(1).max(500),
    addressNotes: z.string().trim().max(500).optional(),
    courierName: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export const deliveryItemInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    qty: z
      .number()
      .finite()
      .positive()
      .max(1_000_000)
      .refine(
        value => Math.abs(value * 1000 - Math.round(value * 1000)) < 0.00001,
        'Quantity must have at most three decimals'
      ),
    unitPrice: money,
  })
  .strict();
export const createDeliveryInput = recipient
  .extend({
    customerId: id.optional(),
    totalAmount: money.default(0),
    items: z.array(deliveryItemInput).max(200).default([]),
  })
  .strict();
export const createDeliveryFromSaleInput = recipient.extend({ saleId: id }).strict();
export const advanceDeliveryInput = z
  .object({
    siteId: id,
    id,
    expectedVersion: z
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER - 1),
    toStatus: z.enum(deliveryOrderStatusEnum),
    courierName: z.string().trim().min(1).max(120).optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.toStatus === 'cancelled' && !value.reason) {
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Cancellation reason is required',
      });
    }
  });
export const deliverySiteInput = z.object({ siteId: id }).strict();
export const deliverySaleOptionsInput = deliverySiteInput
  .extend({ search: z.string().trim().max(128).default('') })
  .strict();
export const deliveryTargetInput = deliverySiteInput.extend({ id }).strict();
export const listDeliveryInput = deliverySiteInput
  .extend({
    status: z.enum(deliveryOrderStatusEnum).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    cursor: z
      .object({ acceptedAt: z.string().min(1).max(40), id })
      .strict()
      .optional(),
  })
  .strict();
/** Validated manual quote; does not create a sale, payment or stock reservation. */
export type CreateDeliveryInput = z.infer<typeof createDeliveryInput>;
/** Recipient plus authoritative completed-sale reference. */
export type CreateDeliveryFromSaleInput = z.infer<typeof createDeliveryFromSaleInput>;
/** Observed-version fulfillment transition; cancellation always includes a reason. */
export type AdvanceDeliveryInput = z.infer<typeof advanceDeliveryInput>;
