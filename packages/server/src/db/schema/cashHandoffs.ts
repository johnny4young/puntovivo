/**
 * Drizzle schema — a drawer passed from one cashier to the next.
 *
 * @module db/schema/cashHandoffs
 */
import { index, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { sites, tenants, users } from './auth.js';
import { nowIso, sqliteNow, type CashSessionDenomination } from './base.js';
import { cashSessions } from './sales.js';

export const cashHandoffReceiveModeEnum = ['counted_drawer', 'new_float'] as const;
export type CashHandoffReceiveMode = (typeof cashHandoffReceiveModeEnum)[number];

export interface CashHandoffNotice {
  kind: 'low_change' | 'printer';
  /** Denomination values short of change; empty for a printer notice. */
  values: number[];
  /** Print jobs that did not come out; zero for a low-change notice. */
  count: number;
  since: string | null;
}

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
    fromUserId: text('from_user_id')
      .notNull()
      .references(() => users.id),
    // Frozen at signing so a later rename does not rewrite who handed over.
    fromUserName: text('from_user_name').notNull(),
    countedTotal: real('counted_total').notNull(),
    countedDenominations: text('counted_denominations', { mode: 'json' })
      .$type<CashSessionDenomination[]>()
      .notNull(),
    note: text('note'),
    carriedSaleIds: text('carried_sale_ids', { mode: 'json' }).$type<string[]>().notNull(),
    notices: text('notices', { mode: 'json' }).$type<CashHandoffNotice[]>().notNull(),
    // Null until the next cashier receives the drawer.
    toSessionId: text('to_session_id').references(() => cashSessions.id),
    toUserId: text('to_user_id').references(() => users.id),
    toUserName: text('to_user_name'),
    receiveMode: text('receive_mode', { enum: cashHandoffReceiveModeEnum }),
    recountTotal: real('recount_total'),
    recountDenominations: text('recount_denominations', { mode: 'json' }).$type<
      CashSessionDenomination[] | null
    >(),
    // Recount minus the outgoing count; it never touches either session's over/short.
    recountDifference: real('recount_difference'),
    receivedAt: text('received_at'),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_cash_session_handoffs_tenant_site_created').on(
      table.tenantId,
      table.siteId,
      table.createdAt
    ),
    index('idx_cash_session_handoffs_tenant_from_session').on(table.tenantId, table.fromSessionId),
  ]
);

export type CashSessionHandoff = typeof cashSessionHandoffs.$inferSelect;
