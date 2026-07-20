/** Server-authoritative customer and provider launch imports. */
import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { createCustomer } from '../customers/index.js';
import { createProvider } from '../providers/index.js';
import { cities, customers, providers } from '../../db/schema.js';
import { createModuleLogger } from '../../logging/logger.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import type {
  CommitLaunchCustomerImportInput,
  CommitLaunchProviderImportInput,
  LaunchCustomerImportRow,
  LaunchProviderImportRow,
  PreviewLaunchCustomerImportInput,
  PreviewLaunchProviderImportInput,
} from '../../trpc/schemas/launchMigration.js';
import type {
  CustomerImportPreviewRow,
  LaunchMigrationContext,
  NormalizedLaunchCustomer,
  NormalizedLaunchProvider,
  PartyImportIssue,
  PartyImportIssueCode,
  ProviderImportPreviewRow,
} from './types.js';
import {
  assertRealDataCommit,
  getImportSourceFormat,
  getSafeImportErrorMetadata,
} from './safety.js';

const log = createModuleLogger('launch-migration');
const emailSchema = z.string().email();
const DUPLICATE_ISSUES = new Set<PartyImportIssueCode>([
  'duplicate_file_name',
  'duplicate_existing_name',
  'duplicate_file_tax_id',
  'duplicate_existing_tax_id',
  'duplicate_file_email',
  'duplicate_existing_email',
]);

function optionalText(value: string | undefined): string | null {
  return value?.trim() || null;
}

function normalizedKey(value: string | null): string | null {
  return value ? value.trim().toLocaleLowerCase('en-US') : null;
}

function addLengthIssue(
  issues: PartyImportIssue[],
  field: PartyImportIssue['field'],
  value: string | null,
  max: number
) {
  if (value && value.length > max) issues.push({ code: 'too_long', field });
}

function classifyPartyStatus(issues: PartyImportIssue[]) {
  const invalid = issues.some(issue => !DUPLICATE_ISSUES.has(issue.code));
  return invalid
    ? ('invalid' as const)
    : issues.length > 0
      ? ('duplicate' as const)
      : ('ready' as const);
}

function hashPartyImport(
  entity: 'customers' | 'providers',
  input: { dataMode: 'demo' | 'real'; sourceName: string; rows: unknown[] }
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        dataMode: input.dataMode,
        entity,
        sourceName: input.sourceName,
        rows: input.rows,
      })
    )
    .digest('hex');
}

export function hashLaunchCustomerImport(input: PreviewLaunchCustomerImportInput): string {
  return hashPartyImport('customers', input);
}

export function hashLaunchProviderImport(input: PreviewLaunchProviderImportInput): string {
  return hashPartyImport('providers', input);
}

function normalizeCustomerRow(row: LaunchCustomerImportRow) {
  const normalized: NormalizedLaunchCustomer = {
    name: row.values.name?.trim() ?? '',
    taxId: optionalText(row.values.taxId),
    email: normalizedKey(optionalText(row.values.email)),
    phone: optionalText(row.values.phone),
    address: optionalText(row.values.address),
    city: optionalText(row.values.city),
    state: optionalText(row.values.state),
    postalCode: optionalText(row.values.postalCode),
    country: optionalText(row.values.country),
    notes: optionalText(row.values.notes),
  };
  const issues: PartyImportIssue[] = [];
  if (!normalized.name) issues.push({ code: 'required', field: 'name' });
  addLengthIssue(issues, 'name', normalized.name, 255);
  addLengthIssue(issues, 'taxId', normalized.taxId, 100);
  addLengthIssue(issues, 'email', normalized.email, 254);
  addLengthIssue(issues, 'phone', normalized.phone, 100);
  addLengthIssue(issues, 'address', normalized.address, 500);
  addLengthIssue(issues, 'city', normalized.city, 120);
  addLengthIssue(issues, 'state', normalized.state, 120);
  addLengthIssue(issues, 'postalCode', normalized.postalCode, 40);
  addLengthIssue(issues, 'country', normalized.country, 120);
  addLengthIssue(issues, 'notes', normalized.notes, 2_000);
  if (normalized.email && !emailSchema.safeParse(normalized.email).success) {
    issues.push({ code: 'invalid_email', field: 'email' });
  }
  return { normalized, issues };
}

async function loadExistingCustomerKeys(
  ctx: LaunchMigrationContext,
  normalizedRows: NormalizedLaunchCustomer[]
) {
  const taxIds = [
    ...new Set(normalizedRows.map(row => normalizedKey(row.taxId)).filter(Boolean)),
  ] as string[];
  const emails = [
    ...new Set(normalizedRows.map(row => normalizedKey(row.email)).filter(Boolean)),
  ] as string[];
  const [taxIdRows, emailRows] = await Promise.all([
    taxIds.length
      ? ctx.db
          .select({ value: customers.taxId })
          .from(customers)
          .where(
            and(
              eq(customers.tenantId, ctx.tenantId),
              eq(customers.privacyStatus, 'active'),
              inArray(sql<string>`lower(trim(${customers.taxId}))`, taxIds)
            )
          )
          .all()
      : [],
    emails.length
      ? ctx.db
          .select({ value: customers.email })
          .from(customers)
          .where(
            and(
              eq(customers.tenantId, ctx.tenantId),
              eq(customers.privacyStatus, 'active'),
              inArray(sql<string>`lower(trim(${customers.email}))`, emails)
            )
          )
          .all()
      : [],
  ]);
  return {
    taxIds: new Set(taxIdRows.map(row => normalizedKey(row.value)).filter(Boolean)),
    emails: new Set(emailRows.map(row => normalizedKey(row.value)).filter(Boolean)),
  };
}

export async function previewLaunchCustomerImport(
  ctx: LaunchMigrationContext,
  input: PreviewLaunchCustomerImportInput
) {
  const normalizedRows = input.rows.map(row => ({
    rowNumber: row.rowNumber,
    ...normalizeCustomerRow(row),
  }));
  const existing = await loadExistingCustomerKeys(
    ctx,
    normalizedRows.map(row => row.normalized)
  );
  const seenTaxIds = new Set<string>();
  const seenEmails = new Set<string>();
  const rows: CustomerImportPreviewRow[] = normalizedRows.map(row => {
    const issues = [...row.issues];
    const taxId = normalizedKey(row.normalized.taxId);
    const email = normalizedKey(row.normalized.email);
    if (taxId) {
      if (seenTaxIds.has(taxId)) issues.push({ code: 'duplicate_file_tax_id', field: 'taxId' });
      else if (existing.taxIds.has(taxId))
        issues.push({ code: 'duplicate_existing_tax_id', field: 'taxId' });
      seenTaxIds.add(taxId);
    }
    if (email) {
      if (seenEmails.has(email)) issues.push({ code: 'duplicate_file_email', field: 'email' });
      else if (existing.emails.has(email))
        issues.push({ code: 'duplicate_existing_email', field: 'email' });
      seenEmails.add(email);
    }
    return {
      rowNumber: row.rowNumber,
      status: classifyPartyStatus(issues),
      normalized: row.normalized,
      issues,
    };
  });
  return {
    dataMode: input.dataMode,
    previewHash: hashLaunchCustomerImport(input),
    summary: summarizePartyRows(rows),
    rows,
  };
}

function normalizeProviderRow(row: LaunchProviderImportRow) {
  const normalized: NormalizedLaunchProvider = {
    name: row.values.name?.trim() ?? '',
    taxId: optionalText(row.values.taxId),
    email: normalizedKey(optionalText(row.values.email)),
    phone: optionalText(row.values.phone),
    address: optionalText(row.values.address),
    contactName: optionalText(row.values.contactName),
    cityCode: optionalText(row.values.cityCode),
    cityId: null,
  };
  const issues: PartyImportIssue[] = [];
  if (!normalized.name) issues.push({ code: 'required', field: 'name' });
  addLengthIssue(issues, 'name', normalized.name, 255);
  addLengthIssue(issues, 'taxId', normalized.taxId, 100);
  addLengthIssue(issues, 'email', normalized.email, 254);
  addLengthIssue(issues, 'phone', normalized.phone, 100);
  addLengthIssue(issues, 'address', normalized.address, 500);
  addLengthIssue(issues, 'contactName', normalized.contactName, 255);
  addLengthIssue(issues, 'cityCode', normalized.cityCode, 100);
  if (normalized.email && !emailSchema.safeParse(normalized.email).success) {
    issues.push({ code: 'invalid_email', field: 'email' });
  }
  return { normalized, issues };
}

async function loadProviderReferenceData(
  ctx: LaunchMigrationContext,
  normalizedRows: NormalizedLaunchProvider[]
) {
  const names = [
    ...new Set(normalizedRows.map(row => normalizedKey(row.name)).filter(Boolean)),
  ] as string[];
  const taxIds = [
    ...new Set(normalizedRows.map(row => normalizedKey(row.taxId)).filter(Boolean)),
  ] as string[];
  const emails = [
    ...new Set(normalizedRows.map(row => normalizedKey(row.email)).filter(Boolean)),
  ] as string[];
  const cityCodes = [
    ...new Set(normalizedRows.map(row => normalizedKey(row.cityCode)).filter(Boolean)),
  ] as string[];
  const [nameRows, taxIdRows, emailRows, cityRows] = await Promise.all([
    names.length
      ? ctx.db
          .select({ value: providers.name })
          .from(providers)
          .where(
            and(
              eq(providers.tenantId, ctx.tenantId),
              inArray(sql<string>`lower(trim(${providers.name}))`, names)
            )
          )
          .all()
      : [],
    taxIds.length
      ? ctx.db
          .select({ value: providers.taxId })
          .from(providers)
          .where(
            and(
              eq(providers.tenantId, ctx.tenantId),
              inArray(sql<string>`lower(trim(${providers.taxId}))`, taxIds)
            )
          )
          .all()
      : [],
    emails.length
      ? ctx.db
          .select({ value: providers.email })
          .from(providers)
          .where(
            and(
              eq(providers.tenantId, ctx.tenantId),
              inArray(sql<string>`lower(trim(${providers.email}))`, emails)
            )
          )
          .all()
      : [],
    cityCodes.length
      ? ctx.db
          .select({ id: cities.id, code: cities.code })
          .from(cities)
          .where(
            and(
              eq(cities.tenantId, ctx.tenantId),
              eq(cities.isActive, true),
              inArray(sql<string>`lower(trim(${cities.code}))`, cityCodes)
            )
          )
          .all()
      : [],
  ]);
  return {
    names: new Set(nameRows.map(row => normalizedKey(row.value)).filter(Boolean)),
    taxIds: new Set(taxIdRows.map(row => normalizedKey(row.value)).filter(Boolean)),
    emails: new Set(emailRows.map(row => normalizedKey(row.value)).filter(Boolean)),
    cityIdsByCode: new Map(cityRows.map(row => [normalizedKey(row.code)!, row.id])),
  };
}

export async function previewLaunchProviderImport(
  ctx: LaunchMigrationContext,
  input: PreviewLaunchProviderImportInput
) {
  const normalizedRows = input.rows.map(row => ({
    rowNumber: row.rowNumber,
    ...normalizeProviderRow(row),
  }));
  const existing = await loadProviderReferenceData(
    ctx,
    normalizedRows.map(row => row.normalized)
  );
  const seenNames = new Set<string>();
  const seenTaxIds = new Set<string>();
  const seenEmails = new Set<string>();
  const rows: ProviderImportPreviewRow[] = normalizedRows.map(row => {
    const issues = [...row.issues];
    const name = normalizedKey(row.normalized.name);
    const taxId = normalizedKey(row.normalized.taxId);
    const email = normalizedKey(row.normalized.email);
    const cityCode = normalizedKey(row.normalized.cityCode);
    if (name) {
      if (seenNames.has(name)) issues.push({ code: 'duplicate_file_name', field: 'name' });
      else if (existing.names.has(name))
        issues.push({ code: 'duplicate_existing_name', field: 'name' });
      seenNames.add(name);
    }
    if (taxId) {
      if (seenTaxIds.has(taxId)) issues.push({ code: 'duplicate_file_tax_id', field: 'taxId' });
      else if (existing.taxIds.has(taxId))
        issues.push({ code: 'duplicate_existing_tax_id', field: 'taxId' });
      seenTaxIds.add(taxId);
    }
    if (email) {
      if (seenEmails.has(email)) issues.push({ code: 'duplicate_file_email', field: 'email' });
      else if (existing.emails.has(email))
        issues.push({ code: 'duplicate_existing_email', field: 'email' });
      seenEmails.add(email);
    }
    if (cityCode && !existing.cityIdsByCode.has(cityCode)) {
      issues.push({ code: 'city_not_found', field: 'cityCode' });
    }
    return {
      rowNumber: row.rowNumber,
      status: classifyPartyStatus(issues),
      normalized: {
        ...row.normalized,
        cityId: cityCode ? (existing.cityIdsByCode.get(cityCode) ?? null) : null,
      },
      issues,
    };
  });
  return {
    dataMode: input.dataMode,
    previewHash: hashLaunchProviderImport(input),
    summary: summarizePartyRows(rows),
    rows,
  };
}

function summarizePartyRows(rows: ReadonlyArray<{ status: 'ready' | 'duplicate' | 'invalid' }>) {
  return {
    total: rows.length,
    ready: rows.filter(row => row.status === 'ready').length,
    duplicates: rows.filter(row => row.status === 'duplicate').length,
    invalid: rows.filter(row => row.status === 'invalid').length,
  };
}

function isProviderConflict(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed.*providers/i.test(error.message);
}

async function commitPartyImport<
  Row extends {
    rowNumber: number;
    status: 'ready' | 'duplicate' | 'invalid';
    issues: PartyImportIssue[];
  },
>(
  ctx: LaunchMigrationContext,
  options: {
    entity: 'customers' | 'providers';
    auditAction: 'data_import.customers' | 'data_import.providers';
    create: (row: Row) => Promise<{ id: string }>;
    isConflict?: (error: unknown) => boolean;
    sourceName: string;
    previewHash: string;
    preview: {
      summary: { total: number; invalid: number };
      rows: Row[];
    };
  }
) {
  const importId = nanoid();
  const importedRows: Array<{ rowNumber: number; recordId: string; issues: PartyImportIssue[] }> =
    [];
  const failedRows: Array<{ rowNumber: number; issues: PartyImportIssue[] }> = [];
  const skippedRows = options.preview.rows
    .filter(row => row.status === 'duplicate')
    .map(row => ({ rowNumber: row.rowNumber, issues: row.issues }));

  for (const row of options.preview.rows) {
    if (row.status !== 'ready') continue;
    try {
      const created = await options.create(row);
      importedRows.push({ rowNumber: row.rowNumber, recordId: created.id, issues: [] });
    } catch (error) {
      if (options.isConflict?.(error)) {
        skippedRows.push({
          rowNumber: row.rowNumber,
          issues: [{ code: 'concurrent_duplicate', field: 'name' }],
        });
        continue;
      }
      log.error(
        {
          ...getSafeImportErrorMetadata(error),
          tenantId: ctx.tenantId,
          importId,
          rowNumber: row.rowNumber,
          entity: options.entity,
        },
        'party import row failed'
      );
      failedRows.push({
        rowNumber: row.rowNumber,
        issues: [{ code: 'import_failed', field: 'name' }],
      });
    }
  }

  const completedAt = new Date().toISOString();
  ctx.db.transaction(tx => {
    writeAuditLog({
      tx,
      tenantId: ctx.tenantId,
      actorId: ctx.user.id,
      action: options.auditAction,
      resourceType: 'data_import',
      resourceId: importId,
      after: {
        imported: importedRows.length,
        skipped: skippedRows.length,
        invalid: options.preview.summary.invalid,
        failed: failedRows.length,
      },
      metadata: {
        dataMode: 'real',
        sourceFormat: getImportSourceFormat(options.sourceName),
        previewHash: options.previewHash,
        totalRows: options.preview.summary.total,
      },
    });
  });

  return {
    dataMode: 'real' as const,
    importId,
    completedAt,
    summary: {
      total: options.preview.summary.total,
      imported: importedRows.length,
      skipped: skippedRows.length,
      invalid: options.preview.summary.invalid,
      failed: failedRows.length,
      warnings: 0,
    },
    importedRows,
    skippedRows,
    failedRows,
  };
}

export async function commitLaunchCustomerImport(
  ctx: LaunchMigrationContext,
  input: CommitLaunchCustomerImportInput
) {
  assertRealDataCommit(input);
  const preview = await previewLaunchCustomerImport(ctx, input);
  if (preview.previewHash !== input.previewHash) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The import changed after preview. Preview it again before importing.',
    });
  }
  return commitPartyImport(ctx, {
    entity: 'customers',
    auditAction: 'data_import.customers',
    create: row =>
      createCustomer(ctx, {
        name: row.normalized.name,
        taxId: row.normalized.taxId ?? undefined,
        email: row.normalized.email ?? undefined,
        phone: row.normalized.phone ?? undefined,
        address: row.normalized.address ?? undefined,
        city: row.normalized.city ?? undefined,
        state: row.normalized.state ?? undefined,
        postalCode: row.normalized.postalCode ?? undefined,
        country: row.normalized.country ?? undefined,
        notes: row.normalized.notes ?? undefined,
        isActive: true,
      }),
    sourceName: input.sourceName,
    previewHash: input.previewHash,
    preview,
  });
}

export async function commitLaunchProviderImport(
  ctx: LaunchMigrationContext,
  input: CommitLaunchProviderImportInput
) {
  assertRealDataCommit(input);
  const preview = await previewLaunchProviderImport(ctx, input);
  if (preview.previewHash !== input.previewHash) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The import changed after preview. Preview it again before importing.',
    });
  }
  return commitPartyImport(ctx, {
    entity: 'providers',
    auditAction: 'data_import.providers',
    create: row =>
      createProvider(ctx, {
        name: row.normalized.name,
        taxId: row.normalized.taxId ?? undefined,
        email: row.normalized.email ?? undefined,
        phone: row.normalized.phone ?? undefined,
        address: row.normalized.address ?? undefined,
        contactName: row.normalized.contactName ?? undefined,
        cityId: row.normalized.cityId ?? undefined,
        isActive: true,
      }),
    isConflict: isProviderConflict,
    sourceName: input.sourceName,
    previewHash: input.previewHash,
    preview,
  });
}
