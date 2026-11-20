/**
 * Drizzle schema — one-touch keys a site shares across its registers.
 *
 * @module db/schema/quickKeys
 */
import { SITE_QUICK_KEY_COLOURS, SITE_QUICK_KEY_KINDS } from '@puntovivo/shared/quick-keys';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { sites, tenants, users } from './auth.js';
import { nowIso, sqliteNow } from './base.js';
import { units } from './catalogs.js';
import { products } from './products.js';

export {
  MAX_SITE_QUICK_KEYS,
  SITE_QUICK_KEY_COLOURS,
  SITE_QUICK_KEY_KINDS,
  type SiteQuickKeyColour,
  type SiteQuickKeyKind,
} from '@puntovivo/shared/quick-keys';

export const siteQuickKeys = sqliteTable(
  'site_quick_keys',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    position: integer('position').notNull(),
    kind: text('kind', { enum: SITE_QUICK_KEY_KINDS }).notNull().default('product'),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    unitId: text('unit_id').references(() => units.id),
    label: text('label'),
    colour: text('colour', { enum: SITE_QUICK_KEY_COLOURS }),
    createdBy: text('created_by').references(() => users.id),
    updatedBy: text('updated_by').references(() => users.id),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_site_quick_keys_tenant_site_position').on(
      table.tenantId,
      table.siteId,
      table.position
    ),
    index('idx_site_quick_keys_product').on(table.productId),
  ]
);
