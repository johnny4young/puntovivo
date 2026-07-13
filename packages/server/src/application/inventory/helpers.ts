/** ENG-206 — Shared inventory mutation helpers. */
import { TRPCError } from '@trpc/server';
import { normalizedQuantity as resolveNormalizedQuantity } from '@puntovivo/shared/unit-math';
import { and, eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { operationEvents, products, unitXProduct, units } from '../../db/schema.js';
import { createModuleLogger } from '../../logging/logger.js';
import { updateOperationSummary } from '../../services/operation-journal/journal.js';
import type { InventoryContext } from './types.js';

const log = createModuleLogger('application/inventory');

export async function getProductForInventory(
  db: DatabaseInstance,
  tenantId: string,
  productId: string
) {
  const product = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
    .get();

  if (!product || product.isActive === false) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found or inactive' });
  }

  return product;
}

export async function lookupInventoryJournalEventId(
  db: DatabaseInstance,
  tenantId: string,
  operationId: string | undefined
): Promise<string | null> {
  if (!operationId) return null;

  const row = await db
    .select({ id: operationEvents.id })
    .from(operationEvents)
    .where(
      and(
        eq(operationEvents.tenantId, tenantId),
        eq(operationEvents.operationId, operationId)
      )
    )
    .get();
  return row?.id ?? null;
}

export async function safeUpdateInventoryAdjustedSummary(
  ctx: InventoryContext,
  journalEventId: string,
  summary: {
    productId: string;
    siteId: string;
    quantityBefore: number;
    quantityAfter: number;
    delta: number;
    locationId: string | null;
    reasonCode: string | null;
  }
): Promise<void> {
  try {
    await updateOperationSummary(ctx.db, journalEventId, summary);
  } catch (err) {
    (ctx.log ?? log).warn(
      { err, journalEventId },
      'operation summary update failed (non-blocking)'
    );
  }
}

export async function getProductUnitAssignment(
  db: DatabaseInstance,
  productId: string,
  unitId: string
) {
  const assignment = await db
    .select({
      unitId: unitXProduct.unitId,
      equivalence: unitXProduct.equivalence,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      isActive: units.isActive,
    })
    .from(unitXProduct)
    .innerJoin(units, eq(unitXProduct.unitId, units.id))
    .where(and(eq(unitXProduct.productId, productId), eq(unitXProduct.unitId, unitId)))
    .get();

  if (!assignment || assignment.isActive === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected product unit was not found or is inactive',
    });
  }

  return assignment;
}

export function getNormalizedInventoryQuantity(quantity: number, equivalence: number) {
  try {
    return resolveNormalizedQuantity(quantity, equivalence);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The normalized quantity must be greater than zero',
    });
  }
}
