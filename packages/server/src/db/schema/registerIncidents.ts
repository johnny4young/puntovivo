/**
 * Drizzle schema — incidents a cashier reports from the till without leaving the sale.
 *
 * @module db/schema/registerIncidents
 */
import { index, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { sites, tenants, users } from './auth.js';
import { nowIso, sqliteNow } from './base.js';
import { products } from './products.js';
import { cashSessions } from './sales.js';

export const registerIncidentKindEnum = [
  'stockout',
  'price_mismatch',
  'no_barcode',
  'call_manager',
] as const;
export type RegisterIncidentKind = (typeof registerIncidentKindEnum)[number];

/** Stockout reasons as the cashier sees them; the other kinds carry no reason code. */
export const registerIncidentReasonEnum = ['not_on_shelf', 'system_zero', 'expired'] as const;
export type RegisterIncidentReason = (typeof registerIncidentReasonEnum)[number];

export const registerIncidentStatusEnum = ['open', 'resolved'] as const;
export type RegisterIncidentStatus = (typeof registerIncidentStatusEnum)[number];

export const registerIncidents = sqliteTable(
  'register_incidents',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    kind: text('kind', { enum: registerIncidentKindEnum }).notNull(),
    reason: text('reason', { enum: registerIncidentReasonEnum }),
    productId: text('product_id').references(() => products.id, { onDelete: 'set null' }),
    // Snapshot so the row stays readable if the product is renamed or deleted.
    productName: text('product_name'),
    shelfPrice: real('shelf_price'),
    systemPrice: real('system_price'),
    note: text('note'),
    reportedBy: text('reported_by')
      .notNull()
      .references(() => users.id),
    cashSessionId: text('cash_session_id').references(() => cashSessions.id),
    status: text('status', { enum: registerIncidentStatusEnum }).notNull().default('open'),
    resolvedAt: text('resolved_at'),
    resolvedBy: text('resolved_by').references(() => users.id),
    resolutionNote: text('resolution_note'),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_register_incidents_tenant_status_created').on(
      table.tenantId,
      table.status,
      table.createdAt
    ),
    index('idx_register_incidents_tenant_site_status').on(
      table.tenantId,
      table.siteId,
      table.status
    ),
  ]
);
