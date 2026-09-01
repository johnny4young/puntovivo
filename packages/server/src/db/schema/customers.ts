/**
 * Drizzle schema — customers domain.
 *
 * relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/customers
 */
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { moneyPositiveChecks, nowIso, sqliteNow, syncStatusEnum } from './base.js';
import { tenants, users } from './auth.js';
import { sales } from './sales.js';
import { currencyCatalog } from './config.js';

// ============================================================================
// CUSTOMER REFERENCE CATALOGS
// ============================================================================

/** Identification types classify the tax or legal document used by a customer, such as national ID or tax ID. */
export const identificationTypes = sqliteTable(
  'identification_types',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_identification_types_tenant').on(table.tenantId),
    uniqueIndex('idx_identification_types_tenant_code').on(table.tenantId, table.code),
    uniqueIndex('idx_identification_types_tenant_name').on(table.tenantId, table.name),
  ]
);

export const identificationTypesRelations = relations(identificationTypes, ({ one }) => ({
  tenant: one(tenants, {
    fields: [identificationTypes.tenantId],
    references: [tenants.id],
  }),
}));

/** Person types classify whether a customer is treated as a natural person or a legal entity. */
export const personTypes = sqliteTable(
  'person_types',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_person_types_tenant').on(table.tenantId),
    uniqueIndex('idx_person_types_tenant_code').on(table.tenantId, table.code),
    uniqueIndex('idx_person_types_tenant_name').on(table.tenantId, table.name),
  ]
);

export const personTypesRelations = relations(personTypes, ({ one }) => ({
  tenant: one(tenants, {
    fields: [personTypes.tenantId],
    references: [tenants.id],
  }),
}));

/** Regime types classify the fiscal or tax regime assigned to a customer. */
export const regimeTypes = sqliteTable(
  'regime_types',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_regime_types_tenant').on(table.tenantId),
    uniqueIndex('idx_regime_types_tenant_code').on(table.tenantId, table.code),
    uniqueIndex('idx_regime_types_tenant_name').on(table.tenantId, table.name),
  ]
);

export const regimeTypesRelations = relations(regimeTypes, ({ one }) => ({
  tenant: one(tenants, {
    fields: [regimeTypes.tenantId],
    references: [tenants.id],
  }),
}));

/** Client types classify a customer commercially, such as retail or wholesale; they are attributes of customers, not separate business parties. */
export const clientTypes = sqliteTable(
  'client_types',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_client_types_tenant').on(table.tenantId),
    uniqueIndex('idx_client_types_tenant_code').on(table.tenantId, table.code),
    uniqueIndex('idx_client_types_tenant_name').on(table.tenantId, table.name),
  ]
);

export const clientTypesRelations = relations(clientTypes, ({ one }) => ({
  tenant: one(tenants, {
    fields: [clientTypes.tenantId],
    references: [tenants.id],
  }),
}));

/** Commercial activities classify the main business or economic activity associated with a customer for fiscal and reporting use. */
export const commercialActivities = sqliteTable(
  'commercial_activities',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_commercial_activities_tenant').on(table.tenantId),
    uniqueIndex('idx_commercial_activities_tenant_code').on(table.tenantId, table.code),
    uniqueIndex('idx_commercial_activities_tenant_name').on(table.tenantId, table.name),
  ]
);

export const commercialActivitiesRelations = relations(commercialActivities, ({ one }) => ({
  tenant: one(tenants, {
    fields: [commercialActivities.tenantId],
    references: [tenants.id],
  }),
}));

// ============================================================================
// CUSTOMERS
// ============================================================================

export const customerPrivacyStatusEnum = ['active', 'anonymized'] as const;

/** A customer is the business party that buys from the tenant; the same real-world party may exist separately in multiple tenants. */
export const customers = sqliteTable(
  'customers',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    address: text('address'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    country: text('country'),
    taxId: text('tax_id'),
    identificationTypeId: text('identification_type_id'),
    personTypeId: text('person_type_id'),
    regimeTypeId: text('regime_type_id'),
    clientTypeId: text('client_type_id'),
    commercialActivityId: text('commercial_activity_id'),
    notes: text('notes'),
    // per-customer credit ceiling (cupo de crédito).
    // `0 = sin cupo` (no limit); zero is the sentinel so reads never
    // need to handle null. Zod rejects negative values at the input
    // layer. 's `requireCreditLimitNotExceeded()` invariant
    // gates the "Cargar a cuenta" payment method against this column.
    creditLimit: real('credit_limit').notNull().default(0),
    // currency for the creditLimit column. Nullable so
    // customers without an active credit limit (creditLimit = 0) do
    // not have to carry a currency. When `creditLimit > 0` the
    // application sets this either to the explicit operator override
    // or to `resolveTenantCurrency(ctx.tenantId)`.
    creditLimitCurrencyCode: text('credit_limit_currency_code').references(
      () => currencyCatalog.code
    ),
    // which of the product's three catalog prices this customer
    // buys at (1 = retail default, 2/3 = contractor / wholesale). Drives
    // the cart's suggested unit price AND the reference price the
    // price-override detector compares against, so selling a tier-2
    // customer at price2 is not flagged as a manual override.
    priceTier: integer('price_tier').notNull().default(1),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    // explicit privacy lifecycle state. Anonymized rows remain
    // only when linked fiscal/financial records require referential integrity;
    // ordinary customer lists and searches hide them.
    privacyStatus: text('privacy_status', { enum: customerPrivacyStatusEnum })
      .notNull()
      .default('active'),
    privacyDisposedAt: text('privacy_disposed_at'),
    // optimistic-concurrency guard (see products.version).
    version: integer('version').notNull().default(0),
    // Sync fields
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_customers_tenant').on(table.tenantId),
    index('idx_customers_email').on(table.email),
    // -176b — credit limit cannot be negative ( also
    // enforces this at the Zod layer);  stores the credit-limit
    // currency while per-currency decimal precision remains a future
    // refinement.
    ...moneyPositiveChecks('customers_credit_limit', table.creditLimit),
  ]
);

export const customersRelations = relations(customers, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [customers.tenantId],
    references: [tenants.id],
  }),
  sales: many(sales),
}));

// ============================================================================
// LOYALTY ( minimum viable loyalty)
// ============================================================================

/**
 * A customer's materialized point balance ( / ).
 *
 * `points` is a ROLLUP of `loyalty_movements`, maintained only by
 * `services/loyalty.ts` inside the same transaction as the movement it
 * follows — same discipline as `cash_sessions.expected_balance` ():
 * the ledger is the truth, the balance is the fast read. Parity
 * `points ≡ Σ(movements.points)` is pinned by `loyalty.test.ts`.
 */
export const loyaltyAccounts = sqliteTable(
  'loyalty_accounts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    /** Materialized balance. Redemptions/manual debits fail at zero; a later
     * return may create auditable debt after already-earned points were spent. */
    points: integer('points').notNull().default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    // One account per customer — the read path and the upsert both key on it.
    uniqueIndex('idx_loyalty_accounts_customer').on(table.tenantId, table.customerId),
  ]
);

/** Why a movement exists. Restores reverse a concrete redemption; reverts
 * claw back points earned by merchandise that was returned or voided. */
export const loyaltyMovementKindEnum = ['earn', 'redeem', 'adjust', 'revert', 'restore'] as const;

/**
 * Append-only points ledger ( / ). Same posture as
 * `sale_item_lots`: every balance change leaves an auditable row carrying
 * its provenance (`saleId` when the sale path drove it, null for a manual
 * adjustment). Rows are NEVER updated or deleted — a reverted earn appends
 * a negative `revert` row rather than erasing history.
 */
export const loyaltyMovements = sqliteTable(
  'loyalty_movements',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    accountId: text('account_id')
      .notNull()
      .references(() => loyaltyAccounts.id, { onDelete: 'cascade' }),
    /** Null for manual adjustments; set for sale-driven earn/revert rows. */
    saleId: text('sale_id').references(() => sales.id),
    /** Stable idempotency key for a partial return reversal. Deliberately not
     * an FK to avoid a schema initialization cycle with salesAux. */
    saleReturnId: text('sale_return_id'),
    /** Concrete tender that caused a redemption. Kept as a logical reference
     * to avoid a schema cycle with salesAux. */
    salePaymentId: text('sale_payment_id'),
    /** Movement being reversed/restored. Source-linking allows one return to
     * claw back an earn and restore a redemption without colliding. */
    sourceMovementId: text('source_movement_id'),
    kind: text('kind', { enum: loyaltyMovementKindEnum }).notNull(),
    /** Signed: positive earns, negative redeems/reverts. */
    points: integer('points').notNull(),
    /** Snapshot of the rule that produced an earn (points per currency unit),
     * so a later rate change never rewrites what the customer was told. */
    rateAtEarn: real('rate_at_earn'),
    /** Monetary value frozen for redemption/restoration movements. */
    valuePerPoint: real('value_per_point'),
    moneyAmount: real('money_amount'),
    currencyCode: text('currency_code').references(() => currencyCatalog.code),
    note: text('note'),
    createdBy: text('created_by').references(() => users.id),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_loyalty_movements_account').on(table.accountId),
    index('idx_loyalty_movements_tenant_sale').on(table.tenantId, table.saleId),
    // one earn per (account, sale): the guard that makes the sale
    // path idempotent under a retried completion. Reverts are exempt (a
    // partial index would need `kind='earn'`, which drizzle emits since 0.31).
    uniqueIndex('idx_loyalty_movements_sale_earn')
      .on(table.accountId, table.saleId)
      .where(sql`${table.kind} = 'earn'`),
    uniqueIndex('idx_loyalty_movements_payment_redeem')
      .on(table.tenantId, table.salePaymentId)
      .where(sql`${table.kind} = 'redeem' and ${table.salePaymentId} is not null`),
    uniqueIndex('idx_loyalty_movements_return_source')
      .on(table.tenantId, table.saleReturnId, table.sourceMovementId, table.kind)
      .where(sql`${table.saleReturnId} is not null and ${table.sourceMovementId} is not null`),
    uniqueIndex('idx_loyalty_movements_void_source')
      .on(table.tenantId, table.saleId, table.sourceMovementId, table.kind)
      .where(sql`${table.saleReturnId} is null and ${table.sourceMovementId} is not null`),
    check(
      'chk_loyalty_movements_sign',
      sql`(${table.kind} IN ('earn', 'restore') AND ${table.points} > 0) OR (${table.kind} IN ('redeem', 'revert') AND ${table.points} < 0) OR (${table.kind} = 'adjust' AND ${table.points} <> 0)`
    ),
    check(
      'chk_loyalty_movements_redemption_snapshot',
      sql`(${table.kind} IN ('redeem', 'restore') AND ${table.valuePerPoint} IS NOT NULL AND ${table.valuePerPoint} > 0 AND ${table.moneyAmount} IS NOT NULL AND ${table.moneyAmount} >= 0 AND ${table.currencyCode} IS NOT NULL) OR (${table.kind} NOT IN ('redeem', 'restore') AND ${table.valuePerPoint} IS NULL AND ${table.moneyAmount} IS NULL AND ${table.currencyCode} IS NULL)`
    ),
    ...moneyPositiveChecks('loyalty_movements_value_per_point', table.valuePerPoint),
    ...moneyPositiveChecks('loyalty_movements_money_amount', table.moneyAmount),
  ]
);

export const loyaltyAccountsRelations = relations(loyaltyAccounts, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [loyaltyAccounts.tenantId],
    references: [tenants.id],
  }),
  customer: one(customers, {
    fields: [loyaltyAccounts.customerId],
    references: [customers.id],
  }),
  movements: many(loyaltyMovements),
}));

export const loyaltyMovementsRelations = relations(loyaltyMovements, ({ one }) => ({
  account: one(loyaltyAccounts, {
    fields: [loyaltyMovements.accountId],
    references: [loyaltyAccounts.id],
  }),
  sale: one(sales, {
    fields: [loyaltyMovements.saleId],
    references: [sales.id],
  }),
}));
