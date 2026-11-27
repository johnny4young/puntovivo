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
import { inventoryValueChecks } from './value-checks.js';
import { customers } from './customers.js';
import { inventoryMovements } from './inventory/core.js';
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

export const pharmacyEnvironmentalPeriodEnum = ['morning', 'afternoon'] as const;
export type PharmacyEnvironmentalPeriod = (typeof pharmacyEnvironmentalPeriodEnum)[number];

export const pharmacyEnvironmentalZoneEnum = ['ambient', 'refrigerator'] as const;
export type PharmacyEnvironmentalZone = (typeof pharmacyEnvironmentalZoneEnum)[number];

export const pharmacyInvimaStatusEnum = [
  'vigente',
  'en_tramite_renovacion',
  'vencido',
  'cancelado',
  'suspendido',
] as const;
export type PharmacyInvimaStatus = (typeof pharmacyInvimaStatusEnum)[number];

export const pharmacyFneMovementTypeEnum = [
  'receipt',
  'supplier_return',
  'dispensation',
  'return',
  'destruction',
  'fractionation_out',
  'fractionation_in',
] as const;
export type PharmacyFneMovementType = (typeof pharmacyFneMovementTypeEnum)[number];

export const pharmacyAllergySeverityEnum = ['mild', 'moderate', 'severe'] as const;
export type PharmacyAllergySeverity = (typeof pharmacyAllergySeverityEnum)[number];

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
    dosesPerPack: integer('doses_per_pack'),
    cumCode: text('cum_code'),
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
    index('idx_pharmacy_profiles_cum').on(table.tenantId, table.cumCode),
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

/** Immutable regulated lot fractionation lineage (box -> blister -> tablet) preserving lot, expiry and cost cents. */
export const pharmacyLotFractionations = sqliteTable(
  'pharmacy_lot_fractionations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    sourceProductId: text('source_product_id')
      .notNull()
      .references(() => products.id),
    sourceLotId: text('source_lot_id')
      .notNull()
      .references(() => inventoryLots.id),
    targetProductId: text('target_product_id')
      .notNull()
      .references(() => products.id),
    targetLotId: text('target_lot_id')
      .notNull()
      .references(() => inventoryLots.id),
    sourceQuantity: real('source_quantity').notNull(),
    targetQuantity: real('target_quantity').notNull(),
    unitsPerSource: real('units_per_source').notNull(),
    sourceLotNumber: text('source_lot_number').notNull(),
    targetLotNumber: text('target_lot_number').notNull(),
    expiresAt: text('expires_at'),
    sanitaryRegistration: text('sanitary_registration'),
    transferredValueCents: integer('transferred_value_cents').notNull(),
    sourceMovementId: text('source_movement_id')
      .notNull()
      .references(() => inventoryMovements.id),
    targetMovementId: text('target_movement_id')
      .notNull()
      .references(() => inventoryMovements.id),
    reason: text('reason').notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    occurredAt: text('occurred_at').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    ...inventoryValueChecks('pharmacy_lot_fractionations', {
      cents: [table.transferredValueCents],
      nonnegative: [table.transferredValueCents],
      quantities: [table.sourceQuantity, table.targetQuantity, table.unitsPerSource],
    }),
    index('idx_pharmacy_fractionations_tenant_site').on(
      table.tenantId,
      table.siteId,
      table.occurredAt
    ),
    index('idx_pharmacy_fractionations_source_lot').on(table.tenantId, table.sourceLotId),
    index('idx_pharmacy_fractionations_target_lot').on(table.tenantId, table.targetLotId),
    check(
      'chk_pharmacy_fractionation_qty_pos',
      sql`${table.sourceQuantity} > 0 and ${table.targetQuantity} > 0 and ${table.unitsPerSource} > 0`
    ),
    check(
      'chk_pharmacy_fractionation_distinct_products',
      sql`${table.sourceProductId} <> ${table.targetProductId}`
    ),
  ]
);

/** Append-only daily temperature and relative humidity logbook (Res. 1403/2007 CO). */
export const pharmacyEnvironmentalLogs = sqliteTable(
  'pharmacy_environmental_logs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    businessDate: text('business_date').notNull(),
    period: text('period', { enum: pharmacyEnvironmentalPeriodEnum }).notNull(),
    zone: text('zone', { enum: pharmacyEnvironmentalZoneEnum }).notNull(),
    temperatureC: real('temperature_c').notNull(),
    humidityPercent: real('humidity_percent'),
    minTempC: real('min_temp_c').notNull(),
    maxTempC: real('max_temp_c').notNull(),
    maxHumidityPercent: real('max_humidity_percent'),
    isOutOfRange: integer('is_out_of_range', { mode: 'boolean' }).notNull().default(false),
    correctiveAction: text('corrective_action'),
    instrumentCode: text('instrument_code'),
    notes: text('notes'),
    recordedBy: text('recorded_by')
      .notNull()
      .references(() => users.id),
    recordedAt: text('recorded_at').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_pharmacy_env_logs_site_date').on(
      table.tenantId,
      table.siteId,
      table.businessDate,
      table.zone
    ),
    index('idx_pharmacy_env_logs_out_of_range').on(
      table.tenantId,
      table.siteId,
      table.isOutOfRange,
      table.businessDate
    ),
    check(
      'chk_pharmacy_env_date',
      sql`length(${table.businessDate}) = 10 and date(${table.businessDate}) = ${table.businessDate}`
    ),
    check('chk_pharmacy_env_period', sql`${table.period} in ('morning', 'afternoon')`),
    check('chk_pharmacy_env_zone', sql`${table.zone} in ('ambient', 'refrigerator')`),
    check(
      'chk_pharmacy_env_temp_bounds',
      sql`${table.minTempC} < ${table.maxTempC} and ${table.temperatureC} >= -40 and ${table.temperatureC} <= 80`
    ),
    check(
      'chk_pharmacy_env_humidity_bounds',
      sql`${table.humidityPercent} is null or (${table.humidityPercent} >= 0 and ${table.humidityPercent} <= 100)`
    ),
  ]
);

/** Official INVIMA / CUM reference catalog imported per tenant for medicine profile autofill and validity checks. */
export const pharmacyInvimaCatalog = sqliteTable(
  'pharmacy_invima_catalog',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    cumCode: text('cum_code').notNull(),
    cumNormalized: text('cum_normalized').notNull(),
    productName: text('product_name').notNull(),
    activeIngredient: text('active_ingredient').notNull(),
    concentration: text('concentration'),
    dosageForm: text('dosage_form'),
    administrationRoute: text('administration_route'),
    presentation: text('presentation'),
    dosesPerPack: integer('doses_per_pack'),
    manufacturer: text('manufacturer'),
    authorizationHolder: text('authorization_holder'),
    sanitaryRegistration: text('sanitary_registration').notNull(),
    sanitaryRegistrationNormalized: text('sanitary_registration_normalized').notNull(),
    registrationStatus: text('registration_status', { enum: pharmacyInvimaStatusEnum })
      .notNull()
      .default('vigente'),
    registrationExpiresAt: text('registration_expires_at'),
    classification: text('classification', { enum: pharmacyClassificationEnum })
      .notNull()
      .default('otc'),
    importedAt: text('imported_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    uniqueIndex('idx_pharmacy_invima_tenant_cum').on(table.tenantId, table.cumNormalized),
    index('idx_pharmacy_invima_tenant_reg').on(
      table.tenantId,
      table.sanitaryRegistrationNormalized
    ),
    index('idx_pharmacy_invima_tenant_ingredient').on(table.tenantId, table.activeIngredient),
    check(
      'chk_pharmacy_invima_status',
      sql`${table.registrationStatus} in ('vigente', 'en_tramite_renovacion', 'vencido', 'cancelado', 'suspendido')`
    ),
    check(
      'chk_pharmacy_invima_classification',
      sql`${table.classification} in ('otc', 'prescription', 'controlled')`
    ),
    check(
      'chk_pharmacy_invima_doses',
      sql`${table.dosesPerPack} is null or ${table.dosesPerPack} > 0`
    ),
    check(
      'chk_pharmacy_invima_expiry',
      sql`${table.registrationExpiresAt} is null or (length(${table.registrationExpiresAt}) = 10 and date(${table.registrationExpiresAt}) = ${table.registrationExpiresAt})`
    ),
  ]
);

/** Active FNE / Secretaría de Salud authorization enabling controlled medicines (Res. 1478/2006 CO). */
export const pharmacyFneAuthorizations = sqliteTable(
  'pharmacy_fne_authorizations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id').references(() => sites.id),
    countryCode: text('country_code').notNull(),
    resolutionNumber: text('resolution_number').notNull(),
    issuingAuthority: text('issuing_authority').notNull(),
    responsibleUserId: text('responsible_user_id')
      .notNull()
      .references(() => users.id),
    validFrom: text('valid_from').notNull(),
    validUntil: text('valid_until'),
    status: text('status', { enum: pharmacyAuthorizationStatusEnum }).notNull().default('active'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    revokedBy: text('revoked_by').references(() => users.id),
    revokedAt: text('revoked_at'),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_pharmacy_fne_auth_tenant_effective').on(
      table.tenantId,
      table.countryCode,
      table.status,
      table.validFrom,
      table.validUntil
    ),
    check(
      'chk_pharmacy_fne_auth_date_order',
      sql`${table.validUntil} is null or ${table.validUntil} >= ${table.validFrom}`
    ),
    check(
      'chk_pharmacy_fne_auth_dates',
      sql`length(${table.validFrom}) = 10 and date(${table.validFrom}) = ${table.validFrom} and (${table.validUntil} is null or (length(${table.validUntil}) = 10 and date(${table.validUntil}) = ${table.validUntil}))`
    ),
    check(
      'chk_pharmacy_fne_auth_country',
      sql`length(${table.countryCode}) = 2 and ${table.countryCode} = upper(${table.countryCode}) and ${table.countryCode} glob '[A-Z][A-Z]'`
    ),
    check(
      'chk_pharmacy_fne_auth_state',
      sql`(${table.status} = 'active' and ${table.revokedBy} is null and ${table.revokedAt} is null) or (${table.status} = 'revoked' and ${table.revokedBy} is not null and ${table.revokedAt} is not null)`
    ),
  ]
);

/** Append-only official controlled-substances ledger (Libro de Control Especial FNE). */
export const pharmacyFneLedger = sqliteTable(
  'pharmacy_fne_ledger',
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
    lotId: text('lot_id').references(() => inventoryLots.id),
    lotNumber: text('lot_number'),
    businessDate: text('business_date').notNull(),
    movementType: text('movement_type', { enum: pharmacyFneMovementTypeEnum }).notNull(),
    quantityDelta: real('quantity_delta').notNull(),
    balanceAfter: real('balance_after').notNull(),
    fneAuthorizationId: text('fne_authorization_id').references(() => pharmacyFneAuthorizations.id),
    saleId: text('sale_id').references(() => sales.id),
    evidenceId: text('evidence_id').references(() => pharmacyPrescriptionEvidence.id),
    retainedFormulaDigest: text('retained_formula_digest'),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    notes: text('notes'),
    occurredAt: text('occurred_at').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    ...inventoryValueChecks('pharmacy_fne_ledger', {
      cents: [],
      quantities: [table.quantityDelta, table.balanceAfter],
    }),
    index('idx_pharmacy_fne_ledger_tenant_date').on(
      table.tenantId,
      table.siteId,
      table.businessDate,
      table.productId
    ),
    index('idx_pharmacy_fne_ledger_tenant_product').on(
      table.tenantId,
      table.productId,
      table.occurredAt
    ),
    check(
      'chk_pharmacy_fne_ledger_date',
      sql`length(${table.businessDate}) = 10 and date(${table.businessDate}) = ${table.businessDate}`
    ),
    check(
      'chk_pharmacy_fne_ledger_type',
      sql`${table.movementType} in ('receipt', 'supplier_return', 'dispensation', 'return', 'destruction', 'fractionation_out', 'fractionation_in')`
    ),
    check(
      'chk_pharmacy_fne_ledger_sign',
      sql`(${table.movementType} in ('receipt', 'return', 'fractionation_in') and ${table.quantityDelta} > 0) or (${table.movementType} in ('dispensation', 'supplier_return', 'destruction', 'fractionation_out') and ${table.quantityDelta} < 0)`
    ),
    check('chk_pharmacy_fne_ledger_balance', sql`${table.balanceAfter} >= 0`),
  ]
);

/** Tenant-scoped patient active-ingredient allergies used for POS checkout safety alerts. */
export const pharmacyCustomerAllergies = sqliteTable(
  'pharmacy_customer_allergies',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    activeIngredient: text('active_ingredient').notNull(),
    activeIngredientNormalized: text('active_ingredient_normalized').notNull(),
    severity: text('severity', { enum: pharmacyAllergySeverityEnum }).notNull().default('moderate'),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    uniqueIndex('idx_pharmacy_customer_allergies_unique').on(
      table.tenantId,
      table.customerId,
      table.activeIngredientNormalized
    ),
    index('idx_pharmacy_customer_allergies_tenant_customer').on(table.tenantId, table.customerId),
    check(
      'chk_pharmacy_allergy_severity',
      sql`${table.severity} in ('mild', 'moderate', 'severe')`
    ),
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
