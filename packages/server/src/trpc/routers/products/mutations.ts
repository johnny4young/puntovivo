/**
 * Products router write-side procedures (create, update, delete).
 *
 * ENG-178 — extracted verbatim from the former flat `trpc/routers/products.ts`
 * during the megafile decomposition. Exported as a procedure record that
 * `index.ts` spreads into the assembled `productsRouter` (paths unchanged).
 *
 * @module trpc/routers/products/mutations
 */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { assertVersionedWriteApplied } from '../../../lib/optimisticVersion.js';
import { adminProcedure, managerOrAdminProcedure } from '../../middleware/roles.js';
import { products } from '../../../db/schema.js';
import { enqueueSync } from '../../../services/sync/enqueue.js';
import {
  applyInventoryBalanceDelta,
  getPrimarySiteId,
  getProductStockTotal,
} from '../../../services/inventory-balances.js';
import {
  createProductInput,
  updateProductInput,
  deleteProductInput,
} from '../../schemas/products.js';
import { normalizeProductPricing } from '../../../services/pricing.js';
import { resolveFractionPolicy } from '../../../services/fraction-policy.js';
import { roundMoney } from '../../../lib/money.js';
import { resolveTenantCurrency } from '../../../lib/currency.js';
import {
  getDefaultUnitAssignments,
  getExistingProviderAssignments,
  getExistingUnitAssignments,
  normalizeProviderState,
  replaceProviderAssignments,
  replaceUnitAssignments,
  resolveLocationId,
  resolveProviderAssignments,
  resolveTaxRate,
  resolveUnitAssignments,
} from './helpers.js';
import { getProductWithRelations } from './product-read.js';

export const productMutationProcedures = {
  /**
   * Create a new product
   */
  create: managerOrAdminProcedure.input(createProductInput).mutation(async ({ ctx, input }) => {
    const existingSku = await ctx.db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.tenantId, ctx.tenantId), eq(products.sku, input.sku)))
      .get();

    if (existingSku) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A product with this SKU already exists',
      });
    }

    const now = new Date().toISOString();
    const normalizedPricing = normalizeProductPricing({
      cost: input.cost,
      price: input.price,
      price2: input.price2,
      price3: input.price3,
      marginPercent1: input.marginPercent1,
      marginPercent2: input.marginPercent2,
      marginPercent3: input.marginPercent3,
      marginAmount1: input.marginAmount1,
      marginAmount2: input.marginAmount2,
      marginAmount3: input.marginAmount3,
    });
    const id = nanoid();
    const resolvedUnitAssignments = await resolveUnitAssignments(
      ctx.db,
      ctx.tenantId,
      input.unitAssignments ??
        (await getDefaultUnitAssignments(ctx.db, ctx.tenantId, normalizedPricing.price))
    );
    const normalizedProviderState = normalizeProviderState({
      providerId: input.providerId,
      providerAssignments: input.providerAssignments,
    });
    const resolvedProviderAssignments = normalizedProviderState
      ? await resolveProviderAssignments(
          ctx.db,
          ctx.tenantId,
          normalizedProviderState.providerAssignments
        )
      : [];
    const resolvedTax = await resolveTaxRate(ctx.db, ctx.tenantId, input.vatRateId, input.taxRate);
    const resolvedLocationId = await resolveLocationId(ctx.db, ctx.tenantId, input.locationId);
    const resolvedFractionPolicy = resolveFractionPolicy({
      sellByFraction: input.sellByFraction,
      fractionStep: input.fractionStep,
      fractionMinimum: input.fractionMinimum,
    });

    // ENG-176b — products carry their own currency_code so an
    // imported product priced in USD can live inside a COP tenant.
    // Default to the tenant currency; future input schemas can add
    // an explicit override for the import-product flow.
    const productCurrencyCode = resolveTenantCurrency(ctx.db, ctx.tenantId);

    await ctx.db.insert(products).values({
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      sku: input.sku,
      description: input.description ?? null,
      categoryId: input.categoryId ?? null,
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
      providerId: normalizedProviderState?.providerId ?? null,
      locationId: resolvedLocationId,
      initialCost: roundMoney(input.initialCost),
      currencyCode: productCurrencyCode,
      minStock: input.minStock,
      sellByFraction: resolvedFractionPolicy.sellByFraction,
      fractionStep: resolvedFractionPolicy.fractionStep,
      fractionMinimum: resolvedFractionPolicy.fractionMinimum,
      isActive: input.isActive,
      barcode: input.barcode ?? null,
      imageUrl: input.imageUrl ?? null,
      syncStatus: 'pending',
      syncVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    await replaceUnitAssignments(ctx.db, id, resolvedUnitAssignments, now);

    if (normalizedProviderState) {
      await replaceProviderAssignments(ctx.db, id, resolvedProviderAssignments, now);
    }

    // `stock` is no longer a product column — it is the single-source
    // Σ(inventory_balances.on_hand). Seed the opening quantity into the
    // tenant's primary site so `products.getById` reports it back.
    if (input.stock > 0) {
      ctx.db.transaction(tx => {
        const primarySiteId = getPrimarySiteId(tx, ctx.tenantId);
        if (primarySiteId) {
          applyInventoryBalanceDelta(tx, {
            tenantId: ctx.tenantId,
            siteId: primarySiteId,
            productId: id,
            delta: input.stock,
            initialOnHandIfMissing: 0,
            now,
          });
        }
      });
    }

    await enqueueSync(ctx, {
      entityType: 'products',
      entityId: id,
      operation: 'create',
      data: {
        id,
        ...input,
        ...normalizedPricing,
        taxRate: resolvedTax.taxRate,
        vatRateId: resolvedTax.vatRateId,
        providerId: normalizedProviderState?.providerId ?? null,
        locationId: resolvedLocationId,
        sellByFraction: resolvedFractionPolicy.sellByFraction,
        fractionStep: resolvedFractionPolicy.fractionStep,
        fractionMinimum: resolvedFractionPolicy.fractionMinimum,
        providerAssignments: resolvedProviderAssignments,
        unitAssignments: resolvedUnitAssignments,
      },
    });

    const created = await getProductWithRelations(ctx.db, id, ctx.tenantId);

    return created!;
  }),

  /**
   * Update an existing product
   */
  update: managerOrAdminProcedure.input(updateProductInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;

    const existing = await ctx.db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
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
    const updateData: Record<string, unknown> = {
      updatedAt: now,
      syncStatus: 'pending',
      syncVersion: (existing.syncVersion ?? 0) + 1,
      // ENG-177a — optimistic-concurrency bump. The versioned WHERE below
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

    // ENG-177a — optimistic-concurrency guard. The version predicate makes
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
  }),

  /**
   * Delete a product (admin only)
   */
  delete: adminProcedure.input(deleteProductInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db
      .select()
      .from(products)
      .where(and(eq(products.id, input.id), eq(products.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    const now = new Date().toISOString();
    await ctx.db
      .update(products)
      .set({
        isActive: false,
        updatedAt: now,
        syncStatus: 'pending',
        syncVersion: (existing.syncVersion ?? 0) + 1,
      })
      .where(and(eq(products.id, input.id), eq(products.tenantId, ctx.tenantId)));

    await enqueueSync(ctx, {
      entityType: 'products',
      entityId: input.id,
      operation: 'update',
      data: { id: input.id, isActive: false, updatedAt: now },
    });

    return { success: true, id: input.id };
  }),
};
