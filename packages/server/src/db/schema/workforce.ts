/** Effective employment terms are private evidence, not authorization roles or payroll results. */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { tenants, sites, users } from './auth.js';
import { currencyCatalog } from './config.js';
import { moneyPositiveChecks, sqliteNow } from './base.js';
import type { EmploymentContractTerms } from '../../services/labor/employment-contract.js';

// SQLite CHECK treats NULL as success. Require normalized dates explicitly so
// malformed dates cannot pass through date(...)=NULL during an import.
const validCalendarDate = (column: AnySQLiteColumn) => sql`
  length(${column}) = 10
  AND ${column} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND substr(${column}, 1, 4) != '0000'
  AND date(${column}, '+0 days') IS NOT NULL
  AND date(${column}, '+0 days') = ${column}`;

/** Private full evidence; never include this payload in general audit logs or sync invalidations. */
export interface EmploymentContractSnapshot {
  terms: EmploymentContractTerms;
  timeZone: string;
  version: number;
  voidedAt: string | null;
}

export const employmentContracts = sqliteTable(
  'employment_contracts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    position: text('position').notNull(),
    effectiveFrom: text('effective_from').notNull(),
    effectiveUntil: text('effective_until'),
    timeZone: text('time_zone').notNull(),
    currencyCode: text('currency_code')
      .notNull()
      .references(() => currencyCatalog.code),
    payBasis: text('pay_basis', { enum: ['hourly', 'monthly'] }).notNull(),
    payAmount: real('pay_amount').notNull(),
    costingHourlyRate: real('costing_hourly_rate'),
    predecessorId: text('predecessor_id').references((): AnySQLiteColumn => employmentContracts.id),
    version: integer('version').notNull().default(1),
    voidedAt: text('voided_at'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    updatedByUserId: text('updated_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(sqliteNow),
    updatedAt: text('updated_at').notNull().default(sqliteNow),
  },
  table => [
    index('idx_employment_contracts_user_window').on(
      table.tenantId,
      table.userId,
      table.effectiveFrom
    ),
    index('idx_employment_contracts_site').on(table.tenantId, table.siteId, table.id),
    uniqueIndex('idx_employment_contracts_active_start')
      .on(table.tenantId, table.userId, table.effectiveFrom)
      .where(sql`${table.voidedAt} IS NULL`),
    check('chk_employment_contracts_start', validCalendarDate(table.effectiveFrom)),
    check(
      'chk_employment_contracts_end',
      sql`${table.effectiveUntil} IS NULL OR (${validCalendarDate(table.effectiveUntil)} AND ${table.effectiveUntil} > ${table.effectiveFrom})`
    ),
    check(
      'chk_employment_contracts_position',
      sql`length(trim(${table.position})) BETWEEN 1 AND 100`
    ),
    check(
      'chk_employment_contracts_timezone',
      sql`length(trim(${table.timeZone})) BETWEEN 1 AND 100`
    ),
    check(
      'chk_employment_contracts_version',
      sql`${table.version} >= 1 AND typeof(${table.version}) = 'integer'`
    ),
    check(
      'chk_employment_contracts_basis',
      sql`${table.payBasis} IN ('hourly','monthly') AND (${table.payBasis} = 'monthly' OR ${table.costingHourlyRate} IS NULL)`
    ),
    ...moneyPositiveChecks('employment_contracts_pay', table.payAmount),
    ...moneyPositiveChecks('employment_contracts_costing_rate', table.costingHourlyRate),
    check(
      'chk_employment_contracts_pay_limit',
      sql`${table.payAmount} <= 1000000000000 AND (${table.costingHourlyRate} IS NULL OR ${table.costingHourlyRate} <= 1000000000000)`
    ),
    check(
      'chk_employment_contracts_predecessor',
      sql`${table.predecessorId} IS NULL OR ${table.predecessorId} != ${table.id}`
    ),
  ]
);

/** Append-only via the command API; corrections add evidence instead of rewriting past events. */
export const employmentContractEvents = sqliteTable(
  'employment_contract_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    contractId: text('contract_id')
      .notNull()
      .references(() => employmentContracts.id),
    version: integer('version').notNull(),
    kind: text('kind', { enum: ['created', 'ended', 'replaced', 'voided'] }).notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    operationId: text('operation_id').notNull(),
    reason: text('reason').notNull(),
    before: text('before_json', { mode: 'json' }).$type<EmploymentContractSnapshot>(),
    after: text('after_json', { mode: 'json' }).$type<EmploymentContractSnapshot>().notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_employment_contract_events_version').on(
      table.tenantId,
      table.contractId,
      table.version
    ),
    index('idx_employment_contract_events_operation').on(table.tenantId, table.operationId),
    check(
      'chk_employment_contract_events_version',
      sql`${table.version} >= 1 AND typeof(${table.version}) = 'integer'`
    ),
    check(
      'chk_employment_contract_events_kind',
      sql`${table.kind} IN ('created','ended','replaced','voided')`
    ),
    check(
      'chk_employment_contract_events_reason',
      sql`length(trim(${table.reason})) BETWEEN 10 AND 500`
    ),
    check(
      'chk_employment_contract_events_before',
      sql`${table.before} IS NULL OR json_valid(${table.before})`
    ),
    check('chk_employment_contract_events_after', sql`json_valid(${table.after})`),
    check(
      'chk_employment_contract_events_creation',
      sql`(${table.kind} = 'created' AND ${table.version} = 1 AND ${table.before} IS NULL) OR (${table.kind} != 'created' AND ${table.version} > 1 AND ${table.before} IS NOT NULL)`
    ),
  ]
);

/** Current private terms projection; previous versions are retained in the dedicated event ledger. */
export type EmploymentContractRow = typeof employmentContracts.$inferSelect;
