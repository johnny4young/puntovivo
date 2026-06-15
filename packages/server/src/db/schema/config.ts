/**
 * Drizzle schema — config domain.
 *
 * ENG-178 — relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/config
 */
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { nowIso, receiptTemplateKindEnum, receiptTemplatePaperWidthEnum, sqliteNow } from './base.js';
import { tenants, users } from './auth.js';

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
    // At most ONE default template per (tenant, kind); non-default rows
    // are unlimited. Previously hand-appended SQL (the old
    // 0001_receipt_templates.sql) because drizzle could not emit partial
    // indexes; declared here since the 2026-06 baseline squash.
    uniqueIndex('idx_receipt_templates_tenant_kind_default')
      .on(table.tenantId, table.kind)
      .where(sql`${table.isDefault} = 1`),
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
  // ENG-177a — optimistic-concurrency guard (see products.version).
  version: integer('version').notNull().default(0),
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
// ENG-176c — Global, read-only catalog of fiscal identification types
// scoped by ISO-3166 country code. Renamed from `dian_identification_types`
// (Colombia DIAN, ENG-020 Phase A) to `fiscal_identification_types` so SAT
// México (CFDI), SUNAT Perú (Catálogo Nº 6), and SII Chile (RUT/RUN) rows
// can coexist with DIAN entries without code collisions — DIAN '13'
// (Cédula de Ciudadanía) and SUNAT '1' (DNI) are different codes that
// happen to occupy the same single-column PK space pre-rename.
// Seeded on boot by `seedFiscalIdentificationTypes()` in `db/index.ts`.
// Keyed by composite (country_code, code).
//
// Distinct from the existing tenant-scoped `identification_types` table,
// which stores each tenant's custom catalog for UX flows. The two link
// only via `abbr` when a tenant wires up their identificationTypes row
// to a fiscal code (that mapping is out of scope for ENG-176c and is
// handled by operator choice in the admin fiscal settings later).

/** Global, read-only fiscal identification type catalog. Seeded at boot. */
export const fiscalIdentificationTypes = sqliteTable(
  'fiscal_identification_types',
  {
    /** ISO-3166 alpha-2 country code ('CO', 'MX', 'PE', 'CL'). */
    countryCode: text('country_code')
      .notNull()
      .references(() => countryCatalog.code),
    /** Authority-issued code ('13' for DIAN CC, 'RFC' for SAT, '1' for SUNAT DNI). */
    code: text('code').notNull(),
    /** Short human-friendly abbreviation ('CC', 'NIT', 'CE'). */
    abbr: text('abbr').notNull(),
    nameEs: text('name_es').notNull(),
    nameEn: text('name_en').notNull(),
    /** When the type is issued to natural persons (vs. legal entities). */
    naturalPerson: integer('natural_person', { mode: 'boolean' })
      .notNull()
      .default(true),
  },
  table => [
    primaryKey({ columns: [table.countryCode, table.code] }),
  ]
);

export type FiscalIdentificationType =
  typeof fiscalIdentificationTypes.$inferSelect;
export type NewFiscalIdentificationType =
  typeof fiscalIdentificationTypes.$inferInsert;
