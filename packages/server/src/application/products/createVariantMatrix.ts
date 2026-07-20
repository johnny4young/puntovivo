/** Atomically convert a zero-stock product into a variant matrix. */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  inventoryBalances,
  orderItems,
  products,
  productXProvider,
  purchaseItems,
  saleItems,
  transferOrderItems,
  unitXProduct,
  type ProductVariantAxis,
  type ProductVariantValues,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import type { CreateProductVariantMatrixInput } from '../../trpc/schemas/products.js';
import type { ProductMutationContext } from './types.js';

const STOCK_EPSILON = 1e-9;
const MAX_VARIANTS = 100;
const MAX_SKU_LENGTH = 100;
const MAX_PRODUCT_NAME_LENGTH = 255;

export interface ProductVariantPreview {
  name: string;
  sku: string;
  signature: string;
  values: ProductVariantValues;
}

function skuToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
}

function tokensForAxis(axis: ProductVariantAxis): string[] {
  const baseTokens = axis.values.map((value, index) => skuToken(value) || `OPT${index + 1}`);
  const counts = new Map<string, number>();
  for (const token of baseTokens) counts.set(token, (counts.get(token) ?? 0) + 1);

  return baseTokens.map((token, index) =>
    (counts.get(token) ?? 0) > 1 ? `${token}-${index + 1}` : token
  );
}

function buildVariantSku(parentSku: string, suffix: string): string {
  const availablePrefixLength = MAX_SKU_LENGTH - suffix.length - 1;
  if (availablePrefixLength < 1) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_VARIANT_SKU_CONFLICT',
      message: 'Variant option values leave no room for a SKU prefix',
    });
  }
  const prefix = truncateAtCodePointBoundary(parentSku, availablePrefixLength).replace(/-+$/g, '');
  return `${prefix}-${suffix}`;
}

function truncateAtCodePointBoundary(value: string, maxCodeUnits: number): string {
  let result = '';
  for (const codePoint of value) {
    if (result.length + codePoint.length > maxCodeUnits) break;
    result += codePoint;
  }
  return result;
}

function buildVariantName(parentName: string, valueLabel: string): string {
  const suffix = ` · ${valueLabel}`;
  const parentPrefix = truncateAtCodePointBoundary(
    parentName,
    MAX_PRODUCT_NAME_LENGTH - suffix.length
  ).trimEnd();
  return `${parentPrefix}${suffix}`;
}

export function buildProductVariantPreview(
  parent: { name: string; sku: string },
  axes: ProductVariantAxis[]
): ProductVariantPreview[] {
  const normalizedAxes = axes.map(axis => ({
    name: axis.name.trim(),
    values: axis.values.map(value => value.trim()),
  }));
  const axisTokens = normalizedAxes.map(tokensForAxis);
  let combinations: Array<Array<{ value: string; token: string }>> = [[]];

  for (const [axisIndex, axis] of normalizedAxes.entries()) {
    combinations = combinations.flatMap(combination =>
      axis.values.map((value, valueIndex) => [
        ...combination,
        { value, token: axisTokens[axisIndex]![valueIndex]! },
      ])
    );
  }

  if (combinations.length === 0 || combinations.length > MAX_VARIANTS) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_VARIANT_MATRIX_EXISTS',
      message: `A variant matrix must contain between 1 and ${MAX_VARIANTS} combinations`,
    });
  }

  const usedSuffixes = new Set<string>();
  return combinations.map(combination => {
    const values = Object.fromEntries(
      normalizedAxes.map((axis, index) => [axis.name, combination[index]!.value])
    );
    const valueLabel = combination.map(item => item.value).join(' / ');
    const name = buildVariantName(parent.name, valueLabel);
    const baseSuffix = combination.map(item => item.token).join('-');
    let suffix = baseSuffix;
    let discriminator = 2;
    while (usedSuffixes.has(suffix)) {
      suffix = `${baseSuffix}-${discriminator}`;
      discriminator += 1;
    }
    usedSuffixes.add(suffix);
    const sku = buildVariantSku(parent.sku, suffix);
    return { name, sku, values, signature: JSON.stringify(values) };
  });
}

export async function createProductVariantMatrix(
  ctx: ProductMutationContext,
  input: CreateProductVariantMatrixInput
) {
  const now = new Date().toISOString();
  const result = ctx.db.transaction(tx => {
    const parent = tx
      .select()
      .from(products)
      .where(and(eq(products.id, input.parentProductId), eq(products.tenantId, ctx.tenantId)))
      .get();

    if (!parent) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'PRODUCT_VARIANT_PARENT_NOT_FOUND',
        message: 'Variant parent product was not found for this tenant',
      });
    }
    if (parent.catalogType !== 'standard') {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'PRODUCT_VARIANT_MATRIX_EXISTS',
        message: 'This product already belongs to a variant matrix',
        details: { parentProductId: parent.id, catalogType: parent.catalogType },
      });
    }
    if (parent.tracksSerials) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'PRODUCT_SERIAL_VARIANT_PARENT_UNSUPPORTED',
        message: 'A serial-tracked product cannot become a variant matrix parent',
        details: { parentProductId: parent.id },
      });
    }

    // A historical or deferred document can still reverse/receive stock in a
    // later command. Converting such a product would either strand that stock
    // on the catalog-only parent or break the document lifecycle, so only a
    // transaction-free product can become a matrix parent.
    const operationalReference =
      tx
        .select({ id: saleItems.id })
        .from(saleItems)
        .innerJoin(products, eq(saleItems.productId, products.id))
        .where(and(eq(products.tenantId, ctx.tenantId), eq(saleItems.productId, parent.id)))
        .get() ??
      tx
        .select({ id: purchaseItems.id })
        .from(purchaseItems)
        .innerJoin(products, eq(purchaseItems.productId, products.id))
        .where(and(eq(products.tenantId, ctx.tenantId), eq(purchaseItems.productId, parent.id)))
        .get() ??
      tx
        .select({ id: orderItems.id })
        .from(orderItems)
        .innerJoin(products, eq(orderItems.productId, products.id))
        .where(and(eq(products.tenantId, ctx.tenantId), eq(orderItems.productId, parent.id)))
        .get() ??
      tx
        .select({ id: transferOrderItems.id })
        .from(transferOrderItems)
        .innerJoin(products, eq(transferOrderItems.productId, products.id))
        .where(
          and(eq(products.tenantId, ctx.tenantId), eq(transferOrderItems.productId, parent.id))
        )
        .get();
    if (operationalReference) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'PRODUCT_VARIANT_PARENT_HAS_HISTORY',
        message: 'A product referenced by an operational document cannot become a matrix parent',
        details: { parentProductId: parent.id },
      });
    }

    const nonZeroBalance = tx
      .select({ id: inventoryBalances.id })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, ctx.tenantId),
          eq(inventoryBalances.productId, parent.id),
          sql`abs(${inventoryBalances.onHand}) > ${STOCK_EPSILON}`
        )
      )
      .get();
    if (nonZeroBalance) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'PRODUCT_VARIANT_PARENT_REQUIRES_ZERO_STOCK',
        message: 'A product must have zero stock at every site before creating variants',
        details: { parentProductId: parent.id },
      });
    }

    const axes = input.axes.map(axis => ({
      name: axis.name.trim(),
      values: axis.values.map(value => value.trim()),
    }));
    const preview = buildProductVariantPreview(parent, axes);
    const generatedSkus = preview.map(variant => variant.sku);
    if (new Set(generatedSkus).size !== generatedSkus.length) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'PRODUCT_VARIANT_SKU_CONFLICT',
        message: 'The generated variant SKUs are not unique',
      });
    }
    const skuConflict = tx
      .select({ sku: products.sku })
      .from(products)
      .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.sku, generatedSkus)))
      .get();
    if (skuConflict) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'PRODUCT_VARIANT_SKU_CONFLICT',
        message: `Generated SKU ${skuConflict.sku} already exists`,
        details: { sku: skuConflict.sku },
      });
    }

    const sourceUnits = tx
      .select()
      .from(unitXProduct)
      .where(eq(unitXProduct.productId, parent.id))
      .all();
    const sourceProviders = tx
      .select()
      .from(productXProvider)
      .where(eq(productXProvider.productId, parent.id))
      .all();
    const parentUnitAssignments = sourceUnits.map(assignment => ({
      unitId: assignment.unitId,
      equivalence: assignment.equivalence,
      price: assignment.price,
      isBase: assignment.isBase,
      barcode: assignment.barcode,
    }));
    const childUnitAssignments = parentUnitAssignments.map(assignment => ({
      ...assignment,
      barcode: null,
    }));
    const providerAssignments = sourceProviders.map(assignment => ({
      providerId: assignment.providerId,
    }));

    const parentProduct = {
      ...parent,
      catalogType: 'variant_parent' as const,
      variantAxes: axes,
      isActive: false,
      version: parent.version + 1,
      syncStatus: 'pending' as const,
      syncVersion: (parent.syncVersion ?? 0) + 1,
      updatedAt: now,
    };

    tx.update(products)
      .set({
        catalogType: parentProduct.catalogType,
        variantAxes: parentProduct.variantAxes,
        isActive: parentProduct.isActive,
        version: parentProduct.version,
        syncStatus: parentProduct.syncStatus,
        syncVersion: parentProduct.syncVersion,
        updatedAt: parentProduct.updatedAt,
      })
      .where(and(eq(products.id, parent.id), eq(products.tenantId, ctx.tenantId)))
      .run();

    const variants = preview.map(variant => ({
      id: nanoid(),
      tenantId: parent.tenantId,
      name: variant.name,
      sku: variant.sku,
      description: parent.description,
      categoryId: parent.categoryId,
      price: parent.price,
      price2: parent.price2,
      price3: parent.price3,
      cost: parent.cost,
      marginPercent1: parent.marginPercent1,
      marginPercent2: parent.marginPercent2,
      marginPercent3: parent.marginPercent3,
      marginAmount1: parent.marginAmount1,
      marginAmount2: parent.marginAmount2,
      marginAmount3: parent.marginAmount3,
      taxRate: parent.taxRate,
      vatRateId: parent.vatRateId,
      providerId: parent.providerId,
      locationId: parent.locationId,
      initialCost: parent.initialCost,
      currencyCode: parent.currencyCode,
      minStock: parent.minStock,
      sellByFraction: parent.sellByFraction,
      fractionStep: parent.fractionStep,
      fractionMinimum: parent.fractionMinimum,
      tracksLots: parent.tracksLots,
      tracksSerials: parent.tracksSerials,
      catalogType: 'variant' as const,
      variantParentId: parent.id,
      variantAxes: null,
      variantValues: variant.values,
      variantSignature: variant.signature,
      isActive: parent.isActive,
      barcode: null,
      imageUrl: parent.imageUrl,
      embedding: null,
      embeddingModel: null,
      embeddedAt: null,
      version: 0,
      syncStatus: 'pending' as const,
      syncVersion: 1,
      createdAt: now,
      updatedAt: now,
    }));
    for (const variant of variants) {
      tx.insert(products).values(variant).run();

      for (const assignment of childUnitAssignments) {
        tx.insert(unitXProduct)
          .values({
            id: nanoid(),
            productId: variant.id,
            unitId: assignment.unitId,
            equivalence: assignment.equivalence,
            price: assignment.price,
            isBase: assignment.isBase,
            // Packaging barcodes identify a concrete sellable SKU and cannot
            // be copied safely across every generated child.
            barcode: null,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
      for (const assignment of providerAssignments) {
        tx.insert(productXProvider)
          .values({
            id: nanoid(),
            productId: variant.id,
            providerId: assignment.providerId,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
    }

    const syncContext = { ...ctx, db: tx as unknown as typeof ctx.db };
    enqueueSyncInTransaction(syncContext, {
      entityType: 'products',
      entityId: parent.id,
      operation: 'update',
      data: {
        ...parentProduct,
        stock: 0,
        unitAssignments: parentUnitAssignments,
        providerAssignments,
      },
    });
    for (const variant of variants) {
      enqueueSyncInTransaction(syncContext, {
        entityType: 'products',
        entityId: variant.id,
        operation: 'create',
        data: {
          ...variant,
          stock: 0,
          unitAssignments: childUnitAssignments,
          providerAssignments,
        },
      });
    }

    return {
      parent: parentProduct,
      axes,
      variants: variants.map(variant => ({
        id: variant.id,
        name: variant.name,
        sku: variant.sku,
        signature: variant.variantSignature,
        values: variant.variantValues,
      })),
    };
  });

  return {
    parentProductId: result.parent.id,
    axes: result.axes,
    variants: result.variants,
  };
}
