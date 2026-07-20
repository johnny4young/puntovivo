/** safe transitions into and out of lot-tracked inventory. */
import { and, eq, sql } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import {
  inventoryBalances,
  inventoryLots,
  productSerials,
  type ProductCatalogType,
} from '../../db/schema.js';
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

export function assertCreateSerialTrackingPolicy(input: {
  tracksSerials: boolean;
  tracksLots: boolean;
  sellByFraction: boolean;
  unitEquivalences: number[];
  stock: number;
}): void {
  if (!input.tracksSerials) return;
  if (!isZeroStock(input.stock)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_SERIAL_TRACKING_REQUIRES_ZERO_STOCK',
      message: 'Serial tracking can only be enabled when product stock is zero',
    });
  }
  if (input.tracksLots || input.sellByFraction) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_SERIAL_TRACKING_CONFLICT',
      message: 'Serial tracking cannot be combined with lot or fractional tracking',
    });
  }
  if (input.unitEquivalences.some(equivalence => !isZeroStock(equivalence - 1))) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_SERIAL_UNIT_EQUIVALENCE_REQUIRED',
      message: 'Every sale unit for a serialized product must represent exactly one base unit',
    });
  }
}

export function assertAggregateStockMutationAllowed(input: {
  tracksLots: boolean;
  tracksSerials?: boolean;
  catalogType: ProductCatalogType;
  delta: number;
}): void {
  assertCatalogStockMutationAllowed(input);
  if (input.tracksLots && !isZeroStock(input.delta)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_LOT_TRACKING_STOCK_MANAGED',
      message: 'Lot-tracked stock must be changed through lot-aware inventory operations',
    });
  }
  if (input.tracksSerials && !isZeroStock(input.delta)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_SERIAL_TRACKING_STOCK_MANAGED',
      message: 'Serialized stock must be changed through serial-aware inventory operations',
    });
  }
}

/**
 * central fail-closed guard for every inventory balance writer.
 * Serial-aware workflows must opt in explicitly after they have written the
 * corresponding registry identities in the same transaction.
 */
export function assertSerialStockMutationAllowed(input: {
  tracksSerials: boolean;
  serialAware: boolean;
  delta: number;
}): void {
  if (input.tracksSerials && !input.serialAware && !isZeroStock(input.delta)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_SERIAL_TRACKING_STOCK_MANAGED',
      message: 'Serialized stock must be changed through serial-aware inventory operations',
    });
  }
}

/** catalog-only matrix parents can never regain inventory. */
export function assertCatalogStockMutationAllowed(input: {
  catalogType: ProductCatalogType;
  delta: number;
}): void {
  if (input.catalogType === 'variant_parent' && !isZeroStock(input.delta)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_VARIANT_PARENT_NOT_SELLABLE',
      message: 'A variant matrix parent cannot hold stock',
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

export function assertUpdateSerialTrackingPolicy(input: {
  db: DatabaseInstance;
  tenantId: string;
  productId: string;
  previousTracksSerials: boolean;
  nextTracksSerials: boolean;
  nextTracksLots: boolean;
  nextSellByFraction: boolean;
  unitEquivalences: number[];
  currentStock: number;
  requestedStock?: number | undefined;
}): void {
  if (input.nextTracksSerials) {
    if (input.nextTracksLots || input.nextSellByFraction) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'PRODUCT_SERIAL_TRACKING_CONFLICT',
        message: 'Serial tracking cannot be combined with lot or fractional tracking',
      });
    }
    if (input.unitEquivalences.some(equivalence => !isZeroStock(equivalence - 1))) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'PRODUCT_SERIAL_UNIT_EQUIVALENCE_REQUIRED',
        message: 'Every sale unit for a serialized product must represent exactly one base unit',
      });
    }
  }
  if (!input.previousTracksSerials && input.nextTracksSerials) {
    if (
      !isZeroStock(input.currentStock) ||
      (input.requestedStock !== undefined && !isZeroStock(input.requestedStock))
    ) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'PRODUCT_SERIAL_TRACKING_REQUIRES_ZERO_STOCK',
        message: 'Serial tracking can only be enabled when product stock is zero',
      });
    }
  }

  if (
    input.previousTracksSerials &&
    input.nextTracksSerials &&
    input.requestedStock !== undefined &&
    !isZeroStock(input.requestedStock - input.currentStock)
  ) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_SERIAL_TRACKING_STOCK_MANAGED',
      message: 'Serialized stock must be changed through serial-aware inventory operations',
    });
  }

  if (input.previousTracksSerials && !input.nextTracksSerials) {
    const serial = input.db
      .select({ id: productSerials.id })
      .from(productSerials)
      .where(
        and(
          eq(productSerials.tenantId, input.tenantId),
          eq(productSerials.productId, input.productId)
        )
      )
      .get();
    if (serial) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'PRODUCT_SERIAL_TRACKING_HAS_SERIALS',
        message: 'Serial tracking cannot be disabled after serial units have been recorded',
      });
    }
  }
}
