/**
 * Blind physical-count sessions and their immutable stock snapshots.
 *
 * A count line snapshots the authoritative site balance when the session is
 * opened. While the session is `counting`, read models redact that snapshot;
 * it only becomes reviewable after submission. Approval re-checks every
 * balance under the SQLite writer reservation before applying discrepancies.
 *
 * @module db/schema/inventory/counts
 */

import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { inventoryCountStatusEnum, nowIso, sqliteNow, syncStatusEnum } from '../base.js';
import { sites, tenants, users } from '../auth.js';
import { units } from '../catalogs.js';
import { products } from '../products.js';

export const inventoryCountSessions = sqliteTable(
  'inventory_count_sessions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    status: text('status', { enum: inventoryCountStatusEnum }).notNull().default('counting'),
    isBlind: integer('is_blind', { mode: 'boolean' }).notNull().default(true),
    notes: text('notes'),
    rejectionReason: text('rejection_reason'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    submittedBy: text('submitted_by').references(() => users.id),
    approvedBy: text('approved_by').references(() => users.id),
    rejectedBy: text('rejected_by').references(() => users.id),
    submittedAt: text('submitted_at'),
    approvedAt: text('approved_at'),
    rejectedAt: text('rejected_at'),
    version: integer('version').notNull().default(0),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_inventory_count_sessions_tenant_created').on(table.tenantId, table.createdAt),
    index('idx_inventory_count_sessions_tenant_site_status').on(
      table.tenantId,
      table.siteId,
      table.status
    ),
  ]
);

export const inventoryCountLines = sqliteTable(
  'inventory_count_lines',
  {
    id: text('id').primaryKey(),
    // Denormalized tenant ownership makes every read and repair query
    // independently scopeable even if a damaged FK points at another tenant.
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => inventoryCountSessions.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),
    expectedQuantity: real('expected_quantity').notNull(),
    expectedBalanceVersion: integer('expected_balance_version').notNull().default(0),
    countedQuantity: real('counted_quantity'),
    discrepancy: real('discrepancy'),
    unitCostSnapshot: real('unit_cost_snapshot').notNull().default(0),
    countedBy: text('counted_by').references(() => users.id),
    countedAt: text('counted_at'),
    version: integer('version').notNull().default(0),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    uniqueIndex('idx_inventory_count_lines_session_product').on(
      table.tenantId,
      table.sessionId,
      table.productId
    ),
    index('idx_inventory_count_lines_tenant_product').on(table.tenantId, table.productId),
    index('idx_inventory_count_lines_session').on(table.sessionId),
    // The frozen book balance may legitimately be negative after an imported
    // or historical shortfall. A physical count must be able to reconcile
    // that state; only the operator-entered physical quantity is non-negative.
    check(
      'inventory_count_lines_counted_nonnegative',
      sql`${table.countedQuantity} IS NULL OR ${table.countedQuantity} >= 0`
    ),
    check('inventory_count_lines_cost_nonnegative', sql`${table.unitCostSnapshot} >= 0`),
  ]
);

export const inventoryCountSessionsRelations = relations(
  inventoryCountSessions,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [inventoryCountSessions.tenantId],
      references: [tenants.id],
    }),
    site: one(sites, {
      fields: [inventoryCountSessions.siteId],
      references: [sites.id],
    }),
    createdByUser: one(users, {
      fields: [inventoryCountSessions.createdBy],
      references: [users.id],
    }),
    lines: many(inventoryCountLines),
  })
);

export const inventoryCountLinesRelations = relations(inventoryCountLines, ({ one }) => ({
  session: one(inventoryCountSessions, {
    fields: [inventoryCountLines.sessionId],
    references: [inventoryCountSessions.id],
  }),
  tenant: one(tenants, {
    fields: [inventoryCountLines.tenantId],
    references: [tenants.id],
  }),
  product: one(products, {
    fields: [inventoryCountLines.productId],
    references: [products.id],
  }),
  unit: one(units, {
    fields: [inventoryCountLines.unitId],
    references: [units.id],
  }),
}));
