/**
 * Inventory-transfer shared helpers.
 *
 * ENG-178 — function bodies extracted verbatim from the former flat
 * `services/inventory-transfers.ts` during the megafile decomposition.
 * The helpers are exported from this leaf only so the create / void / receive
 * orchestrators can share them; they receive the active `tx` so transaction
 * boundaries stay at the caller.
 *
 * @module services/inventory-transfers/helpers
 */
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import { inventoryBalances } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type { CreateTransferArgs } from './types.js';

export function getTimestamp(): string {
  return new Date().toISOString();
}

export function assertValidTransferArgs(args: CreateTransferArgs): void {
  if (args.fromSiteId === args.toSiteId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'TRANSFER_SITES_IDENTICAL',
      message: 'Origin and destination sites must be different',
      details: { fromSiteId: args.fromSiteId },
    });
  }

  if (args.items.length === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'TRANSFER_ITEMS_REQUIRED',
      message: 'A transfer must include at least one product line',
    });
  }

  for (const item of args.items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFER_QUANTITY_INVALID',
        message: 'Transfer quantity must be greater than zero',
        details: { productId: item.productId, quantity: item.quantity },
      });
    }
  }
}

export function seedMissingBalanceRow(args: {
  tx: DatabaseInstance;
  tenantId: string;
  siteId: string;
  productId: string;
  initialOnHand: number;
  now: string;
}): void {
  args.tx
    .insert(inventoryBalances)
    .values({
      id: nanoid(),
      tenantId: args.tenantId,
      siteId: args.siteId,
      productId: args.productId,
      onHand: args.initialOnHand,
      reserved: 0,
      syncStatus: 'pending',
      syncVersion: 0,
      createdAt: args.now,
      updatedAt: args.now,
    })
    .onConflictDoNothing({
      target: [
        inventoryBalances.tenantId,
        inventoryBalances.siteId,
        inventoryBalances.productId,
      ],
    })
    .run();
}
