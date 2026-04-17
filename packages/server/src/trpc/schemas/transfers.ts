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

export type CreateTransferInput = z.infer<typeof createTransferInput>;
export type TransferItemInput = z.infer<typeof transferItemInput>;
