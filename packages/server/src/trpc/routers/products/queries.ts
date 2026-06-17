/**
 * Products router read-side procedures (list, getById, search, barcode lookup).
 *
 * ENG-178 — extracted verbatim from the former flat `trpc/routers/products.ts`
 * during the megafile decomposition. Exported as a procedure record that
 * `index.ts` spreads into the assembled `productsRouter` (paths unchanged).
 *
 * @module trpc/routers/products/queries
 */
import { TRPCError } from '@trpc/server';
import { and, eq, like, or, sql } from 'drizzle-orm';

import { tenantProcedure } from '../../middleware/tenant.js';
import {
  categories,
  locations,
  products,
  providers,
  vatRates,
} from '../../../db/schema.js';
import {
  listProductsInput,
  getProductInput,
  searchProductsInput,
  lookupByBarcodeInput,
} from '../../schemas/products.js';
import { parseScan } from '../../../services/peripherals/barcode/parser.js';
import {
  getProductWithRelations,
  getUnitAssignmentsByProductIds,
  productSelection,
} from './product-read.js';

export const productQueryProcedures = {
  /**
   * List products for the current tenant with pagination and filtering
   */
  list: tenantProcedure.input(listProductsInput).query(async ({ ctx, input }) => {
    const { page, perPage, search, categoryId, isActive } = input;
    const offset = (page - 1) * perPage;

    const conditions = [eq(products.tenantId, ctx.tenantId)];
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

  /**
   * Search products by name, SKU or barcode
   */
  search: tenantProcedure.input(searchProductsInput).query(async ({ ctx, input }) => {
    const conditions = [eq(products.tenantId, ctx.tenantId)];
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
        const baseUnit = unitAssignments.find(assignment => assignment.isBase) ?? unitAssignments[0];

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
  // ENG-061 — exact-match scanner lookup
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
  lookupByBarcode: tenantProcedure
    .input(lookupByBarcodeInput)
    .query(async ({ ctx, input }) => {
      const parsed = parseScan(input.barcode, { gs1Scheme: input.gs1Scheme });

      // Strict policy: checksum failure on a known digit-only
      // symbology is a hard reject. `kind: unknown` still falls
      // through to exact-match lookup so basic Code128 / short
      // internal barcodes work without forcing the scanner pipeline
      // into fully permissive mode.
      const failedKnownChecksum =
        !parsed.checksumValid &&
        /^\d+$/.test(parsed.code) &&
        (parsed.code.length === 8 ||
          parsed.code.length === 12 ||
          parsed.code.length === 13);
      if (
        input.parsePolicy === 'strict' &&
        failedKnownChecksum
      ) {
        return null;
      }

      // GS1 layouts carry the SKU in the first 5 digits after the role
      // prefix; non-GS1 codes look up the verbatim string.
      const lookupCode = parsed.lookupCode;

      const item = await ctx.db
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
            eq(products.barcode, lookupCode)
          )
        )
        .get();

      if (!item) {
        return null;
      }

      const assignmentsMap = await getUnitAssignmentsByProductIds(ctx.db, [item.id]);
      const unitAssignments = assignmentsMap.get(item.id) ?? [];
      const baseUnit = unitAssignments.find(a => a.isBase) ?? unitAssignments[0];

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
        // GS1 weight/price overrides for the cart line. Renderer uses
        // these verbatim when present; otherwise it falls back to
        // `quantity = 1` and the product's base unit price.
        suggestedQuantity: parsed.weightKg ?? null,
        suggestedPrice: parsed.priceMajor ?? null,
      };
    }),
};
