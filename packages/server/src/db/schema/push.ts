/**
 * Drizzle schema — browsers that asked for owner push notifications.
 *
 * Installation-local and never synced: the node that holds a subscription is
 * the one that signs and sends to it.
 *
 * @module db/schema/push
 */
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { tenants, users } from './auth.js';
import { nowIso, sqliteNow } from './base.js';

export const PUSH_LANGUAGES = ['es', 'en'] as const;
export type PushLanguage = (typeof PUSH_LANGUAGES)[number];

export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    endpoint: text('endpoint').notNull(),
    // p256dh and auth, sealed with the push wrapping key and bound to the endpoint.
    sealedKeys: text('sealed_keys').notNull(),
    language: text('language', { enum: PUSH_LANGUAGES }).notNull(),
    // The owner's session version at opt-in: revoking their sessions silences the phone.
    sessionVersion: integer('session_version').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    uniqueIndex('idx_push_subscriptions_endpoint').on(table.endpoint),
    index('idx_push_subscriptions_tenant_user').on(table.tenantId, table.userId),
  ]
);
