import { sql } from 'drizzle-orm';
import { check, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { nowIso, sqliteNow } from './base.js';

/**
 * Installation-local ownership boundary, not tenant data or a sync entity.
 * Completion survives deletion of business rows so an owned database never
 * silently becomes an unauthenticated first-run installation again.
 */
export const installationSetup = sqliteTable(
  'installation_setup',
  {
    id: text('id').primaryKey(),
    completedAt: text('completed_at'),
    completionKind: text('completion_kind', { enum: ['owner_claim', 'adopted'] }),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    check('installation_setup_singleton', sql`${table.id} = 'local'`),
    check(
      'installation_setup_completion',
      sql`(${table.completedAt} IS NULL AND ${table.completionKind} IS NULL) OR (${table.completedAt} IS NOT NULL AND ${table.completionKind} IS NOT NULL AND ${table.completionKind} IN ('owner_claim', 'adopted'))`
    ),
  ]
);
