/**
 * Drizzle schema — products domain.
 *
 * ENG-178 — relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/products
 */
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { moneyPositiveChecks, nowIso, sqliteNow, syncStatusEnum } from './base.js';
import { tenants } from './auth.js';
import { categories, locations, providers, units, vatRates } from './catalogs.js';
import { orderItems, purchaseItems } from './purchasing.js';
import { saleItems } from './salesAux.js';
import { initialInventory, inventoryBalances, inventoryMovements } from './inventory.js';
import { currencyCatalog } from './config.js';

// ============================================================================
// PRODUCTS
// ============================================================================

export const productCatalogTypeEnum = ['standard', 'variant_parent', 'variant'] as const;
export type ProductCatalogType = (typeof productCatalogTypeEnum)[number];
export type ProductVariantAxis = { name: string; values: string[] };
export type ProductVariantValues = Record<string, string>;

/** A product is a sellable and purchasable inventory item managed by the tenant, including pricing, stock, tax, and catalog metadata. */
export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    sku: text('sku').notNull(),
    description: text('description'),
    categoryId: text('category_id').references(() => categories.id),
    price: real('price').notNull().default(0),
    price2: real('price2').notNull().default(0),
    price3: real('price3').notNull().default(0),
    cost: real('cost').notNull().default(0),
    marginPercent1: real('margin_percent1').notNull().default(0),
    marginPercent2: real('margin_percent2').notNull().default(0),
    marginPercent3: real('margin_percent3').notNull().default(0),
    marginAmount1: real('margin_amount1').notNull().default(0),
    marginAmount2: real('margin_amount2').notNull().default(0),
    marginAmount3: real('margin_amount3').notNull().default(0),
    taxRate: real('tax_rate').notNull().default(0),
    vatRateId: text('vat_rate_id').references(() => vatRates.id),
    providerId: text('provider_id').references(() => providers.id),
    locationId: text('location_id'),
    initialCost: real('initial_cost').notNull().default(0),
    // ENG-176b — currency for every monetary column on this row (price /
    // price2 / price3 / cost / margin amounts / initialCost). Default
    // 'COP' for backfill; the application sets this from
    // `resolveTenantCurrency(ctx.tenantId)` or from the operator's
    // explicit override in product create/update (imported products
    // priced in USD inside a COP tenant).
    currencyCode: text('currency_code')
      .notNull()
      .default('COP')
      .references(() => currencyCatalog.code),
    // Auditoría 2026-07 — the denormalized tenant-wide `stock` column was
    // removed. `inventory_balances.on_hand` (per site) is the single source of
    // truth; the tenant-wide total is derived as Σ(on_hand) on read (see
    // `services/inventory-balances/derive.ts`). `min_stock` remains: it is a
    // per-product reorder threshold, not a stock quantity.
    // `min_stock` is `real` so ferreterías (2.5 m cable) and supermarkets
    // (0.75 kg produce) can set fractional reorder points.
    minStock: real('min_stock').notNull().default(0),
    sellByFraction: integer('sell_by_fraction', { mode: 'boolean' }).notNull().default(false),
    fractionStep: real('fraction_step'),
    fractionMinimum: real('fraction_minimum'),
    // Auditoría 2026-07 — lots & costing opt-in. When true, receipts create
    // `inventory_lots` rows and consumption is FEFO with per-lot COGS; when
    // false (default) the product keeps the single-number stock path. Additive
    // and backward-compatible.
    tracksLots: integer('tracks_lots', { mode: 'boolean' }).notNull().default(false),
    // ENG-110c — individually serialized inventory is opt-in. Aggregate
    // writers fail closed for these products; stock enters through the
    // serial receipt workflow and leaves through explicit POS selection.
    tracksSerials: integer('tracks_serials', { mode: 'boolean' }).notNull().default(false),
    // ENG-110b — matrix parents are catalog-only templates. Every sellable
    // combination remains a normal product row (`catalog_type = variant`) so
    // the existing productId-based sales, inventory and purchase paths keep
    // their mature invariants without a parallel variant stock model.
    catalogType: text('catalog_type', { enum: productCatalogTypeEnum })
      .notNull()
      .default('standard'),
    variantParentId: text('variant_parent_id').references((): AnySQLiteColumn => products.id, {
      onDelete: 'restrict',
    }),
    variantAxes: text('variant_axes', { mode: 'json' }).$type<ProductVariantAxis[] | null>(),
    variantValues: text('variant_values', { mode: 'json' }).$type<ProductVariantValues | null>(),
    variantSignature: text('variant_signature'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    barcode: text('barcode'),
    imageUrl: text('image_url'),
    // ENG-033 — semantic search support. The vector is JSON-encoded
    // float array (`[0.123, -0.456, ...]`); ~6KB for 1536 dims with
    // text-embedding-3-small. Null until embedded; null also means the
    // tenant has AI disabled and we should fall back to LIKE search.
    embedding: text('embedding'),
    embeddingModel: text('embedding_model'),
    embeddedAt: text('embedded_at'),
    // ENG-177a — optimistic-concurrency guard. Bumped on every catalog
    // UPDATE; a stale client version raises STALE_VERSION. Mirrors
    // users.session_version. Distinct from sync_version (sync-outbox replay).
    version: integer('version').notNull().default(0),
    // Sync fields
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_products_tenant').on(table.tenantId),
    index('idx_products_sku').on(table.sku),
    index('idx_products_barcode').on(table.barcode),
    index('idx_products_category').on(table.categoryId),
    index('idx_products_provider').on(table.providerId),
    index('idx_products_vat_rate').on(table.vatRateId),
    index('idx_products_variant_parent').on(table.tenantId, table.variantParentId),
    uniqueIndex('idx_products_tenant_sku').on(table.tenantId, table.sku),
    uniqueIndex('idx_products_variant_signature')
      .on(table.tenantId, table.variantParentId, table.variantSignature)
      .where(sql`${table.variantParentId} is not null`),
    // ENG-176a — money invariants. Margin amounts are derived from
    // (cost * margin_percent / 100), so they share the same non-negative
    // contract as cost itself; if a future feature needs a negative
    // margin (loss leader) the schema can be re-categorised then.
    ...moneyPositiveChecks('products_price', table.price),
    ...moneyPositiveChecks('products_price2', table.price2),
    ...moneyPositiveChecks('products_price3', table.price3),
    ...moneyPositiveChecks('products_cost', table.cost),
    ...moneyPositiveChecks('products_margin1', table.marginAmount1),
    ...moneyPositiveChecks('products_margin2', table.marginAmount2),
    ...moneyPositiveChecks('products_margin3', table.marginAmount3),
    ...moneyPositiveChecks('products_init_cost', table.initialCost),
  ]
);

export const productsRelations = relations(products, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [products.tenantId],
    references: [tenants.id],
  }),
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  provider: one(providers, {
    fields: [products.providerId],
    references: [providers.id],
  }),
  location: one(locations, {
    fields: [products.locationId],
    references: [locations.id],
  }),
  vatRate: one(vatRates, {
    fields: [products.vatRateId],
    references: [vatRates.id],
  }),
  purchaseItems: many(purchaseItems),
  orderItems: many(orderItems),
  saleItems: many(saleItems),
  unitAssignments: many(unitXProduct),
  providerAssignments: many(productXProvider),
  inventoryMovements: many(inventoryMovements),
  inventoryBalances: many(inventoryBalances),
  initialInventoryEntries: many(initialInventory),
}));

// ============================================================================
// UNIT X PRODUCT
// ============================================================================

export const unitXProduct = sqliteTable(
  'unit_x_product',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),
    equivalence: real('equivalence').notNull().default(1),
    price: real('price').notNull().default(0),
    isBase: integer('is_base', { mode: 'boolean' }).default(false),
    // Auditoría 2026-07 — packaging-level barcode. GS1 barcodes are
    // per-packaging (a case has its own GTIN distinct from the unit), so a
    // single `products.barcode` cannot represent scanning a case. This
    // additive/nullable column lets each packaging level carry its own
    // scannable code; `lookupByBarcode` resolves it to (product, unit) and
    // the cart adds `equivalence` base units. `products.barcode` stays the
    // base-unit code for back-compat.
    barcode: text('barcode'),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_unit_x_product_product').on(table.productId),
    index('idx_unit_x_product_unit').on(table.unitId),
    index('idx_unit_x_product_barcode').on(table.barcode),
    uniqueIndex('idx_unit_x_product_scope').on(table.productId, table.unitId),
  ]
);

export const unitXProductRelations = relations(unitXProduct, ({ one }) => ({
  product: one(products, {
    fields: [unitXProduct.productId],
    references: [products.id],
  }),
  unit: one(units, {
    fields: [unitXProduct.unitId],
    references: [units.id],
  }),
}));

// ============================================================================
// PRODUCT X PROVIDER
// ============================================================================

export const productXProvider = sqliteTable(
  'product_x_provider',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_product_x_provider_product').on(table.productId),
    index('idx_product_x_provider_provider').on(table.providerId),
    uniqueIndex('idx_product_x_provider_scope').on(table.productId, table.providerId),
  ]
);

export const productXProviderRelations = relations(productXProvider, ({ one }) => ({
  product: one(products, {
    fields: [productXProvider.productId],
    references: [products.id],
  }),
  provider: one(providers, {
    fields: [productXProvider.providerId],
    references: [providers.id],
  }),
}));

// ============================================================================
// CATEGORY X PROVIDER
// ============================================================================

export const categoryXProvider = sqliteTable(
  'category_x_provider',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_category_x_provider_tenant').on(table.tenantId),
    index('idx_category_x_provider_category').on(table.categoryId),
    index('idx_category_x_provider_provider').on(table.providerId),
    uniqueIndex('idx_category_x_provider_scope').on(table.tenantId, table.categoryId, table.providerId),
  ]
);

export const categoryXProviderRelations = relations(categoryXProvider, ({ one }) => ({
  tenant: one(tenants, {
    fields: [categoryXProvider.tenantId],
    references: [tenants.id],
  }),
  category: one(categories, {
    fields: [categoryXProvider.categoryId],
    references: [categories.id],
  }),
  provider: one(providers, {
    fields: [categoryXProvider.providerId],
    references: [providers.id],
  }),
}));
