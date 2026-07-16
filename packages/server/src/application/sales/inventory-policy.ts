/**
 * ENG-055 — Shared stock reversal policy for sale lifecycle services.
 *
 * `returnSale`, `voidSale` and `discardDraft` all share the same
 * mechanical loop: for every line on the sale,
 *
 *   1. compute the normalized quantity (units × equivalence),
 *   2. raise `previousStock + normalizedQuantity` against the in-memory
 *      `productStockState` map the caller is tracking,
 *   3. insert an `inventory_movements` row of type `'return'` with the
 *      reversal note,
 *   4. apply the same delta to `inventory_balances` via
 *      `applyInventoryBalanceDelta` (the single source of truth).
 *
 * The only thing that varies across the three paths is the human-readable
 * note string ("Refunded sale", "Voided sale", "Discarded draft"). This
 * module factors out the loop and returns the inserted inventory_movement
 * ids so callers can correlate journal effects.
 *
 * @module application/sales/inventory-policy
 */

import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { inventoryMovements } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { applyInventoryBalanceDelta } from '../../services/inventory-balances.js';
import { getNormalizedSaleQuantity } from './policies.js';

export type ReversalKind = 'return' | 'void' | 'discard';

export interface ReverseSaleItem {
  productId: string;
  quantity: number;
  unitEquivalence: number;
}

export interface ReverseSaleItemsStockArgs {
  tx: DatabaseInstance;
  tenantId: string;
  /** Site whose `inventory_balances` row gets the credit; null falls
   *  back to a no-op on the balance side (legacy sales without a cash
   *  session). */
  siteId: string | null;
  userId: string;
  saleId: string;
  saleNumber: string;
  reversalKind: ReversalKind;
  items: ReverseSaleItem[];
  /** Tracks `previousStock → newStock` between iterations so the same
   *  product appearing twice on a sale does not double-credit. The
   *  caller seeds the map from the current derived stock total
   *  (`getProductStockTotals`). */
  productStockState: Map<string, number>;
  now: string;
}

const REVERSAL_NOTE: Record<ReversalKind, string> = {
  return: 'Refunded sale',
  void: 'Voided sale',
  discard: 'Discarded draft',
};

const REVERSAL_OP_LABEL: Record<ReversalKind, string> = {
  return: 'refund',
  void: 'void',
  discard: 'discard',
};

/**
 * Reverse stock for every line on a sale. Returns the inserted
 * `inventory_movements` row ids so callers can emit one journal effect
 * per movement. Throws `SALE_REVERSAL_PRODUCT_MISSING` when the caller's
 * stock-state map does not include a product on the sale (indicates the
 * caller did not pre-load every product before opening the transaction).
 *
 * MUST run inside the caller's transaction.
 */
export function reverseSaleItemsStock(args: ReverseSaleItemsStockArgs): string[] {
  const inventoryMovementIds: string[] = [];
  const note = `${REVERSAL_NOTE[args.reversalKind]} ${args.saleNumber}`;

  for (const item of args.items) {
    const normalizedQuantity = getNormalizedSaleQuantity(item.quantity, item.unitEquivalence);
    const previousStock = args.productStockState.get(item.productId);

    if (previousStock === undefined) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'SALE_REVERSAL_PRODUCT_MISSING',
        message: `Product ${item.productId} was not found while ${REVERSAL_OP_LABEL[args.reversalKind]}ing the sale`,
        details: {
          productId: item.productId,
          operation: REVERSAL_OP_LABEL[args.reversalKind],
        },
      });
    }

    const newStock = previousStock + normalizedQuantity;
    args.productStockState.set(item.productId, newStock);

    const movementId = nanoid();
    args.tx
      .insert(inventoryMovements)
      .values({
        id: movementId,
        tenantId: args.tenantId,
        productId: item.productId,
        type: 'return',
        quantity: normalizedQuantity,
        previousStock,
        newStock,
        reference: args.saleId,
        notes: note,
        createdBy: args.userId,
        syncStatus: 'pending',
        syncVersion: 1,
        createdAt: args.now,
      })
      .run();
    inventoryMovementIds.push(movementId);

    applyInventoryBalanceDelta(args.tx, {
      tenantId: args.tenantId,
      siteId: args.siteId,
      productId: item.productId,
      delta: normalizedQuantity,
      initialOnHandIfMissing: previousStock,
      // Every caller of this shared reversal also restores/returns the
      // selected serial registry rows in the same enclosing transaction.
      serialAware: true,
      now: args.now,
    });
  }

  return inventoryMovementIds;
}
