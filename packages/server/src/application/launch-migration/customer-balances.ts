/** ENG-123d — Server-authoritative customer receivable opening balances. */
import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { importOpeningCustomerBalance } from '../customers/index.js';
import { customerLedgerEntries, customers } from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';
import { createModuleLogger } from '../../logging/logger.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import type {
  CommitLaunchCustomerBalanceImportInput,
  LaunchCustomerBalanceImportRow,
  PreviewLaunchCustomerBalanceImportInput,
} from '../../trpc/schemas/launchMigration.js';
import { parseImportNumber } from './numbers.js';
import {
  assertRealDataCommit,
  getImportSourceFormat,
  getSafeImportErrorMetadata,
} from './safety.js';
import type {
  CustomerBalanceImportIssue,
  CustomerBalanceImportIssueCode,
  CustomerBalanceImportPreviewRow,
  LaunchMigrationContext,
  NormalizedLaunchCustomerBalance,
} from './types.js';

const log = createModuleLogger('launch-migration');
const emailSchema = z.string().email();
const MAX_OPENING_BALANCE = 999_999_999_999.99;
const DUPLICATE_ISSUES = new Set<CustomerBalanceImportIssueCode>([
  'duplicate_file_customer',
  'duplicate_existing_balance',
]);

interface CustomerCandidate {
  email: string | null;
  id: string;
  name: string;
  taxId: string | null;
}

function optionalText(value: string | undefined): string | null {
  return value?.trim() || null;
}

function normalizedKey(value: string | null): string | null {
  return value ? value.trim().toLocaleLowerCase('en-US') : null;
}

function canonicalImportPayload(input: PreviewLaunchCustomerBalanceImportInput) {
  return {
    dataMode: input.dataMode,
    sourceName: input.sourceName,
    decimalFormat: input.decimalFormat,
    rows: input.rows.map(row => ({ rowNumber: row.rowNumber, values: row.values })),
  };
}

export function hashLaunchCustomerBalanceImport(
  input: PreviewLaunchCustomerBalanceImportInput
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalImportPayload(input)))
    .digest('hex');
}

function normalizeRow(
  row: LaunchCustomerBalanceImportRow,
  decimalFormat: PreviewLaunchCustomerBalanceImportInput['decimalFormat']
): { normalized: NormalizedLaunchCustomerBalance; issues: CustomerBalanceImportIssue[] } {
  const taxId = optionalText(row.values.taxId);
  const email = normalizedKey(optionalText(row.values.email));
  const note = optionalText(row.values.note);
  const parsedBalance = parseImportNumber(row.values.openingBalance, decimalFormat);
  const issues: CustomerBalanceImportIssue[] = [];

  if (!taxId && !email) issues.push({ code: 'identity_required', field: 'taxId' });
  if (taxId && taxId.length > 100) issues.push({ code: 'too_long', field: 'taxId' });
  if (email && email.length > 254) issues.push({ code: 'too_long', field: 'email' });
  if (note && note.length > 300) issues.push({ code: 'too_long', field: 'note' });
  if (email && !emailSchema.safeParse(email).success) {
    issues.push({ code: 'invalid_email', field: 'email' });
  }
  if (parsedBalance === null) {
    issues.push({ code: 'invalid_number', field: 'openingBalance' });
  } else if (parsedBalance <= 0) {
    issues.push({ code: 'balance_must_be_positive', field: 'openingBalance' });
  } else if (parsedBalance > MAX_OPENING_BALANCE) {
    issues.push({ code: 'out_of_range', field: 'openingBalance' });
  }

  return {
    normalized: {
      customerId: null,
      customerName: null,
      taxId,
      email,
      openingBalance: parsedBalance === null ? 0 : roundMoney(parsedBalance),
      note,
    },
    issues,
  };
}

function groupCandidates(
  rows: CustomerCandidate[],
  field: 'email' | 'taxId'
): Map<string, CustomerCandidate[]> {
  const grouped = new Map<string, CustomerCandidate[]>();
  for (const row of rows) {
    const key = normalizedKey(row[field]);
    if (!key) continue;
    const matches = grouped.get(key) ?? [];
    matches.push(row);
    grouped.set(key, matches);
  }
  return grouped;
}

async function loadCustomerResolutionState(
  ctx: LaunchMigrationContext,
  rows: NormalizedLaunchCustomerBalance[]
) {
  const taxIds = [
    ...new Set(rows.map(row => normalizedKey(row.taxId)).filter(Boolean)),
  ] as string[];
  const emails = [
    ...new Set(rows.map(row => normalizedKey(row.email)).filter(Boolean)),
  ] as string[];
  const projection = {
    id: customers.id,
    name: customers.name,
    taxId: customers.taxId,
    email: customers.email,
  };
  const [taxRows, emailRows] = await Promise.all([
    taxIds.length
      ? ctx.db
          .select(projection)
          .from(customers)
          .where(
            and(
              eq(customers.tenantId, ctx.tenantId),
              eq(customers.isActive, true),
              eq(customers.privacyStatus, 'active'),
              inArray(sql<string>`lower(trim(${customers.taxId}))`, taxIds)
            )
          )
          .all()
      : [],
    emails.length
      ? ctx.db
          .select(projection)
          .from(customers)
          .where(
            and(
              eq(customers.tenantId, ctx.tenantId),
              eq(customers.isActive, true),
              eq(customers.privacyStatus, 'active'),
              inArray(sql<string>`lower(trim(${customers.email}))`, emails)
            )
          )
          .all()
      : [],
  ]);
  const candidates = new Map<string, CustomerCandidate>();
  [...taxRows, ...emailRows].forEach(row => candidates.set(row.id, row));
  const customerIds = [...candidates.keys()];
  const existingLedgerRows = customerIds.length
    ? await ctx.db
        .select({ customerId: customerLedgerEntries.customerId })
        .from(customerLedgerEntries)
        .where(
          and(
            eq(customerLedgerEntries.tenantId, ctx.tenantId),
            inArray(customerLedgerEntries.customerId, customerIds)
          )
        )
        .groupBy(customerLedgerEntries.customerId)
        .all()
    : [];
  return {
    byTaxId: groupCandidates(taxRows, 'taxId'),
    byEmail: groupCandidates(emailRows, 'email'),
    existingLedgerCustomerIds: new Set(existingLedgerRows.map(row => row.customerId)),
  };
}

function resolveCustomer(
  row: NormalizedLaunchCustomerBalance,
  state: Awaited<ReturnType<typeof loadCustomerResolutionState>>
): { candidate: CustomerCandidate | null; issue: CustomerBalanceImportIssue | null } {
  const taxMatches = normalizedKey(row.taxId)
    ? (state.byTaxId.get(normalizedKey(row.taxId)!) ?? [])
    : [];
  const emailMatches = normalizedKey(row.email)
    ? (state.byEmail.get(normalizedKey(row.email)!) ?? [])
    : [];
  if (taxMatches.length > 1 || emailMatches.length > 1) {
    return {
      candidate: null,
      issue: { code: 'ambiguous_customer', field: taxMatches.length > 1 ? 'taxId' : 'email' },
    };
  }
  if (
    taxMatches.length === 1 &&
    emailMatches.length === 1 &&
    taxMatches[0]?.id !== emailMatches[0]?.id
  ) {
    return { candidate: null, issue: { code: 'identifier_conflict', field: 'email' } };
  }
  const candidate = taxMatches[0] ?? emailMatches[0] ?? null;
  return candidate
    ? { candidate, issue: null }
    : {
        candidate: null,
        issue: { code: 'customer_not_found', field: row.taxId ? 'taxId' : 'email' },
      };
}

function summarizeRows(rows: CustomerBalanceImportPreviewRow[]) {
  return {
    total: rows.length,
    ready: rows.filter(row => row.status === 'ready').length,
    duplicates: rows.filter(row => row.status === 'duplicate').length,
    invalid: rows.filter(row => row.status === 'invalid').length,
  };
}

export async function previewLaunchCustomerBalanceImport(
  ctx: LaunchMigrationContext,
  input: PreviewLaunchCustomerBalanceImportInput
) {
  const normalizedRows = input.rows.map(row => ({
    rowNumber: row.rowNumber,
    ...normalizeRow(row, input.decimalFormat),
  }));
  const state = await loadCustomerResolutionState(
    ctx,
    normalizedRows.map(row => row.normalized)
  );
  const seenCustomerIds = new Set<string>();
  const rows: CustomerBalanceImportPreviewRow[] = normalizedRows.map(row => {
    const issues = [...row.issues];
    const resolution =
      row.normalized.taxId || row.normalized.email
        ? resolveCustomer(row.normalized, state)
        : { candidate: null, issue: null };
    if (resolution.issue) issues.push(resolution.issue);
    const normalized = resolution.candidate
      ? {
          ...row.normalized,
          customerId: resolution.candidate.id,
          customerName: resolution.candidate.name,
        }
      : row.normalized;
    if (resolution.candidate) {
      if (seenCustomerIds.has(resolution.candidate.id)) {
        issues.push({
          code: 'duplicate_file_customer',
          field: row.normalized.taxId ? 'taxId' : 'email',
        });
      } else if (state.existingLedgerCustomerIds.has(resolution.candidate.id)) {
        issues.push({ code: 'duplicate_existing_balance', field: 'openingBalance' });
      }
      seenCustomerIds.add(resolution.candidate.id);
    }
    const hasInvalidIssue = issues.some(issue => !DUPLICATE_ISSUES.has(issue.code));
    return {
      rowNumber: row.rowNumber,
      status: hasInvalidIssue ? 'invalid' : issues.length ? 'duplicate' : 'ready',
      normalized,
      issues,
    };
  });
  return {
    dataMode: input.dataMode,
    previewHash: hashLaunchCustomerBalanceImport(input),
    summary: summarizeRows(rows),
    rows,
  };
}

export async function commitLaunchCustomerBalanceImport(
  ctx: LaunchMigrationContext,
  input: CommitLaunchCustomerBalanceImportInput
) {
  assertRealDataCommit(input);
  const preview = await previewLaunchCustomerBalanceImport(ctx, input);
  if (preview.previewHash !== input.previewHash) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The import changed after preview. Preview it again before importing.',
    });
  }

  const importId = nanoid();
  const importedRows: Array<{
    adjustmentId: string;
    amount: number;
    customerId: string;
    rowNumber: number;
    issues: CustomerBalanceImportIssue[];
  }> = [];
  const skippedRows: Array<{ rowNumber: number; issues: CustomerBalanceImportIssue[] }> =
    preview.rows
      .filter(row => row.status === 'duplicate')
      .map(row => ({ rowNumber: row.rowNumber, issues: row.issues }));
  const failedRows: Array<{ rowNumber: number; issues: CustomerBalanceImportIssue[] }> = [];

  for (const row of preview.rows) {
    if (row.status !== 'ready' || !row.normalized.customerId) continue;
    try {
      const note = `ENG-123d opening balance import ${importId}${
        row.normalized.note ? ` — ${row.normalized.note}` : ''
      }`;
      const result = importOpeningCustomerBalance(ctx, {
        customerId: row.normalized.customerId,
        amount: row.normalized.openingBalance,
        note,
      });
      if (result.status === 'existing' || !result.id) {
        skippedRows.push({
          rowNumber: row.rowNumber,
          issues: [{ code: 'duplicate_existing_balance', field: 'openingBalance' }],
        });
        continue;
      }
      importedRows.push({
        adjustmentId: result.id,
        amount: row.normalized.openingBalance,
        customerId: row.normalized.customerId,
        rowNumber: row.rowNumber,
        issues: [],
      });
    } catch (error) {
      log.error(
        {
          ...getSafeImportErrorMetadata(error),
          tenantId: ctx.tenantId,
          importId,
          rowNumber: row.rowNumber,
        },
        'customer opening balance import row failed'
      );
      failedRows.push({
        rowNumber: row.rowNumber,
        issues: [{ code: 'import_failed', field: 'openingBalance' }],
      });
    }
  }

  const completedAt = new Date().toISOString();
  ctx.db.transaction(tx => {
    writeAuditLog({
      tx,
      tenantId: ctx.tenantId,
      actorId: ctx.user.id,
      action: 'data_import.customer_balances',
      resourceType: 'data_import',
      resourceId: importId,
      after: {
        imported: importedRows.length,
        skipped: skippedRows.length,
        invalid: preview.summary.invalid,
        failed: failedRows.length,
      },
      metadata: {
        dataMode: 'real',
        sourceFormat: getImportSourceFormat(input.sourceName),
        previewHash: input.previewHash,
        totalRows: preview.summary.total,
      },
    });
  });

  return {
    dataMode: 'real' as const,
    importId,
    completedAt,
    summary: {
      total: preview.summary.total,
      imported: importedRows.length,
      skipped: skippedRows.length,
      invalid: preview.summary.invalid,
      failed: failedRows.length,
      warnings: 0,
    },
    importedRows,
    skippedRows,
    failedRows,
  };
}
