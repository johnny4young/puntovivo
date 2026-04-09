/**
 * Drizzle ORM Schema for Open Yojob POS System
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
export const purchaseStatusEnum = ['completed', 'voided'] as const;
export const orderStatusEnum = ['submitted', 'received', 'voided'] as const;
export const movementTypeEnum = ['purchase', 'sale', 'adjustment', 'transfer', 'return'] as const;
export const userRoleEnum = ['admin', 'manager', 'cashier'] as const;
export const sequentialDocumentTypeEnum = ['sale', 'purchase', 'order'] as const;
export const initialInventoryModeEnum = ['initial', 'physical'] as const;

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
  companies: many(companies),
  sites: many(sites),
  locations: many(locations),
  locationSiteAssignments: many(locationXSite),
  providers: many(providers),
  identificationTypes: many(identificationTypes),
  personTypes: many(personTypes),
  regimeTypes: many(regimeTypes),
  clientTypes: many(clientTypes),
  units: many(units),
  vatRates: many(vatRates),
  sequentials: many(sequentials),
  products: many(products),
  categories: many(categories),
  customers: many(customers),
  purchases: many(purchases),
  orders: many(orders),
  sales: many(sales),
  inventoryMovements: many(inventoryMovements),
  initialInventoryEntries: many(initialInventory),
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
  orders: many(orders),
  sales: many(sales),
  inventoryMovements: many(inventoryMovements),
  initialInventoryEntries: many(initialInventory),
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
    logoUrl: text('logo_url'),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_companies_tenant').on(table.tenantId),
    uniqueIndex('idx_companies_tenant_name').on(table.tenantId, table.name),
  ]
);

export const companiesRelations = relations(companies, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [companies.tenantId],
    references: [tenants.id],
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
  initialInventoryEntries: many(initialInventory),
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
  products: many(products),
  productAssignments: many(productXProvider),
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
    stock: integer('stock').notNull().default(0),
    minStock: integer('min_stock').notNull().default(0),
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
    uniqueIndex('idx_purchases_order_unique').on(table.orderId),
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
    quantity: integer('quantity').notNull().default(1),
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
  ]
);

export const purchaseItemsRelations = relations(purchaseItems, ({ one }) => ({
  purchase: one(purchases, {
    fields: [purchaseItems.purchaseId],
    references: [purchases.id],
  }),
  product: one(products, {
    fields: [purchaseItems.productId],
    references: [products.id],
  }),
  unit: one(units, {
    fields: [purchaseItems.unitId],
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
  receivedPurchase: one(purchases, {
    fields: [orders.id],
    references: [purchases.orderId],
  }),
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
    quantity: integer('quantity').notNull().default(1),
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
  items: many(saleItems),
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
    quantity: integer('quantity').notNull().default(1),
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
    quantity: integer('quantity').notNull(),
    previousStock: integer('previous_stock').notNull(),
    newStock: integer('new_stock').notNull(),
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
    normalizedQuantity: integer('normalized_quantity').notNull(),
    cost: real('cost').notNull().default(0),
    previousStock: integer('previous_stock').notNull(),
    newStock: integer('new_stock').notNull(),
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

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;

export type Provider = typeof providers.$inferSelect;
export type NewProvider = typeof providers.$inferInsert;

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

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

export type Purchase = typeof purchases.$inferSelect;
export type NewPurchase = typeof purchases.$inferInsert;

export type PurchaseItem = typeof purchaseItems.$inferSelect;
export type NewPurchaseItem = typeof purchaseItems.$inferInsert;

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;

export type Sale = typeof sales.$inferSelect;
export type NewSale = typeof sales.$inferInsert;

export type SaleItem = typeof saleItems.$inferSelect;
export type NewSaleItem = typeof saleItems.$inferInsert;

export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type NewInventoryMovement = typeof inventoryMovements.$inferInsert;

export type InitialInventory = typeof initialInventory.$inferSelect;
export type NewInitialInventory = typeof initialInventory.$inferInsert;

export type SyncQueueItem = typeof syncQueue.$inferSelect;
export type NewSyncQueueItem = typeof syncQueue.$inferInsert;

export type SyncConflict = typeof syncConflicts.$inferSelect;
export type NewSyncConflict = typeof syncConflicts.$inferInsert;

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
