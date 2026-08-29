/**
 * Normalized tax components for catalog and immutable document lines.
 *
 * The legacy taxRate/taxKind/taxAmount columns remain compatibility summaries
 * during the transition. These child rows are the source of truth whenever
 * they exist. Position is both presentation order and a database-enforced
 * maximum of four components per parent line.
 */
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { moneyPositiveChecks, nowIso, sqliteNow, taxKindEnum } from './base.js';
import { tenants } from './auth.js';
import { vatRates } from './catalogs.js';
import { products } from './products.js';
import { saleItems } from './salesAux.js';
import { quotationItems } from './quotationsAudit.js';
import { fiscalDocumentItems } from './fiscal.js';

function componentColumns() {
  return {
    componentKey: text('component_key').notNull(),
    vatRateId: text('vat_rate_id').references(() => vatRates.id),
    taxKind: text('tax_kind', { enum: taxKindEnum }).notNull(),
    taxRate: real('tax_rate').notNull(),
    position: integer('position').notNull(),
  };
}

export const productTaxComponents = sqliteTable(
  'product_tax_components',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    ...componentColumns(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_product_tax_components_tenant_product').on(table.tenantId, table.productId),
    uniqueIndex('idx_product_tax_components_key').on(table.productId, table.componentKey),
    uniqueIndex('idx_product_tax_components_position').on(table.productId, table.position),
    check('chk_product_tax_components_position', sql`${table.position} between 0 and 3`),
    check(
      'chk_product_tax_components_rate',
      sql`${table.taxRate} >= 0 and ${table.taxRate} <= 100`
    ),
  ]
);

function snapshotColumns() {
  return {
    componentKey: text('component_key').notNull(),
    // Immutable lineage only. Snapshot rows must not depend on a mutable
    // catalog row continuing to exist after the sale or quotation is frozen.
    vatRateId: text('vat_rate_id'),
    taxKind: text('tax_kind', { enum: taxKindEnum }).notNull(),
    taxRate: real('tax_rate').notNull(),
    position: integer('position').notNull(),
    taxableAmount: real('taxable_amount').notNull().default(0),
    taxAmount: real('tax_amount').notNull().default(0),
  };
}

export const saleItemTaxComponents = sqliteTable(
  'sale_item_tax_components',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleItemId: text('sale_item_id')
      .notNull()
      .references(() => saleItems.id, { onDelete: 'cascade' }),
    ...snapshotColumns(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_sale_item_tax_components_tenant_line').on(table.tenantId, table.saleItemId),
    uniqueIndex('idx_sale_item_tax_components_key').on(table.saleItemId, table.componentKey),
    uniqueIndex('idx_sale_item_tax_components_position').on(table.saleItemId, table.position),
    check('chk_sale_item_tax_components_position', sql`${table.position} between 0 and 3`),
    check(
      'chk_sale_item_tax_components_rate',
      sql`${table.taxRate} >= 0 and ${table.taxRate} <= 100`
    ),
    ...moneyPositiveChecks('sale_item_tax_components_base', table.taxableAmount),
    ...moneyPositiveChecks('sale_item_tax_components_tax', table.taxAmount),
  ]
);

export const quotationItemTaxComponents = sqliteTable(
  'quotation_item_tax_components',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    quotationItemId: text('quotation_item_id')
      .notNull()
      .references(() => quotationItems.id, { onDelete: 'cascade' }),
    ...snapshotColumns(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_quotation_item_tax_components_tenant_line').on(
      table.tenantId,
      table.quotationItemId
    ),
    uniqueIndex('idx_quotation_item_tax_components_key').on(
      table.quotationItemId,
      table.componentKey
    ),
    uniqueIndex('idx_quotation_item_tax_components_position').on(
      table.quotationItemId,
      table.position
    ),
    check('chk_quotation_item_tax_components_position', sql`${table.position} between 0 and 3`),
    check(
      'chk_quotation_item_tax_components_rate',
      sql`${table.taxRate} >= 0 and ${table.taxRate} <= 100`
    ),
    ...moneyPositiveChecks('quotation_item_tax_components_base', table.taxableAmount),
    ...moneyPositiveChecks('quotation_item_tax_components_tax', table.taxAmount),
  ]
);

export const fiscalDocumentItemTaxComponents = sqliteTable(
  'fiscal_document_item_tax_components',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    fiscalDocumentItemId: text('fiscal_document_item_id')
      .notNull()
      .references(() => fiscalDocumentItems.id, { onDelete: 'cascade' }),
    componentKey: text('component_key').notNull(),
    taxKind: text('tax_kind', { enum: taxKindEnum }).notNull(),
    taxCategoryCode: text('tax_category_code').notNull(),
    taxRate: real('tax_rate').notNull(),
    taxableAmount: real('taxable_amount').notNull().default(0),
    taxAmount: real('tax_amount').notNull().default(0),
    position: integer('position').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_fiscal_item_tax_components_tenant_line').on(
      table.tenantId,
      table.fiscalDocumentItemId
    ),
    uniqueIndex('idx_fiscal_item_tax_components_key').on(
      table.fiscalDocumentItemId,
      table.componentKey
    ),
    uniqueIndex('idx_fiscal_item_tax_components_position').on(
      table.fiscalDocumentItemId,
      table.position
    ),
    check('chk_fiscal_item_tax_components_position', sql`${table.position} between 0 and 3`),
    check(
      'chk_fiscal_item_tax_components_rate',
      sql`${table.taxRate} >= 0 and ${table.taxRate} <= 100`
    ),
    ...moneyPositiveChecks('fiscal_item_tax_components_base', table.taxableAmount),
    ...moneyPositiveChecks('fiscal_item_tax_components_tax', table.taxAmount),
  ]
);

export const productTaxComponentsRelations = relations(productTaxComponents, ({ one }) => ({
  tenant: one(tenants, { fields: [productTaxComponents.tenantId], references: [tenants.id] }),
  product: one(products, { fields: [productTaxComponents.productId], references: [products.id] }),
  vatRate: one(vatRates, { fields: [productTaxComponents.vatRateId], references: [vatRates.id] }),
}));

export const saleItemTaxComponentsRelations = relations(saleItemTaxComponents, ({ one }) => ({
  tenant: one(tenants, { fields: [saleItemTaxComponents.tenantId], references: [tenants.id] }),
  saleItem: one(saleItems, {
    fields: [saleItemTaxComponents.saleItemId],
    references: [saleItems.id],
  }),
}));

export const quotationItemTaxComponentsRelations = relations(
  quotationItemTaxComponents,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [quotationItemTaxComponents.tenantId],
      references: [tenants.id],
    }),
    quotationItem: one(quotationItems, {
      fields: [quotationItemTaxComponents.quotationItemId],
      references: [quotationItems.id],
    }),
  })
);

export const fiscalDocumentItemTaxComponentsRelations = relations(
  fiscalDocumentItemTaxComponents,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [fiscalDocumentItemTaxComponents.tenantId],
      references: [tenants.id],
    }),
    fiscalDocumentItem: one(fiscalDocumentItems, {
      fields: [fiscalDocumentItemTaxComponents.fiscalDocumentItemId],
      references: [fiscalDocumentItems.id],
    }),
  })
);
