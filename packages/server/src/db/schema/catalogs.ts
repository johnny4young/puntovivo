/**
 * Drizzle schema — catalogs domain.
 *
 * ENG-178 — relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/catalogs
 */
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { nowIso, sequentialDocumentTypeEnum, sqliteNow, unitDimensionEnum } from './base.js';
import { sites, tenants } from './auth.js';
import { categoryXProvider, productXProvider, products, unitXProduct } from './products.js';
import { orderItems, orders, purchaseItems, purchases } from './purchasing.js';
import { saleItems } from './salesAux.js';

// ============================================================================
// COUNTRIES
// ============================================================================

/** A country is the top-level geographic catalog used to group departments and cities for business addresses. */
export const countries = sqliteTable(
  'countries',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_countries_tenant').on(table.tenantId),
    uniqueIndex('idx_countries_tenant_code').on(table.tenantId, table.code),
    uniqueIndex('idx_countries_tenant_name').on(table.tenantId, table.name),
  ]
);

export const countriesRelations = relations(countries, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [countries.tenantId],
    references: [tenants.id],
  }),
  departments: many(departments),
}));

// ============================================================================
// DEPARTMENTS
// ============================================================================

/** A department is a tenant-owned geographic region or state used to organize cities and supplier addresses. */
export const departments = sqliteTable(
  'departments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    countryId: text('country_id').references(() => countries.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_departments_tenant').on(table.tenantId),
    uniqueIndex('idx_departments_tenant_code').on(table.tenantId, table.code),
    uniqueIndex('idx_departments_tenant_name').on(table.tenantId, table.name),
  ]
);

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [departments.tenantId],
    references: [tenants.id],
  }),
  country: one(countries, {
    fields: [departments.countryId],
    references: [countries.id],
  }),
  cities: many(cities),
}));

// ============================================================================
// CITIES
// ============================================================================

/** A city is a tenant-owned geographic catalog entry used by providers and other business records that need a normalized municipality. */
export const cities = sqliteTable(
  'cities',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    departmentId: text('department_id')
      .notNull()
      .references(() => departments.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_cities_tenant').on(table.tenantId),
    index('idx_cities_department').on(table.departmentId),
    uniqueIndex('idx_cities_tenant_code').on(table.tenantId, table.code),
    uniqueIndex('idx_cities_scope_name').on(table.tenantId, table.departmentId, table.name),
  ]
);

export const citiesRelations = relations(cities, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [cities.tenantId],
    references: [tenants.id],
  }),
  department: one(departments, {
    fields: [cities.departmentId],
    references: [departments.id],
  }),
  providers: many(providers),
}));

// ============================================================================
// PROVIDERS
// ============================================================================

/** A provider is a supplier from whom the business purchases products or inventory. */
export const providers = sqliteTable(
  'providers',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    taxId: text('tax_id'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    cityId: text('city_id'),
    contactName: text('contact_name'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    // ENG-177a — optimistic-concurrency guard (see products.version).
    version: integer('version').notNull().default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_providers_tenant').on(table.tenantId),
    uniqueIndex('idx_providers_tenant_name').on(table.tenantId, table.name),
  ]
);

export const providersRelations = relations(providers, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [providers.tenantId],
    references: [tenants.id],
  }),
  city: one(cities, {
    fields: [providers.cityId],
    references: [cities.id],
  }),
  products: many(products),
  productAssignments: many(productXProvider),
  categoryAssignments: many(categoryXProvider),
  purchases: many(purchases),
  orders: many(orders),
}));

// ============================================================================
// UNITS
// ============================================================================

/** A unit defines how products are measured or sold, such as piece, box, kilogram, or pack. */
export const units = sqliteTable(
  'units',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    abbreviation: text('abbreviation').notNull(),
    // Auditoría 2026-07 — units foundation. All three are additive/nullable
    // so every legacy row round-trips untouched.
    //
    // `dimension` groups units by physical quantity (mass/volume/…), so a
    // product's unit set can be validated for coherence and reported on.
    dimension: text('dimension', { enum: unitDimensionEnum }),
    // `standardCode` is the UN/ECE Recommendation 20 unit-of-measure code
    // (KGM, LTR, MTR, GRM, H87 for piece…). LatAm fiscal e-invoicing — the
    // Colombian DIAN UBL invoice among them — requires a standardized
    // `unitCode` per line; a free-form tenant abbreviation cannot map to it
    // reliably, so this column is the fiscal hook.
    standardCode: text('standard_code'),
    // `referenceFactor` is the multiplier that converts ONE of this unit
    // into its dimension's canonical reference unit (mass→gram, volume→
    // millilitre, length→metre, count→unit): KGM=1000, GRM=1, LTR=1000,
    // MLT=1. Enables dimension-wide conversion without per-product factors;
    // null keeps the legacy per-product `unit_x_product.equivalence` path.
    referenceFactor: real('reference_factor'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_units_tenant').on(table.tenantId),
    uniqueIndex('idx_units_tenant_abbreviation').on(table.tenantId, table.abbreviation),
    index('idx_units_dimension').on(table.dimension),
  ]
);

export const unitsRelations = relations(units, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [units.tenantId],
    references: [tenants.id],
  }),
  productUnits: many(unitXProduct),
  purchaseItems: many(purchaseItems),
  orderItems: many(orderItems),
  saleItems: many(saleItems),
}));

// ============================================================================
// VAT RATES
// ============================================================================

/** A VAT rate represents the tax percentage used to price and report products and sales lines. */
export const vatRates = sqliteTable(
  'vat_rates',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    rate: real('rate').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_vat_rates_tenant').on(table.tenantId),
    uniqueIndex('idx_vat_rates_tenant_name').on(table.tenantId, table.name),
  ]
);

export const vatRatesRelations = relations(vatRates, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [vatRates.tenantId],
    references: [tenants.id],
  }),
  products: many(products),
}));

// ============================================================================
// SEQUENTIALS
// ============================================================================

/** A sequential stores the next document number configuration for a site and document type such as sales, purchases, or orders. */
export const sequentials = sqliteTable(
  'sequentials',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    documentType: text('document_type', { enum: sequentialDocumentTypeEnum }).notNull(),
    prefix: text('prefix').notNull().default(''),
    currentValue: integer('current_value').notNull().default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_sequentials_tenant').on(table.tenantId),
    index('idx_sequentials_site').on(table.siteId),
    uniqueIndex('idx_sequentials_scope').on(table.tenantId, table.siteId, table.documentType),
  ]
);

export const sequentialsRelations = relations(sequentials, ({ one }) => ({
  tenant: one(tenants, {
    fields: [sequentials.tenantId],
    references: [tenants.id],
  }),
  site: one(sites, {
    fields: [sequentials.siteId],
    references: [sites.id],
  }),
}));

// ============================================================================
// CATEGORIES
// ============================================================================

/** A category groups products for organization, filtering, reporting, and optional parent-child catalog structure. */
export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    description: text('description'),
    parentId: text('parent_id'),
    // ENG-177a — optimistic-concurrency guard (see products.version).
    version: integer('version').notNull().default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_categories_tenant').on(table.tenantId),
    index('idx_categories_parent').on(table.parentId),
  ]
);

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [categories.tenantId],
    references: [tenants.id],
  }),
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'categoryParent',
  }),
  children: many(categories, { relationName: 'categoryParent' }),
  products: many(products),
  providerAssignments: many(categoryXProvider),
}));

// ============================================================================
// LOCATIONS
// ============================================================================

/** A location is an internal stock placement or warehouse zone used to identify where products are stored inside the business. */
export const locations = sqliteTable(
  'locations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_locations_tenant').on(table.tenantId),
    uniqueIndex('idx_locations_tenant_code').on(table.tenantId, table.code),
    uniqueIndex('idx_locations_tenant_name').on(table.tenantId, table.name),
  ]
);

export const locationsRelations = relations(locations, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [locations.tenantId],
    references: [tenants.id],
  }),
  siteAssignments: many(locationXSite),
}));

// ============================================================================
// LOCATION X SITE
// ============================================================================

export const locationXSite = sqliteTable(
  'location_x_site',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_location_x_site_tenant').on(table.tenantId),
    index('idx_location_x_site_location').on(table.locationId),
    index('idx_location_x_site_site').on(table.siteId),
    uniqueIndex('idx_location_x_site_scope').on(table.tenantId, table.locationId, table.siteId),
  ]
);

export const locationXSiteRelations = relations(locationXSite, ({ one }) => ({
  tenant: one(tenants, {
    fields: [locationXSite.tenantId],
    references: [tenants.id],
  }),
  location: one(locations, {
    fields: [locationXSite.locationId],
    references: [locations.id],
  }),
  site: one(sites, {
    fields: [locationXSite.siteId],
    references: [sites.id],
  }),
}));
