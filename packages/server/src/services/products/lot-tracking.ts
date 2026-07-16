/** ENG-110a — safe transitions into and out of lot-tracked inventory. */
import { and, eq, sql } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { inventoryBalances, inventoryLots } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';

const STOCK_EPSILON = 1e-9;

function isZeroStock(value: number): boolean {
  return Math.abs(value) <= STOCK_EPSILON;
}

export function assertCreateLotTrackingPolicy(input: { tracksLots: boolean; stock: number }): void {
  if (input.tracksLots && !isZeroStock(input.stock)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_LOT_TRACKING_REQUIRES_ZERO_STOCK',
      message: 'Lot tracking can only be enabled when product stock is zero',
    });
  }
}

export function assertAggregateStockMutationAllowed(input: {
  tracksLots: boolean;
  delta: number;
}): void {
  if (input.tracksLots && !isZeroStock(input.delta)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_LOT_TRACKING_STOCK_MANAGED',
      message: 'Lot-tracked stock must be changed through lot-aware inventory operations',
    });
  }
}

export function assertUpdateLotTrackingPolicy(input: {
  db: DatabaseInstance;
  tenantId: string;
  productId: string;
  previousTracksLots: boolean;
  nextTracksLots: boolean;
  currentStock: number;
  requestedStock?: number | undefined;
}): void {
  if (!input.previousTracksLots && input.nextTracksLots) {
    const nonZeroBalance = input.db
      .select({ id: inventoryBalances.id })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, input.tenantId),
          eq(inventoryBalances.productId, input.productId),
          sql`abs(${inventoryBalances.onHand}) > ${STOCK_EPSILON}`
        )
      )
      .get();
    if (
      nonZeroBalance ||
      (input.requestedStock !== undefined && !isZeroStock(input.requestedStock))
    ) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'PRODUCT_LOT_TRACKING_REQUIRES_ZERO_STOCK',
        message: 'Lot tracking can only be enabled when product stock is zero',
      });
    }
  }

  if (
    input.previousTracksLots &&
    input.nextTracksLots &&
    input.requestedStock !== undefined &&
    !isZeroStock(input.requestedStock - input.currentStock)
  ) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_LOT_TRACKING_STOCK_MANAGED',
      message: 'Lot-tracked stock must be changed through lot-aware inventory operations',
    });
  }

  if (input.previousTracksLots && !input.nextTracksLots) {
    const activeLot = input.db
      .select({ id: inventoryLots.id })
      .from(inventoryLots)
      .where(
        and(
          eq(inventoryLots.tenantId, input.tenantId),
          eq(inventoryLots.productId, input.productId),
          sql`abs(${inventoryLots.onHand}) > ${STOCK_EPSILON}`
        )
      )
      .get();

    if (activeLot) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'PRODUCT_LOT_TRACKING_HAS_ACTIVE_LOTS',
        message: 'Lot tracking cannot be disabled while a lot has non-zero stock',
      });
    }
  }
}
