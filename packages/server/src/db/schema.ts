/**
 * Drizzle ORM Schema for Puntovivo POS System
 *
 * This is the source-of-truth schema for the SQLite database.
 * All tables support multi-tenant isolation via tenant_id.
 *
 * @module db/schema
 */

import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// ============================================================================
// ENUMS (as string literals for SQLite)
// ============================================================================

export const syncStatusEnum = ['pending', 'synced', 'conflict', 'error'] as const;
export const paymentMethodEnum = ['cash', 'card', 'transfer', 'credit', 'other'] as const;
export const paymentStatusEnum = ['pending', 'paid', 'partial', 'refunded'] as const;
export const saleStatusEnum = ['draft', 'completed', 'cancelled', 'voided'] as const;
export const purchaseStatusEnum = ['completed', 'partial_returned', 'returned', 'voided'] as const;
export const orderStatusEnum = ['submitted', 'partial_received', 'received', 'voided'] as const;
export const movementTypeEnum = ['purchase', 'sale', 'adjustment', 'transfer', 'return'] as const;
export const cashSessionStatusEnum = ['open', 'closed'] as const;
export const cashMovementTypeEnum = [
  'sale',
  'refund',
  'paid_in',
  'paid_out',
  'skim',
  'replenishment',
] as const;
export const userRoleEnum = ['admin', 'manager', 'cashier', 'viewer'] as const;
export const sequentialDocumentTypeEnum = ['sale', 'purchase', 'order'] as const;
export const initialInventoryModeEnum = ['initial', 'physical'] as const;

export interface CashSessionDenomination {
  value: number;
  count: number;
}

// ============================================================================
// TENANTS
// ============================================================================

/** A tenant is an independent business account whose operational data must remain isolated from other companies using the system. */
export const tenants = sqliteTable(
  'tenants',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    settings: text('settings', { mode: 'json' }).$type<Record<string, unknown>>().default({}),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [uniqueIndex('idx_tenants_slug').on(table.slug)]
);

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  logos: many(logos),
  companies: many(companies),
  sites: many(sites),
  countries: many(countries),
  departments: many(departments),
  cities: many(cities),
  locations: many(locations),
  locationSiteAssignments: many(locationXSite),
  providers: many(providers),
  identificationTypes: many(identificationTypes),
  personTypes: many(personTypes),
  regimeTypes: many(regimeTypes),
  clientTypes: many(clientTypes),
  commercialActivities: many(commercialActivities),
  units: many(units),
  vatRates: many(vatRates),
  sequentials: many(sequentials),
  products: many(products),
  categories: many(categories),
  categoryProviderAssignments: many(categoryXProvider),
  customers: many(customers),
  purchases: many(purchases),
  purchaseReturns: many(purchaseReturns),
  orders: many(orders),
  sales: many(sales),
  saleReturns: many(saleReturns),
  cashSessions: many(cashSessions),
  cashMovements: many(cashMovements),
  inventoryMovements: many(inventoryMovements),
  inventoryBalances: many(inventoryBalances),
  initialInventoryEntries: many(initialInventory),
  denominationTemplates: many(denominationTemplates),
}));

// ============================================================================
// USERS
// ============================================================================

/** A user is an internal operator of a tenant, such as an admin, manager, or cashier, who works inside the business. */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    sessionVersion: integer('session_version').notNull().default(1),
    role: text('role', { enum: userRoleEnum }).notNull().default('cashier'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_users_tenant').on(table.tenantId),
    uniqueIndex('idx_users_email').on(table.email),
  ]
);

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
  purchases: many(purchases),
  purchaseReturns: many(purchaseReturns),
  orders: many(orders),
  sales: many(sales),
  saleReturns: many(saleReturns),
  cashSessions: many(cashSessions),
  cashMovements: many(cashMovements),
  inventoryMovements: many(inventoryMovements),
  initialInventoryEntries: many(initialInventory),
}));

// ============================================================================
// LOGOS
// ============================================================================

/** A logo is a reusable branding asset owned by a tenant and selectable by the company profile for receipts and identity. */
export const logos = sqliteTable(
  'logos',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    imageUrl: text('image_url').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_logos_tenant').on(table.tenantId),
    uniqueIndex('idx_logos_tenant_name').on(table.tenantId, table.name),
  ]
);

export const logosRelations = relations(logos, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [logos.tenantId],
    references: [tenants.id],
  }),
  companies: many(companies),
}));

// ============================================================================
// COMPANIES
// ============================================================================

/** A company is the legal or commercial entity represented by a tenant for tax, branding, and organizational purposes. */
export const companies = sqliteTable(
  'companies',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    taxId: text('tax_id'),
    address: text('address'),
    phone: text('phone'),
    email: text('email'),
    logoId: text('logo_id').references(() => logos.id),
    logoUrl: text('logo_url'),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_companies_tenant').on(table.tenantId),
    index('idx_companies_logo').on(table.logoId),
    uniqueIndex('idx_companies_tenant_name').on(table.tenantId, table.name),
  ]
);

export const companiesRelations = relations(companies, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [companies.tenantId],
    references: [tenants.id],
  }),
  logo: one(logos, {
    fields: [companies.logoId],
    references: [logos.id],
  }),
  sites: many(sites),
}));

// ============================================================================
// SITES
// ============================================================================

/** A site is a physical branch, store, warehouse, or operating location where business documents and stock activity can occur. */
export const sites = sqliteTable(
  'sites',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id),
    name: text('name').notNull(),
    address: text('address'),
    phone: text('phone'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_sites_tenant').on(table.tenantId),
    index('idx_sites_company').on(table.companyId),
    uniqueIndex('idx_sites_tenant_name').on(table.tenantId, table.name),
  ]
);

export const sitesRelations = relations(sites, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [sites.tenantId],
    references: [tenants.id],
  }),
  company: one(companies, {
    fields: [sites.companyId],
    references: [companies.id],
  }),
  locationAssignments: many(locationXSite),
  sequentials: many(sequentials),
  purchases: many(purchases),
  orders: many(orders),
  cashSessions: many(cashSessions),
  denominationTemplates: many(denominationTemplates),
  initialInventoryEntries: many(initialInventory),
  inventoryBalances: many(inventoryBalances),
}));

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
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
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
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
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
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
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
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
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
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_units_tenant').on(table.tenantId),
    uniqueIndex('idx_units_tenant_abbreviation').on(table.tenantId, table.abbreviation),
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
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
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
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
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
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
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
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
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
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
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

// ============================================================================
// PRODUCTS
// ============================================================================

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
    // Phase 1 DB-050: stock is `real` so ferreterías (2.5 m cable)
    // and supermarkets (0.75 kg produce) can sell by fraction. Existing
    // integer values round-trip unchanged because SQLite stores both in the
    // same numeric affinity — this is additive relaxation, not a breaking
    // change.
    stock: real('stock').notNull().default(0),
    minStock: real('min_stock').notNull().default(0),
    sellByFraction: integer('sell_by_fraction', { mode: 'boolean' }).notNull().default(false),
    fractionStep: real('fraction_step'),
    fractionMinimum: real('fraction_minimum'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    barcode: text('barcode'),
    imageUrl: text('image_url'),
    // Sync fields
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_products_tenant').on(table.tenantId),
    index('idx_products_sku').on(table.sku),
    index('idx_products_barcode').on(table.barcode),
    index('idx_products_category').on(table.categoryId),
    index('idx_products_provider').on(table.providerId),
    index('idx_products_vat_rate').on(table.vatRateId),
    uniqueIndex('idx_products_tenant_sku').on(table.tenantId, table.sku),
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
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_unit_x_product_product').on(table.productId),
    index('idx_unit_x_product_unit').on(table.unitId),
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
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
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
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
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

// ============================================================================
// CUSTOMER REFERENCE CATALOGS
// ============================================================================

/** Identification types classify the tax or legal document used by a customer, such as national ID or tax ID. */
export const identificationTypes = sqliteTable(
  'identification_types',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_identification_types_tenant').on(table.tenantId),
    uniqueIndex('idx_identification_types_tenant_code').on(table.tenantId, table.code),
    uniqueIndex('idx_identification_types_tenant_name').on(table.tenantId, table.name),
  ]
);

export const identificationTypesRelations = relations(identificationTypes, ({ one }) => ({
  tenant: one(tenants, {
    fields: [identificationTypes.tenantId],
    references: [tenants.id],
  }),
}));

/** Person types classify whether a customer is treated as a natural person or a legal entity. */
export const personTypes = sqliteTable(
  'person_types',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_person_types_tenant').on(table.tenantId),
    uniqueIndex('idx_person_types_tenant_code').on(table.tenantId, table.code),
    uniqueIndex('idx_person_types_tenant_name').on(table.tenantId, table.name),
  ]
);

export const personTypesRelations = relations(personTypes, ({ one }) => ({
  tenant: one(tenants, {
    fields: [personTypes.tenantId],
    references: [tenants.id],
  }),
}));

/** Regime types classify the fiscal or tax regime assigned to a customer. */
export const regimeTypes = sqliteTable(
  'regime_types',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_regime_types_tenant').on(table.tenantId),
    uniqueIndex('idx_regime_types_tenant_code').on(table.tenantId, table.code),
    uniqueIndex('idx_regime_types_tenant_name').on(table.tenantId, table.name),
  ]
);

export const regimeTypesRelations = relations(regimeTypes, ({ one }) => ({
  tenant: one(tenants, {
    fields: [regimeTypes.tenantId],
    references: [tenants.id],
  }),
}));

/** Client types classify a customer commercially, such as retail or wholesale; they are attributes of customers, not separate business parties. */
export const clientTypes = sqliteTable(
  'client_types',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_client_types_tenant').on(table.tenantId),
    uniqueIndex('idx_client_types_tenant_code').on(table.tenantId, table.code),
    uniqueIndex('idx_client_types_tenant_name').on(table.tenantId, table.name),
  ]
);

export const clientTypesRelations = relations(clientTypes, ({ one }) => ({
  tenant: one(tenants, {
    fields: [clientTypes.tenantId],
    references: [tenants.id],
  }),
}));

/** Commercial activities classify the main business or economic activity associated with a customer for fiscal and reporting use. */
export const commercialActivities = sqliteTable(
  'commercial_activities',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_commercial_activities_tenant').on(table.tenantId),
    uniqueIndex('idx_commercial_activities_tenant_code').on(table.tenantId, table.code),
    uniqueIndex('idx_commercial_activities_tenant_name').on(table.tenantId, table.name),
  ]
);

export const commercialActivitiesRelations = relations(commercialActivities, ({ one }) => ({
  tenant: one(tenants, {
    fields: [commercialActivities.tenantId],
    references: [tenants.id],
  }),
}));

// ============================================================================
// CUSTOMERS
// ============================================================================

/** A customer is the business party that buys from the tenant; the same real-world party may exist separately in multiple tenants. */
export const customers = sqliteTable(
  'customers',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    address: text('address'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    country: text('country'),
    taxId: text('tax_id'),
    identificationTypeId: text('identification_type_id'),
    personTypeId: text('person_type_id'),
    regimeTypeId: text('regime_type_id'),
    clientTypeId: text('client_type_id'),
    commercialActivityId: text('commercial_activity_id'),
    notes: text('notes'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    // Sync fields
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_customers_tenant').on(table.tenantId),
    index('idx_customers_email').on(table.email),
  ]
);

export const customersRelations = relations(customers, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [customers.tenantId],
    references: [tenants.id],
  }),
  sales: many(sales),
}));

// ============================================================================
// PURCHASES
// ============================================================================

/** A purchase records inventory that was actually received from a provider and therefore affects stock and product cost. */
export const purchases = sqliteTable(
  'purchases',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    purchaseNumber: text('purchase_number').notNull(),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id),
    orderId: text('order_id').references(() => orders.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    status: text('status', { enum: purchaseStatusEnum }).notNull().default('completed'),
    subtotal: real('subtotal').notNull().default(0),
    total: real('total').notNull().default(0),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_purchases_tenant').on(table.tenantId),
    index('idx_purchases_provider').on(table.providerId),
    index('idx_purchases_order').on(table.orderId),
    index('idx_purchases_site').on(table.siteId),
    index('idx_purchases_created_by').on(table.createdBy),
    uniqueIndex('idx_purchases_tenant_number').on(table.tenantId, table.purchaseNumber),
  ]
);

export const purchasesRelations = relations(purchases, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [purchases.tenantId],
    references: [tenants.id],
  }),
  provider: one(providers, {
    fields: [purchases.providerId],
    references: [providers.id],
  }),
  sourceOrder: one(orders, {
    fields: [purchases.orderId],
    references: [orders.id],
  }),
  site: one(sites, {
    fields: [purchases.siteId],
    references: [sites.id],
  }),
  createdByUser: one(users, {
    fields: [purchases.createdBy],
    references: [users.id],
  }),
  items: many(purchaseItems),
  returns: many(purchaseReturns),
}));

// ============================================================================
// PURCHASE ITEMS
// ============================================================================

export const purchaseItems = sqliteTable(
  'purchase_items',
  {
    id: text('id').primaryKey(),
    purchaseId: text('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    sourceOrderItemId: text('source_order_item_id').references(() => orderItems.id),
    quantity: real('quantity').notNull().default(1),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),
    unitEquivalence: real('unit_equivalence').notNull().default(1),
    costPerUnit: real('cost_per_unit').notNull().default(0),
    baseUnitCost: real('base_unit_cost').notNull().default(0),
    total: real('total').notNull().default(0),
  },
  table => [
    index('idx_purchase_items_purchase').on(table.purchaseId),
    index('idx_purchase_items_product').on(table.productId),
    index('idx_purchase_items_source_order_item').on(table.sourceOrderItemId),
  ]
);

export const purchaseItemsRelations = relations(purchaseItems, ({ one, many }) => ({
  purchase: one(purchases, {
    fields: [purchaseItems.purchaseId],
    references: [purchases.id],
  }),
  product: one(products, {
    fields: [purchaseItems.productId],
    references: [products.id],
  }),
  sourceOrderItem: one(orderItems, {
    fields: [purchaseItems.sourceOrderItemId],
    references: [orderItems.id],
  }),
  unit: one(units, {
    fields: [purchaseItems.unitId],
    references: [units.id],
  }),
  returnItems: many(purchaseReturnItems),
}));

// ============================================================================
// PURCHASE RETURNS
// ============================================================================

/** A purchase return records goods sent back to a provider after receipt, reducing stock while preserving the original purchase as history. */
export const purchaseReturns = sqliteTable(
  'purchase_returns',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    purchaseId: text('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    returnAmount: real('return_amount').notNull().default(0),
    reason: text('reason'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_purchase_returns_tenant').on(table.tenantId),
    index('idx_purchase_returns_purchase').on(table.purchaseId),
    index('idx_purchase_returns_created_by').on(table.createdBy),
  ]
);

export const purchaseReturnsRelations = relations(purchaseReturns, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [purchaseReturns.tenantId],
    references: [tenants.id],
  }),
  purchase: one(purchases, {
    fields: [purchaseReturns.purchaseId],
    references: [purchases.id],
  }),
  createdByUser: one(users, {
    fields: [purchaseReturns.createdBy],
    references: [users.id],
  }),
  items: many(purchaseReturnItems),
}));

// ============================================================================
// PURCHASE RETURN ITEMS
// ============================================================================

export const purchaseReturnItems = sqliteTable(
  'purchase_return_items',
  {
    id: text('id').primaryKey(),
    purchaseReturnId: text('purchase_return_id')
      .notNull()
      .references(() => purchaseReturns.id, { onDelete: 'cascade' }),
    purchaseItemId: text('purchase_item_id')
      .notNull()
      .references(() => purchaseItems.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    quantity: real('quantity').notNull().default(1),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),
    unitEquivalence: real('unit_equivalence').notNull().default(1),
    costPerUnit: real('cost_per_unit').notNull().default(0),
    baseUnitCost: real('base_unit_cost').notNull().default(0),
    total: real('total').notNull().default(0),
  },
  table => [
    index('idx_purchase_return_items_return').on(table.purchaseReturnId),
    index('idx_purchase_return_items_purchase_item').on(table.purchaseItemId),
    index('idx_purchase_return_items_product').on(table.productId),
  ]
);

export const purchaseReturnItemsRelations = relations(purchaseReturnItems, ({ one }) => ({
  purchaseReturn: one(purchaseReturns, {
    fields: [purchaseReturnItems.purchaseReturnId],
    references: [purchaseReturns.id],
  }),
  purchaseItem: one(purchaseItems, {
    fields: [purchaseReturnItems.purchaseItemId],
    references: [purchaseItems.id],
  }),
  product: one(products, {
    fields: [purchaseReturnItems.productId],
    references: [products.id],
  }),
  unit: one(units, {
    fields: [purchaseReturnItems.unitId],
    references: [units.id],
  }),
}));

// ============================================================================
// ORDERS
// ============================================================================

/** An order records a purchase request sent to a provider before goods are received; it plans buying but does not move stock by itself. */
export const orders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    orderNumber: text('order_number').notNull(),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    status: text('status', { enum: orderStatusEnum }).notNull().default('submitted'),
    subtotal: real('subtotal').notNull().default(0),
    total: real('total').notNull().default(0),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_orders_tenant').on(table.tenantId),
    index('idx_orders_provider').on(table.providerId),
    index('idx_orders_site').on(table.siteId),
    index('idx_orders_created_by').on(table.createdBy),
    uniqueIndex('idx_orders_tenant_number').on(table.tenantId, table.orderNumber),
  ]
);

export const ordersRelations = relations(orders, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [orders.tenantId],
    references: [tenants.id],
  }),
  provider: one(providers, {
    fields: [orders.providerId],
    references: [providers.id],
  }),
  site: one(sites, {
    fields: [orders.siteId],
    references: [sites.id],
  }),
  createdByUser: one(users, {
    fields: [orders.createdBy],
    references: [users.id],
  }),
  linkedPurchases: many(purchases),
  items: many(orderItems),
}));

// ============================================================================
// ORDER ITEMS
// ============================================================================

export const orderItems = sqliteTable(
  'order_items',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    quantity: real('quantity').notNull().default(1),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),
    unitEquivalence: real('unit_equivalence').notNull().default(1),
    costPerUnit: real('cost_per_unit').notNull().default(0),
    baseUnitCost: real('base_unit_cost').notNull().default(0),
    total: real('total').notNull().default(0),
  },
  table => [
    index('idx_order_items_order').on(table.orderId),
    index('idx_order_items_product').on(table.productId),
  ]
);

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
  unit: one(units, {
    fields: [orderItems.unitId],
    references: [units.id],
  }),
}));

// ============================================================================
// SALES
// ============================================================================

/** A sale records a completed or in-progress commercial transaction through which the tenant sells products to a customer or walk-in buyer. */
export const sales = sqliteTable(
  'sales',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleNumber: text('sale_number').notNull(),
    customerId: text('customer_id').references(() => customers.id),
    subtotal: real('subtotal').notNull().default(0),
    taxAmount: real('tax_amount').notNull().default(0),
    discountAmount: real('discount_amount').notNull().default(0),
    total: real('total').notNull().default(0),
    paymentMethod: text('payment_method', { enum: paymentMethodEnum }).notNull().default('cash'),
    paymentStatus: text('payment_status', { enum: paymentStatusEnum }).notNull().default('pending'),
    status: text('status', { enum: saleStatusEnum }).notNull().default('draft'),
    cashSessionId: text('cash_session_id').references(() => cashSessions.id),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    // Sync fields
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_sales_tenant').on(table.tenantId),
    index('idx_sales_customer').on(table.customerId),
    index('idx_sales_cash_session').on(table.cashSessionId),
    index('idx_sales_created_by').on(table.createdBy),
    uniqueIndex('idx_sales_tenant_number').on(table.tenantId, table.saleNumber),
  ]
);

export const salesRelations = relations(sales, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [sales.tenantId],
    references: [tenants.id],
  }),
  customer: one(customers, {
    fields: [sales.customerId],
    references: [customers.id],
  }),
  createdByUser: one(users, {
    fields: [sales.createdBy],
    references: [users.id],
  }),
  cashSession: one(cashSessions, {
    fields: [sales.cashSessionId],
    references: [cashSessions.id],
  }),
  items: many(saleItems),
  returns: many(saleReturns),
  payments: many(salePayments),
}));

// ============================================================================
// CASH SESSIONS
// ============================================================================

/** A cash session tracks the opening float, running expected balance, and reconciliation state for a cashier on a specific register/site. */
export const cashSessions = sqliteTable(
  'cash_sessions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    cashierId: text('cashier_id')
      .notNull()
      .references(() => users.id),
    registerName: text('register_name').notNull(),
    openingFloat: real('opening_float').notNull().default(0),
    openingCountDenominations: text('opening_count_denominations', { mode: 'json' })
      .$type<CashSessionDenomination[]>()
      .notNull(),
    expectedBalance: real('expected_balance').notNull().default(0),
    actualCount: real('actual_count'),
    actualCountDenominations: text('actual_count_denominations', { mode: 'json' })
      .$type<CashSessionDenomination[] | null>(),
    overShort: real('over_short'),
    status: text('status', { enum: cashSessionStatusEnum }).notNull().default('open'),
    openedAt: text('opened_at').notNull().default(new Date().toISOString()),
    closedAt: text('closed_at'),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_cash_sessions_tenant').on(table.tenantId),
    index('idx_cash_sessions_site').on(table.siteId),
    index('idx_cash_sessions_cashier').on(table.cashierId),
    index('idx_cash_sessions_status').on(table.status),
    index('idx_cash_sessions_site_status').on(table.siteId, table.status),
    index('idx_cash_sessions_register_status').on(table.siteId, table.registerName, table.status),
  ]
);

export const cashSessionsRelations = relations(cashSessions, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [cashSessions.tenantId],
    references: [tenants.id],
  }),
  site: one(sites, {
    fields: [cashSessions.siteId],
    references: [sites.id],
  }),
  cashier: one(users, {
    fields: [cashSessions.cashierId],
    references: [users.id],
  }),
  movements: many(cashMovements),
  sales: many(sales),
}));

/** A denomination template stores the standard opening float breakdown for a site register so cashiers can reopen drawers consistently. */
export const denominationTemplates = sqliteTable(
  'denomination_templates',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    registerName: text('register_name').notNull(),
    label: text('label').notNull(),
    openingFloat: real('opening_float').notNull().default(0),
    denominations: text('denominations', { mode: 'json' })
      .$type<CashSessionDenomination[]>()
      .notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_denomination_templates_tenant').on(table.tenantId),
    index('idx_denomination_templates_site').on(table.siteId),
    index('idx_denomination_templates_site_active').on(table.siteId, table.isActive, table.sortOrder),
    uniqueIndex('idx_denomination_templates_site_register').on(table.siteId, table.registerName),
  ]
);

export const denominationTemplatesRelations = relations(denominationTemplates, ({ one }) => ({
  tenant: one(tenants, {
    fields: [denominationTemplates.tenantId],
    references: [tenants.id],
  }),
  site: one(sites, {
    fields: [denominationTemplates.siteId],
    references: [sites.id],
  }),
}));

/** A cash movement records each inflow/outflow linked to an open session so expected drawer balance stays auditable throughout the shift. */
export const cashMovements = sqliteTable(
  'cash_movements',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => cashSessions.id, { onDelete: 'cascade' }),
    type: text('type', { enum: cashMovementTypeEnum }).notNull(),
    amount: real('amount').notNull().default(0),
    referenceId: text('reference_id'),
    note: text('note'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_cash_movements_tenant').on(table.tenantId),
    index('idx_cash_movements_session').on(table.sessionId),
    index('idx_cash_movements_type').on(table.type),
    index('idx_cash_movements_created_by').on(table.createdBy),
    index('idx_cash_movements_session_created').on(table.sessionId, table.createdAt),
  ]
);

export const cashMovementsRelations = relations(cashMovements, ({ one }) => ({
  tenant: one(tenants, {
    fields: [cashMovements.tenantId],
    references: [tenants.id],
  }),
  session: one(cashSessions, {
    fields: [cashMovements.sessionId],
    references: [cashSessions.id],
  }),
  createdByUser: one(users, {
    fields: [cashMovements.createdBy],
    references: [users.id],
  }),
}));

// ============================================================================
// SALE ITEMS
// ============================================================================

export const saleItems = sqliteTable(
  'sale_items',
  {
    id: text('id').primaryKey(),
    saleId: text('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    quantity: real('quantity').notNull().default(1),
    unitPrice: real('unit_price').notNull().default(0),
    unitId: text('unit_id').references(() => units.id),
    unitEquivalence: real('unit_equivalence').notNull().default(1),
    discount: real('discount').notNull().default(0),
    taxRate: real('tax_rate').notNull().default(0),
    taxAmount: real('tax_amount').notNull().default(0),
    costAtSale: real('cost_at_sale').notNull().default(0),
    total: real('total').notNull().default(0),
  },
  table => [
    index('idx_sale_items_sale').on(table.saleId),
    index('idx_sale_items_product').on(table.productId),
  ]
);

export const saleItemsRelations = relations(saleItems, ({ one }) => ({
  sale: one(sales, {
    fields: [saleItems.saleId],
    references: [sales.id],
  }),
  product: one(products, {
    fields: [saleItems.productId],
    references: [products.id],
  }),
  unit: one(units, {
    fields: [saleItems.unitId],
    references: [units.id],
  }),
}));

// ============================================================================
// SALE PAYMENTS (Phase 2 Tier-2 step 5 — multi-tender / split payments)
// ============================================================================

/**
 * A sale payment records one tender applied to a sale. A single-tender sale
 * has exactly one row here (legacy flow is normalized into the table on
 * `sales.create`). Split-payment sales have multiple rows whose `amount` sums
 * to the sale's `total`. The `method` enum is the same as `sales.paymentMethod`
 * so classic reports keep working against either surface.
 */
export const salePayments = sqliteTable(
  'sale_payments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleId: text('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    method: text('method', { enum: paymentMethodEnum }).notNull(),
    amount: real('amount').notNull(),
    /**
     * Optional free-form reference (e.g. card authorization code, transfer
     * receipt number). Not a FK — it's purely descriptive audit context.
     */
    reference: text('reference'),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_sale_payments_tenant').on(table.tenantId),
    index('idx_sale_payments_sale').on(table.saleId),
    index('idx_sale_payments_method').on(table.method),
  ]
);

export const salePaymentsRelations = relations(salePayments, ({ one }) => ({
  tenant: one(tenants, {
    fields: [salePayments.tenantId],
    references: [tenants.id],
  }),
  sale: one(sales, {
    fields: [salePayments.saleId],
    references: [sales.id],
  }),
}));

// ============================================================================
// SALE RETURNS
// ============================================================================

/** A sale return records a refunded sale after completion, restoring stock while preserving the original sale as historical evidence. */
export const saleReturns = sqliteTable(
  'sale_returns',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleId: text('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    refundAmount: real('refund_amount').notNull().default(0),
    reason: text('reason'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_sale_returns_tenant').on(table.tenantId),
    index('idx_sale_returns_sale').on(table.saleId),
    index('idx_sale_returns_created_by').on(table.createdBy),
    uniqueIndex('idx_sale_returns_sale_unique').on(table.saleId),
  ]
);

export const saleReturnsRelations = relations(saleReturns, ({ one }) => ({
  tenant: one(tenants, {
    fields: [saleReturns.tenantId],
    references: [tenants.id],
  }),
  sale: one(sales, {
    fields: [saleReturns.saleId],
    references: [sales.id],
  }),
  createdByUser: one(users, {
    fields: [saleReturns.createdBy],
    references: [users.id],
  }),
}));

// ============================================================================
// INVENTORY MOVEMENTS
// ============================================================================

/** An inventory movement is the auditable stock ledger entry that explains why a product's quantity changed. */
export const inventoryMovements = sqliteTable(
  'inventory_movements',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    type: text('type', { enum: movementTypeEnum }).notNull(),
    // Phase 1 DB-050: movements store real quantities (2.5 m, 0.75 kg, …).
    quantity: real('quantity').notNull(),
    previousStock: real('previous_stock').notNull(),
    newStock: real('new_stock').notNull(),
    reference: text('reference'),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    // Sync fields
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_inventory_tenant').on(table.tenantId),
    index('idx_inventory_product').on(table.productId),
    index('idx_inventory_created_by').on(table.createdBy),
  ]
);

export const inventoryMovementsRelations = relations(inventoryMovements, ({ one }) => ({
  tenant: one(tenants, {
    fields: [inventoryMovements.tenantId],
    references: [tenants.id],
  }),
  product: one(products, {
    fields: [inventoryMovements.productId],
    references: [products.id],
  }),
  createdByUser: one(users, {
    fields: [inventoryMovements.createdBy],
    references: [users.id],
  }),
}));

// ============================================================================
// INITIAL INVENTORY
// ============================================================================

/** An initial inventory entry captures opening stock or physical count adjustments used to establish or reconcile stock balances. */
export const initialInventory = sqliteTable(
  'initial_inventory',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),
    siteId: text('site_id').references(() => sites.id),
    mode: text('mode', { enum: initialInventoryModeEnum }).notNull(),
    quantity: real('quantity').notNull(),
    unitEquivalence: real('unit_equivalence').notNull().default(1),
    normalizedQuantity: real('normalized_quantity').notNull(),
    cost: real('cost').notNull().default(0),
    previousStock: real('previous_stock').notNull(),
    newStock: real('new_stock').notNull(),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_initial_inventory_tenant').on(table.tenantId),
    index('idx_initial_inventory_product').on(table.productId),
    index('idx_initial_inventory_unit').on(table.unitId),
    index('idx_initial_inventory_site').on(table.siteId),
    index('idx_initial_inventory_created_by').on(table.createdBy),
  ]
);

export const initialInventoryRelations = relations(initialInventory, ({ one }) => ({
  tenant: one(tenants, {
    fields: [initialInventory.tenantId],
    references: [tenants.id],
  }),
  product: one(products, {
    fields: [initialInventory.productId],
    references: [products.id],
  }),
  unit: one(units, {
    fields: [initialInventory.unitId],
    references: [units.id],
  }),
  site: one(sites, {
    fields: [initialInventory.siteId],
    references: [sites.id],
  }),
  createdByUser: one(users, {
    fields: [initialInventory.createdBy],
    references: [users.id],
  }),
}));

// ============================================================================
// INVENTORY BALANCES (Phase 2 DB-101)
// ============================================================================

/**
 * An inventory balance is the on-hand stock attributed to a specific site for a
 * product. Phase 2 step 0 introduced the (site, product) grain; step 1 made
 * the row authoritative — `transfers.create` is the first write path that
 * mutates it. A future step will add location-level granularity and an
 * in-transit / reserved column for the full transfer lifecycle.
 */
export const inventoryBalances = sqliteTable(
  'inventory_balances',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    onHand: real('on_hand').notNull().default(0),
    reserved: real('reserved').notNull().default(0),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_inventory_balances_tenant').on(table.tenantId),
    index('idx_inventory_balances_site').on(table.siteId),
    index('idx_inventory_balances_product').on(table.productId),
    uniqueIndex('idx_inventory_balances_scope').on(
      table.tenantId,
      table.siteId,
      table.productId
    ),
  ]
);

export const inventoryBalancesRelations = relations(inventoryBalances, ({ one }) => ({
  tenant: one(tenants, {
    fields: [inventoryBalances.tenantId],
    references: [tenants.id],
  }),
  site: one(sites, {
    fields: [inventoryBalances.siteId],
    references: [sites.id],
  }),
  product: one(products, {
    fields: [inventoryBalances.productId],
    references: [products.id],
  }),
}));

// ============================================================================
// TRANSFER ORDERS (Phase 2 DB-102 — immediate step, no ship/receive lifecycle)
// ============================================================================

export const transferOrderStatusEnum = ['completed', 'in_transit', 'void'] as const;

/**
 * A transfer order captures a cross-site stock movement. Phase 2 step 1
 * shipped the immediate `completed` transfer (create + ship + receive
 * collapsed into one atomic step). Step 3 adds the `in_transit` state for
 * deferred-receive transfers — origin is debited on create, destination is
 * credited later via `transfers.receive`. A future step may add an explicit
 * `draft` state if transfers need to be staged without touching balances.
 */
export const transferOrders = sqliteTable(
  'transfer_orders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    fromSiteId: text('from_site_id')
      .notNull()
      .references(() => sites.id),
    toSiteId: text('to_site_id')
      .notNull()
      .references(() => sites.id),
    status: text('status', { enum: transferOrderStatusEnum }).notNull().default('completed'),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    // Phase 2 API-102 step 3: receipt metadata for the in_transit → completed
    // transition. Null on immediate transfers that skip the deferred window.
    receivedAt: text('received_at'),
    receivedBy: text('received_by').references(() => users.id),
    // Phase 2 UI-103: optional note captured by the receiver when they record
    // a variance between shipped and received quantities.
    discrepancyNotes: text('discrepancy_notes'),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_transfer_orders_tenant').on(table.tenantId),
    index('idx_transfer_orders_from_site').on(table.fromSiteId),
    index('idx_transfer_orders_to_site').on(table.toSiteId),
    index('idx_transfer_orders_status').on(table.status),
    index('idx_transfer_orders_received_by').on(table.receivedBy),
  ]
);

export const transferOrderItems = sqliteTable(
  'transfer_order_items',
  {
    id: text('id').primaryKey(),
    transferOrderId: text('transfer_order_id')
      .notNull()
      .references(() => transferOrders.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    quantity: real('quantity').notNull(),
    // Phase 2 UI-103: what the destination actually received. Null for legacy
    // receipts and for lines still in transit; populated on every line at
    // receive time, defaulting to `quantity` when the receiver did not edit.
    receivedQuantity: real('received_quantity'),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_transfer_order_items_order').on(table.transferOrderId),
    index('idx_transfer_order_items_product').on(table.productId),
  ]
);

export const transferOrdersRelations = relations(transferOrders, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [transferOrders.tenantId],
    references: [tenants.id],
  }),
  fromSite: one(sites, {
    fields: [transferOrders.fromSiteId],
    references: [sites.id],
  }),
  toSite: one(sites, {
    fields: [transferOrders.toSiteId],
    references: [sites.id],
  }),
  createdByUser: one(users, {
    fields: [transferOrders.createdBy],
    references: [users.id],
  }),
  items: many(transferOrderItems),
}));

export const transferOrderItemsRelations = relations(transferOrderItems, ({ one }) => ({
  order: one(transferOrders, {
    fields: [transferOrderItems.transferOrderId],
    references: [transferOrders.id],
  }),
  product: one(products, {
    fields: [transferOrderItems.productId],
    references: [products.id],
  }),
}));

// ============================================================================
// SYNC QUEUE (Local operations waiting to be synced)
// ============================================================================

export const syncQueue = sqliteTable(
  'sync_queue',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    entityType: text('entity_type').notNull(), // e.g., 'products', 'sales', 'customers'
    entityId: text('entity_id').notNull(),
    operation: text('operation', { enum: ['create', 'update', 'delete'] as const }).notNull(),
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>(),
    localVersion: integer('local_version').notNull().default(1),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_sync_queue_tenant').on(table.tenantId),
    index('idx_sync_queue_entity').on(table.entityType, table.entityId),
  ]
);

// ============================================================================
// SYNC CONFLICTS
// ============================================================================

export const syncConflicts = sqliteTable(
  'sync_conflicts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    localData: text('local_data', { mode: 'json' }).$type<Record<string, unknown>>(),
    remoteData: text('remote_data', { mode: 'json' }).$type<Record<string, unknown>>(),
    status: text('status', { enum: ['pending', 'resolved'] as const })
      .notNull()
      .default('pending'),
    resolution: text('resolution', { enum: ['local_wins', 'remote_wins', 'merged'] as const }),
    resolvedAt: text('resolved_at'),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_sync_conflicts_tenant').on(table.tenantId),
    index('idx_sync_conflicts_status').on(table.status),
  ]
);

// ============================================================================
// APP SETTINGS (Local app configuration)
// ============================================================================

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>(),
  updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Logo = typeof logos.$inferSelect;
export type NewLogo = typeof logos.$inferInsert;

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;

export type Country = typeof countries.$inferSelect;
export type NewCountry = typeof countries.$inferInsert;

export type Department = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;

export type City = typeof cities.$inferSelect;
export type NewCity = typeof cities.$inferInsert;

export type Provider = typeof providers.$inferSelect;
export type NewProvider = typeof providers.$inferInsert;

export type CommercialActivity = typeof commercialActivities.$inferSelect;
export type NewCommercialActivity = typeof commercialActivities.$inferInsert;

export type Unit = typeof units.$inferSelect;
export type NewUnit = typeof units.$inferInsert;

export type VatRate = typeof vatRates.$inferSelect;
export type NewVatRate = typeof vatRates.$inferInsert;

export type Sequential = typeof sequentials.$inferSelect;
export type NewSequential = typeof sequentials.$inferInsert;

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;

export type UnitXProduct = typeof unitXProduct.$inferSelect;
export type NewUnitXProduct = typeof unitXProduct.$inferInsert;

export type ProductXProvider = typeof productXProvider.$inferSelect;
export type NewProductXProvider = typeof productXProvider.$inferInsert;

export type CategoryXProvider = typeof categoryXProvider.$inferSelect;
export type NewCategoryXProvider = typeof categoryXProvider.$inferInsert;

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

export type Purchase = typeof purchases.$inferSelect;
export type NewPurchase = typeof purchases.$inferInsert;

export type PurchaseItem = typeof purchaseItems.$inferSelect;
export type NewPurchaseItem = typeof purchaseItems.$inferInsert;

export type PurchaseReturn = typeof purchaseReturns.$inferSelect;
export type NewPurchaseReturn = typeof purchaseReturns.$inferInsert;

export type PurchaseReturnItem = typeof purchaseReturnItems.$inferSelect;
export type NewPurchaseReturnItem = typeof purchaseReturnItems.$inferInsert;

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;

export type Sale = typeof sales.$inferSelect;
export type NewSale = typeof sales.$inferInsert;

export type SaleItem = typeof saleItems.$inferSelect;
export type NewSaleItem = typeof saleItems.$inferInsert;

export type SalePayment = typeof salePayments.$inferSelect;
export type NewSalePayment = typeof salePayments.$inferInsert;

export type SaleReturn = typeof saleReturns.$inferSelect;
export type NewSaleReturn = typeof saleReturns.$inferInsert;

export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type NewInventoryMovement = typeof inventoryMovements.$inferInsert;

export type InitialInventory = typeof initialInventory.$inferSelect;
export type NewInitialInventory = typeof initialInventory.$inferInsert;

export type InventoryBalance = typeof inventoryBalances.$inferSelect;
export type NewInventoryBalance = typeof inventoryBalances.$inferInsert;

export type TransferOrder = typeof transferOrders.$inferSelect;
export type NewTransferOrder = typeof transferOrders.$inferInsert;
export type TransferOrderItem = typeof transferOrderItems.$inferInsert;
export type TransferOrderStatus = (typeof transferOrderStatusEnum)[number];

export type SyncQueueItem = typeof syncQueue.$inferSelect;
export type NewSyncQueueItem = typeof syncQueue.$inferInsert;

export type SyncConflict = typeof syncConflicts.$inferSelect;
export type NewSyncConflict = typeof syncConflicts.$inferInsert;

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
