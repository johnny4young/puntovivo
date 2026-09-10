/**
 * Pharmacy catalog, authorization, prescription and lot-control schema.
 *
 * Regulatory metadata stays in a one-to-one product extension so ordinary
 * retail products do not acquire a wide nullable surface. Every operational
 * child repeats tenant_id; application writes and reads scope every related
 * identity explicitly because SQLite's individual foreign keys do not prove
 * that two referenced rows belong to the same tenant.
 *
 * @module db/schema/pharmacy
 */
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

import { nowIso, sqliteNow, lotStatusEnum } from './base.js';
import { customers } from './customers.js';
import { inventoryLots } from './inventory/lots.js';
import { products } from './products.js';
import { providers } from './catalogs.js';
import { sales } from './sales.js';
import { saleItems } from './salesAux.js';
import { sites, tenants, users } from './auth.js';

export const pharmacyClassificationEnum = ['otc', 'prescription', 'controlled'] as const;
export type PharmacyClassification = (typeof pharmacyClassificationEnum)[number];

export const pharmacyAuthorizationStatusEnum = ['active', 'revoked'] as const;
export const pharmacyEvidenceStatusEnum = ['pending', 'approved', 'consumed', 'revoked'] as const;
export const pharmacyRecallStatusEnum = ['active', 'closed'] as const;
export const pharmacyRecallScopeEnum = [
  'product',
  'lot',
  'provider',
  'sanitary_registration',
] as const;
export const inventoryLotEventTypeEnum = [
  'activation',
  'quarantine',
  'release',
  'expiration',
  'recall',
  'destruction',
  'supplier_return',
  'cold_chain_incident',
] as const;
export type InventoryLotEventType = (typeof inventoryLotEventTypeEnum)[number];

/**
 * Database-local data-encryption material for sealed pharmacy evidence.
 * The containing SQLite database is encrypted in production, so this key
 * survives SQLCipher rekey and cross-device backup restore without depending
 * on a machine keychain or becoming a remotely synchronized entity.
 */
export const pharmacyEvidenceKeys = sqliteTable(
  'pharmacy_evidence_keys',
  {
    id: text('id').primaryKey(),
    secretMaterial: text('secret_material').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    check('chk_pharmacy_evidence_key_id', sql`${table.id} = 'evidence-v1'`),
    check(
      'chk_pharmacy_evidence_key_strength',
      sql`length(cast(${table.secretMaterial} as blob)) >= 32`
    ),
  ]
);

/** Regulatory and handling metadata for one sellable product. */
export const pharmacyProductProfiles = sqliteTable(
  'pharmacy_product_profiles',
  {
    productId: text('product_id')
      .primaryKey()
      .references(() => products.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    activeIngredient: text('active_ingredient'),
    genericName: text('generic_name'),
    concentration: text('concentration'),
    dosageForm: text('dosage_form'),
    administrationRoute: text('administration_route'),
    presentation: text('presentation'),
    manufacturer: text('manufacturer'),
    authorizationHolder: text('authorization_holder'),
    sanitaryRegistration: text('sanitary_registration'),
    sanitaryRegistrationNormalized: text('sanitary_registration_normalized'),
    registrationExpiresAt: text('registration_expires_at'),
    classification: text('classification', { enum: pharmacyClassificationEnum })
      .notNull()
      .default('otc'),
    storageConditions: text('storage_conditions'),
    requiresColdChain: integer('requires_cold_chain', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_pharmacy_profiles_tenant').on(table.tenantId),
    index('idx_pharmacy_profiles_ingredient').on(table.tenantId, table.activeIngredient),
    index('idx_pharmacy_profiles_generic').on(table.tenantId, table.genericName),
    index('idx_pharmacy_profiles_registration').on(
      table.tenantId,
      table.sanitaryRegistrationNormalized
    ),
    check(
      'chk_pharmacy_profile_classification',
      sql`${table.classification} in ('otc', 'prescription', 'controlled')`
    ),
    check(
      'chk_pharmacy_profile_registration_date',
      sql`${table.registrationExpiresAt} is null or (length(${table.registrationExpiresAt}) = 10 and date(${table.registrationExpiresAt}) = ${table.registrationExpiresAt})`
    ),
  ]
);

/** Effective professional credential allowed to approve a prescription. */
export const pharmacyProfessionalAuthorizations = sqliteTable(
  'pharmacy_professional_authorizations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    siteId: text('site_id').references(() => sites.id),
    countryCode: text('country_code').notNull(),
    credentialType: text('credential_type').notNull(),
    credentialDigest: text('credential_digest').notNull(),
    sealedCredential: text('sealed_credential').notNull(),
    validFrom: text('valid_from').notNull(),
    validUntil: text('valid_until'),
    status: text('status', { enum: pharmacyAuthorizationStatusEnum }).notNull().default('active'),
    version: integer('version').notNull().default(0),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    revokedBy: text('revoked_by').references(() => users.id),
    revokedAt: text('revoked_at'),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_pharmacy_auth_tenant_user').on(table.tenantId, table.userId),
    index('idx_pharmacy_auth_tenant_effective').on(
      table.tenantId,
      table.countryCode,
      table.status,
      table.validFrom,
      table.validUntil
    ),
    index('idx_pharmacy_auth_credential').on(
      table.tenantId,
      table.countryCode,
      table.credentialDigest
    ),
    check(
      'chk_pharmacy_authorization_date_order',
      sql`${table.validUntil} is null or ${table.validUntil} >= ${table.validFrom}`
    ),
    check(
      'chk_pharmacy_authorization_dates',
      sql`length(${table.validFrom}) = 10 and date(${table.validFrom}) = ${table.validFrom} and (${table.validUntil} is null or (length(${table.validUntil}) = 10 and date(${table.validUntil}) = ${table.validUntil}))`
    ),
    check(
      'chk_pharmacy_authorization_country',
      sql`length(${table.countryCode}) = 2 and ${table.countryCode} = upper(${table.countryCode}) and ${table.countryCode} glob '[A-Z][A-Z]'`
    ),
    check(
      'chk_pharmacy_authorization_state',
      sql`(${table.status} = 'active' and ${table.revokedBy} is null and ${table.revokedAt} is null) or (${table.status} = 'revoked' and ${table.revokedBy} is not null and ${table.revokedAt} is not null)`
    ),
  ]
);

/** Minimal sealed prescription evidence. Plain-text reference/PII is absent. */
export const pharmacyPrescriptionEvidence = sqliteTable(
  'pharmacy_prescription_evidence',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    countryCode: text('country_code').notNull(),
    policyVersion: text('policy_version').notNull(),
    referenceDigest: text('reference_digest').notNull(),
    sealedEvidence: text('sealed_evidence').notNull(),
    authorizedQuantity: real('authorized_quantity').notNull(),
    dispensedQuantity: real('dispensed_quantity').notNull().default(0),
    validFrom: text('valid_from').notNull(),
    expiresAt: text('expires_at').notNull(),
    status: text('status', { enum: pharmacyEvidenceStatusEnum }).notNull().default('pending'),
    approvedBy: text('approved_by').references(() => users.id),
    approvalAuthorizationId: text('approval_authorization_id').references(
      () => pharmacyProfessionalAuthorizations.id
    ),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    revokedBy: text('revoked_by').references(() => users.id),
    revokedAt: text('revoked_at'),
    version: integer('version').notNull().default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_pharmacy_evidence_tenant_product').on(table.tenantId, table.productId),
    index('idx_pharmacy_evidence_customer_status').on(
      table.tenantId,
      table.customerId,
      table.status
    ),
    index('idx_pharmacy_evidence_checkout').on(
      table.tenantId,
      table.customerId,
      table.productId,
      table.countryCode,
      table.policyVersion,
      table.status,
      table.expiresAt,
      table.createdAt,
      table.id
    ),
    uniqueIndex('idx_pharmacy_evidence_reference').on(
      table.tenantId,
      table.productId,
      table.referenceDigest
    ),
    check('chk_pharmacy_evidence_authorized_positive', sql`${table.authorizedQuantity} > 0`),
    check('chk_pharmacy_evidence_dispensed_nonnegative', sql`${table.dispensedQuantity} >= 0`),
    check(
      'chk_pharmacy_evidence_dispensed_within_authorized',
      sql`${table.dispensedQuantity} <= ${table.authorizedQuantity}`
    ),
    check('chk_pharmacy_evidence_date_order', sql`${table.expiresAt} >= ${table.validFrom}`),
    check(
      'chk_pharmacy_evidence_dates',
      sql`length(${table.validFrom}) = 10 and date(${table.validFrom}) = ${table.validFrom} and length(${table.expiresAt}) = 10 and date(${table.expiresAt}) = ${table.expiresAt}`
    ),
    check(
      'chk_pharmacy_evidence_country',
      sql`length(${table.countryCode}) = 2 and ${table.countryCode} = upper(${table.countryCode}) and ${table.countryCode} glob '[A-Z][A-Z]'`
    ),
    check(
      'chk_pharmacy_evidence_state',
      sql`(${table.status} = 'pending' and ${table.approvedBy} is null and ${table.approvalAuthorizationId} is null and ${table.revokedBy} is null and ${table.revokedAt} is null) or (${table.status} = 'approved' and ${table.approvedBy} is not null and ${table.approvalAuthorizationId} is not null and ${table.revokedBy} is null and ${table.revokedAt} is null) or (${table.status} = 'consumed' and ${table.approvedBy} is not null and ${table.approvalAuthorizationId} is not null and ${table.revokedBy} is null and ${table.revokedAt} is null and ${table.dispensedQuantity} = ${table.authorizedQuantity}) or (${table.status} = 'revoked' and ${table.revokedBy} is not null and ${table.revokedAt} is not null)`
    ),
  ]
);

/** Frozen per-line allocation produced only by a committed completed sale. */
export const pharmacyDispensations = sqliteTable(
  'pharmacy_dispensations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleId: text('sale_id')
      .notNull()
      .references(() => sales.id),
    saleItemId: text('sale_item_id')
      .notNull()
      .references(() => saleItems.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    evidenceId: text('evidence_id')
      .notNull()
      .references(() => pharmacyPrescriptionEvidence.id),
    authorizationId: text('authorization_id')
      .notNull()
      .references(() => pharmacyProfessionalAuthorizations.id),
    classification: text('classification', { enum: pharmacyClassificationEnum }).notNull(),
    policyVersion: text('policy_version').notNull(),
    quantity: real('quantity').notNull(),
    businessDate: text('business_date').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_pharmacy_dispensations_tenant_sale').on(table.tenantId, table.saleId),
    index('idx_pharmacy_dispensations_tenant_product').on(table.tenantId, table.productId),
    uniqueIndex('idx_pharmacy_dispensations_line_evidence').on(
      table.tenantId,
      table.saleItemId,
      table.evidenceId
    ),
    check('chk_pharmacy_dispensation_quantity_positive', sql`${table.quantity} > 0`),
    check(
      'chk_pharmacy_dispensation_classification',
      sql`${table.classification} in ('otc', 'prescription', 'controlled')`
    ),
    check(
      'chk_pharmacy_dispensation_business_date',
      sql`length(${table.businessDate}) = 10 and date(${table.businessDate}) = ${table.businessDate}`
    ),
  ]
);

/** Immutable state transition ledger for controlled lots. */
export const inventoryLotEvents = sqliteTable(
  'inventory_lot_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    lotId: text('lot_id')
      .notNull()
      .references(() => inventoryLots.id),
    eventType: text('event_type', { enum: inventoryLotEventTypeEnum }).notNull(),
    previousStatus: text('previous_status', { enum: lotStatusEnum }),
    nextStatus: text('next_status', { enum: lotStatusEnum }).notNull(),
    quantitySnapshot: real('quantity_snapshot').notNull(),
    reason: text('reason').notNull(),
    referenceType: text('reference_type'),
    referenceId: text('reference_id'),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    occurredAt: text('occurred_at').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_inventory_lot_events_tenant_lot').on(table.tenantId, table.lotId, table.occurredAt),
    index('idx_inventory_lot_events_tenant_type').on(table.tenantId, table.eventType),
    check('chk_inventory_lot_event_quantity_nonnegative', sql`${table.quantitySnapshot} >= 0`),
    check(
      'chk_inventory_lot_event_type',
      sql`${table.eventType} in ('activation', 'quarantine', 'release', 'expiration', 'recall', 'destruction', 'supplier_return', 'cold_chain_incident')`
    ),
    check(
      'chk_inventory_lot_event_status',
      sql`${table.nextStatus} in ('active', 'depleted', 'expired', 'quarantined', 'recalled') and (${table.previousStatus} is null or ${table.previousStatus} in ('active', 'depleted', 'expired', 'quarantined', 'recalled'))`
    ),
  ]
);

/** One explicit withdrawal campaign with exactly one server-resolved scope. */
export const pharmacyRecalls = sqliteTable(
  'pharmacy_recalls',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    scopeType: text('scope_type', { enum: pharmacyRecallScopeEnum }).notNull(),
    productId: text('product_id').references(() => products.id),
    lotId: text('lot_id').references(() => inventoryLots.id),
    providerId: text('provider_id').references(() => providers.id),
    sanitaryRegistration: text('sanitary_registration'),
    reason: text('reason').notNull(),
    status: text('status', { enum: pharmacyRecallStatusEnum }).notNull().default('active'),
    initiatedBy: text('initiated_by')
      .notNull()
      .references(() => users.id),
    initiatedAt: text('initiated_at').notNull(),
    closedBy: text('closed_by').references(() => users.id),
    closedAt: text('closed_at'),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_pharmacy_recalls_tenant_status').on(table.tenantId, table.status),
    check(
      'chk_pharmacy_recall_exact_scope',
      sql`(case when ${table.productId} is null then 0 else 1 end + case when ${table.lotId} is null then 0 else 1 end + case when ${table.providerId} is null then 0 else 1 end + case when ${table.sanitaryRegistration} is null then 0 else 1 end) = 1`
    ),
    check(
      'chk_pharmacy_recall_scope_matches',
      sql`(${table.scopeType} = 'product' and ${table.productId} is not null) or (${table.scopeType} = 'lot' and ${table.lotId} is not null) or (${table.scopeType} = 'provider' and ${table.providerId} is not null) or (${table.scopeType} = 'sanitary_registration' and ${table.sanitaryRegistration} is not null)`
    ),
    check(
      'chk_pharmacy_recall_state',
      sql`(${table.status} = 'active' and ${table.closedBy} is null and ${table.closedAt} is null) or (${table.status} = 'closed' and ${table.closedBy} is not null and ${table.closedAt} is not null)`
    ),
  ]
);

/** Append-only set of affected lots, extended when recalled stock completes transfer custody. */
export const pharmacyRecallLots = sqliteTable(
  'pharmacy_recall_lots',
  {
    recallId: text('recall_id')
      .notNull()
      .references(() => pharmacyRecalls.id, { onDelete: 'cascade' }),
    lotId: text('lot_id')
      .notNull()
      .references(() => inventoryLots.id),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    previousStatus: text('previous_status', { enum: lotStatusEnum }).notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    primaryKey({ columns: [table.recallId, table.lotId] }),
    index('idx_pharmacy_recall_lots_tenant_lot').on(table.tenantId, table.lotId),
  ]
);

export const pharmacyProductProfilesRelations = relations(pharmacyProductProfiles, ({ one }) => ({
  product: one(products, {
    fields: [pharmacyProductProfiles.productId],
    references: [products.id],
  }),
  tenant: one(tenants, {
    fields: [pharmacyProductProfiles.tenantId],
    references: [tenants.id],
  }),
}));

export const pharmacyPrescriptionEvidenceRelations = relations(
  pharmacyPrescriptionEvidence,
  ({ one, many }) => ({
    product: one(products, {
      fields: [pharmacyPrescriptionEvidence.productId],
      references: [products.id],
    }),
    customer: one(customers, {
      fields: [pharmacyPrescriptionEvidence.customerId],
      references: [customers.id],
    }),
    dispensations: many(pharmacyDispensations),
  })
);

export const pharmacyDispensationsRelations = relations(pharmacyDispensations, ({ one }) => ({
  evidence: one(pharmacyPrescriptionEvidence, {
    fields: [pharmacyDispensations.evidenceId],
    references: [pharmacyPrescriptionEvidence.id],
  }),
  sale: one(sales, { fields: [pharmacyDispensations.saleId], references: [sales.id] }),
  saleItem: one(saleItems, {
    fields: [pharmacyDispensations.saleItemId],
    references: [saleItems.id],
  }),
}));
