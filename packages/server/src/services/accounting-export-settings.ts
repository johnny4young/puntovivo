/**
 * Versioned tenant settings for the local accountant hand-off.
 *
 * The namespace lives at `tenants.settings.accountingExport`. Keeping the
 * defaults server-side gives every renderer the same PUC baseline and lets a
 * future default revision coexist with tenants that already customized their
 * chart. Reads are defensive: an old, partial, or malformed blob falls back
 * field-by-field instead of leaking invalid account cells into an export.
 *
 * @module services/accounting-export-settings
 */

import { eq, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../db/index.js';
import { tenants } from '../db/schema.js';

export const ACCOUNTING_EXPORT_SETTINGS_VERSION = 3 as const;
export const ACCOUNTING_PUC_DEFAULTS_VERSION = 3 as const;

export interface AccountingPucAccounts {
  paymentMethods: {
    cash: string;
    card: string;
    transfer: string;
    credit: string;
    other: string;
  };
  income: string;
  iva: string;
  inc: string;
  tips: string;
  receivable: string;
  /** Liability created when a refund is issued as customer store credit. */
  storeCredit: string;
  /** Loyalty-points liability debited on redemption and credited on restore. */
  loyalty: string;
  refunds: string;
}

export interface AccountingExportSettings {
  schemaVersion: typeof ACCOUNTING_EXPORT_SETTINGS_VERSION;
  pucDefaultsVersion: typeof ACCOUNTING_PUC_DEFAULTS_VERSION;
  accounts: AccountingPucAccounts;
  lastSiteId: string | null;
}

/**
 * Four digits admit account-level mappings; up to twelve digits admit company
 * auxiliary levels. Separators are rejected so the exported cell is a stable
 * numeric identifier across CSV importers.
 */
export const ACCOUNTING_PUC_CODE_PATTERN = /^[1-9]\d{3,11}$/;

export const DEFAULT_ACCOUNTING_PUC_ACCOUNTS: AccountingPucAccounts = {
  paymentMethods: {
    cash: '110505',
    card: '111005',
    transfer: '111005',
    credit: '130505',
    other: '110505',
  },
  income: '413595',
  iva: '240802',
  inc: '246205',
  tips: '238095',
  receivable: '130505',
  storeCredit: '280505',
  loyalty: '280505',
  refunds: '417595',
};

function cloneDefaultAccounts(): AccountingPucAccounts {
  return {
    ...DEFAULT_ACCOUNTING_PUC_ACCOUNTS,
    paymentMethods: { ...DEFAULT_ACCOUNTING_PUC_ACCOUNTS.paymentMethods },
  };
}

function validAccountCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && ACCOUNTING_PUC_CODE_PATTERN.test(value) ? value : fallback;
}

function parseAccounts(raw: unknown): AccountingPucAccounts {
  const defaults = cloneDefaultAccounts();
  if (!raw || typeof raw !== 'object') return defaults;

  const candidate = raw as Record<string, unknown>;
  const rawPaymentMethods =
    candidate.paymentMethods && typeof candidate.paymentMethods === 'object'
      ? (candidate.paymentMethods as Record<string, unknown>)
      : {};

  return {
    paymentMethods: {
      cash: validAccountCode(rawPaymentMethods.cash, defaults.paymentMethods.cash),
      card: validAccountCode(rawPaymentMethods.card, defaults.paymentMethods.card),
      transfer: validAccountCode(rawPaymentMethods.transfer, defaults.paymentMethods.transfer),
      credit: validAccountCode(rawPaymentMethods.credit, defaults.paymentMethods.credit),
      other: validAccountCode(rawPaymentMethods.other, defaults.paymentMethods.other),
    },
    income: validAccountCode(candidate.income, defaults.income),
    iva: validAccountCode(candidate.iva, defaults.iva),
    inc: validAccountCode(candidate.inc, defaults.inc),
    tips: validAccountCode(candidate.tips, defaults.tips),
    receivable: validAccountCode(candidate.receivable, defaults.receivable),
    storeCredit: validAccountCode(candidate.storeCredit, defaults.storeCredit),
    loyalty: validAccountCode(candidate.loyalty, defaults.loyalty),
    refunds: validAccountCode(candidate.refunds, defaults.refunds),
  };
}

export function parseAccountingExportSettings(rawSettings: unknown): AccountingExportSettings {
  const root =
    rawSettings && typeof rawSettings === 'object' ? (rawSettings as Record<string, unknown>) : {};
  const rawNamespace = root.accountingExport;
  const namespace =
    rawNamespace && typeof rawNamespace === 'object'
      ? (rawNamespace as Record<string, unknown>)
      : {};

  return {
    schemaVersion: ACCOUNTING_EXPORT_SETTINGS_VERSION,
    pucDefaultsVersion: ACCOUNTING_PUC_DEFAULTS_VERSION,
    accounts: parseAccounts(namespace.accounts),
    lastSiteId:
      typeof namespace.lastSiteId === 'string' && namespace.lastSiteId.length > 0
        ? namespace.lastSiteId
        : null,
  };
}

export async function resolveAccountingExportSettings(
  db: DatabaseInstance,
  tenantId: string
): Promise<AccountingExportSettings> {
  const row = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();

  return parseAccountingExportSettings(row?.settings);
}

async function patchAccountingExportNamespace(
  db: DatabaseInstance,
  tenantId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const encodedPatch = JSON.stringify({
    schemaVersion: ACCOUNTING_EXPORT_SETTINGS_VERSION,
    pucDefaultsVersion: ACCOUNTING_PUC_DEFAULTS_VERSION,
    ...patch,
  });
  // Merge only this namespace at UPDATE time. A site selection and a PUC
  // save can be in flight together; a read/modify/write of the full tenant
  // blob would let the last request silently erase the other one.
  await db
    .update(tenants)
    .set({
      settings: sql`json_set(
        COALESCE(${tenants.settings}, '{}'),
        '$.accountingExport',
        json_patch(
          COALESCE(
            json_extract(COALESCE(${tenants.settings}, '{}'), '$.accountingExport'),
            json('{}')
          ),
          json(${encodedPatch})
        )
      )`,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tenants.id, tenantId));
}

export async function writeAccountingPucAccounts(
  db: DatabaseInstance,
  tenantId: string,
  accounts: AccountingPucAccounts
): Promise<AccountingExportSettings> {
  await patchAccountingExportNamespace(db, tenantId, { accounts: parseAccounts(accounts) });
  return resolveAccountingExportSettings(db, tenantId);
}

export async function writeAccountingLastSite(
  db: DatabaseInstance,
  tenantId: string,
  lastSiteId: string | null
): Promise<AccountingExportSettings> {
  await patchAccountingExportNamespace(db, tenantId, { lastSiteId });
  return resolveAccountingExportSettings(db, tenantId);
}
