/**
 * Drizzle schema — sales domain.
 *
 * relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/sales
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
import {
  cashMovementTypeEnum,
  cashSessionStatusEnum,
  moneyPositiveChecks,
  moneyTwoDecimalCheck,
  nowIso,
  paymentMethodEnum,
  paymentStatusEnum,
  saleStatusEnum,
  sqliteNow,
  syncStatusEnum,
} from './base.js';
import type { CashSessionDenomination } from './base.js';
import { sites, tenants, users } from './auth.js';
import { customers } from './customers.js';
import { employeeShifts } from './labor.js';
import { restaurantTables, saleItems, salePayments, saleReturns } from './salesAux.js';
import { currencyCatalog } from './config.js';

// ============================================================================
// SALES
// ============================================================================

/** A sale records a completed or in-progress commercial transaction through which the tenant sells products to a customer or walk-in buyer. */
export const sales = sqliteTable(
  'sales',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleNumber: text('sale_number').notNull(),
    customerId: text('customer_id').references(() => customers.id),
    // optional restaurant-table FK. When non-null the draft
    // is "open" on that physical table; `listWithDraftStatus` reads
    // this column to surface occupancy. Nullable so non-restaurant
    // tenants and pre- drafts pass through unchanged.
    tableId: text('table_id').references(() => restaurantTables.id),
    subtotal: real('subtotal').notNull().default(0),
    taxAmount: real('tax_amount').notNull().default(0),
    discountAmount: real('discount_amount').notNull().default(0),
    total: real('total').notNull().default(0),
    // multi-currency seam. `currencyCode` is the currency
    // the sale was priced in (subtotal/taxAmount/tipAmount/total are
    // all denominated in it). `exchangeRateAtSale` is the factor that
    // converts `settleCurrencyCode → currencyCode`; 1.0 when settle
    // matches sale (most flows today). `settleCurrencyCode` is set
    // only when  lands multi-currency settle: a sale priced
    // in USD but cashed in COP carries currencyCode='USD',
    // settleCurrencyCode='COP', exchangeRateAtSale=4200.
    currencyCode: text('currency_code')
      .notNull()
      .default('COP')
      .references(() => currencyCatalog.code),
    exchangeRateAtSale: real('exchange_rate_at_sale').notNull().default(1),
    settleCurrencyCode: text('settle_currency_code').references(() => currencyCatalog.code),
    // restaurant tip / propina. `tipAmount` is the resolved
    // currency value added on top of `subtotal + tax - discount` (it
    // rolls into `total` so payment validation stays unchanged).
    // `tipMethod` records how the operator picked it; null means the
    // operator did not enter a tip (default for retail tenants).
    tipAmount: real('tip_amount').notNull().default(0),
    tipMethod: text('tip_method', { enum: ['percentage', 'fixed'] as const }),
    // restaurant service charge / propina sugerida.
    // `serviceChargeAmount` is the resolved currency value auto-applied
    // from `tenants.settings.restaurant.serviceChargeRate` (mandatory,
    // unlike the voluntary tip). Rolls into `total` after tax + tip so
    // multi-tender Σ validation stays unchanged. `serviceChargeRate`
    // records the percentage that was active when the sale was
    // finalized; null means the tenant had no rate configured (default
    // for retail tenants).
    serviceChargeAmount: real('service_charge_amount').notNull().default(0),
    serviceChargeRate: real('service_charge_rate'),
    paymentMethod: text('payment_method', { enum: paymentMethodEnum }).notNull().default('cash'),
    paymentStatus: text('payment_status', { enum: paymentStatusEnum }).notNull().default('pending'),
    status: text('status', { enum: saleStatusEnum }).notNull().default('draft'),
    cashSessionId: text('cash_session_id').references(() => cashSessions.id),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    // client cart/resume start used only for aggregate cashier
    // pace. Null on historical/non-POS rows; server rejects future or
    // abandoned (>4h) intervals before persisting it.
    checkoutStartedAt: text('checkout_started_at'),
    // Immutable completion boundary paired with checkoutStartedAt. Do not
    // derive checkout duration from updatedAt: later returns and reprints
    // deliberately advance that mutable lifecycle timestamp.
    checkoutCompletedAt: text('checkout_completed_at'),
    // park-and-resume columns. Populated when a draft sale is
    // suspended (`sales.suspend`) and cleared when resumed (`sales.resume`)
    // or discarded (`sales.discardDraft` → `status='cancelled'`).
    // `suspendedBy` is the cashier who suspended it; resume by a different
    // actor is only allowed when that actor is manager/admin.
    suspendedAt: text('suspended_at'),
    suspendedBy: text('suspended_by').references(() => users.id),
    suspendedLabel: text('suspended_label'),
    // receipt reprint counters. Incremented inside
    // `sales.getForReprint`; the audit trail lives in `audit_logs` as
    // one `sale.reprint` row per invocation.
    reprintCount: integer('reprint_count').notNull().default(0),
    lastReprintedAt: text('last_reprinted_at'),
    lastReprintedBy: text('last_reprinted_by').references(() => users.id),
    // Sync fields
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_sales_tenant').on(table.tenantId),
    // The sales history list (`sales.list`) filters by tenant and orders by
    // `created_at DESC` with LIMIT/OFFSET; the composite lets SQLite walk
    // the index in order instead of sorting the tenant's full sale history
    // on every page load. Mirrors idx_inventory_movements_tenant_created /
    // idx_audit_logs_tenant_created.
    index('idx_sales_tenant_created').on(table.tenantId, table.createdAt),
    index('idx_sales_customer').on(table.customerId),
    index('idx_sales_cash_session').on(table.cashSessionId),
    index('idx_sales_created_by').on(table.createdBy),
    // filter drafts quickly by owning cashier in `listDrafts`.
    index('idx_sales_suspended_by').on(table.suspendedBy),
    // cover the leftJoin that drives
    // `restaurantTables.listWithDraftStatus`.
    index('idx_sales_tenant_table').on(table.tenantId, table.tableId),
    uniqueIndex('idx_sales_tenant_number').on(table.tenantId, table.saleNumber),
    // sale amounts: subtotal, tax, tip, and service charge are
    // always positive; total is the rolled-up sum (also positive in every
    // legitimate flow — a return is a sale_return row, not a negative
    // sale). discountAmount is signed: a negative discount (additional
    // charge) is rare but legal and must round-trip cleanly.
    ...moneyPositiveChecks('sales_subtotal', table.subtotal),
    ...moneyPositiveChecks('sales_tax', table.taxAmount),
    ...moneyPositiveChecks('sales_total', table.total),
    ...moneyPositiveChecks('sales_tip', table.tipAmount),
    ...moneyPositiveChecks('sales_service', table.serviceChargeAmount),
    moneyTwoDecimalCheck('sales_discount', table.discountAmount),
    // exchange rate must be strictly positive. 1.0 for
    // single-currency sales (currencyCode === settleCurrencyCode or
    // settleCurrencyCode IS NULL). A negative or zero rate has no
    // accounting meaning and would silently zero out totals.
    check('chk_sales_exchange_rate_positive', sql`${table.exchangeRateAtSale} > 0`),
    // defense-in-depth for the cash-session invariant. The
    // rule "every committed sale is bound to a cash session" is enforced
    // in application code (requireActiveCashSession + the in-tx
    // assertCashSessionStillOpen, ), but a raw write, a future
    // sync path, or a bug could otherwise persist a non-draft sale with a
    // null cashSessionId. Drafts are exempt by design (a sale may be
    // started before its session is resolved); every other status must
    // carry a session. No row written through the app violates this today
    // (both INSERT sites bind a session, even for drafts), so the
    // constraint is purely additive — it pins the invariant at the
    // storage layer.
    check(
      'chk_sales_cash_session_or_draft',
      sql`${table.cashSessionId} IS NOT NULL OR ${table.status} = 'draft'`
    ),
  ]
);

export const salesRelations = relations(sales, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [sales.tenantId],
    references: [tenants.id],
  }),
  customer: one(customers, {
    fields: [sales.customerId],
    references: [customers.id],
  }),
  createdByUser: one(users, {
    fields: [sales.createdBy],
    references: [users.id],
  }),
  cashSession: one(cashSessions, {
    fields: [sales.cashSessionId],
    references: [cashSessions.id],
  }),
  // optional link to the physical restaurant table.
  restaurantTable: one(restaurantTables, {
    fields: [sales.tableId],
    references: [restaurantTables.id],
  }),
  items: many(saleItems),
  returns: many(saleReturns),
  payments: many(salePayments),
}));

// ============================================================================
// CASH SESSIONS
// ============================================================================

/** A cash session tracks the opening float, running expected balance, and reconciliation state for a cashier on a specific register/site. */
export const cashSessions = sqliteTable(
  'cash_sessions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    cashierId: text('cashier_id')
      .notNull()
      .references(() => users.id),
    // nullable only for historical sessions created before
    // cash/labor lifecycle integration. Every new application open path links
    // the drawer to the same-site employee shift that owns its labor evidence.
    employeeShiftId: text('employee_shift_id').references(() => employeeShifts.id),
    registerName: text('register_name').notNull(),
    openingFloat: real('opening_float').notNull().default(0),
    openingCountDenominations: text('opening_count_denominations', { mode: 'json' })
      .$type<CashSessionDenomination[]>()
      .notNull(),
    expectedBalance: real('expected_balance').notNull().default(0),
    actualCount: real('actual_count'),
    actualCountDenominations: text('actual_count_denominations', { mode: 'json' }).$type<
      CashSessionDenomination[] | null
    >(),
    overShort: real('over_short'),
    status: text('status', { enum: cashSessionStatusEnum }).notNull().default('open'),
    openedAt: text('opened_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    closedAt: text('closed_at'),
    // materialized at close so the private HUD can read a
    // personal best without rescanning all historical sale items.
    paceItemsPerMinute: real('pace_items_per_minute'),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_cash_sessions_tenant').on(table.tenantId),
    index('idx_cash_sessions_site').on(table.siteId),
    index('idx_cash_sessions_cashier').on(table.cashierId),
    index('idx_cash_sessions_tenant_employee_shift').on(table.tenantId, table.employeeShiftId),
    index('idx_cash_sessions_status').on(table.status),
    index('idx_cash_sessions_site_status').on(table.siteId, table.status),
    index('idx_cash_sessions_register_status').on(table.siteId, table.registerName, table.status),
    // opening float and the running expected balance can never
    // go negative without indicating either a robbery or a runtime bug
    // (Counter must net cash inflows). over_short is the variance at
    // close and is intentionally signed (positive over, negative short).
    ...moneyPositiveChecks('cash_sessions_opening', table.openingFloat),
    ...moneyPositiveChecks('cash_sessions_expected', table.expectedBalance),
    moneyTwoDecimalCheck('cash_sessions_over_short', table.overShort),
  ]
);

export const cashSessionsRelations = relations(cashSessions, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [cashSessions.tenantId],
    references: [tenants.id],
  }),
  site: one(sites, {
    fields: [cashSessions.siteId],
    references: [sites.id],
  }),
  cashier: one(users, {
    fields: [cashSessions.cashierId],
    references: [users.id],
  }),
  employeeShift: one(employeeShifts, {
    fields: [cashSessions.employeeShiftId],
    references: [employeeShifts.id],
  }),
  movements: many(cashMovements),
  sales: many(sales),
}));

/** A denomination template stores the standard opening float breakdown for a site register so cashiers can reopen drawers consistently. */
export const denominationTemplates = sqliteTable(
  'denomination_templates',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    registerName: text('register_name').notNull(),
    label: text('label').notNull(),
    openingFloat: real('opening_float').notNull().default(0),
    denominations: text('denominations', { mode: 'json' })
      .$type<CashSessionDenomination[]>()
      .notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_denomination_templates_tenant').on(table.tenantId),
    index('idx_denomination_templates_site').on(table.siteId),
    index('idx_denomination_templates_site_active').on(
      table.siteId,
      table.isActive,
      table.sortOrder
    ),
    uniqueIndex('idx_denomination_templates_site_register').on(table.siteId, table.registerName),
    // template opening float is non-negative.
    ...moneyPositiveChecks('denomination_templates_opening', table.openingFloat),
  ]
);

export const denominationTemplatesRelations = relations(denominationTemplates, ({ one }) => ({
  tenant: one(tenants, {
    fields: [denominationTemplates.tenantId],
    references: [tenants.id],
  }),
  site: one(sites, {
    fields: [denominationTemplates.siteId],
    references: [sites.id],
  }),
}));

/** A cash movement records each inflow/outflow linked to an open session so expected drawer balance stays auditable throughout the shift. */
export const cashMovements = sqliteTable(
  'cash_movements',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => cashSessions.id, { onDelete: 'cascade' }),
    type: text('type', { enum: cashMovementTypeEnum }).notNull(),
    amount: real('amount').notNull().default(0),
    referenceId: text('reference_id'),
    note: text('note'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_cash_movements_tenant').on(table.tenantId),
    index('idx_cash_movements_session').on(table.sessionId),
    index('idx_cash_movements_type').on(table.type),
    index('idx_cash_movements_created_by').on(table.createdBy),
    index('idx_cash_movements_session_created').on(table.sessionId, table.createdAt),
    // cash_movements.amount is intentionally
    // signed (paid_out / refund / skim store negative deltas). Only
    // the precision invariant applies; the application uses
    // roundMoney() before every write.
    moneyTwoDecimalCheck('cash_movements_amount', table.amount),
  ]
);

export const cashMovementsRelations = relations(cashMovements, ({ one }) => ({
  tenant: one(tenants, {
    fields: [cashMovements.tenantId],
    references: [tenants.id],
  }),
  session: one(cashSessions, {
    fields: [cashMovements.sessionId],
    references: [cashSessions.id],
  }),
  createdByUser: one(users, {
    fields: [cashMovements.createdBy],
    references: [users.id],
  }),
}));
