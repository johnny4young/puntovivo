/**
 * Drizzle schema — where a site receives transfers (Bre-B key, wallet or bank account).
 *
 * @module db/schema/transferDestinations
 */
import {
  BANK_ACCOUNT_TYPES,
  TRANSFER_DESTINATION_KINDS,
} from '@puntovivo/shared/transfer-destinations';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { sites, tenants, users } from './auth.js';
import { nowIso, sqliteNow } from './base.js';

export {
  BANK_ACCOUNT_TYPES,
  MAX_SITE_TRANSFER_DESTINATIONS,
  TRANSFER_DESTINATION_KINDS,
  TRANSFER_DESTINATION_LIMITS,
  TRANSFER_QR_LOCALES,
  type BankAccountType,
  type TransferDestinationKind,
} from '@puntovivo/shared/transfer-destinations';

export const siteTransferDestinations = sqliteTable(
  'site_transfer_destinations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    position: integer('position').notNull(),
    kind: text('kind', { enum: TRANSFER_DESTINATION_KINDS }).notNull(),
    label: text('label').notNull(),
    account: text('account').notNull(),
    bankName: text('bank_name'),
    accountType: text('account_type', { enum: BANK_ACCOUNT_TYPES }),
    holderName: text('holder_name'),
    holderId: text('holder_id'),
    // A bank-issued EMVCo QR read with the register scanner, kept verbatim.
    qrPayload: text('qr_payload'),
    createdBy: text('created_by').references(() => users.id),
    updatedBy: text('updated_by').references(() => users.id),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_site_transfer_destinations_tenant_site_position').on(
      table.tenantId,
      table.siteId,
      table.position
    ),
  ]
);
