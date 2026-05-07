/**
 * Drizzle ORM Schema for Puntovivo POS System
 *
 * This is the source-of-truth schema for the SQLite database.
 * All tables support multi-tenant isolation via tenant_id.
 *
 * @module db/schema
 */

import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

// ============================================================================
// ENUMS (as string literals for SQLite)
// ============================================================================

export const syncStatusEnum = ['pending', 'synced', 'conflict', 'error'] as const;
export const paymentMethodEnum = ['cash', 'card', 'transfer', 'credit', 'other'] as const;
export const paymentStatusEnum = ['pending', 'paid', 'partial', 'refunded'] as const;
export const idempotencyKeyStatusEnum = ['processing', 'succeeded', 'failed'] as const;
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
export type CashMovementType = (typeof cashMovementTypeEnum)[number];
export const userRoleEnum = ['admin', 'manager', 'cashier', 'viewer'] as const;
export const sequentialDocumentTypeEnum = ['sale', 'purchase', 'order', 'quotation'] as const;
export const quotationStatusEnum = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'converted',
] as const;
export type QuotationStatus = (typeof quotationStatusEnum)[number];
export const initialInventoryModeEnum = ['initial', 'physical'] as const;

/**
 * Phase 8 / Tier-2 #8 — audit trail for sensitive operations.
 *
 * The list is intentionally open-ended: the full set of `action` / `resource_type`
 * values is enforced in the service layer (`services/audit-logs.ts`), not at
 * the DB enum level, so new auditable operations can be added without a
 * migration. The string is stored as plain text and new values simply round
 * trip.
 */
export const auditLogActionEnum = [
  'transfer.void',
  'quotation.delete',
  'quotation.convert',
  // Phase 8 / Tier-2 #8 — sensitive sale, cash, and inventory actions.
  // The DB column is free-form text (no enum constraint at the SQL layer)
  // so adding entries here NEVER requires a migration; only the TS-level
  // narrowing is widened.
  'sale.void',
  'sale.return',
  'cash_session.close',
  // ENG-056 — shift-lifecycle parity. open had no audit row before; add
  // it alongside close so the audit trail brackets every shift symmetrically.
  // movement covers the manual paid_in / paid_out / skim / replenishment
  // mutations routed through `application/cash-sessions/recordCashMovement`.
  'cash_session.open',
  'cash_session.movement',
  'inventory.adjust_stock',
  // ENG-007 second wave — purchase voids, admin user lifecycle, manual
  // price overrides at checkout. Same free-form-text rule applies: no
  // migration is needed to add audit actions here.
  'purchase.void',
  'user.create',
  'user.update',
  'sale.price_override',
  // ENG-018 — park-and-resume (multi-cart workspace). `sale.park` is emitted
  // when a cashier suspends a draft sale; `sale.resume` when the same or
  // another cashier (manager/admin override) reopens it. Gated at the
  // service level by the optional `audit_park_sale` tenant setting so
  // tenants that consider park churn noise can suppress the rows.
  'sale.park',
  'sale.resume',
  // ENG-019 — receipt reprint. One row per reprint invocation, metadata
  // carries the reason dropdown value + reprint ordinal count.
  'sale.reprint',
  // ENG-018c — draft completion. Emitted by `sales.completeDraft` when
  // a draft sale transitions to `status='completed'`. Creates the audit
  // parity with void/return/park — any state-change on an existing sale
  // leaves a row in the log.
  'sale.complete',
  // ENG-047 — local anomaly detector persistence. Emitted when the
  // dashboard detector surfaces a new non-snoozed alert.
  'ai.anomaly.detected',
  // ENG-068 — module activation kernel. Admin toggles a tenant
  // module on/off via `modules.setActive`; metadata carries
  // `{moduleId, wasExplicit, defaultEnabled}` for activation history.
  'module.toggle',
] as const;
export type AuditLogAction = (typeof auditLogActionEnum)[number];

export const auditLogResourceTypeEnum = [
  'transfer_order',
  'quotation',
  'sale',
  'cash_session',
  // ENG-056 — manual cash movements emit cash_session.movement audit rows
  // keyed to the inserted cash_movements row id.
  'cash_movement',
  'product',
  // ENG-007 second wave resources.
  'purchase',
  'user',
  // ENG-047 wrote anomaly rows keyed to the flagged cashier in early
  // dev databases. Keep the reader tolerant so those rows stay visible.
  'cashier',
  // ENG-068 — module activation kernel. `module.toggle` audit rows
  // key on the module id (one row per module per tenant per toggle).
  'tenant_module',
] as const;
export type AuditLogResourceType = (typeof auditLogResourceTypeEnum)[number];

/**
 * Iter 2 — Receipt templates (declarative editor + pure renderer).
 *
 * `kind` partitions templates by document type; `paper_width` is denormalized
 * out of the JSON layout so the list view can filter without parsing every
 * blob. The actual block tree lives in `layout_json` as a `ReceiptLayout`
 * shape validated by Zod at the router boundary — no free-form HTML is
 * accepted, only a closed set of atomic blocks (text, logo, items table,
 * totals, tenders, qr, separator, barcode128).
 */
export const receiptTemplateKindEnum = ['sale', 'quotation', 'fiscal_dee'] as const;
export type ReceiptTemplateKind = (typeof receiptTemplateKindEnum)[number];

export const receiptTemplatePaperWidthEnum = ['58mm', '80mm', 'letter', 'a4'] as const;
export type ReceiptTemplatePaperWidth = (typeof receiptTemplatePaperWidthEnum)[number];

export interface CashSessionDenomination {
  value: number;
  count: number;
}

const nowIso = () => new Date().toISOString();
const sqliteNow = sql`(datetime('now'))`;

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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    // ENG-033 — semantic search support. The vector is JSON-encoded
    // float array (`[0.123, -0.456, ...]`); ~6KB for 1536 dims with
    // text-embedding-3-small. Null until embedded; null also means the
    // tenant has AI disabled and we should fall back to LIKE search.
    embedding: text('embedding'),
    embeddingModel: text('embedding_model'),
    embeddedAt: text('embedded_at'),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    // ENG-018 — park-and-resume columns. Populated when a draft sale is
    // suspended (`sales.suspend`) and cleared when resumed (`sales.resume`)
    // or discarded (`sales.discardDraft` → `status='cancelled'`).
    // `suspendedBy` is the cashier who suspended it; resume by a different
    // actor is only allowed when that actor is manager/admin.
    suspendedAt: text('suspended_at'),
    suspendedBy: text('suspended_by').references(() => users.id),
    suspendedLabel: text('suspended_label'),
    // ENG-019 — receipt reprint counters. Incremented inside
    // `sales.getForReprint`; the audit trail lives in `audit_logs` as
    // one `sale.reprint` row per invocation.
    reprintCount: integer('reprint_count').notNull().default(0),
    lastReprintedAt: text('last_reprinted_at'),
    lastReprintedBy: text('last_reprinted_by').references(() => users.id),
    // Sync fields
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_sales_tenant').on(table.tenantId),
    index('idx_sales_customer').on(table.customerId),
    index('idx_sales_cash_session').on(table.cashSessionId),
    index('idx_sales_created_by').on(table.createdBy),
    // ENG-018 — filter drafts quickly by owning cashier in `listDrafts`.
    index('idx_sales_suspended_by').on(table.suspendedBy),
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
    openedAt: text('opened_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    closedAt: text('closed_at'),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
// QUOTATIONS (Phase 5 / Tier-2 #6 — pre-sale documents)
// ============================================================================

/**
 * A quotation is a non-binding pre-sale document captured for a customer.
 * It carries a list of line items, totals, a validity window, and a status
 * that drives the quote-to-sale workflow. Inventory is NOT decremented when
 * a quotation is created — only when it is converted into a sale (deferred
 * to a later slice).
 */
export const quotations = sqliteTable(
  'quotations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    quotationNumber: text('quotation_number').notNull(),
    customerId: text('customer_id').references(() => customers.id),
    status: text('status', { enum: quotationStatusEnum }).notNull().default('draft'),
    subtotal: real('subtotal').notNull().default(0),
    taxAmount: real('tax_amount').notNull().default(0),
    discountAmount: real('discount_amount').notNull().default(0),
    total: real('total').notNull().default(0),
    /** ISO timestamp at which the quotation expires. Optional. */
    validUntil: text('valid_until'),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    /** Timestamp + actor of the most recent status transition. */
    statusChangedAt: text('status_changed_at'),
    statusChangedBy: text('status_changed_by').references(() => users.id),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_quotations_tenant').on(table.tenantId),
    index('idx_quotations_site').on(table.siteId),
    index('idx_quotations_customer').on(table.customerId),
    index('idx_quotations_status').on(table.status),
    index('idx_quotations_created_by').on(table.createdBy),
    uniqueIndex('idx_quotations_tenant_number').on(table.tenantId, table.quotationNumber),
  ]
);

export const quotationItems = sqliteTable(
  'quotation_items',
  {
    id: text('id').primaryKey(),
    quotationId: text('quotation_id')
      .notNull()
      .references(() => quotations.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    quantity: real('quantity').notNull().default(1),
    unitPrice: real('unit_price').notNull().default(0),
    discount: real('discount').notNull().default(0),
    taxRate: real('tax_rate').notNull().default(0),
    taxAmount: real('tax_amount').notNull().default(0),
    total: real('total').notNull().default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_quotation_items_quotation').on(table.quotationId),
    index('idx_quotation_items_product').on(table.productId),
  ]
);

export const quotationsRelations = relations(quotations, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [quotations.tenantId],
    references: [tenants.id],
  }),
  site: one(sites, {
    fields: [quotations.siteId],
    references: [sites.id],
  }),
  customer: one(customers, {
    fields: [quotations.customerId],
    references: [customers.id],
  }),
  createdByUser: one(users, {
    fields: [quotations.createdBy],
    references: [users.id],
  }),
  statusChangedByUser: one(users, {
    fields: [quotations.statusChangedBy],
    references: [users.id],
  }),
  items: many(quotationItems),
}));

export const quotationItemsRelations = relations(quotationItems, ({ one }) => ({
  quotation: one(quotations, {
    fields: [quotationItems.quotationId],
    references: [quotations.id],
  }),
  product: one(products, {
    fields: [quotationItems.productId],
    references: [products.id],
  }),
}));

// ============================================================================
// AUDIT LOGS (Phase 8 / Tier-2 #8 — sensitive-action traceability)
// ============================================================================

/**
 * A single immutable row per auditable operation. `before` / `after` capture
 * a relevant JSON snapshot of the affected resource so the viewer can render
 * a diff without re-joining upstream tables (those rows may have been
 * deleted — e.g. deleted quotations).
 *
 * `metadata` is a free-form bag for per-action details that don't fit the
 * before/after model (e.g. a void reason string, a discrepancy note).
 */
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    before: text('before', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    after: text('after', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    /**
     * ENG-052 — Foundation Reset wave. Carries the `operationId` from the
     * Command Envelope (ADR-0002) when the audit row was emitted under a
     * critical mutation. Nullable because (a) audit rows pre-dating ENG-052
     * have no operation id, and (b) future flows may emit audit rows
     * outside the envelope-decorated procedures. ENG-053 backfills the
     * column for journaled operations.
     */
    operationId: text('operation_id'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    index('idx_audit_logs_tenant').on(table.tenantId),
    index('idx_audit_logs_actor').on(table.actorId),
    index('idx_audit_logs_action').on(table.action),
    index('idx_audit_logs_resource').on(table.resourceType, table.resourceId),
    index('idx_audit_logs_created_at').on(table.createdAt),
    index('idx_audit_logs_operation_id').on(table.operationId),
  ]
);

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  tenant: one(tenants, {
    fields: [auditLogs.tenantId],
    references: [tenants.id],
  }),
  actor: one(users, {
    fields: [auditLogs.actorId],
    references: [users.id],
  }),
}));

// ============================================================================
// DEVICES + IDEMPOTENCY (ENG-052 — Command Envelope foundation, ADR-0002)
// ============================================================================

/**
 * `devices` is the formal record of every cashier machine that mutates
 * the local store. The Electron desktop binary or the web client
 * registers itself once via `auth.registerDevice` and persists the
 * server-issued id locally (Electron userData file or browser
 * localStorage). Subsequent critical mutations carry `x-device-id` so
 * the server can verify (`tenant_id`, `device_id`) ownership server
 * side and refuse renderer-supplied ids that no row backs.
 *
 * `kind` discriminates `desktop` (Electron) from `web` (browser-only,
 * dev or self-hosted). `is_active=false` revokes the device without
 * deleting the row so future audits can still join via
 * `audit_logs.operation_id` → operation journal (ENG-053) → device.
 */
export const devices = sqliteTable(
  'devices',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    kind: text('kind', { enum: ['desktop', 'web'] as const }).notNull(),
    name: text('name').notNull(),
    registeredByUserId: text('registered_by_user_id')
      .notNull()
      .references(() => users.id),
    lastSeenAt: text('last_seen_at'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    index('idx_devices_tenant_active').on(table.tenantId, table.isActive),
    index('idx_devices_tenant_last_seen').on(table.tenantId, table.lastSeenAt),
  ]
);

export const devicesRelations = relations(devices, ({ one }) => ({
  tenant: one(tenants, {
    fields: [devices.tenantId],
    references: [tenants.id],
  }),
  registeredBy: one(users, {
    fields: [devices.registeredByUserId],
    references: [users.id],
  }),
}));

/**
 * `idempotency_keys` reserves a critical command before the procedure
 * runs, then caches the result after success. A replay with a matching
 * `request_hash` returns either the cached `result_ref` or
 * COMMAND_IN_PROGRESS while the first call is still executing; a
 * mismatched hash raises IDEMPOTENCY_KEY_CONFLICT.
 *
 * Default TTL is 24 hours (cleaned by background sweep). The unique
 * index covers the lookup hot path.
 */
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id),
    idempotencyKey: text('idempotency_key').notNull(),
    operationKind: text('operation_kind').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status', { enum: idempotencyKeyStatusEnum })
      .notNull()
      .default('processing'),
    resultRef: text('result_ref', { mode: 'json' }).$type<unknown | null>(),
    lockedAt: text('locked_at').notNull(),
    completedAt: text('completed_at'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    expiresAt: text('expires_at').notNull(),
  },
  table => [
    uniqueIndex('idx_idempotency_keys_unique').on(
      table.tenantId,
      table.deviceId,
      table.idempotencyKey,
      table.operationKind
    ),
    index('idx_idempotency_keys_expires_at').on(table.expiresAt),
    index('idx_idempotency_keys_status_expires_at').on(table.status, table.expiresAt),
  ]
);

export const idempotencyKeysRelations = relations(idempotencyKeys, ({ one }) => ({
  tenant: one(tenants, {
    fields: [idempotencyKeys.tenantId],
    references: [tenants.id],
  }),
  device: one(devices, {
    fields: [idempotencyKeys.deviceId],
    references: [devices.id],
  }),
}));

// ============================================================================
// OPERATION JOURNAL + OUTBOX METADATA (ENG-053 — ADR-0001/0002/0003)
// ============================================================================

/**
 * `operation_events` is the append-only intent log that closes the loop
 * opened by ENG-052 — every critical mutation that flows through
 * `commandEnvelope` reserves a row here keyed by `(tenant_id,
 * operation_id)`. The envelope's `operationId` becomes the join key
 * across logs, audit rows, outbox effects, and (eventually) the
 * central server publish stream.
 *
 * `status` lifecycle:
 *
 *   started → succeeded | failed | partial
 *
 * `partial` exists for the future case where the procedure committed
 * the primary work but a post-commit fan-out (e.g. fiscal emission
 * via the future `fiscal_outbox`) failed; the original sale stays
 * intact and the journal records the partial completion so operators
 * can retry the missing fan-out without re-running the primary.
 *
 * `summary` is a small JSON blob the procedure can write at completion
 * time (e.g. `{saleId, total, paymentMethod}`) so forensics queries
 * don't need to re-join 10 tables to reconstruct what happened.
 */
export const operationEventStatusEnum = [
  'started',
  'succeeded',
  'failed',
  'partial',
] as const;

export type OperationEventStatus = (typeof operationEventStatusEnum)[number];

export const operationEvents = sqliteTable(
  'operation_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    operationId: text('operation_id').notNull(),
    operationKind: text('operation_kind').notNull(),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: operationEventStatusEnum })
      .notNull()
      .default('started'),
    requestHash: text('request_hash').notNull(),
    summary: text('summary', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    startedAt: text('started_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    completedAt: text('completed_at'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    uniqueIndex('idx_operation_events_tenant_operation').on(
      table.tenantId,
      table.operationId
    ),
    index('idx_operation_events_status').on(table.status),
    index('idx_operation_events_kind_status').on(table.operationKind, table.status),
    index('idx_operation_events_device').on(table.deviceId),
    index('idx_operation_events_user').on(table.userId),
  ]
);

/**
 * `operation_effects` records what side effects a single operation
 * produced. One row per significant effect (an audit_logs row, a
 * sync_outbox enqueue, a fiscal_outbox enqueue, an inventory
 * movement, etc.). Row-level details live in their dedicated tables;
 * the effect row carries `kind` + `resource_type` + `resource_id` so
 * the trail can join back without forcing every consumer to read the
 * destination table.
 *
 * Cascade-delete with the parent event row keeps the trail tidy
 * during the eventual journal-rotation policy (operations older than
 * 90 days move to cold storage in a future ticket).
 */
export const operationEffects = sqliteTable(
  'operation_effects',
  {
    id: text('id').primaryKey(),
    operationEventId: text('operation_event_id')
      .notNull()
      .references(() => operationEvents.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    effectData: text('effect_data', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    index('idx_operation_effects_event').on(table.operationEventId),
    index('idx_operation_effects_event_kind').on(table.operationEventId, table.kind),
    index('idx_operation_effects_resource').on(table.resourceType, table.resourceId),
  ]
);

/**
 * `operation_errors` records POST-commit failures attributed to an
 * operation without rolling back the primary work. Example: the sale
 * committed cleanly, but the DIAN adapter rejected the emission with
 * a transient error. The sale row stays intact, the operation event
 * transitions to `partial`, and a row lands here so the operator can
 * retry from the Operations Center (ENG-065).
 *
 * `recoverable` distinguishes retryable failures (provider 5xx,
 * network timeout) from permanent ones (validation rejection at the
 * provider, malformed input). Workers consult this flag when
 * deciding whether to schedule a retry or move straight to the
 * dead-letter terminal.
 */
export const operationErrors = sqliteTable(
  'operation_errors',
  {
    id: text('id').primaryKey(),
    operationEventId: text('operation_event_id')
      .notNull()
      .references(() => operationEvents.id, { onDelete: 'cascade' }),
    errorCode: text('error_code').notNull(),
    message: text('message').notNull(),
    recoverable: integer('recoverable', { mode: 'boolean' }).notNull().default(false),
    errorData: text('error_data', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    index('idx_operation_errors_event').on(table.operationEventId),
    index('idx_operation_errors_code').on(table.errorCode),
  ]
);

export const operationEventsRelations = relations(operationEvents, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [operationEvents.tenantId],
    references: [tenants.id],
  }),
  device: one(devices, {
    fields: [operationEvents.deviceId],
    references: [devices.id],
  }),
  user: one(users, {
    fields: [operationEvents.userId],
    references: [users.id],
  }),
  effects: many(operationEffects),
  errors: many(operationErrors),
}));

export const operationEffectsRelations = relations(operationEffects, ({ one }) => ({
  event: one(operationEvents, {
    fields: [operationEffects.operationEventId],
    references: [operationEvents.id],
  }),
}));

export const operationErrorsRelations = relations(operationErrors, ({ one }) => ({
  event: one(operationEvents, {
    fields: [operationErrors.operationEventId],
    references: [operationEvents.id],
  }),
}));

/**
 * `outbox_metadata` is the cross-outbox health table — one row per
 * `(tenant_id, outbox_kind)`. The five concrete outboxes (sync,
 * fiscal, payment, webhook, hardware — ADR-0003) each refresh their
 * row periodically with `pending_count`, `oldest_pending_at`, and the
 * last success/failure timestamps. ENG-065 (Operations Center) reads
 * this single table to render its status panels without scanning the
 * outbox tables themselves.
 *
 * The kernel at `lib/outbox/metadata.ts` owns the read/write helpers;
 * concrete outboxes never write here directly.
 */
export const outboxKindEnum = [
  'sync',
  'fiscal',
  'payment',
  'webhook',
  'hardware',
] as const;

export type OutboxKind = (typeof outboxKindEnum)[number];

export const outboxMetadata = sqliteTable(
  'outbox_metadata',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    outboxKind: text('outbox_kind', { enum: outboxKindEnum }).notNull(),
    pendingCount: integer('pending_count').notNull().default(0),
    lastSuccessAt: text('last_success_at'),
    lastFailureAt: text('last_failure_at'),
    oldestPendingAt: text('oldest_pending_at'),
    refreshedAt: text('refreshed_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    uniqueIndex('idx_outbox_metadata_tenant_kind').on(table.tenantId, table.outboxKind),
    index('idx_outbox_metadata_kind_pending').on(table.outboxKind, table.pendingCount),
  ]
);

export const outboxMetadataRelations = relations(outboxMetadata, ({ one }) => ({
  tenant: one(tenants, {
    fields: [outboxMetadata.tenantId],
    references: [tenants.id],
  }),
}));

// ============================================================================
// RECEIPT TEMPLATES (Iter 2 — declarative receipt editor + pure renderer)
// ============================================================================

/**
 * `receipt_templates` is the persistence layer for the declarative receipt
 * editor: each row owns a JSON `layout` of atomic blocks (text, logo, items
 * table, totals, tenders, qr, separator, barcode128) plus print metadata
 * (paper width, default flag). The companion pure renderer
 * (`services/receipt-renderer`) consumes the layout to emit HTML for
 * `webContents.print()` and ESC/POS bytes for thermal printers from the
 * SAME source of truth.
 *
 * Concurrency invariant: at most one row per `(tenant_id, kind)` may have
 * `is_default = 1`. Enforced by a partial unique index in the raw DDL
 * mirror (Drizzle's SQLite dialect cannot express partial uniques today)
 * AND defended at the service layer with a transaction that flips the
 * old default to false in the same statement that flips the new one to
 * true.
 */
export const receiptTemplates = sqliteTable(
  'receipt_templates',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    kind: text('kind', { enum: receiptTemplateKindEnum }).notNull(),
    name: text('name').notNull(),
    paperWidth: text('paper_width', { enum: receiptTemplatePaperWidthEnum })
      .notNull()
      .default('80mm'),
    /**
     * Declarative `ReceiptLayout` validated by Zod at the router. Stored as
     * JSON text via Drizzle's `mode: 'json'`; the runtime shape is the
     * `ReceiptLayout` exported from `trpc/schemas/receiptTemplates`.
     */
    layout: text('layout', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: text('updated_by').references(() => users.id),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_receipt_templates_tenant').on(table.tenantId),
    index('idx_receipt_templates_tenant_kind').on(table.tenantId, table.kind),
    index('idx_receipt_templates_tenant_active').on(table.tenantId, table.isActive),
  ]
);

export const receiptTemplatesRelations = relations(receiptTemplates, ({ one }) => ({
  tenant: one(tenants, {
    fields: [receiptTemplates.tenantId],
    references: [tenants.id],
  }),
  createdByUser: one(users, {
    fields: [receiptTemplates.createdBy],
    references: [users.id],
    relationName: 'receipt_templates_created_by',
  }),
  updatedByUser: one(users, {
    fields: [receiptTemplates.updatedBy],
    references: [users.id],
    relationName: 'receipt_templates_updated_by',
  }),
}));

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
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
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
  updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
});

// ============================================================================
// LOCALE CATALOGS (ENG-017)
// ============================================================================
//
// Global read-only catalogs. `country_catalog` + `currency_catalog` are
// the first two tables in the repo that are explicitly NOT tenant-
// scoped — ISO codes are universal truth and every tenant shares the
// same rows. Seeded on boot via `seedLocaleCatalogs()` in `db/index.ts`;
// idempotent by PK so the seed runs safely on every start.
//
// The existing `countries` table stays unchanged (tenant-scoped catalog
// of operationally relevant countries for customer addresses). The two
// link only via ISO code when the operator picks their default country.

/** Global, read-only ISO-4217 currency catalog. Seeded at boot. */
export const currencyCatalog = sqliteTable('currency_catalog', {
  /** ISO 4217 alpha-3 code (e.g. 'COP', 'USD'). Primary key. */
  code: text('code').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameEs: text('name_es').notNull(),
  symbol: text('symbol').notNull(),
  /**
   * Legal decimals per ISO 4217 (usually 2; 0 for CLP / PYG / JPY).
   * Used by fiscal / accounting surfaces that must never round below
   * the legal tender precision.
   */
  decimals: integer('decimals').notNull(),
  /**
   * Practical display decimals used by POS rendering. Colombia
   * renders COP with 0 decimals in retail even though ISO 4217 says
   * 2. Keep this distinct from `decimals` so fiscal documents get
   * the legally required precision while the UI renders
   * operator-friendly amounts.
   */
  displayDecimals: integer('display_decimals').notNull(),
});

/** Global, read-only ISO-3166 country catalog with locale defaults. */
export const countryCatalog = sqliteTable('country_catalog', {
  /** ISO 3166-1 alpha-2 code (e.g. 'CO', 'US'). Primary key. */
  code: text('code').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameEs: text('name_es').notNull(),
  /** BCP-47 locale (e.g. 'es-CO', 'en-US') used by Intl formatters. */
  defaultLocale: text('default_locale').notNull(),
  /** Primary language subtag (e.g. 'es', 'en', 'pt') for i18next. */
  generalLocale: text('general_locale').notNull(),
  defaultCurrencyCode: text('default_currency_code')
    .notNull()
    .references(() => currencyCatalog.code),
  /**
   * Additional currencies the country operates in (e.g. Panama's
   * PAB+USD). Informational only; operator chooses via override.
   */
  additionalCurrencyCodes: text('additional_currency_codes', { mode: 'json' })
    .$type<string[]>()
    .default([]),
  /** IANA timezone (e.g. 'America/Bogota'). */
  defaultTimezone: text('default_timezone').notNull(),
  /** 0 = Sunday, 1 = Monday. Used by calendar widgets. */
  firstDayOfWeek: integer('first_day_of_week').notNull(),
  /** Date format hint shown in admin preview ('dd/MM/yyyy', 'MM/dd/yyyy'). */
  dateFormatShort: text('date_format_short').notNull(),
  dateFormatLong: text('date_format_long').notNull(),
  /** Common tax-ID codes (e.g. ['CC', 'NIT', 'CE']) for operator hints. */
  taxIdTypesHint: text('tax_id_types_hint', { mode: 'json' })
    .$type<string[]>()
    .default([]),
  /**
   * Whether the UI has i18next bundles for this country's general
   * locale. Brazil (pt-BR) is false until the pt bundle ships; the
   * admin UI will warn when the picked country is not ui-ready.
   */
  uiLocaleReady: integer('ui_locale_ready', { mode: 'boolean' })
    .notNull()
    .default(true),
});

/**
 * Per-tenant locale choice + overrides. A null override inherits from
 * `country_catalog` via `resolveTenantLocale` in
 * `services/tenant-locale.ts`.
 */
export const tenantLocaleSettings = sqliteTable('tenant_locale_settings', {
  tenantId: text('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  countryCode: text('country_code')
    .notNull()
    .references(() => countryCatalog.code),
  localeOverride: text('locale_override'),
  currencyOverride: text('currency_override').references(
    () => currencyCatalog.code
  ),
  timezoneOverride: text('timezone_override'),
  firstDayOfWeekOverride: integer('first_day_of_week_override'),
  updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
});

export const countryCatalogRelations = relations(countryCatalog, ({ one }) => ({
  defaultCurrency: one(currencyCatalog, {
    fields: [countryCatalog.defaultCurrencyCode],
    references: [currencyCatalog.code],
  }),
}));

export const tenantLocaleSettingsRelations = relations(
  tenantLocaleSettings,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [tenantLocaleSettings.tenantId],
      references: [tenants.id],
    }),
    country: one(countryCatalog, {
      fields: [tenantLocaleSettings.countryCode],
      references: [countryCatalog.code],
    }),
    currencyOverrideRef: one(currencyCatalog, {
      fields: [tenantLocaleSettings.currencyOverride],
      references: [currencyCatalog.code],
    }),
  })
);

// ============================================================================
// DIAN IDENTIFICATION TYPES CATALOG (ENG-020 Phase A)
// ============================================================================
//
// Global, read-only catalog of the 10 identification types recognised by
// Colombia's DIAN (Dirección de Impuestos y Aduanas Nacionales). Seeded
// on boot by `seedDianIdentificationTypes()` in `db/index.ts`. Keyed by
// the DIAN-issued numeric code (`11`, `13`, `22`, …) which is what the
// fiscal XML needs, while `abbr` is the human-friendly label operators
// know ("CC", "NIT", "CE") and that buyer snapshots carry verbatim.
//
// Distinct from the existing `identification_types` table, which is
// tenant-scoped and stores each tenant's custom catalog for UX flows.
// The two link only via `abbr` when a tenant wires up their identificationTypes
// row to a DIAN code (that mapping is out of scope for ENG-020 Phase A
// and is handled by operator choice in the admin fiscal settings later).

/** Global, read-only DIAN identification type catalog. Seeded at boot. */
export const dianIdentificationTypes = sqliteTable(
  'dian_identification_types',
  {
    /** DIAN-issued 2-digit code ('11', '13', '22'). Primary key. */
    code: text('code').primaryKey(),
    /** Short human-friendly abbreviation ('CC', 'NIT', 'CE'). */
    abbr: text('abbr').notNull(),
    nameEs: text('name_es').notNull(),
    nameEn: text('name_en').notNull(),
    /** When the type is issued to natural persons (vs. legal entities). */
    naturalPerson: integer('natural_person', { mode: 'boolean' })
      .notNull()
      .default(true),
  }
);

export type DianIdentificationType = typeof dianIdentificationTypes.$inferSelect;
export type NewDianIdentificationType = typeof dianIdentificationTypes.$inferInsert;

// ============================================================================
// FISCAL DOCUMENTS (ENG-020 Phase A — Colombia DIAN MVP)
// ============================================================================
//
// Four tenant-scoped tables that together model the fiscal-document
// lifecycle without committing to any specific Proveedor Tecnológico.
// ENG-021 (Fase B) swaps the `MockAdapter` implementation behind the
// `FiscalAdapter` interface for a real PT integration — the tables
// themselves do not change shape.
//
// Immutability contract: once a `fiscal_document` row is inserted it
// MUST NOT be updated except through a very narrow set of status
// transitions managed by `services/fiscal/orchestrator.ts`. The buyer
// and line snapshots are FROZEN at issuance time so later mutations
// of the `customers` / `products` rows cannot alter the emitted fiscal
// record. This is a legal requirement under DIAN Resolución 165/2023.
//
// Scope per tenant:
// - `fiscal_numbering_resolutions` — DIAN-issued consecutive ranges.
//   Each site holds one active range per kind (DEE, FEV, NC, ND).
// - `fiscal_certificates` — references to the p12 cert + passphrase
//   (stored out of band; only the ref + validity metadata lives here).
// - `fiscal_documents` — one row per emitted fiscal event.
// - `fiscal_document_items` — line snapshot; frozen product name/sku.

/** Kinds of fiscal documents DIAN recognises for POS / e-invoicing. */
export const fiscalDocumentKindEnum = ['DEE', 'FEV', 'NC', 'ND'] as const;
export type FiscalDocumentKind = (typeof fiscalDocumentKindEnum)[number];

/** Lifecycle states a fiscal document can occupy. */
export const fiscalDocumentStatusEnum = [
  'pending',
  'sent',
  'accepted',
  'rejected',
  'contingency',
] as const;
export type FiscalDocumentStatus = (typeof fiscalDocumentStatusEnum)[number];

/** Source event that triggered the document. */
export const fiscalDocumentSourceEnum = ['sale', 'void', 'return'] as const;
export type FiscalDocumentSource = (typeof fiscalDocumentSourceEnum)[number];

export const fiscalNumberingResolutions = sqliteTable(
  'fiscal_numbering_resolutions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    kind: text('kind', { enum: fiscalDocumentKindEnum }).notNull(),
    /** DIAN resolution number — opaque string the PT expects verbatim. */
    resolutionNumber: text('resolution_number').notNull(),
    prefix: text('prefix').notNull(),
    fromNumber: integer('from_number').notNull(),
    toNumber: integer('to_number').notNull(),
    currentNumber: integer('current_number').notNull(),
    /** Technical key provided by DIAN, used in CUFE inputs. */
    technicalKey: text('technical_key').notNull(),
    validFrom: text('valid_from').notNull(),
    validUntil: text('valid_until').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_fiscal_resolutions_tenant').on(table.tenantId),
    index('idx_fiscal_resolutions_site_kind').on(
      table.siteId,
      table.kind,
      table.isActive
    ),
  ]
);

export const fiscalCertificates = sqliteTable(
  'fiscal_certificates',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    /** Reference (URL or path) to the p12 blob — never the blob itself. */
    p12Ref: text('p12_ref').notNull(),
    /** Reference to the passphrase (vault / KMS), never the passphrase. */
    passphraseRef: text('passphrase_ref').notNull(),
    /** PEM-encoded subject DN for the admin UI. Non-secret. */
    subjectDn: text('subject_dn'),
    validFrom: text('valid_from').notNull(),
    validUntil: text('valid_until').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [index('idx_fiscal_certificates_tenant').on(table.tenantId)]
);

export const fiscalDocuments = sqliteTable(
  'fiscal_documents',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Source event type (which sale lifecycle hook fired). */
    source: text('source', { enum: fiscalDocumentSourceEnum }).notNull(),
    /** Id of the source row — sale id, sale return id, etc. */
    sourceId: text('source_id').notNull(),
    /** DIAN document kind (DEE, FEV, NC, ND). */
    kind: text('kind', { enum: fiscalDocumentKindEnum }).notNull(),
    /** Numbering resolution used to generate the consecutive. */
    resolutionId: text('resolution_id')
      .notNull()
      .references(() => fiscalNumberingResolutions.id),
    consecutive: integer('consecutive').notNull(),
    documentNumber: text('document_number').notNull(),
    /**
     * CUFE (Código Único de Factura Electrónica). 96-char hex string
     * computed via SHA-384 per DIAN Resolución 165/2023. Unique.
     */
    cufe: text('cufe').notNull(),
    status: text('status', { enum: fiscalDocumentStatusEnum })
      .notNull()
      .default('pending'),
    // --- Buyer snapshot (frozen at emission) ---------------------------------
    /** null when consumidor final; otherwise the source customer id. */
    customerId: text('customer_id').references(() => customers.id),
    buyerTaxId: text('buyer_tax_id').notNull(),
    buyerTaxIdTypeCode: text('buyer_tax_id_type_code')
      .notNull()
      .references(() => dianIdentificationTypes.code),
    buyerName: text('buyer_name').notNull(),
    buyerEmail: text('buyer_email'),
    buyerAddress: text('buyer_address'),
    buyerCity: text('buyer_city'),
    buyerDepartment: text('buyer_department'),
    buyerCountry: text('buyer_country'),
    // --- Sale header snapshot ------------------------------------------------
    subtotal: real('subtotal').notNull().default(0),
    taxAmount: real('tax_amount').notNull().default(0),
    discountAmount: real('discount_amount').notNull().default(0),
    totalAmount: real('total_amount').notNull().default(0),
    currencyCode: text('currency_code').notNull(),
    localeCode: text('locale_code').notNull(),
    /**
     * When the source is `void` or `return`, this holds the CUFE of the
     * original `fiscal_documents` row being compensated.
     */
    originalCufe: text('original_cufe'),
    reasonCode: text('reason_code'),
    /** Provider that emitted the document. Fase A = 'mock'. */
    providerId: text('provider_id').notNull(),
    /** PT response JSON snapshot for troubleshooting. Null for MockAdapter. */
    providerResponse: text('provider_response', { mode: 'json' })
      .$type<Record<string, unknown> | null>()
      .default(null),
    /** Reference to the XML blob (storage path). Null until stored. */
    xmlRef: text('xml_ref'),
    /** Retry count for the contingency queue. */
    retries: integer('retries').notNull().default(0),
    emittedByUserId: text('emitted_by_user_id')
      .notNull()
      .references(() => users.id),
    emittedAt: text('emitted_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_fiscal_documents_tenant').on(table.tenantId),
    index('idx_fiscal_documents_source').on(table.source, table.sourceId),
    uniqueIndex('idx_fiscal_documents_cufe').on(table.cufe),
    uniqueIndex('idx_fiscal_documents_tenant_doc').on(
      table.tenantId,
      table.documentNumber
    ),
    index('idx_fiscal_documents_status').on(table.status),
  ]
);

export const fiscalDocumentItems = sqliteTable(
  'fiscal_document_items',
  {
    id: text('id').primaryKey(),
    fiscalDocumentId: text('fiscal_document_id')
      .notNull()
      .references(() => fiscalDocuments.id, { onDelete: 'cascade' }),
    lineNumber: integer('line_number').notNull(),
    /** Product id at emission time — kept only for lineage; NOT joined. */
    productId: text('product_id'),
    /** Product name snapshot. Frozen. */
    productName: text('product_name').notNull(),
    productSku: text('product_sku'),
    /** Unit of measure code (DIAN spec: 'EA', 'KGM', 'LTR', …). */
    unitMeasureCode: text('unit_measure_code').notNull().default('EA'),
    quantity: real('quantity').notNull(),
    unitPrice: real('unit_price').notNull(),
    discountAmount: real('discount_amount').notNull().default(0),
    taxRate: real('tax_rate').notNull().default(0),
    taxAmount: real('tax_amount').notNull().default(0),
    /** DIAN tax category code ('01' IVA, '04' INC, '05' ReteIVA, …). */
    taxCategoryCode: text('tax_category_code').notNull().default('01'),
    lineTotal: real('line_total').notNull(),
  },
  table => [
    index('idx_fiscal_document_items_doc').on(table.fiscalDocumentId),
  ]
);

export const fiscalNumberingResolutionsRelations = relations(
  fiscalNumberingResolutions,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [fiscalNumberingResolutions.tenantId],
      references: [tenants.id],
    }),
    site: one(sites, {
      fields: [fiscalNumberingResolutions.siteId],
      references: [sites.id],
    }),
  })
);

export const fiscalDocumentsRelations = relations(
  fiscalDocuments,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [fiscalDocuments.tenantId],
      references: [tenants.id],
    }),
    resolution: one(fiscalNumberingResolutions, {
      fields: [fiscalDocuments.resolutionId],
      references: [fiscalNumberingResolutions.id],
    }),
    emittedBy: one(users, {
      fields: [fiscalDocuments.emittedByUserId],
      references: [users.id],
    }),
    items: many(fiscalDocumentItems),
  })
);

export const fiscalDocumentItemsRelations = relations(
  fiscalDocumentItems,
  ({ one }) => ({
    fiscalDocument: one(fiscalDocuments, {
      fields: [fiscalDocumentItems.fiscalDocumentId],
      references: [fiscalDocuments.id],
    }),
  })
);

// ============================================================================
// FISCAL OUTBOX (ENG-057 — first concrete consumer of the outbox kernel)
// ============================================================================

/**
 * Closed list of statuses for the fiscal outbox lifecycle, per
 * ADR-0003 §Fiscal outbox. The kernel writes `queued`, `submitting`,
 * `accepted`, `retrying`, `dead_letter`. The fiscal worker writes
 * `contingency` (operator-visible "we are knowingly off-line, retry
 * pending") and `rejected` (terminal-but-not-success when the
 * provider returns a non-recoverable rejection) before the kernel's
 * `complete` / `fail` transition narrows again.
 */
export const fiscalOutboxStatusEnum = [
  'queued',
  'submitting',
  'accepted',
  'rejected',
  'contingency',
  'retrying',
  'dead_letter',
] as const;
export type FiscalOutboxStatus = (typeof fiscalOutboxStatusEnum)[number];

/**
 * Closed list of fiscal outbox kinds. ENG-057 ships only `emit`;
 * `cancel` (DIAN cancellation), `retry_contingency` (re-enqueue
 * after manual operator action), and `fetch_status` (poll PT for
 * an in-flight CUFE) land incrementally per ADR-0003 sequencing.
 */
export const fiscalOutboxKindEnum = ['emit'] as const;
export type FiscalOutboxKind = (typeof fiscalOutboxKindEnum)[number];

/**
 * `fiscal_outbox` orchestrates the lifecycle of fiscal-document
 * delivery to the country adapter. Lives next to `fiscal_documents`
 * which remains the source of truth for each comprobante; the outbox
 * row tracks the communication-with-provider state.
 *
 * The status machine + retry policy + claim_token concurrency are
 * inherited from `lib/outbox/createOutboxKernel`. The fiscal worker
 * (`services/fiscal/fiscal-worker.ts`) drives state transitions and
 * mirrors the verdict back to `fiscal_documents.status` so existing
 * consumers (close-shift pending checks, FiscalContingencyIndicator,
 * `reports.fiscal.list`) keep working without joining this table.
 */
export const fiscalOutbox = sqliteTable(
  'fiscal_outbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    status: text('status', { enum: fiscalOutboxStatusEnum }).notNull().default('queued'),
    kind: text('kind', { enum: fiscalOutboxKindEnum }).notNull().default('emit'),
    /**
     * FK to the pre-created `fiscal_documents` row (status='pending'
     * at enqueue time). Nullable to leave room for a future
     * raw-enqueue path (admin batch issue) that does not pre-create.
     * In ENG-057's flow this is always populated.
     */
    fiscalDocumentId: text('fiscal_document_id').references(
      () => fiscalDocuments.id,
      { onDelete: 'set null' }
    ),
    /** Snapshot of the resolved adapter providerId at enqueue. */
    providerId: text('provider_id'),
    /** Filled by the worker on `accepted`; redundant with `fiscal_documents.cufe`. */
    cufe: text('cufe'),
    /** `FiscalAdapterIssueInput` snapshot — worker MUST be able to retry without re-resolving. */
    payload: text('payload', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    payloadVersion: integer('payload_version').notNull().default(1),
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: text('next_retry_at'),
    /** `NormalizedOutboxError` written by the kernel on `fail`. */
    lastError: text('last_error', { mode: 'json' })
      .$type<Record<string, unknown> | null>()
      .default(null),
    priority: real('priority').notNull().default(0),
    claimToken: text('claim_token'),
    lockedAt: text('locked_at'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    // Primary path for the kernel's claimNext: filter by tenant +
    // status (queued or retrying) ordered by priority + createdAt;
    // nextRetryAt is consulted as `IS NULL OR <= now`.
    index('idx_fiscal_outbox_tenant_status_retry').on(
      table.tenantId,
      table.status,
      table.nextRetryAt
    ),
    // Drilldown for the FiscalDocumentListPage retry button + the
    // manual-retry router lookup by document id.
    index('idx_fiscal_outbox_fiscal_document').on(table.fiscalDocumentId),
    // Operations Center listing + peek.
    index('idx_fiscal_outbox_tenant_created').on(table.tenantId, table.createdAt),
  ]
);

export const fiscalOutboxRelations = relations(fiscalOutbox, ({ one }) => ({
  tenant: one(tenants, {
    fields: [fiscalOutbox.tenantId],
    references: [tenants.id],
  }),
  fiscalDocument: one(fiscalDocuments, {
    fields: [fiscalOutbox.fiscalDocumentId],
    references: [fiscalDocuments.id],
  }),
}));

export type FiscalOutboxRow = typeof fiscalOutbox.$inferSelect;
export type NewFiscalOutboxRow = typeof fiscalOutbox.$inferInsert;

// ============================================================================
// SITE PERIPHERALS (ENG-060 — peripheral registry + hardware ports)
// ============================================================================

/**
 * Closed list of peripheral kinds a site can configure. The contracts +
 * default drivers for `printer` (system) and `payment_terminal` (manual)
 * ship with ENG-060; ENG-061 (scanner pipeline), ENG-062 (ESC/POS + cash
 * drawer), and ENG-063 (Bold/Wompi/MercadoPago) extend the driver matrix
 * without touching this enum.
 *
 * `customer_display` is reserved for a future ticket; ENG-060 surfaces
 * the enum value but no driver registration is permitted.
 */
export const peripheralKindEnum = [
  'printer',
  'cash_drawer',
  'scanner',
  'payment_terminal',
  'customer_display',
] as const;
export type PeripheralKind = (typeof peripheralKindEnum)[number];

/**
 * Last test result captured on the most recent `peripherals.test`
 * invocation. Null when never tested. The admin UI maps this to a
 * status chip (`ok` → green, `failed` → red, null → neutral).
 */
export const peripheralTestResultEnum = ['ok', 'failed'] as const;
export type PeripheralTestResult = (typeof peripheralTestResultEnum)[number];

/**
 * Per-site configuration of physical and virtual peripherals.
 *
 * Lookup pattern (per ADR docs/HARDWARE-POS.md): the registry resolves
 * the active row by `(tenant_id, site_id, kind)` and dispatches to the
 * appropriate adapter via `driver`. The partial unique index enforces
 * "at most one active peripheral per kind per site" — toggling
 * `is_active=0` on the previous row is the migration path when an
 * operator swaps drivers (e.g. system → escpos).
 */
export const sitePeripherals = sqliteTable(
  'site_peripherals',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    kind: text('kind', { enum: peripheralKindEnum }).notNull(),
    /**
     * Driver discriminator — `'system'` / `'escpos'` for printers,
     * `'manual'` / `'bold'` / `'wompi'` / `'mercadopago'` for payment
     * terminals, etc. Each driver self-validates `config_json` via a
     * Zod schema exported alongside its adapter class.
     */
    driver: text('driver').notNull(),
    /** Driver-specific JSON config (e.g. `{channel:'tcp',host:'192.168.1.50',port:9100}` for escpos). */
    config: text('config_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Optional human-friendly label shown on the admin list ("Caja principal", "Cocina"). */
    displayName: text('display_name'),
    /** Soft activation flag; the partial unique only fires on `is_active=1`. */
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    /** ISO timestamp of the most recent `peripherals.test` invocation. */
    lastTestedAt: text('last_tested_at'),
    /** Result of the most recent test; null until first run. */
    lastTestResult: text('last_test_result', { enum: peripheralTestResultEnum }),
    /** Free-form forensics blob for the last test (errors, latency, etc.). */
    lastTestDetails: text('last_test_details', { mode: 'json' })
      .$type<Record<string, unknown> | null>()
      .default(null),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    // Primary lookup path for the registry resolver.
    index('idx_site_peripherals_tenant_site_kind').on(
      table.tenantId,
      table.siteId,
      table.kind
    ),
    // Cross-site listing for the admin index page.
    index('idx_site_peripherals_tenant_kind').on(table.tenantId, table.kind),
    // Partial unique: at most one ACTIVE peripheral per kind per site.
    uniqueIndex('idx_site_peripherals_active_per_kind')
      .on(table.tenantId, table.siteId, table.kind)
      .where(sql`${table.isActive} = 1`),
  ]
);

export const sitePeripheralsRelations = relations(sitePeripherals, ({ one }) => ({
  tenant: one(tenants, {
    fields: [sitePeripherals.tenantId],
    references: [tenants.id],
  }),
  site: one(sites, {
    fields: [sitePeripherals.siteId],
    references: [sites.id],
  }),
}));

export type SitePeripheralRow = typeof sitePeripherals.$inferSelect;
export type NewSitePeripheralRow = typeof sitePeripherals.$inferInsert;

// ============================================================================
// HARDWARE OUTBOX (ENG-062 — ESC/POS printer + cash drawer queue)
// ============================================================================
//
// Mirror of `fiscal_outbox` (ENG-057) for peripheral I/O. ENG-060 deferred
// this table to here because the two default drivers (`system` printer +
// `manual` payment terminal) had no async fan-out. With ENG-062's `escpos`
// driver landing real device I/O — which can fail recoverably on USB
// unplug, paper out, or TCP-host unreachable — the queue lets the cashier
// keep moving while the worker retries in the background.
//
// Status machine + retry policy + claim_token concurrency are inherited
// from `lib/outbox/createOutboxKernel`. The hardware worker
// (`services/peripherals/hardware-worker.ts`) drives state transitions;
// failed receipt prints are recoverable through the standard outbox
// flow without re-triggering the original sale completion.

/**
 * Closed list of hardware outbox lifecycle states. Mirror of the fiscal
 * outbox enum but with `printed` / `failed` instead of accepted / rejected
 * because the printer doesn't issue a verdict — it either flushed bytes
 * to the device or it didn't.
 */
export const hardwareOutboxStatusEnum = [
  'queued',
  'submitting',
  'printed',
  'failed',
  'retrying',
  'dead_letter',
] as const;
export type HardwareOutboxStatus = (typeof hardwareOutboxStatusEnum)[number];

/**
 * Closed list of hardware outbox kinds keyed to the `PrintJobKind` union
 * (`services/peripherals/contracts/receipt-printer.ts`) plus the cash
 * drawer kick. Adding a kind requires updating the worker dispatcher.
 */
export const hardwareOutboxKindEnum = [
  'print-receipt',
  'print-fiscal-dee',
  'print-quotation',
  'print-kitchen-ticket',
  'kick-drawer',
] as const;
export type HardwareOutboxKind = (typeof hardwareOutboxKindEnum)[number];

export const hardwareOutbox = sqliteTable(
  'hardware_outbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    status: text('status', { enum: hardwareOutboxStatusEnum }).notNull().default('queued'),
    kind: text('kind', { enum: hardwareOutboxKindEnum }).notNull(),
    /**
     * The peripheral row that owned this attempt. Nullable + ON DELETE
     * SET NULL so we don't lose history when an admin removes a
     * peripheral row mid-flight; the worker treats null as
     * "peripheral was unregistered" and dead-letters.
     */
    peripheralId: text('peripheral_id').references(() => sitePeripherals.id, {
      onDelete: 'set null',
    }),
    /** Snapshot of the print job + transport opts so the worker can retry without re-resolving. */
    payload: text('payload', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    payloadVersion: integer('payload_version').notNull().default(1),
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: text('next_retry_at'),
    /** `NormalizedHardwareError` + transport-level details written by the kernel on `fail`. */
    lastError: text('last_error', { mode: 'json' })
      .$type<Record<string, unknown> | null>()
      .default(null),
    priority: real('priority').notNull().default(0),
    claimToken: text('claim_token'),
    lockedAt: text('locked_at'),
    /**
     * ENG-067b — envelope-derived dedup key. Nullable so legacy
     * callers without an envelope keep producing independent rows.
     * The partial unique index in 0018 only guards rows where this
     * is non-null. Set by `enqueueHardware` from the input
     * `idempotencyKey`; left null when the caller doesn't pass one.
     */
    idempotencyKey: text('idempotency_key'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    // Primary path for the kernel's claimNext: filter by tenant +
    // status (queued or retrying) ordered by priority + createdAt.
    index('idx_hardware_outbox_tenant_status_retry').on(
      table.tenantId,
      table.status,
      table.nextRetryAt
    ),
    // Drilldown for "show retry history of this peripheral" + admin
    // peripheral-detail surfaces planned for ENG-065.
    index('idx_hardware_outbox_peripheral').on(table.peripheralId),
    // Operations Center listing + peek.
    index('idx_hardware_outbox_tenant_created').on(table.tenantId, table.createdAt),
    // ENG-067b — partial unique idempotency idx is hand-appended in
    // 0018_hardware_outbox_idempotency.sql since SQLite's Drizzle
    // dialect cannot emit `WHERE idempotency_key IS NOT NULL` from
    // the table builder. Mirror of the sync_outbox pattern.
  ]
);

export const hardwareOutboxRelations = relations(hardwareOutbox, ({ one }) => ({
  tenant: one(tenants, {
    fields: [hardwareOutbox.tenantId],
    references: [tenants.id],
  }),
  peripheral: one(sitePeripherals, {
    fields: [hardwareOutbox.peripheralId],
    references: [sitePeripherals.id],
  }),
}));

export type HardwareOutboxRow = typeof hardwareOutbox.$inferSelect;
export type NewHardwareOutboxRow = typeof hardwareOutbox.$inferInsert;

// ============================================================================
// SYNC OUTBOX (ENG-064 — Sync contract v1)
// ============================================================================
//
// Closes ADR-0003's promise of five purpose-specific outboxes. Mirrors the
// kernel projection used by `fiscal_outbox` (ENG-057) and `hardware_outbox`
// (ENG-062) PLUS adds the per-entity contract columns ADR-0002 + ADR-0004
// lock in: payload version, command-envelope correlation
// (idempotency_key + device_id + operation_event_id), conflict policy
// per ADR-0004, and a soft `depends_on_operation_id` for topological
// ordering on the consumer side.
//
// ENG-064b cutover history: 0016_sync_contract_v1 introduced this
// table and backfilled pending rows from the legacy `sync_queue`;
// 0017_drop_sync_queue dropped the legacy table once every writer
// (19 routers + 4 application services + dev seed) routed through
// `enqueueSync()` and the eight `sync.*` procedures cut over to read
// from `sync_outbox`. After 0017 there is a single canonical sync
// table.

/**
 * Closed list of sync outbox lifecycle states. Mirror of the fiscal
 * outbox enum but with `synced`/`conflict` instead of accepted/rejected
 * because sync rows do not get a provider verdict — they either land
 * on the consumer or hit a write conflict that needs resolution.
 */
export const syncOutboxStatusEnum = [
  'queued',
  'submitting',
  'synced',
  'conflict',
  'retrying',
  'dead_letter',
] as const;
export type SyncOutboxStatus = (typeof syncOutboxStatusEnum)[number];

/**
 * Per-entity conflict policy per ADR-0004. `manual` for high-risk
 * entities (sales, cash, fiscal, inventory, audit) where the
 * operator MUST resolve any divergence; `auto_lww` for catalog and
 * preferences where last-write-wins is safe. ENG-064 v1 surfaces
 * the marker; the actual auto-resolution branch in `sync.push` is
 * parked for a follow-up.
 */
export const syncConflictPolicyEnum = ['manual', 'auto_lww'] as const;
export type SyncConflictPolicy = (typeof syncConflictPolicyEnum)[number];

/**
 * Operation kind on the sync row. Three-value enum: `create` /
 * `update` / `delete`. Future: `restore` / `replay` could land
 * here when ENG-066 chaos suite needs them.
 */
export const syncOperationEnum = ['create', 'update', 'delete'] as const;
export type SyncOperation = (typeof syncOperationEnum)[number];

export const syncOutbox = sqliteTable(
  'sync_outbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    status: text('status', { enum: syncOutboxStatusEnum }).notNull().default('queued'),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    operation: text('operation', { enum: syncOperationEnum }).notNull(),
    conflictPolicy: text('conflict_policy', { enum: syncConflictPolicyEnum })
      .notNull()
      .default('auto_lww'),
    /** Snapshot of the entity row at emit time. JSON-serialized. */
    payload: text('payload', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    payloadVersion: integer('payload_version').notNull().default(1),
    /**
     * Command-envelope key (ENG-052). Nullable because catalog /
     * preferences writes are not envelope-wrapped. When present, the
     * partial unique index `idx_sync_outbox_idempotent` collapses
     * duplicate enqueues for retries.
     */
    idempotencyKey: text('idempotency_key'),
    deviceId: text('device_id').references(() => devices.id, { onDelete: 'set null' }),
    /**
     * Soft FK to `operation_events.operation_id`. Carried as a string
     * so the consumer can defer applying this row until the
     * referenced operation is acknowledged. Null when the writer
     * runs outside the command-envelope middleware.
     */
    dependsOnOperationId: text('depends_on_operation_id'),
    /** Hard FK to `operation_events.id` for the journal trail. */
    operationEventId: text('operation_event_id').references(() => operationEvents.id, {
      onDelete: 'set null',
    }),
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: text('next_retry_at'),
    /** `NormalizedOutboxError` written by the kernel on `fail`. */
    lastError: text('last_error', { mode: 'json' })
      .$type<Record<string, unknown> | null>()
      .default(null),
    priority: real('priority').notNull().default(0),
    claimToken: text('claim_token'),
    lockedAt: text('locked_at'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    // Primary path for the kernel's claimNext: filter by tenant +
    // status (queued or retrying) ordered by priority + createdAt.
    index('idx_sync_outbox_tenant_status_retry').on(
      table.tenantId,
      table.status,
      table.nextRetryAt
    ),
    // Per-entity drilldown for "what's pending for this customer
    // record" surfaces (Operations Center).
    index('idx_sync_outbox_entity').on(table.entityType, table.entityId),
    // Operations Center listing + peek.
    index('idx_sync_outbox_tenant_created').on(table.tenantId, table.createdAt),
    // Coalesce duplicate enqueues at the queue layer when an
    // idempotencyKey is present. Catalog writes without an
    // idempotency key are not deduped here because they're
    // idempotent on the consumer side anyway. The partial WHERE
    // clause is applied in the migration SQL with `IF NOT EXISTS`;
    // Drizzle's SQLite dialect cannot emit partial unique indexes
    // generically.
    uniqueIndex('idx_sync_outbox_idempotent')
      .on(
        table.tenantId,
        table.entityType,
        table.entityId,
        table.operation,
        table.idempotencyKey
      )
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  ]
);

export const syncOutboxRelations = relations(syncOutbox, ({ one }) => ({
  tenant: one(tenants, {
    fields: [syncOutbox.tenantId],
    references: [tenants.id],
  }),
  device: one(devices, {
    fields: [syncOutbox.deviceId],
    references: [devices.id],
  }),
  operationEvent: one(operationEvents, {
    fields: [syncOutbox.operationEventId],
    references: [operationEvents.id],
  }),
}));

export type SyncOutboxRow = typeof syncOutbox.$inferSelect;
export type NewSyncOutboxRow = typeof syncOutbox.$inferInsert;

export type FiscalNumberingResolution = typeof fiscalNumberingResolutions.$inferSelect;
export type NewFiscalNumberingResolution = typeof fiscalNumberingResolutions.$inferInsert;
export type FiscalCertificate = typeof fiscalCertificates.$inferSelect;
export type NewFiscalCertificate = typeof fiscalCertificates.$inferInsert;
export type FiscalDocument = typeof fiscalDocuments.$inferSelect;
export type NewFiscalDocument = typeof fiscalDocuments.$inferInsert;
export type FiscalDocumentItem = typeof fiscalDocumentItems.$inferSelect;
export type NewFiscalDocumentItem = typeof fiscalDocumentItems.$inferInsert;

// ============================================================================
// LOGIN RATE-LIMIT STATE (ENG-008b)
// ============================================================================
//
// Persistent counters backing `security/loginRateLimit.ts`. ENG-008
// shipped the policy against an in-memory Map; ENG-008b promotes the DB to
// source of truth so `auth.login` rate limits survive a server restart.
//
// **NOT tenant-scoped**: rate limiting applies per-IP and per-email across
// every tenant. An attacker hammering multiple tenants from the same origin
// should be globally throttled — adding `tenant_id` here would let them
// split attempts across tenants to evade the cap. Documented in
// docs/SECURITY.md §Rate limiting.

/** Two bucket kinds: by client IP, or by normalized (lowercased) email. */
export const loginAttemptKindEnum = ['ip', 'username'] as const;
export type LoginAttemptKind = (typeof loginAttemptKindEnum)[number];

export const loginAttempts = sqliteTable(
  'login_attempts',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: loginAttemptKindEnum }).notNull(),
    /** Either the client IP string or the normalized email. */
    key: text('key').notNull(),
    /** Monotonically increasing count inside the current window. */
    count: integer('count').notNull().default(0),
    /** Epoch millis when the bucket was first touched in the current window. */
    firstAt: integer('first_at').notNull(),
    /** Epoch millis when the bucket expires (firstAt + windowMs). */
    expiresAt: integer('expires_at').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    uniqueIndex('idx_login_attempts_kind_key').on(table.kind, table.key),
    index('idx_login_attempts_expires_at').on(table.expiresAt),
  ]
);

export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type NewLoginAttempt = typeof loginAttempts.$inferInsert;

// ============================================================================
// AI AUDIT LOG (ENG-030 — provider-agnostic call recording + budget control)
// ============================================================================
//
// One row per AI provider call (success and failure) so the admin can see
// total tenant spend, per-site breakdown, per-feature breakdown, and
// per-provider breakdown without crossing tenant boundaries. Budget
// enforcement (`services/ai/client.ts::completeAI`) reads
// `currentMonthSpend` from this table.
//
// `site_id` and `provider_id` are populated from day 1 so future per-site
// reporting / per-site BUDGET enforcement does not require a follow-up
// migration. ENG-030 ships per-tenant single-budget enforcement; the data
// is already wide enough for finer-grained controls later.
//
// Failed calls are persisted with `error_code` set + `cost_usd = 0` so the
// `byBreakdown` reports include error counts (e.g. provider-down minutes
// per site) without joining a separate observability table.

export const aiAuditLog = sqliteTable(
  'ai_audit_log',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id').references(() => sites.id),
    userId: text('user_id').references(() => users.id),
    /** AI feature label (`completeTest`, `copilot`, `autoCategorize`, `embeddings`). */
    feature: text('feature').notNull(),
    /** Provider id (`anthropic`, `openai`, `ollama`). */
    providerId: text('provider_id').notNull(),
    /** Provider-specific model id (e.g. `claude-haiku-4-5`). */
    modelId: text('model_id').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    /** USD cost of this call, computed from the provider's pricing table. */
    costUsd: real('cost_usd').notNull(),
    durationMs: integer('duration_ms').notNull(),
    /** Server errorCode when the call failed; null on success. */
    errorCode: text('error_code'),
    createdAt: text('created_at').notNull().$defaultFn(nowIso),
  },
  table => [
    index('idx_ai_audit_log_tenant_created').on(table.tenantId, table.createdAt),
    index('idx_ai_audit_log_tenant_site_created').on(
      table.tenantId,
      table.siteId,
      table.createdAt
    ),
    index('idx_ai_audit_log_tenant_feature').on(table.tenantId, table.feature),
    index('idx_ai_audit_log_tenant_provider').on(table.tenantId, table.providerId),
  ]
);

export const aiAuditLogRelations = relations(aiAuditLog, ({ one }) => ({
  tenant: one(tenants, {
    fields: [aiAuditLog.tenantId],
    references: [tenants.id],
  }),
  site: one(sites, {
    fields: [aiAuditLog.siteId],
    references: [sites.id],
  }),
  user: one(users, {
    fields: [aiAuditLog.userId],
    references: [users.id],
  }),
}));

export type AIAuditLogRow = typeof aiAuditLog.$inferSelect;
export type NewAIAuditLogRow = typeof aiAuditLog.$inferInsert;

// ============================================================================
// AI ANOMALY SNOOZES (ENG-047)
// ============================================================================

/**
 * Snoozes an alert from `ai.anomalies.list` until `snoozedUntil`. Keyed
 * by (tenant, kind, cashierId, evidenceRef) — a $5000 refund silenced
 * today does not also silence a different high-ticket refund next week
 * because their `evidenceRef` (the saleId) differs.
 *
 * `evidenceRef` is nullable because aggregate detectors (`voidRate`,
 * `noSaleSessions`) flag a cashier rather than a specific event; their
 * snooze rows carry `evidence_ref = NULL` and apply across all alerts of
 * that kind for that cashier.
 */
export const aiAnomalySnoozes = sqliteTable(
  'ai_anomaly_snoozes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    kind: text('kind').notNull(),
    cashierId: text('cashier_id').references(() => users.id),
    evidenceRef: text('evidence_ref'),
    snoozedUntil: text('snoozed_until').notNull(),
    snoozedBy: text('snoozed_by')
      .notNull()
      .references(() => users.id),
    reason: text('reason'),
    createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  },
  table => [
    index('idx_ai_anomaly_snoozes_tenant_until').on(table.tenantId, table.snoozedUntil),
    index('idx_ai_anomaly_snoozes_lookup').on(
      table.tenantId,
      table.kind,
      table.cashierId,
      table.evidenceRef,
      table.snoozedUntil
    ),
  ]
);

export const aiAnomalySnoozesRelations = relations(aiAnomalySnoozes, ({ one }) => ({
  tenant: one(tenants, {
    fields: [aiAnomalySnoozes.tenantId],
    references: [tenants.id],
  }),
  cashier: one(users, {
    fields: [aiAnomalySnoozes.cashierId],
    references: [users.id],
  }),
  snoozedByUser: one(users, {
    fields: [aiAnomalySnoozes.snoozedBy],
    references: [users.id],
  }),
}));

export type AIAnomalySnoozeRow = typeof aiAnomalySnoozes.$inferSelect;
export type NewAIAnomalySnoozeRow = typeof aiAnomalySnoozes.$inferInsert;

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

export type Quotation = typeof quotations.$inferSelect;
export type NewQuotation = typeof quotations.$inferInsert;
export type QuotationItem = typeof quotationItems.$inferSelect;
export type NewQuotationItem = typeof quotationItems.$inferInsert;

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
export type DeviceKind = NonNullable<Device['kind']>;

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;

export type ReceiptTemplate = typeof receiptTemplates.$inferSelect;
export type NewReceiptTemplate = typeof receiptTemplates.$inferInsert;

export type SyncConflict = typeof syncConflicts.$inferSelect;
export type NewSyncConflict = typeof syncConflicts.$inferInsert;

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;

export type CurrencyCatalogRow = typeof currencyCatalog.$inferSelect;
export type NewCurrencyCatalogRow = typeof currencyCatalog.$inferInsert;

export type CountryCatalogRow = typeof countryCatalog.$inferSelect;
export type NewCountryCatalogRow = typeof countryCatalog.$inferInsert;

export type TenantLocaleSettingsRow = typeof tenantLocaleSettings.$inferSelect;
export type NewTenantLocaleSettingsRow = typeof tenantLocaleSettings.$inferInsert;

// ============================================================================
// FISCAL CAFS (ENG-036b — Pack Chile DTE 1.0 — Códigos de Autorización
// de Folios). The SII issues a signed XML CAF that authorizes a tenant
// to emit a TipoDTE in a folio range; this table stores the per-tenant
// metadata + raw CAF XML so the allocator can advance the folio cursor
// atomically with the fiscal_documents insert. Mexico's CFDI 4.0 model
// has no equivalent. ENG-036c adds the upload UI + RSA signature parse.
// ============================================================================

export const fiscalCafStatusEnum = ['active', 'exhausted', 'revoked'] as const;
export type FiscalCafStatus = (typeof fiscalCafStatusEnum)[number];

export const fiscalCafs = sqliteTable(
  'fiscal_cafs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /**
     * SII TipoDTE — '33' factura electrónica, '39' boleta electrónica,
     * '61' nota crédito, etc. See `services/fiscal/packs/cl/catalogs/tipoDte.ts`
     * for the curated set ENG-036a shipped.
     */
    tipoDte: text('tipo_dte').notNull(),
    /** RUT emisor — soft-FK to `tenants.settings.fiscal.cl.rut` at ingestion. */
    rutEmisor: text('rut_emisor').notNull(),
    folioDesde: integer('folio_desde').notNull(),
    folioHasta: integer('folio_hasta').notNull(),
    /**
     * Cursor: next folio to allocate. Starts at folio_desde; advances
     * by one per emission until > folio_hasta → status='exhausted'.
     */
    currentFolio: integer('current_folio').notNull(),
    fechaAutorizacion: text('fecha_autorizacion').notNull(),
    /** Raw CAF XML preserved for ENG-036c TED RSA signing. */
    rawXml: text('raw_xml').notNull(),
    status: text('status', { enum: fiscalCafStatusEnum }).notNull().default('active'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  table => [
    // Primary lookup: the active CAF for a (tenant, tipoDte) pair.
    // Partial unique idx — one active CAF per pair, enforced at the
    // schema level. Exhausted/revoked rows free the slot.
    uniqueIndex('idx_fiscal_cafs_active')
      .on(table.tenantId, table.tipoDte)
      .where(sql`${table.status} = 'active'`),
    // Admin listing of all CAFs (active + historical) for a tenant.
    index('idx_fiscal_cafs_tenant').on(table.tenantId, table.status),
  ]
);

export const fiscalCafsRelations = relations(fiscalCafs, ({ one }) => ({
  tenant: one(tenants, {
    fields: [fiscalCafs.tenantId],
    references: [tenants.id],
  }),
}));

export type FiscalCafRow = typeof fiscalCafs.$inferSelect;
export type NewFiscalCafRow = typeof fiscalCafs.$inferInsert;
