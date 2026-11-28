/** Create-product application use-case. */
import { inventoryMovementValueSnapshot } from '../../services/product-valuation.js';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { inventoryMovements, products, sites, type TaxKind } from '../../db/schema.js';
import { resolveTenantCurrency } from '../../lib/currency.js';
import { roundMoney } from '../../lib/money.js';
import { resolveFractionPolicy } from '../../services/fraction-policy.js';
import { applyInventoryBalanceDelta, getPrimarySiteId } from '../../services/inventory-balances.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { productAuditSnapshot } from '../../services/products/catalog-audit.js';
import { normalizeProductPricing } from '../../services/pricing.js';
import { assertGs1CheckDigit } from '../../services/products/barcode-check-digit.js';
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
  resolveCategoryId,
  resolveLocationId,
  resolveProviderAssignments,
  resolveTaxRate,
  resolveUnitAssignments,
  validateUnitAssignments,
} from '../../services/products/mutation-helpers.js';
import { getProductWithRelations } from '../../services/products/product-read.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import {
  legacyComponent,
  replaceProductTaxComponents,
  resolveTaxComponentInputs,
  summarizeTaxComponents,
} from '../../services/tax-components.js';
import type { CreateProductInput } from '../../trpc/schemas/products.js';
import type { ProductMutationContext } from './types.js';
import {
  assertPharmacyInventoryPolicy,
  replacePharmacyProductProfile,
} from '../../services/pharmacy/product-profile.js';

/**
 * Tenant-scoped catalog snapshot reused across rows of a single launch-migration
 * product import so bulk creation avoids repeating identical `units`, `vat_rates`,
 * and `tenants` lookups on every row while enforcing identical validation rules.
 */
export interface ProductImportCache {
  defaultUnitId: string;
  activeUnitIds: ReadonlySet<string>;
  vatRatesById: ReadonlyMap<string, { id: string; rate: number; kind: TaxKind }>;
  currencyCode: string;
}

async function persistProduct(
  ctx: ProductMutationContext,
  input: CreateProductInput,
  options: { auditCreate: boolean; importCache?: ProductImportCache }
) {
  assertCreateLotTrackingPolicy({ tracksLots: input.tracksLots, stock: input.stock });
  assertCreateStockTrackingPolicy({
    tracksStock: input.tracksStock,
    tracksLots: input.tracksLots,
    tracksSerials: input.tracksSerials,
    stock: input.stock,
  });
  assertPharmacyInventoryPolicy({
    profile: input.pharmacy,
    tracksStock: input.tracksStock,
    tracksLots: input.tracksLots,
    tracksSerials: input.tracksSerials,
  });

  assertGs1CheckDigit(input.barcode);

  if (!options.importCache) {
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
  let resolvedUnitAssignments;
  if (options.importCache) {
    const rawAssignments = input.unitAssignments ?? [
      {
        unitId: options.importCache.defaultUnitId,
        equivalence: 1,
        price: normalizedPricing.price,
        price2: 0,
        price3: 0,
        isBase: true,
      },
    ];
    validateUnitAssignments(rawAssignments, input.barcode);
    for (const assignment of rawAssignments) {
      if (!options.importCache.activeUnitIds.has(assignment.unitId)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'One of the selected units was not found or is inactive',
        });
      }
    }
    resolvedUnitAssignments = rawAssignments.map(assignment => ({
      ...assignment,
      price: roundMoney(assignment.price),
      price2: roundMoney(assignment.price2),
      price3: roundMoney(assignment.price3),
    }));
  } else {
    resolvedUnitAssignments = await resolveUnitAssignments(
      ctx.db,
      ctx.tenantId,
      input.unitAssignments ??
        (await getDefaultUnitAssignments(ctx.db, ctx.tenantId, normalizedPricing.price)),
      input.barcode
    );
  }
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
  let resolvedTax;
  if (options.importCache) {
    if (!input.vatRateId) {
      resolvedTax = {
        vatRateId: null,
        taxRate: input.taxRate ?? 0,
        taxKind: 'iva' as TaxKind,
      };
    } else {
      const vatRate = options.importCache.vatRatesById.get(input.vatRateId);
      if (!vatRate) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Selected VAT rate was not found',
        });
      }
      resolvedTax = {
        vatRateId: vatRate.id,
        taxRate: vatRate.rate,
        taxKind: vatRate.kind,
      };
    }
  } else {
    resolvedTax = await resolveTaxRate(ctx.db, ctx.tenantId, input.vatRateId, input.taxRate);
  }
  const resolvedTaxComponents = input.taxComponents
    ? await resolveTaxComponentInputs(ctx.db, ctx.tenantId, input.taxComponents)
    : [legacyComponent(resolvedTax)];
  const taxSummary = summarizeTaxComponents(resolvedTaxComponents);
  const resolvedLocationId = await resolveLocationId(ctx.db, ctx.tenantId, input.locationId);
  const resolvedCategoryId = await resolveCategoryId(ctx.db, ctx.tenantId, input.categoryId);
  const resolvedFractionPolicy = resolveFractionPolicy({
    sellByFraction: input.sellByFraction,
    fractionStep: input.fractionStep,
    fractionMinimum: input.fractionMinimum,
  });

  // products carry their own currency_code so an
  // imported product priced in USD can live inside a COP tenant.
  // Default to the tenant currency; future input schemas can add
  // an explicit override for the import-product flow.
  const productCurrencyCode =
    options.importCache?.currencyCode ?? resolveTenantCurrency(ctx.db, ctx.tenantId);

  const openingMovementId = input.stock > 0 ? nanoid() : null;
  // Opening stock with only a cost typed must still carry inventory value.
  const openingInitialCost =
    input.initialCost > 0 || input.stock <= 0
      ? roundMoney(input.initialCost)
      : normalizedPricing.cost;
  ctx.db.transaction(
    tx => {
      tx.insert(products)
        .values({
          id,
          tenantId: ctx.tenantId,
          name: input.name,
          sku: input.sku,
          description: input.description ?? null,
          categoryId: resolvedCategoryId,
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
          initialCost: openingInitialCost,
          currencyCode: productCurrencyCode,
          minStock: input.minStock,
          sellByFraction: resolvedFractionPolicy.sellByFraction,
          fractionStep: resolvedFractionPolicy.fractionStep,
          fractionMinimum: resolvedFractionPolicy.fractionMinimum,
          tracksStock: input.tracksStock,
          tracksLots: input.tracksLots,
          tracksSerials: input.tracksSerials,
          isReturnableContainer: input.isReturnableContainer,
          returnableDepositAmount: input.isReturnableContainer
            ? roundMoney(input.returnableDepositAmount)
            : 0,
          isActive: input.isActive,
          barcode: input.barcode ?? null,
          imageUrl: input.imageUrl ?? null,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      // Imports already write one summary row per run instead of one per product.
      if (options.auditCreate) {
        const created = tx.select().from(products).where(eq(products.id, id)).get()!;
        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user.id,
          action: 'product.create',
          resourceType: 'product',
          resourceId: id,
          before: null,
          after: productAuditSnapshot(created),
          operationId: ctx.envelope?.operationId,
        });
      }

      replaceUnitAssignments(tx, id, resolvedUnitAssignments, now, { skipDelete: true });
      replaceProductTaxComponents(tx, ctx.tenantId, id, resolvedTaxComponents, now, {
        skipDelete: true,
      });
      if (input.pharmacy) {
        replacePharmacyProductProfile(tx, {
          tenantId: ctx.tenantId,
          productId: id,
          profile: input.pharmacy,
          now,
        });
        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user.id,
          action: 'pharmacy.product.profile.update',
          resourceType: 'pharmacy_product_profile',
          resourceId: id,
          before: null,
          after: input.pharmacy,
          operationId: ctx.envelope?.operationId,
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
            operation: 'create',
            data: { productId: id, ...input.pharmacy },
          }
        );
      }

      if (normalizedProviderState) {
        replaceProviderAssignments(tx, id, resolvedProviderAssignments, now);
      }

      // `stock` is no longer a product column — it is the single-source
      // Σ(inventory_balances.on_hand). Opening stock belongs to the requested
      // site, else the request's active site, else the primary one, and
      // receives its own movement + audit evidence in the same transaction.
      if (input.siteId) {
        const requestedSite = tx
          .select({ isActive: sites.isActive })
          .from(sites)
          .where(and(eq(sites.id, input.siteId), eq(sites.tenantId, ctx.tenantId)))
          .get();
        if (!requestedSite) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Site not found' });
        }
        if (requestedSite.isActive === false) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Selected opening stock site is inactive',
          });
        }
      }
      if (input.stock > 0 && openingMovementId) {
        const openingSiteId = input.siteId ?? ctx.siteId ?? getPrimarySiteId(tx, ctx.tenantId);
        if (!openingSiteId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'An active site is required to record opening stock',
          });
        }
        let movementValue = inventoryMovementValueSnapshot(null);
        applyInventoryBalanceDelta(tx, {
          tenantId: ctx.tenantId,
          siteId: openingSiteId,
          productId: id,
          delta: input.stock,
          onValueDelta: values => {
            movementValue = inventoryMovementValueSnapshot(values);
          },
          initialOnHandIfMissing: 0,
          now,
        });
        tx.insert(inventoryMovements)
          .values({
            id: openingMovementId,
            tenantId: ctx.tenantId,
            productId: id,
            siteId: openingSiteId,
            type: 'adjustment',
            ...movementValue,
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
            siteId: openingSiteId,
            movementId: openingMovementId,
            source: 'product_create',
          },
        });
        enqueueSyncInTransaction(
          { ...ctx, db: tx },
          {
            entityType: 'inventory_movements',
            entityId: openingMovementId,
            operation: 'create',
            data: {
              ...movementValue,
              siteId: openingSiteId,
              id: openingMovementId,
              productId: id,
              quantity: input.stock,
              newStock: input.stock,
            },
          }
        );
      }
      const syncableProductInput = { ...input };
      delete syncableProductInput.pharmacy;
      delete syncableProductInput.siteId;
      enqueueSyncInTransaction(
        { ...ctx, db: tx },
        {
          entityType: 'products',
          entityId: id,
          operation: 'create',
          data: {
            id,
            ...syncableProductInput,
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
        }
      );
    },
    { behavior: 'immediate' }
  );

  return { id, unitAssignments: resolvedUnitAssignments };
}

/** Interactive creation retains the complete public read model and transport contract. */
export async function createProduct(ctx: ProductMutationContext, input: CreateProductInput) {
  const persisted = await persistProduct(ctx, input, { auditCreate: true });
  const created = await getProductWithRelations(ctx.db, persisted.id, ctx.tenantId);
  return created!;
}

/**
 * Import needs only the committed identity and validated units for its separate
 * opening-stock command. Share every validation, transaction, audit and outbox
 * write with interactive creation without hydrating unused display relations
 * once per row. These assignments are not a cached catalog-authority snapshot:
 * recordInventoryEntry revalidates product and unit under its own writer lock.
 */
export async function createProductForImport(
  ctx: ProductMutationContext,
  input: CreateProductInput,
  importCache?: ProductImportCache
) {
  return persistProduct(ctx, input, {
    auditCreate: false,
    ...(importCache ? { importCache } : {}),
  });
}
