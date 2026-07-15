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
import {
  blob,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { tenants, users } from './auth.js';

export const DAY_CLOSE_SIGNOFF_SCHEMA_VERSION = 1 as const;
export const DAY_CLOSE_PDF_RENDERER_VERSION = 1 as const;
export const DAY_CLOSE_PDF_MIME_TYPE = 'application/pdf' as const;

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
    uniqueIndex('idx_day_close_signoffs_tenant_id').on(table.tenantId, table.id),
    index('idx_day_close_signoffs_tenant_signed_at').on(table.tenantId, table.signedAt),
  ]
);

/**
 * ENG-141c — binary evidence generated before the irreversible sign-off commits.
 *
 * The BLOB lives in a separate one-to-one table so future delivery records do
 * not expand the core attestation row. Composite tenant/signoff ownership is
 * enforced in SQLite, and migration triggers make the artifact append-only.
 */
export const dayCloseArtifacts = sqliteTable(
  'day_close_artifacts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    signoffId: text('signoff_id').notNull(),
    rendererVersion: integer('renderer_version').notNull().default(DAY_CLOSE_PDF_RENDERER_VERSION),
    locale: text('locale').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull().default(DAY_CLOSE_PDF_MIME_TYPE),
    byteSize: integer('byte_size').notNull(),
    payloadHash: text('payload_hash').notNull(),
    reportHash: text('report_hash').notNull(),
    payload: blob('payload', { mode: 'buffer' }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  table => [
    foreignKey({
      columns: [table.tenantId, table.signoffId],
      foreignColumns: [dayCloseSignoffs.tenantId, dayCloseSignoffs.id],
      name: 'fk_day_close_artifacts_tenant_signoff',
    }),
    uniqueIndex('idx_day_close_artifacts_tenant_signoff').on(table.tenantId, table.signoffId),
    index('idx_day_close_artifacts_tenant_created').on(table.tenantId, table.createdAt),
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
  artifact: one(dayCloseArtifacts, {
    fields: [dayCloseSignoffs.tenantId, dayCloseSignoffs.id],
    references: [dayCloseArtifacts.tenantId, dayCloseArtifacts.signoffId],
  }),
}));

export const dayCloseArtifactsRelations = relations(dayCloseArtifacts, ({ one }) => ({
  tenant: one(tenants, {
    fields: [dayCloseArtifacts.tenantId],
    references: [tenants.id],
  }),
  signoff: one(dayCloseSignoffs, {
    fields: [dayCloseArtifacts.tenantId, dayCloseArtifacts.signoffId],
    references: [dayCloseSignoffs.tenantId, dayCloseSignoffs.id],
  }),
}));

export type DayCloseSignoff = typeof dayCloseSignoffs.$inferSelect;
export type NewDayCloseSignoff = typeof dayCloseSignoffs.$inferInsert;
export type DayCloseArtifact = typeof dayCloseArtifacts.$inferSelect;
export type NewDayCloseArtifact = typeof dayCloseArtifacts.$inferInsert;
