/**
 * Transfer Zod Schemas (Phase 2 DB-102 / API-102 step 1).
 *
 * Immediate-completion transfers only for now — the lifecycle
 * (`draft`/`in_transit`/`received`) lands in a follow-up step.
 *
 * @module trpc/schemas/transfers
 */

import { z } from 'zod';

export const transferItemInput = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  quantity: z
    .number()
    .finite('Quantity must be a finite number')
    .positive('Quantity must be greater than zero'),
});

export const createTransferInput = z
  .object({
    fromSiteId: z.string().min(1, 'Origin site is required'),
    toSiteId: z.string().min(1, 'Destination site is required'),
    items: z.array(transferItemInput).min(1, 'A transfer must include at least one product'),
    notes: z.string().trim().max(500).optional(),
    /**
     * When true, the transfer persists as `in_transit`. Origin is debited on
     * create; destination is credited later via `transfers.receive`.
     */
    defer: z.boolean().optional(),
  })
  .refine(value => value.fromSiteId !== value.toSiteId, {
    path: ['toSiteId'],
    message: 'Origin and destination sites must be different',
  });

export const listTransfersInput = z
  .object({
    limit: z.number().int().positive().max(200).optional(),
  })
  .optional();

export const voidTransferInput = z.object({
  transferId: z.string().min(1, 'Transfer ID is required'),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Phase 2 UI-103 — per-line received quantity + optional discrepancy notes.
 *
 * `lines` is optional: when omitted (or empty), the receiver accepts the
 * shipped quantities as-is (legacy one-click Receive behaviour). When
 * supplied, each entry refers to a `transfer_order_items.id` and carries
 * the actual received quantity at the destination. The service validates
 * `received <= shipped` and rejects unknown/duplicate item ids.
 */
export const receiveTransferLineInput = z.object({
  itemId: z.string().min(1, 'Item ID is required'),
  receivedQuantity: z
    .number()
    .finite('Received quantity must be a finite number')
    .nonnegative('Received quantity cannot be negative'),
});

export const receiveTransferInput = z.object({
  transferId: z.string().min(1, 'Transfer ID is required'),
  lines: z.array(receiveTransferLineInput).optional(),
  discrepancyNotes: z.string().trim().max(500).optional(),
});

export const getTransferInput = z.object({
  id: z.string().min(1, 'Transfer ID is required'),
});

export type CreateTransferInput = z.infer<typeof createTransferInput>;
export type TransferItemInput = z.infer<typeof transferItemInput>;
export type VoidTransferInput = z.infer<typeof voidTransferInput>;
export type ReceiveTransferInput = z.infer<typeof receiveTransferInput>;
export type ReceiveTransferLineInput = z.infer<typeof receiveTransferLineInput>;
export type GetTransferInput = z.infer<typeof getTransferInput>;
