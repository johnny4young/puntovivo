/**
 * Products router read-side procedures (list, getById, search, barcode lookup).
 *
 * extracted verbatim from the former flat `trpc/routers/products.ts`
 * during the megafile decomposition. Exported as a procedure record that
 * `index.ts` spreads into the assembled `productsRouter` (paths unchanged).
 *
 * @module trpc/routers/products/queries
 */
import { TRPCError } from '@trpc/server';
import { and, eq, like, ne, or, sql } from 'drizzle-orm';

import { tenantProcedure } from '../../middleware/tenant.js';
import {
  categories,
  locations,
  products,
  providers,
  unitXProduct,
  vatRates,
} from '../../../db/schema.js';
import {
  listProductsInput,
  getProductInput,
  getProductVariantMatrixInput,
  searchProductsInput,
  lookupByBarcodeInput,
} from '../../schemas/products.js';
import { parseScan } from '../../../services/peripherals/barcode/parser.js';
import {
  getProductWithRelations,
  getUnitAssignmentsByProductIds,
  productSelection,
} from '../../../services/products/product-read.js';

export const productQueryProcedures = {
  /**
   * List products for the current tenant with pagination and filtering
   */
  list: tenantProcedure.input(listProductsInput).query(async ({ ctx, input }) => {
    const { page, perPage, search, categoryId, isActive, includeVariantParents } = input;
    const offset = (page - 1) * perPage;

    const conditions = [eq(products.tenantId, ctx.tenantId)];
    if (!includeVariantParents) {
      conditions.push(ne(products.catalogType, 'variant_parent'));
    }
    if (search) {
      conditions.push(or(like(products.name, `%${search}%`), like(products.sku, `%${search}%`))!);
    }
    if (categoryId !== undefined) {
      conditions.push(eq(products.categoryId, categoryId));
    }
    if (isActive !== undefined) {
      conditions.push(eq(products.isActive, isActive));
    }

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      ctx.db
        .select(productSelection)
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .leftJoin(locations, eq(products.locationId, locations.id))
        .leftJoin(providers, eq(products.providerId, providers.id))
        .leftJoin(vatRates, eq(products.vatRateId, vatRates.id))
        .where(where)
        .limit(perPage)
        .offset(offset)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(products)
        .where(where)
        .get(),
    ]);

    const totalItems = countResult?.count ?? 0;

    return {
      items,
      page,
      perPage,
      totalItems,
      totalPages: Math.ceil(totalItems / perPage),
    };
  }),

  /**
   * Get a single product by ID
   */
  getById: tenantProcedure.input(getProductInput).query(async ({ ctx, input }) => {
    const product = await getProductWithRelations(ctx.db, input.id, ctx.tenantId);

    if (!product) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    return product;
  }),

  /** Read a catalog-only parent and its tenant-scoped sellable children. */
  getVariantMatrix: tenantProcedure
    .input(getProductVariantMatrixInput)
    .query(async ({ ctx, input }) => {
      const parent = await getProductWithRelations(ctx.db, input.parentProductId, ctx.tenantId);
      if (!parent || parent.catalogType !== 'variant_parent') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Variant matrix was not found' });
      }

      const variants = await ctx.db
        .select(productSelection)
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .leftJoin(locations, eq(products.locationId, locations.id))
        .leftJoin(providers, eq(products.providerId, providers.id))
        .leftJoin(vatRates, eq(products.vatRateId, vatRates.id))
        .where(
          and(
            eq(products.tenantId, ctx.tenantId),
            eq(products.variantParentId, input.parentProductId),
            eq(products.catalogType, 'variant')
          )
        )
        .all();

      const axes = parent.variantAxes ?? [];
      variants.sort((left, right) => {
        for (const axis of axes) {
          const leftIndex = axis.values.indexOf(left.variantValues?.[axis.name] ?? '');
          const rightIndex = axis.values.indexOf(right.variantValues?.[axis.name] ?? '');
          if (leftIndex !== rightIndex) return leftIndex - rightIndex;
        }
        return left.sku.localeCompare(right.sku);
      });

      return { parent, axes, variants };
    }),

  /**
   * Search products by name, SKU or barcode
   */
  search: tenantProcedure.input(searchProductsInput).query(async ({ ctx, input }) => {
    const conditions = [
      eq(products.tenantId, ctx.tenantId),
      ne(products.catalogType, 'variant_parent'),
    ];
    if (input.categoryId) {
      conditions.push(eq(products.categoryId, input.categoryId));
    }
    if (input.providerId) {
      conditions.push(eq(products.providerId, input.providerId));
    }
    if (input.isActive !== undefined) {
      conditions.push(eq(products.isActive, input.isActive));
    }

    const items = await ctx.db
      .select(productSelection)
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(locations, eq(products.locationId, locations.id))
      .leftJoin(providers, eq(products.providerId, providers.id))
      .leftJoin(vatRates, eq(products.vatRateId, vatRates.id))
      .where(
        and(
          ...conditions,
          or(
            like(products.name, `%${input.q}%`),
            like(products.sku, `%${input.q}%`),
            like(products.barcode, `%${input.q}%`)
          )
        )
      )
      .limit(input.limit)
      .all();

    const assignmentsMap = await getUnitAssignmentsByProductIds(
      ctx.db,
      items.map(item => item.id)
    );

    return {
      items: items.map(item => {
        const unitAssignments = assignmentsMap.get(item.id) ?? [];
        const baseUnit =
          unitAssignments.find(assignment => assignment.isBase) ?? unitAssignments[0];

        return {
          ...item,
          unitAssignments: unitAssignments.map(assignment => ({
            ...assignment,
            isBase: assignment.isBase ?? false,
          })),
          baseUnitId: baseUnit?.unitId ?? null,
          baseUnitName: baseUnit?.unitName ?? null,
          baseUnitAbbreviation: baseUnit?.unitAbbreviation ?? null,
          baseUnitPrice: baseUnit?.price ?? item.price,
        };
      }),
    };
  }),

  // ==========================================================================
  // exact-match scanner lookup
  // --------------------------------------------------------------------------
  // The renderer's `useBarcodeWedgeListener` accumulates raw HID
  // keystrokes; on emit it calls this procedure with the raw code.
  // We parse server-side (`parseScan`) to validate checksum and decode
  // GS1 prefix-2x weight/price labels, then look up the product by
  // exact barcode match. Available to any tenant-authenticated user
  // (cashiers must be able to scan); tenant-scoped via the explicit
  // `eq(products.tenantId, ctx.tenantId)` filter.
  //
  // Returns null when the scan does not resolve so the SalesPage can
  // surface a translated "not found" toast without an error envelope.
  // ==========================================================================

  /**
   * Exact-match barcode lookup with GS1 weight/price awareness.
   *
   * Strict mode rejects checksum failures for known digit-only
   * symbologies. Unknown symbologies fall through to exact lookup
   * so basic Code128 / internal SKU labels still resolve.
   */
  lookupByBarcode: tenantProcedure.input(lookupByBarcodeInput).query(async ({ ctx, input }) => {
    const parsed = parseScan(input.barcode, { gs1Scheme: input.gs1Scheme });

    // Strict policy: checksum failure on a known digit-only
    // symbology is a hard reject. `kind: unknown` still falls
    // through to exact-match lookup so basic Code128 / short
    // internal barcodes work without forcing the scanner pipeline
    // into fully permissive mode.
    const failedKnownChecksum =
      !parsed.checksumValid &&
      /^\d+$/.test(parsed.code) &&
      (parsed.code.length === 8 || parsed.code.length === 12 || parsed.code.length === 13);
    if (input.parsePolicy === 'strict' && failedKnownChecksum) {
      return null;
    }

    // GS1 layouts carry the SKU in the first 5 digits after the role
    // prefix; non-GS1 codes look up the verbatim string.
    const lookupCode = parsed.lookupCode;

    let item = await ctx.db
      .select(productSelection)
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(locations, eq(products.locationId, locations.id))
      .leftJoin(providers, eq(products.providerId, providers.id))
      .leftJoin(vatRates, eq(products.vatRateId, vatRates.id))
      .where(
        and(
          eq(products.tenantId, ctx.tenantId),
          eq(products.isActive, true),
          ne(products.catalogType, 'variant_parent'),
          eq(products.barcode, lookupCode)
        )
      )
      .get();

    // Auditoría 2026-07 — packaging-level fallback. When no product carries
    // this code as its base barcode, try a per-packaging barcode on
    // `unit_x_product` (a scanned case/pack). A hit resolves the owning
    // product AND the specific unit, so the renderer selects that unit and
    // the cart line multiplies by its `equivalence`.
    let resolvedUnitId: string | null = null;
    if (!item) {
      const packaging = await ctx.db
        .select({ productId: unitXProduct.productId, unitId: unitXProduct.unitId })
        .from(unitXProduct)
        .innerJoin(products, eq(unitXProduct.productId, products.id))
        .where(
          and(
            eq(products.tenantId, ctx.tenantId),
            eq(products.isActive, true),
            ne(products.catalogType, 'variant_parent'),
            eq(unitXProduct.barcode, lookupCode)
          )
        )
        .get();

      if (packaging) {
        resolvedUnitId = packaging.unitId;
        item = await ctx.db
          .select(productSelection)
          .from(products)
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .leftJoin(locations, eq(products.locationId, locations.id))
          .leftJoin(providers, eq(products.providerId, providers.id))
          .leftJoin(vatRates, eq(products.vatRateId, vatRates.id))
          .where(and(eq(products.tenantId, ctx.tenantId), eq(products.id, packaging.productId)))
          .get();
      }
    }

    if (!item) {
      return null;
    }

    const assignmentsMap = await getUnitAssignmentsByProductIds(ctx.db, [item.id]);
    const unitAssignments = assignmentsMap.get(item.id) ?? [];
    const baseUnit = unitAssignments.find(a => a.isBase) ?? unitAssignments[0];
    // The scanned unit for a packaging hit; base-barcode hits leave this null
    // so the renderer keeps its base-unit default.
    const resolvedUnit = resolvedUnitId
      ? (unitAssignments.find(a => a.unitId === resolvedUnitId) ?? null)
      : null;

    const product = {
      ...item,
      unitAssignments: unitAssignments.map(a => ({
        ...a,
        isBase: a.isBase ?? false,
      })),
      baseUnitId: baseUnit?.unitId ?? null,
      baseUnitName: baseUnit?.unitName ?? null,
      baseUnitAbbreviation: baseUnit?.unitAbbreviation ?? null,
      baseUnitPrice: baseUnit?.price ?? item.price,
    };

    return {
      product,
      parsed,
      // The packaging unit the scan resolved to, or null for a base-unit
      // barcode. When set, the renderer selects this unit (price +
      // equivalence come from its assignment).
      resolvedUnitId,
      resolvedUnitPrice: resolvedUnit?.price ?? null,
      // GS1 weight/price overrides for the cart line. Renderer uses
      // these verbatim when present; otherwise it falls back to
      // `quantity = 1` and the product's base unit price.
      suggestedQuantity: parsed.weightKg ?? null,
      suggestedPrice: parsed.priceMajor ?? null,
    };
  }),
};
