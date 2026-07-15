/**
 * Drizzle schema — short-lived manager approval requests (ENG-106c1).
 *
 * Approval rows carry identity and decision evidence, never credentials.
 * The manager/admin PIN is verified per decision and is not persisted in
 * this table or returned to the requesting cashier.
 *
 * @module db/schema/approvals
 */
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { sites, tenants, users } from './auth.js';
import { nowIso, sqliteNow } from './base.js';

export const managerApprovalActionEnum = [
  'credit_override',
  'sale_void',
  'sale_discount',
  'cash_drawer_open',
  'sale_refund',
  'credit_sale',
] as const;
export type ManagerApprovalAction = (typeof managerApprovalActionEnum)[number];

export const managerApprovalStatusEnum = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'executing',
  'consumed',
  'expired',
] as const;
export type ManagerApprovalStatus = (typeof managerApprovalStatusEnum)[number];

export interface ManagerApprovalSummary {
  label: string;
  amount?: number | undefined;
  currencyCode?: string | undefined;
}

export const managerApprovalRequests = sqliteTable(
  'manager_approval_requests',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    requesterId: text('requester_id')
      .notNull()
      .references(() => users.id),
    action: text('action', { enum: managerApprovalActionEnum }).notNull(),
    status: text('status', { enum: managerApprovalStatusEnum })
      .notNull()
      .default('pending'),
    reason: text('reason').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    summary: text('summary', { mode: 'json' }).$type<ManagerApprovalSummary>().notNull(),
    requestedAt: text('requested_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    decidedAt: text('decided_at'),
    decidedBy: text('decided_by').references(() => users.id),
    decisionReason: text('decision_reason'),
    grantExpiresAt: text('grant_expires_at'),
    claimToken: text('claim_token'),
    claimExpiresAt: text('claim_expires_at'),
    consumedAt: text('consumed_at'),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_manager_approvals_tenant_status_requested').on(
      table.tenantId,
      table.status,
      table.requestedAt
    ),
    index('idx_manager_approvals_tenant_site_status').on(
      table.tenantId,
      table.siteId,
      table.status
    ),
    index('idx_manager_approvals_tenant_requester_requested').on(
      table.tenantId,
      table.requesterId,
      table.requestedAt
    ),
    index('idx_manager_approvals_grant_expiry').on(table.status, table.grantExpiresAt),
  ]
);

export const managerApprovalRequestsRelations = relations(
  managerApprovalRequests,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [managerApprovalRequests.tenantId],
      references: [tenants.id],
    }),
    site: one(sites, {
      fields: [managerApprovalRequests.siteId],
      references: [sites.id],
    }),
    requester: one(users, {
      fields: [managerApprovalRequests.requesterId],
      references: [users.id],
      relationName: 'manager_approval_requester',
    }),
    decider: one(users, {
      fields: [managerApprovalRequests.decidedBy],
      references: [users.id],
      relationName: 'manager_approval_decider',
    }),
  })
);

export type ManagerApprovalRequest = typeof managerApprovalRequests.$inferSelect;
export type NewManagerApprovalRequest = typeof managerApprovalRequests.$inferInsert;
