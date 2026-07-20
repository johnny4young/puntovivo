/**
 * Drizzle schema — auth domain.
 *
 * relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/auth
 */
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { nowIso, sqliteNow, userRoleEnum } from './base.js';
import {
  categories,
  cities,
  countries,
  departments,
  locationXSite,
  locations,
  providers,
  sequentials,
  units,
  vatRates,
} from './catalogs.js';
import { categoryXProvider, products } from './products.js';
import {
  clientTypes,
  commercialActivities,
  customers,
  identificationTypes,
  personTypes,
  regimeTypes,
} from './customers.js';
import { orders, purchaseReturns, purchases } from './purchasing.js';
import { cashMovements, cashSessions, denominationTemplates, sales } from './sales.js';
import { saleReturns } from './salesAux.js';
import { initialInventory, inventoryBalances, inventoryMovements } from './inventory.js';
import { currencyCatalog } from './config.js';

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
    // canonical default currency for the tenant. Filled by
    // migration 0037 via COALESCE(tenant_locale_settings.currency_override,
    // country_catalog.default_currency_code via tenant_locale_settings.country_code,
    // json_extract(settings, '$.currency'), 'COP'). Read by
    // `resolveTenantCurrency()` at every monetary write boundary so app code
    // never has to parse tenants.settings JSON on the hot path. FK to
    // currency_catalog so the value is always a known ISO-4217 code.
    defaultCurrencyCode: text('default_currency_code')
      .notNull()
      .default('COP')
      .references(() => currencyCatalog.code),
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
    // optional fast-switch credential. Stored as an Argon2id
    // hash and never projected into user/sync/audit responses.
    staffPinHash: text('staff_pin_hash'),
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
// REFRESH TOKEN FAMILIES
// ============================================================================

/**
 * One row per live refresh-token *family* (login session). Every refresh
 * rotation swaps `current_jti` for a fresh id; presenting a refresh token
 * whose `jti` no longer matches means an OLD (already-rotated) token was
 * replayed — i.e. the cookie was stolen — and the whole family is revoked
 * plus the user's `sessionVersion` bumped. Auditoría 2026-07 follow-up:
 * without this, a stolen refresh JWT stayed usable for its full 7-day TTL.
 *
 * `previous_jti` + a short rotation-grace window absorb the benign
 * concurrent-refresh case (two POS tabs share one httpOnly cookie and can
 * both POST `auth.refresh` before either sees the rotated cookie): a
 * replay of the *immediately-previous* jti within the grace window is a
 * race, not theft, so the family is NOT revoked — the standard OAuth
 * rotation-leeway pattern. Only a stale-or-older jti trips revocation.
 */
export const authRefreshFamilies = sqliteTable(
  'auth_refresh_families',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** The jti of the newest (only-valid) refresh token in the family. */
    currentJti: text('current_jti').notNull(),
    /**
     * The jti this family rotated away from on its last rotation. Null on
     * a freshly-created family. Reused within the grace window ⇒ benign
     * concurrent refresh; reused after it (or an even older jti) ⇒ theft.
     */
    previousJti: text('previous_jti'),
    issuedAt: text('issued_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    lastRotatedAt: text('last_rotated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    /** ISO timestamp mirroring the refresh JWT TTL; prune target. */
    expiresAt: text('expires_at').notNull(),
  },
  table => [
    index('idx_auth_refresh_families_user').on(table.userId),
    index('idx_auth_refresh_families_expires').on(table.expiresAt),
  ]
);

export const authRefreshFamiliesRelations = relations(authRefreshFamilies, ({ one }) => ({
  tenant: one(tenants, {
    fields: [authRefreshFamilies.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [authRefreshFamilies.userId],
    references: [users.id],
  }),
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
