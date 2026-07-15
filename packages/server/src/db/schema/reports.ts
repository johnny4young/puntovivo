/**
 * Drizzle schema — immutable report evidence.
 *
 * ENG-141b stores one manager-signed comprehensive day-close snapshot per
 * tenant business date. There is deliberately no updated_at column: the row
 * is append-only evidence, and the migration adds database triggers that
 * reject UPDATE and DELETE in addition to the service exposing no mutator.
 *
 * @module db/schema/reports
 */
import { relations } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { tenants, users } from './auth.js';

export const DAY_CLOSE_SIGNOFF_SCHEMA_VERSION = 1 as const;

export const dayCloseSignoffs = sqliteTable(
  'day_close_signoffs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    businessDate: text('business_date').notNull(),
    schemaVersion: integer('schema_version').notNull().default(DAY_CLOSE_SIGNOFF_SCHEMA_VERSION),
    timeZone: text('time_zone').notNull(),
    currencyCode: text('currency_code').notNull(),
    reportSnapshot: text('report_snapshot', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    reportHash: text('report_hash').notNull(),
    signedByUserId: text('signed_by_user_id')
      .notNull()
      .references(() => users.id),
    /** Name frozen at attestation time so later profile edits do not rewrite evidence. */
    signedByName: text('signed_by_name').notNull(),
    signedAt: text('signed_at').notNull(),
  },
  table => [
    uniqueIndex('idx_day_close_signoffs_tenant_date').on(table.tenantId, table.businessDate),
    index('idx_day_close_signoffs_tenant_signed_at').on(table.tenantId, table.signedAt),
  ]
);

export const dayCloseSignoffsRelations = relations(dayCloseSignoffs, ({ one }) => ({
  tenant: one(tenants, {
    fields: [dayCloseSignoffs.tenantId],
    references: [tenants.id],
  }),
  signer: one(users, {
    fields: [dayCloseSignoffs.signedByUserId],
    references: [users.id],
  }),
}));

export type DayCloseSignoff = typeof dayCloseSignoffs.$inferSelect;
export type NewDayCloseSignoff = typeof dayCloseSignoffs.$inferInsert;
