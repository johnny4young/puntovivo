/**
 * Drizzle schema — a register passed from one cashier to the next mid-day.
 *
 * @module db/schema/cashHandoffs
 */
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { sites, tenants, users } from './auth.js';
import { moneyPositiveChecks, nowIso, sqliteNow } from './base.js';
import type { CashSessionDenomination } from './base.js';
import { cashSessions } from './sales.js';

export const cashHandoffStatusEnum = ['pending', 'received', 'superseded'] as const;

/** Keep the counted drawer (recount it) or start over with a fresh float. */
export const cashHandoffReceiveModeEnum = ['counted_drawer', 'new_drawer'] as const;
export type CashHandoffReceiveMode = (typeof cashHandoffReceiveModeEnum)[number];

/** `session` means the signer had no staff PIN enrolled. */
export const cashHandoffSignatureEnum = ['pin', 'session'] as const;
export type CashHandoffSignature = (typeof cashHandoffSignatureEnum)[number];

export const cashSessionHandoffs = sqliteTable(
  'cash_session_handoffs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    registerName: text('register_name').notNull(),
    fromSessionId: text('from_session_id')
      .notNull()
      .references(() => cashSessions.id),
    fromCashierId: text('from_cashier_id')
      .notNull()
      .references(() => users.id),
    // The named recipient while pending; whoever received it afterwards.
    toCashierId: text('to_cashier_id').references(() => users.id),
    toSessionId: text('to_session_id').references(() => cashSessions.id),
    status: text('status', { enum: cashHandoffStatusEnum }).notNull().default('pending'),
    outgoingCount: real('outgoing_count').notNull(),
    outgoingDenominations: text('outgoing_denominations', { mode: 'json' })
      .$type<CashSessionDenomination[]>()
      .notNull(),
    note: text('note'),
    fromSignature: text('from_signature', { enum: cashHandoffSignatureEnum }).notNull(),
    handedOverAt: text('handed_over_at').notNull(),
    receiveMode: text('receive_mode', { enum: cashHandoffReceiveModeEnum }),
    // Recount of the kept drawer; null when the receiver starts a new drawer.
    receivedCount: real('received_count'),
    receivedDenominations: text('received_denominations', { mode: 'json' }).$type<
      CashSessionDenomination[] | null
    >(),
    toSignature: text('to_signature', { enum: cashHandoffSignatureEnum }),
    reassignedDraftCount: integer('reassigned_draft_count').notNull().default(0),
    receivedAt: text('received_at'),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    uniqueIndex('idx_cash_handoffs_from_session').on(table.fromSessionId),
    uniqueIndex('idx_cash_handoffs_pending_register')
      .on(table.tenantId, table.siteId, table.registerName)
      .where(sql`${table.status} = 'pending'`),
    index('idx_cash_handoffs_tenant_status').on(table.tenantId, table.status),
    index('idx_cash_handoffs_tenant_to_session').on(table.tenantId, table.toSessionId),
    ...moneyPositiveChecks('cash_handoffs_outgoing', table.outgoingCount),
    ...moneyPositiveChecks('cash_handoffs_received', table.receivedCount),
  ]
);
