/** Update-product application use-case. */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { products } from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { assertVersionedWriteApplied } from '../../lib/optimisticVersion.js';
import { resolveFractionPolicy } from '../../services/fraction-policy.js';
import {
  applyInventoryBalanceDelta,
  getPrimarySiteId,
  getProductStockTotal,
} from '../../services/inventory-balances.js';
import { normalizeProductPricing } from '../../services/pricing.js';
import {
  assertUpdateLotTrackingPolicy,
  assertUpdateSerialTrackingPolicy,
} from '../../services/products/lot-tracking.js';
import {
  getExistingProviderAssignments,
  getExistingUnitAssignments,
  normalizeProviderState,
  replaceProviderAssignments,
  replaceUnitAssignments,
  resolveLocationId,
  resolveProviderAssignments,
  resolveTaxRate,
  resolveUnitAssignments,
} from '../../services/products/mutation-helpers.js';
import { getProductWithRelations } from '../../services/products/product-read.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import type { UpdateProductInput } from '../../trpc/schemas/products.js';
import type { ProductMutationContext } from './types.js';

export async function updateProduct(ctx: ProductMutationContext, input: UpdateProductInput) {
  const { id, ...updates } = input;

  const existing = await ctx.db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId)))
    .get();

  if (!existing) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
  }

  if (
    existing.catalogType === 'variant_parent' &&
    (updates.isActive === true || (updates.stock !== undefined && Math.abs(updates.stock) > 1e-9))
  ) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_VARIANT_PARENT_NOT_SELLABLE',
      message: 'A variant matrix parent cannot be activated or hold stock',
      details: { productId: existing.id },
    });
  }

  if (updates.sku && updates.sku !== existing.sku) {
    const duplicateSku = await ctx.db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.tenantId, ctx.tenantId), eq(products.sku, updates.sku)))
      .get();

    if (duplicateSku) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A product with this SKU already exists',
      });
    }
  }

  const now = new Date().toISOString();
  const existingUnitAssignments = await getExistingUnitAssignments(ctx.db, id);
  const existingProviderIds = await getExistingProviderAssignments(ctx.db, id);
  const resolvedUnitAssignments = await resolveUnitAssignments(
    ctx.db,
    ctx.tenantId,
    updates.unitAssignments ?? existingUnitAssignments
  );
  const normalizedProviderState = normalizeProviderState({
    providerId: updates.providerId,
    providerAssignments: updates.providerAssignments,
    existingProviderIds,
  });
  const resolvedProviderAssignments = normalizedProviderState
    ? await resolveProviderAssignments(
        ctx.db,
        ctx.tenantId,
        normalizedProviderState.providerAssignments
      )
    : undefined;
  const normalizedPricing = normalizeProductPricing({
    cost: updates.cost ?? existing.cost,
    price: updates.price ?? existing.price,
    price2: updates.price2 ?? existing.price2,
    price3: updates.price3 ?? existing.price3,
    marginPercent1: updates.marginPercent1 ?? existing.marginPercent1,
    marginPercent2: updates.marginPercent2 ?? existing.marginPercent2,
    marginPercent3: updates.marginPercent3 ?? existing.marginPercent3,
    marginAmount1: updates.marginAmount1 ?? existing.marginAmount1,
    marginAmount2: updates.marginAmount2 ?? existing.marginAmount2,
    marginAmount3: updates.marginAmount3 ?? existing.marginAmount3,
  });
  const resolvedTax = await resolveTaxRate(
    ctx.db,
    ctx.tenantId,
    updates.vatRateId !== undefined ? updates.vatRateId : existing.vatRateId,
    updates.taxRate ?? existing.taxRate
  );
  const resolvedLocationId =
    updates.locationId !== undefined
      ? await resolveLocationId(ctx.db, ctx.tenantId, updates.locationId)
      : existing.locationId;
  const resolvedFractionPolicy = resolveFractionPolicy(
    {
      sellByFraction: updates.sellByFraction,
      fractionStep: updates.fractionStep,
      fractionMinimum: updates.fractionMinimum,
    },
    {
      sellByFraction: existing.sellByFraction ?? false,
      fractionStep: existing.fractionStep,
      fractionMinimum: existing.fractionMinimum,
    }
  );
  const currentStock = getProductStockTotal(ctx.db, ctx.tenantId, id);
  const nextTracksLots = updates.tracksLots ?? existing.tracksLots;
  assertUpdateLotTrackingPolicy({
    db: ctx.db,
    tenantId: ctx.tenantId,
    productId: id,
    previousTracksLots: existing.tracksLots,
    nextTracksLots,
    currentStock,
    requestedStock: updates.stock,
  });
  const nextTracksSerials = updates.tracksSerials ?? existing.tracksSerials;
  assertUpdateSerialTrackingPolicy({
    db: ctx.db,
    tenantId: ctx.tenantId,
    productId: id,
    previousTracksSerials: existing.tracksSerials,
    nextTracksSerials,
    nextTracksLots,
    nextSellByFraction: resolvedFractionPolicy.sellByFraction,
    unitEquivalences: resolvedUnitAssignments.map(assignment => assignment.equivalence),
    currentStock,
    requestedStock: updates.stock,
  });
  const updateData: Record<string, unknown> = {
    updatedAt: now,
    syncStatus: 'pending',
    syncVersion: (existing.syncVersion ?? 0) + 1,
    // optimistic-concurrency bump. The versioned WHERE below
    // guarantees the stored version still equals input.version, so the
    // next value is unconditionally input.version + 1.
    version: input.version + 1,
    price: normalizedPricing.price,
    price2: normalizedPricing.price2,
    price3: normalizedPricing.price3,
    cost: normalizedPricing.cost,
    marginPercent1: normalizedPricing.marginPercent1,
    marginPercent2: normalizedPricing.marginPercent2,
    marginPercent3: normalizedPricing.marginPercent3,
    marginAmount1: normalizedPricing.marginAmount1,
    marginAmount2: normalizedPricing.marginAmount2,
    marginAmount3: normalizedPricing.marginAmount3,
    taxRate: resolvedTax.taxRate,
    vatRateId: resolvedTax.vatRateId,
    sellByFraction: resolvedFractionPolicy.sellByFraction,
    fractionStep: resolvedFractionPolicy.fractionStep,
    fractionMinimum: resolvedFractionPolicy.fractionMinimum,
    tracksLots: nextTracksLots,
    tracksSerials: nextTracksSerials,
  };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.sku !== undefined) updateData.sku = updates.sku;
  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.categoryId !== undefined) updateData.categoryId = updates.categoryId;
  if (normalizedProviderState) updateData.providerId = normalizedProviderState.providerId;
  if (updates.locationId !== undefined) updateData.locationId = resolvedLocationId;
  if (updates.initialCost !== undefined) updateData.initialCost = roundMoney(updates.initialCost);
  if (updates.minStock !== undefined) updateData.minStock = updates.minStock;
  if (updates.isActive !== undefined) updateData.isActive = updates.isActive;
  if (updates.barcode !== undefined) updateData.barcode = updates.barcode;
  if (updates.imageUrl !== undefined) updateData.imageUrl = updates.imageUrl;

  // optimistic-concurrency guard. The version predicate makes
  // this UPDATE a no-op when another tab already saved (stored version no
  // longer matches), and the tenant predicate keeps the multi-tenant
  // invariant explicit rather than relying solely on the pre-read above.
  const versionedUpdate = ctx.db
    .update(products)
    .set(updateData)
    .where(
      and(
        eq(products.id, id),
        eq(products.tenantId, ctx.tenantId),
        eq(products.version, input.version)
      )
    )
    .run() as { changes?: number };
  assertVersionedWriteApplied('product', versionedUpdate.changes ?? 0, input.version);

  // `stock` is derived from Σ(inventory_balances.on_hand). When the caller
  // supplies an absolute `stock` (backward-compat), realize it by applying
  // the delta to the tenant's primary site balance.
  if (updates.stock !== undefined) {
    ctx.db.transaction(tx => {
      const primarySiteId = getPrimarySiteId(tx, ctx.tenantId);
      if (primarySiteId) {
        const currentTotal = getProductStockTotal(tx, ctx.tenantId, id);
        const delta = updates.stock! - currentTotal;
        if (delta !== 0) {
          applyInventoryBalanceDelta(tx, {
            tenantId: ctx.tenantId,
            siteId: primarySiteId,
            productId: id,
            delta,
            // Seed a missing primary-site row with 0, not the tenant-wide
            // total: if other sites already hold stock, seeding with the
            // total would double-count them in the derived Σ(on_hand). The
            // delta alone brings the total to the requested absolute stock.
            initialOnHandIfMissing: 0,
            now,
          });
        }
      }
    });
  }

  await replaceUnitAssignments(ctx.db, id, resolvedUnitAssignments, now);

  if (resolvedProviderAssignments !== undefined) {
    await replaceProviderAssignments(ctx.db, id, resolvedProviderAssignments, now);
  }

  await enqueueSync(ctx, {
    entityType: 'products',
    entityId: id,
    operation: 'update',
    data: {
      id,
      ...updateData,
      providerAssignments: resolvedProviderAssignments,
      unitAssignments: resolvedUnitAssignments,
    },
  });

  const updated = await getProductWithRelations(ctx.db, id, ctx.tenantId);

  return updated!;
}
