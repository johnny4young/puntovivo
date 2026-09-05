/** Update-product application use-case. */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  inventoryBalances,
  inventoryMovements,
  pharmacyProductProfiles,
  products,
} from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { assertVersionedWriteApplied } from '../../lib/optimisticVersion.js';
import { resolveFractionPolicy } from '../../services/fraction-policy.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  applyInventoryBalanceDelta,
  getPrimarySiteId,
  getProductStockTotal,
} from '../../services/inventory-balances.js';
import { normalizeProductPricing } from '../../services/pricing.js';
import {
  assertUpdateInventoryIdentityPolicy,
  assertUpdateLotTrackingPolicy,
  assertUpdateSerialTrackingPolicy,
  assertUpdateStockTrackingPolicy,
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
import { enqueueSync, enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import {
  getProductTaxComponents,
  legacyComponent,
  replaceProductTaxComponents,
  resolveTaxComponentInputs,
  summarizeTaxComponents,
} from '../../services/tax-components.js';
import type { UpdateProductInput } from '../../trpc/schemas/products.js';
import type { ProductMutationContext } from './types.js';
import {
  assertPharmacyInventoryPolicy,
  assertPharmacyProfileTransitionAllowed,
  getPharmacyProfileTransitionState,
  pharmacyProductProfileMatches,
  replacePharmacyProductProfile,
} from '../../services/pharmacy/product-profile.js';

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
    updates.taxRate ?? existing.taxRate,
    // Explicitly CLEARING the vat-rate link resets the kind: a manual
    // rate is kind-agnostic, and keeping a stale 'inc' would classify
    // the new number as consumption tax on every future fiscal line. An
    // untouched manual product keeps its stored kind.
    updates.vatRateId === null ? 'iva' : existing.taxKind
  );
  const existingTaxComponents = (await getProductTaxComponents(ctx.db, ctx.tenantId, [id])).get(
    id
  ) ?? [
    legacyComponent({
      vatRateId: existing.vatRateId,
      taxKind: existing.taxKind,
      taxRate: existing.taxRate,
    }),
  ];
  const submittedComponentIds = updates.taxComponents?.map(component => component.vatRateId);
  const componentSelectionIsUnchanged =
    submittedComponentIds !== undefined &&
    submittedComponentIds.length === existingTaxComponents.length &&
    submittedComponentIds.every(
      (vatRateId, position) => existingTaxComponents[position]?.vatRateId === vatRateId
    );
  const resolvedTaxComponents = updates.taxComponents
    ? componentSelectionIsUnchanged
      ? existingTaxComponents
      : await resolveTaxComponentInputs(ctx.db, ctx.tenantId, updates.taxComponents)
    : updates.vatRateId !== undefined || updates.taxRate !== undefined
      ? [legacyComponent(resolvedTax)]
      : existingTaxComponents;
  const taxSummary = summarizeTaxComponents(resolvedTaxComponents);
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
  const nextTracksSerials = updates.tracksSerials ?? existing.tracksSerials;
  const nextTracksStock = updates.tracksStock ?? existing.tracksStock;
  const existingPharmacyProfile = await ctx.db
    .select()
    .from(pharmacyProductProfiles)
    .where(
      and(
        eq(pharmacyProductProfiles.tenantId, ctx.tenantId),
        eq(pharmacyProductProfiles.productId, id)
      )
    )
    .get();
  const nextPharmacyProfile =
    updates.pharmacy === undefined ? existingPharmacyProfile : updates.pharmacy;
  const pharmacyTransitionState = getPharmacyProfileTransitionState(ctx.db, {
    tenantId: ctx.tenantId,
    productId: id,
    sanitaryRegistration: existingPharmacyProfile?.sanitaryRegistration,
  });
  assertPharmacyInventoryPolicy({
    profile: nextPharmacyProfile,
    tracksStock: nextTracksStock,
    tracksLots: nextTracksLots,
    tracksSerials: nextTracksSerials,
  });
  assertPharmacyProfileTransitionAllowed({
    existing: existingPharmacyProfile,
    next: nextPharmacyProfile,
    currentStock,
    ...pharmacyTransitionState,
  });
  assertUpdateInventoryIdentityPolicy({
    db: ctx.db,
    tenantId: ctx.tenantId,
    productId: id,
    previousTracksStock: existing.tracksStock,
    nextTracksStock,
    previousTracksLots: existing.tracksLots,
    nextTracksLots,
    previousTracksSerials: existing.tracksSerials,
    nextTracksSerials,
  });
  assertUpdateLotTrackingPolicy({
    db: ctx.db,
    tenantId: ctx.tenantId,
    productId: id,
    previousTracksLots: existing.tracksLots,
    nextTracksLots,
    currentStock,
    requestedStock: updates.stock,
  });
  assertUpdateStockTrackingPolicy({
    nextTracksStock,
    nextTracksLots,
    nextTracksSerials,
    currentStock,
    requestedStock: updates.stock,
  });
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
    taxRate: taxSummary.taxRate,
    taxKind: taxSummary.taxKind,
    vatRateId: taxSummary.vatRateId,
    sellByFraction: resolvedFractionPolicy.sellByFraction,
    fractionStep: resolvedFractionPolicy.fractionStep,
    fractionMinimum: resolvedFractionPolicy.fractionMinimum,
    tracksStock: nextTracksStock,
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

  let stockMovementId: string | null = null;
  let committedStockBefore: number | null = null;
  let committedStockAfter: number | null = null;

  // Catalog metadata, unit/provider/tax children and the backward-compatible
  // absolute-stock edit form one atomic versioned write. Reserving SQLite's
  // writer before re-reading stock prevents a sale or another catalog tab
  // from landing between the delta calculation and the balance mutation.
  ctx.db.transaction(
    tx => {
      const current = tx
        .select()
        .from(products)
        .where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId)))
        .get();
      if (!current) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
      }

      const currentTotal = getProductStockTotal(tx, ctx.tenantId, id);
      const currentPharmacyProfile = tx
        .select()
        .from(pharmacyProductProfiles)
        .where(
          and(
            eq(pharmacyProductProfiles.tenantId, ctx.tenantId),
            eq(pharmacyProductProfiles.productId, id)
          )
        )
        .get();
      const pharmacyProfileChanged =
        updates.pharmacy !== undefined &&
        !pharmacyProductProfileMatches(currentPharmacyProfile, updates.pharmacy);
      const currentPharmacyTransitionState = getPharmacyProfileTransitionState(tx, {
        tenantId: ctx.tenantId,
        productId: id,
        sanitaryRegistration: currentPharmacyProfile?.sanitaryRegistration,
      });
      assertPharmacyProfileTransitionAllowed({
        existing: currentPharmacyProfile,
        next: nextPharmacyProfile,
        currentStock: currentTotal,
        ...currentPharmacyTransitionState,
      });
      assertUpdateInventoryIdentityPolicy({
        db: tx,
        tenantId: ctx.tenantId,
        productId: id,
        previousTracksStock: current.tracksStock,
        nextTracksStock,
        previousTracksLots: current.tracksLots,
        nextTracksLots,
        previousTracksSerials: current.tracksSerials,
        nextTracksSerials,
      });
      assertUpdateLotTrackingPolicy({
        db: tx,
        tenantId: ctx.tenantId,
        productId: id,
        previousTracksLots: current.tracksLots,
        nextTracksLots,
        currentStock: currentTotal,
        requestedStock: updates.stock,
      });
      assertUpdateStockTrackingPolicy({
        nextTracksStock,
        nextTracksLots,
        nextTracksSerials,
        currentStock: currentTotal,
        requestedStock: updates.stock,
      });
      assertUpdateSerialTrackingPolicy({
        db: tx,
        tenantId: ctx.tenantId,
        productId: id,
        previousTracksSerials: current.tracksSerials,
        nextTracksSerials,
        nextTracksLots,
        nextSellByFraction: resolvedFractionPolicy.sellByFraction,
        unitEquivalences: resolvedUnitAssignments.map(assignment => assignment.equivalence),
        currentStock: currentTotal,
        requestedStock: updates.stock,
      });

      let primarySiteId: string | null = null;
      let stockDelta = 0;
      if (updates.stock !== undefined) {
        stockDelta = updates.stock - currentTotal;
        if (stockDelta !== 0) {
          primarySiteId = getPrimarySiteId(tx, ctx.tenantId);
          if (!primarySiteId) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'An active primary site is required to update stock',
            });
          }
          const primaryBalance = tx
            .select({ onHand: inventoryBalances.onHand })
            .from(inventoryBalances)
            .where(
              and(
                eq(inventoryBalances.tenantId, ctx.tenantId),
                eq(inventoryBalances.siteId, primarySiteId),
                eq(inventoryBalances.productId, id)
              )
            )
            .get();
          const primaryOnHand = primaryBalance?.onHand ?? 0;
          if (stockDelta < 0 && primaryOnHand < Math.abs(stockDelta)) {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'INVENTORY_ADJUSTMENT_SITE_STOCK_INSUFFICIENT',
              message: 'The primary site cannot absorb this tenant-wide stock reduction',
              details: {
                siteId: primarySiteId,
                available: primaryOnHand,
                requestedReduction: Math.abs(stockDelta),
              },
            });
          }
        }
      }

      const versionedUpdate = tx
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

      if (updates.stock !== undefined && stockDelta !== 0 && primarySiteId) {
        applyInventoryBalanceDelta(tx, {
          tenantId: ctx.tenantId,
          siteId: primarySiteId,
          productId: id,
          delta: stockDelta,
          // Seed a missing primary-site row with 0, not the tenant-wide
          // total: if other sites already hold stock, seeding with the
          // total would double-count them in the derived Σ(on_hand).
          initialOnHandIfMissing: 0,
          now,
        });
        stockMovementId = nanoid();
        committedStockBefore = currentTotal;
        committedStockAfter = updates.stock;
        tx.insert(inventoryMovements)
          .values({
            id: stockMovementId,
            tenantId: ctx.tenantId,
            productId: id,
            siteId: primarySiteId,
            type: 'adjustment',
            quantity: Math.abs(stockDelta),
            previousStock: currentTotal,
            newStock: updates.stock,
            reference: 'product-update',
            notes: 'Stock changed from product edit',
            createdBy: ctx.user.id,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();
        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user.id,
          action: 'inventory.adjust_stock',
          resourceType: 'product',
          resourceId: id,
          before: { stock: currentTotal },
          after: { stock: updates.stock },
          metadata: {
            delta: stockDelta,
            siteId: primarySiteId,
            movementId: stockMovementId,
            source: 'product_update',
          },
        });
      }

      replaceUnitAssignments(tx, id, resolvedUnitAssignments, now);
      replaceProductTaxComponents(tx, ctx.tenantId, id, resolvedTaxComponents, now);
      if (updates.pharmacy !== undefined && pharmacyProfileChanged) {
        replacePharmacyProductProfile(tx, {
          tenantId: ctx.tenantId,
          productId: id,
          profile: updates.pharmacy,
          now,
        });
        enqueueSyncInTransaction(
          {
            db: tx,
            tenantId: ctx.tenantId,
            ...(ctx.envelope === undefined ? {} : { envelope: ctx.envelope }),
            ...(ctx.deviceId === undefined ? {} : { deviceId: ctx.deviceId }),
          },
          {
            entityType: 'pharmacy_product_profiles',
            entityId: id,
            operation:
              updates.pharmacy === null ? 'delete' : currentPharmacyProfile ? 'update' : 'create',
            data:
              updates.pharmacy === null
                ? { productId: id, deleted: true }
                : { productId: id, ...updates.pharmacy },
          }
        );
        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user.id,
          action: 'pharmacy.product.profile.update',
          resourceType: 'pharmacy_product_profile',
          resourceId: id,
          before: currentPharmacyProfile ?? null,
          after: updates.pharmacy,
          operationId: ctx.envelope?.operationId,
        });
      }
      if (resolvedProviderAssignments !== undefined) {
        replaceProviderAssignments(tx, id, resolvedProviderAssignments, now);
      }
    },
    { behavior: 'immediate' }
  );

  await enqueueSync(ctx, {
    entityType: 'products',
    entityId: id,
    operation: 'update',
    data: {
      id,
      ...updateData,
      providerAssignments: resolvedProviderAssignments,
      unitAssignments: resolvedUnitAssignments,
      taxComponents: resolvedTaxComponents,
    },
  });

  if (stockMovementId && committedStockBefore !== null && committedStockAfter !== null) {
    await enqueueSync(ctx, {
      entityType: 'inventory_movements',
      entityId: stockMovementId,
      operation: 'create',
      data: {
        id: stockMovementId,
        productId: id,
        previousStock: committedStockBefore,
        newStock: committedStockAfter,
      },
    });
  }

  const updated = await getProductWithRelations(ctx.db, id, ctx.tenantId);

  return updated!;
}
