/** ENG-207 — Create-product application use-case. */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { products } from '../../db/schema.js';
import { resolveTenantCurrency } from '../../lib/currency.js';
import { roundMoney } from '../../lib/money.js';
import { resolveFractionPolicy } from '../../services/fraction-policy.js';
import { applyInventoryBalanceDelta, getPrimarySiteId } from '../../services/inventory-balances.js';
import { normalizeProductPricing } from '../../services/pricing.js';
import { assertCreateLotTrackingPolicy } from '../../services/products/lot-tracking.js';
import {
  getDefaultUnitAssignments,
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
import type { CreateProductInput } from '../../trpc/schemas/products.js';
import type { ProductMutationContext } from './types.js';

export async function createProduct(ctx: ProductMutationContext, input: CreateProductInput) {
  assertCreateLotTrackingPolicy({ tracksLots: input.tracksLots, stock: input.stock });

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
    tracksLots: input.tracksLots,
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
}
