/** Create-product application use-case. */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { inventoryMovements, products } from '../../db/schema.js';
import { resolveTenantCurrency } from '../../lib/currency.js';
import { roundMoney } from '../../lib/money.js';
import { resolveFractionPolicy } from '../../services/fraction-policy.js';
import { applyInventoryBalanceDelta, getPrimarySiteId } from '../../services/inventory-balances.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { normalizeProductPricing } from '../../services/pricing.js';
import {
  assertCreateLotTrackingPolicy,
  assertCreateSerialTrackingPolicy,
  assertCreateStockTrackingPolicy,
} from '../../services/products/lot-tracking.js';
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
import {
  legacyComponent,
  replaceProductTaxComponents,
  resolveTaxComponentInputs,
  summarizeTaxComponents,
} from '../../services/tax-components.js';
import type { CreateProductInput } from '../../trpc/schemas/products.js';
import type { ProductMutationContext } from './types.js';

export async function createProduct(ctx: ProductMutationContext, input: CreateProductInput) {
  assertCreateLotTrackingPolicy({ tracksLots: input.tracksLots, stock: input.stock });
  assertCreateStockTrackingPolicy({
    tracksStock: input.tracksStock,
    tracksLots: input.tracksLots,
    tracksSerials: input.tracksSerials,
    stock: input.stock,
  });

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
  assertCreateSerialTrackingPolicy({
    tracksSerials: input.tracksSerials,
    tracksLots: input.tracksLots,
    sellByFraction: input.sellByFraction,
    unitEquivalences: resolvedUnitAssignments.map(assignment => assignment.equivalence),
    stock: input.stock,
  });
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
  const resolvedTaxComponents = input.taxComponents
    ? await resolveTaxComponentInputs(ctx.db, ctx.tenantId, input.taxComponents)
    : [legacyComponent(resolvedTax)];
  const taxSummary = summarizeTaxComponents(resolvedTaxComponents);
  const resolvedLocationId = await resolveLocationId(ctx.db, ctx.tenantId, input.locationId);
  const resolvedFractionPolicy = resolveFractionPolicy({
    sellByFraction: input.sellByFraction,
    fractionStep: input.fractionStep,
    fractionMinimum: input.fractionMinimum,
  });

  // products carry their own currency_code so an
  // imported product priced in USD can live inside a COP tenant.
  // Default to the tenant currency; future input schemas can add
  // an explicit override for the import-product flow.
  const productCurrencyCode = resolveTenantCurrency(ctx.db, ctx.tenantId);

  const openingMovementId = input.stock > 0 ? nanoid() : null;
  ctx.db.transaction(
    tx => {
      tx.insert(products)
        .values({
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
          taxRate: taxSummary.taxRate,
          taxKind: taxSummary.taxKind,
          vatRateId: taxSummary.vatRateId,
          providerId: normalizedProviderState?.providerId ?? null,
          locationId: resolvedLocationId,
          initialCost: roundMoney(input.initialCost),
          currencyCode: productCurrencyCode,
          minStock: input.minStock,
          sellByFraction: resolvedFractionPolicy.sellByFraction,
          fractionStep: resolvedFractionPolicy.fractionStep,
          fractionMinimum: resolvedFractionPolicy.fractionMinimum,
          tracksStock: input.tracksStock,
          tracksLots: input.tracksLots,
          tracksSerials: input.tracksSerials,
          isActive: input.isActive,
          barcode: input.barcode ?? null,
          imageUrl: input.imageUrl ?? null,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      replaceUnitAssignments(tx, id, resolvedUnitAssignments, now);
      replaceProductTaxComponents(tx, ctx.tenantId, id, resolvedTaxComponents, now);

      if (normalizedProviderState) {
        replaceProviderAssignments(tx, id, resolvedProviderAssignments, now);
      }

      // `stock` is no longer a product column — it is the single-source
      // Σ(inventory_balances.on_hand). Opening stock belongs to the primary
      // site and receives its own movement + audit evidence in the same
      // transaction as the catalog row.
      if (input.stock <= 0 || !openingMovementId) return;
      const primarySiteId = getPrimarySiteId(tx, ctx.tenantId);
      if (!primarySiteId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'An active site is required to record opening stock',
        });
      }
      applyInventoryBalanceDelta(tx, {
        tenantId: ctx.tenantId,
        siteId: primarySiteId,
        productId: id,
        delta: input.stock,
        initialOnHandIfMissing: 0,
        now,
      });
      tx.insert(inventoryMovements)
        .values({
          id: openingMovementId,
          tenantId: ctx.tenantId,
          productId: id,
          siteId: primarySiteId,
          type: 'adjustment',
          quantity: input.stock,
          previousStock: 0,
          newStock: input.stock,
          reference: 'product-create',
          notes: 'Opening stock from product creation',
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
        before: { stock: 0 },
        after: { stock: input.stock },
        metadata: {
          delta: input.stock,
          siteId: primarySiteId,
          movementId: openingMovementId,
          source: 'product_create',
        },
      });
    },
    { behavior: 'immediate' }
  );

  await enqueueSync(ctx, {
    entityType: 'products',
    entityId: id,
    operation: 'create',
    data: {
      id,
      ...input,
      ...normalizedPricing,
      taxRate: taxSummary.taxRate,
      taxKind: taxSummary.taxKind,
      vatRateId: taxSummary.vatRateId,
      taxComponents: resolvedTaxComponents,
      providerId: normalizedProviderState?.providerId ?? null,
      locationId: resolvedLocationId,
      sellByFraction: resolvedFractionPolicy.sellByFraction,
      fractionStep: resolvedFractionPolicy.fractionStep,
      fractionMinimum: resolvedFractionPolicy.fractionMinimum,
      providerAssignments: resolvedProviderAssignments,
      unitAssignments: resolvedUnitAssignments,
    },
  });

  if (openingMovementId) {
    await enqueueSync(ctx, {
      entityType: 'inventory_movements',
      entityId: openingMovementId,
      operation: 'create',
      data: {
        id: openingMovementId,
        productId: id,
        quantity: input.stock,
        newStock: input.stock,
      },
    });
  }

  const created = await getProductWithRelations(ctx.db, id, ctx.tenantId);

  return created!;
}
