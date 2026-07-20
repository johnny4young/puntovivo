/** Server-authoritative opening-cash register templates. */
import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { cashSessions, denominationTemplates, sites } from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';
import { createModuleLogger } from '../../logging/logger.js';
import { getCashSessionDenominationTotal } from '../../services/cash-session.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import type {
  CommitLaunchOpeningCashImportInput,
  LaunchOpeningCashImportRow,
  PreviewLaunchOpeningCashImportInput,
} from '../../trpc/schemas/launchMigration.js';
import { parseImportNumber } from './numbers.js';
import {
  assertRealDataCommit,
  getImportSourceFormat,
  getSafeImportErrorMetadata,
} from './safety.js';
import type {
  LaunchMigrationContext,
  NormalizedLaunchOpeningCash,
  OpeningCashImportIssue,
  OpeningCashImportIssueCode,
  OpeningCashImportPreviewRow,
} from './types.js';

const log = createModuleLogger('launch-migration');
const MAX_OPENING_FLOAT = 999_999_999_999.99;
const MONEY_EPSILON = 0.001;
const DUPLICATE_ISSUES = new Set<OpeningCashImportIssueCode>([
  'duplicate_file_register',
  'duplicate_existing_register',
]);

type Denomination = NormalizedLaunchOpeningCash['denominations'][number];

interface RegisterTemplateState {
  denominations: Denomination[];
  id: string;
  openingFloat: number;
  registerName: string;
  siteId: string;
  sortOrder: number;
}

interface OpeningCashResolutionState {
  activeRegisterKeys: Set<string>;
  historicalRegisterKeys: Set<string>;
  nextSortOrderBySite: Map<string, number>;
  sitesByName: Map<string, Array<{ id: string; name: string }>>;
  templatesByRegister: Map<string, RegisterTemplateState[]>;
}

function optionalText(value: string | undefined): string | null {
  return value?.trim() || null;
}

function normalizedKey(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

function registerKey(siteId: string, registerName: string): string {
  return `${siteId}\u0000${normalizedKey(registerName)}`;
}

function canonicalImportPayload(input: PreviewLaunchOpeningCashImportInput) {
  return {
    dataMode: input.dataMode,
    sourceName: input.sourceName,
    decimalFormat: input.decimalFormat,
    rows: input.rows.map(row => ({ rowNumber: row.rowNumber, values: row.values })),
  };
}

export function hashLaunchOpeningCashImport(input: PreviewLaunchOpeningCashImportInput): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalImportPayload(input)))
    .digest('hex');
}

function denominationsEqual(left: readonly Denomination[], right: readonly Denomination[]) {
  if (left.length !== right.length) return false;
  const normalize = (values: readonly Denomination[]) =>
    values
      .map(value => ({ value: roundMoney(value.value), count: value.count }))
      .sort((a, b) => b.value - a.value);
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return normalizedLeft.every(
    (value, index) =>
      value.value === normalizedRight[index]?.value && value.count === normalizedRight[index]?.count
  );
}

function isPristineDefaultTemplate(
  template: RegisterTemplateState,
  state: OpeningCashResolutionState
) {
  return (
    Math.abs(template.openingFloat) < MONEY_EPSILON &&
    Math.abs(getCashSessionDenominationTotal(template.denominations)) < MONEY_EPSILON &&
    !state.historicalRegisterKeys.has(registerKey(template.siteId, template.registerName))
  );
}

function parseDenominations(
  value: string | undefined,
  decimalFormat: PreviewLaunchOpeningCashImportInput['decimalFormat']
): Denomination[] | null {
  const raw = optionalText(value);
  if (!raw) return [];

  const denominations: Denomination[] = [];
  const seenValues = new Set<number>();
  const segments = raw
    .split(/[;|]/)
    .map(segment => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;

  for (const segment of segments) {
    const match = /^(.+?)\s*(?::|x|\*)\s*(\d+)$/i.exec(segment);
    if (!match) return null;
    const parsedValue = parseImportNumber(match[1], decimalFormat);
    const count = Number.parseInt(match[2] ?? '', 10);
    if (
      parsedValue === null ||
      parsedValue <= 0 ||
      parsedValue > MAX_OPENING_FLOAT ||
      !Number.isInteger(count) ||
      count <= 0 ||
      Math.abs(parsedValue - roundMoney(parsedValue)) >= MONEY_EPSILON
    ) {
      return null;
    }
    const denominationValue = roundMoney(parsedValue);
    if (seenValues.has(denominationValue)) return null;
    seenValues.add(denominationValue);
    denominations.push({ value: denominationValue, count });
  }

  return denominations.sort((a, b) => b.value - a.value);
}

function normalizeRow(
  row: LaunchOpeningCashImportRow,
  decimalFormat: PreviewLaunchOpeningCashImportInput['decimalFormat']
): { normalized: NormalizedLaunchOpeningCash; issues: OpeningCashImportIssue[] } {
  const siteName = optionalText(row.values.siteName) ?? '';
  const registerName = optionalText(row.values.registerName) ?? '';
  const openingFloatRaw = optionalText(row.values.openingFloat);
  const parsedOpeningFloat = openingFloatRaw
    ? parseImportNumber(openingFloatRaw, decimalFormat)
    : null;
  const denominations = parseDenominations(row.values.denominations, decimalFormat);
  const issues: OpeningCashImportIssue[] = [];

  if (!siteName) issues.push({ code: 'required', field: 'siteName' });
  if (!registerName) issues.push({ code: 'required', field: 'registerName' });
  if (!openingFloatRaw) issues.push({ code: 'required', field: 'openingFloat' });
  if (siteName.length > 120) issues.push({ code: 'too_long', field: 'siteName' });
  if (registerName.length > 80) issues.push({ code: 'too_long', field: 'registerName' });
  if (openingFloatRaw && parsedOpeningFloat === null) {
    issues.push({ code: 'invalid_number', field: 'openingFloat' });
  } else if (
    parsedOpeningFloat !== null &&
    (parsedOpeningFloat < 0 || parsedOpeningFloat > MAX_OPENING_FLOAT)
  ) {
    issues.push({ code: 'out_of_range', field: 'openingFloat' });
  }
  if (denominations === null) {
    issues.push({ code: 'invalid_denominations', field: 'denominations' });
  } else if ((parsedOpeningFloat ?? 0) > 0 && denominations.length === 0) {
    issues.push({ code: 'required', field: 'denominations' });
  } else if (
    parsedOpeningFloat !== null &&
    Math.abs(getCashSessionDenominationTotal(denominations) - roundMoney(parsedOpeningFloat)) >=
      MONEY_EPSILON
  ) {
    issues.push({ code: 'denomination_total_mismatch', field: 'denominations' });
  }

  return {
    normalized: {
      siteId: null,
      siteName,
      registerName,
      openingFloat: parsedOpeningFloat === null ? 0 : roundMoney(parsedOpeningFloat),
      denominations: denominations ?? [],
      operation: 'create',
    },
    issues,
  };
}

function groupByName<T extends { name: string }>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = normalizedKey(row.name);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

function loadResolutionState(
  db: LaunchMigrationContext['db'],
  tenantId: string,
  rows: readonly NormalizedLaunchOpeningCash[]
): OpeningCashResolutionState {
  const requestedSiteNames = [
    ...new Set(rows.map(row => normalizedKey(row.siteName)).filter(Boolean)),
  ];
  // SQLite lower() only folds ASCII. Resolve the bounded site/register keyspace
  // in JavaScript so accented merchant names keep the same case-insensitive
  // semantics as plain Latin names.
  const tenantSiteRows = requestedSiteNames.length
    ? db
        .select({ id: sites.id, name: sites.name })
        .from(sites)
        .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
        .all()
    : [];
  const requestedSiteNameSet = new Set(requestedSiteNames);
  const siteRows = tenantSiteRows.filter(row => requestedSiteNameSet.has(normalizedKey(row.name)));
  const siteIds = siteRows.map(row => row.id);
  const requestedRegisters = [
    ...new Set(rows.map(row => normalizedKey(row.registerName)).filter(Boolean)),
  ];
  const templateRows =
    siteIds.length && requestedRegisters.length
      ? db
          .select({
            denominations: denominationTemplates.denominations,
            id: denominationTemplates.id,
            openingFloat: denominationTemplates.openingFloat,
            registerName: denominationTemplates.registerName,
            siteId: denominationTemplates.siteId,
            sortOrder: denominationTemplates.sortOrder,
          })
          .from(denominationTemplates)
          .where(
            and(
              eq(denominationTemplates.tenantId, tenantId),
              inArray(denominationTemplates.siteId, siteIds)
            )
          )
          .all()
      : [];
  const sessionRows =
    siteIds.length && requestedRegisters.length
      ? db
          .select({
            registerName: cashSessions.registerName,
            siteId: cashSessions.siteId,
            status: cashSessions.status,
          })
          .from(cashSessions)
          .where(and(eq(cashSessions.tenantId, tenantId), inArray(cashSessions.siteId, siteIds)))
          .groupBy(cashSessions.siteId, cashSessions.registerName, cashSessions.status)
          .all()
      : [];

  const requestedRegisterSet = new Set(requestedRegisters);
  const matchingTemplateRows = templateRows.filter(row =>
    requestedRegisterSet.has(normalizedKey(row.registerName))
  );
  const matchingSessionRows = sessionRows.filter(row =>
    requestedRegisterSet.has(normalizedKey(row.registerName))
  );
  const nextSortOrderBySite = new Map<string, number>();
  for (const template of templateRows) {
    nextSortOrderBySite.set(
      template.siteId,
      Math.max(nextSortOrderBySite.get(template.siteId) ?? 0, template.sortOrder + 1)
    );
  }

  const templatesByRegister = new Map<string, RegisterTemplateState[]>();
  for (const template of matchingTemplateRows) {
    const key = registerKey(template.siteId, template.registerName);
    templatesByRegister.set(key, [...(templatesByRegister.get(key) ?? []), template]);
  }

  return {
    activeRegisterKeys: new Set(
      matchingSessionRows
        .filter(session => session.status === 'open')
        .map(session => registerKey(session.siteId, session.registerName))
    ),
    historicalRegisterKeys: new Set(
      matchingSessionRows.map(session => registerKey(session.siteId, session.registerName))
    ),
    nextSortOrderBySite,
    sitesByName: groupByName(siteRows),
    templatesByRegister,
  };
}

function summarizeRows(rows: OpeningCashImportPreviewRow[]) {
  return {
    total: rows.length,
    ready: rows.filter(row => row.status === 'ready').length,
    duplicates: rows.filter(row => row.status === 'duplicate').length,
    invalid: rows.filter(row => row.status === 'invalid').length,
  };
}

export async function previewLaunchOpeningCashImport(
  ctx: LaunchMigrationContext,
  input: PreviewLaunchOpeningCashImportInput
) {
  const normalizedRows = input.rows.map(row => ({
    rowNumber: row.rowNumber,
    ...normalizeRow(row, input.decimalFormat),
  }));
  const state = loadResolutionState(
    ctx.db,
    ctx.tenantId,
    normalizedRows.map(row => row.normalized)
  );
  const seenRegisters = new Set<string>();
  const rows: OpeningCashImportPreviewRow[] = normalizedRows.map(row => {
    const issues = [...row.issues];
    const siteMatches = state.sitesByName.get(normalizedKey(row.normalized.siteName)) ?? [];
    if (row.normalized.siteName && siteMatches.length === 0) {
      issues.push({ code: 'site_not_found', field: 'siteName' });
    } else if (siteMatches.length > 1) {
      issues.push({ code: 'ambiguous_site', field: 'siteName' });
    }

    const site = siteMatches.length === 1 ? siteMatches[0]! : null;
    const normalized = site
      ? { ...row.normalized, siteId: site.id, siteName: site.name }
      : row.normalized;
    if (site && normalized.registerName) {
      const key = registerKey(site.id, normalized.registerName);
      const existingTemplates = state.templatesByRegister.get(key) ?? [];
      if (seenRegisters.has(key)) {
        issues.push({ code: 'duplicate_file_register', field: 'registerName' });
      } else if (state.activeRegisterKeys.has(key)) {
        issues.push({ code: 'active_register', field: 'registerName' });
      } else if (existingTemplates.length > 1) {
        issues.push({ code: 'duplicate_existing_register', field: 'registerName' });
      } else if (existingTemplates.length === 1) {
        const existing = existingTemplates[0]!;
        if (
          existing.openingFloat === normalized.openingFloat &&
          denominationsEqual(existing.denominations, normalized.denominations)
        ) {
          issues.push({ code: 'duplicate_existing_register', field: 'registerName' });
        } else if (isPristineDefaultTemplate(existing, state)) {
          normalized.operation = 'replace_default';
        } else {
          issues.push({ code: 'duplicate_existing_register', field: 'registerName' });
        }
      }
      seenRegisters.add(key);
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
    previewHash: hashLaunchOpeningCashImport(input),
    summary: summarizeRows(rows),
    rows,
  };
}

type CommitRowResult =
  | { status: 'imported'; templateId: string }
  | { status: 'existing' | 'conflict' | 'active' | 'site_missing' };

function commitOpeningCashRow(
  db: LaunchMigrationContext['db'],
  tenantId: string,
  row: NormalizedLaunchOpeningCash,
  state: OpeningCashResolutionState
): CommitRowResult {
  if (!row.siteId) return { status: 'site_missing' };

  const siteMatches = state.sitesByName.get(normalizedKey(row.siteName)) ?? [];
  const site =
    siteMatches.length === 1 && siteMatches[0]?.id === row.siteId ? siteMatches[0] : null;
  if (!site) return { status: 'site_missing' } as const;

  const key = registerKey(site.id, row.registerName);
  const existingTemplates = state.templatesByRegister.get(key) ?? [];
  if (state.activeRegisterKeys.has(key)) return { status: 'active' } as const;
  if (existingTemplates.length > 1) return { status: 'conflict' } as const;

  const existing = existingTemplates[0];
  if (existing) {
    if (
      existing.openingFloat === row.openingFloat &&
      denominationsEqual(existing.denominations, row.denominations)
    ) {
      return { status: 'existing' } as const;
    }
    if (!isPristineDefaultTemplate(existing, state)) return { status: 'conflict' } as const;

    db.update(denominationTemplates)
      .set({
        label: row.registerName,
        registerName: row.registerName,
        openingFloat: row.openingFloat,
        denominations: row.denominations,
        isActive: true,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(eq(denominationTemplates.id, existing.id), eq(denominationTemplates.tenantId, tenantId))
      )
      .run();
    state.templatesByRegister.set(key, [
      {
        ...existing,
        registerName: row.registerName,
        openingFloat: row.openingFloat,
        denominations: row.denominations,
      },
    ]);
    return { status: 'imported', templateId: existing.id } as const;
  }

  const now = new Date().toISOString();
  const templateId = nanoid();
  const sortOrder = state.nextSortOrderBySite.get(site.id) ?? 0;
  db.insert(denominationTemplates)
    .values({
      id: templateId,
      tenantId,
      siteId: site.id,
      registerName: row.registerName,
      label: row.registerName,
      openingFloat: row.openingFloat,
      denominations: row.denominations,
      sortOrder,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  state.nextSortOrderBySite.set(site.id, sortOrder + 1);
  state.templatesByRegister.set(key, [
    {
      id: templateId,
      siteId: site.id,
      registerName: row.registerName,
      openingFloat: row.openingFloat,
      denominations: row.denominations,
      sortOrder,
    },
  ]);
  return { status: 'imported', templateId } as const;
}

export async function commitLaunchOpeningCashImport(
  ctx: LaunchMigrationContext,
  input: CommitLaunchOpeningCashImportInput
) {
  assertRealDataCommit(input);
  const preview = await previewLaunchOpeningCashImport(ctx, input);
  if (preview.previewHash !== input.previewHash) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The import changed after preview. Preview it again before importing.',
    });
  }

  const importId = nanoid();
  const importedRows: Array<{
    rowNumber: number;
    templateId: string;
    issues: OpeningCashImportIssue[];
  }> = [];
  const skippedRows: Array<{ rowNumber: number; issues: OpeningCashImportIssue[] }> = preview.rows
    .filter(row => row.status === 'duplicate')
    .map(row => ({ rowNumber: row.rowNumber, issues: row.issues }));
  const invalidRows: Array<{ rowNumber: number; issues: OpeningCashImportIssue[] }> = preview.rows
    .filter(row => row.status === 'invalid')
    .map(row => ({ rowNumber: row.rowNumber, issues: row.issues }));
  const failedRows: Array<{ rowNumber: number; issues: OpeningCashImportIssue[] }> = [];

  ctx.db.transaction(tx => {
    const commitState = loadResolutionState(
      tx,
      ctx.tenantId,
      preview.rows.filter(row => row.status === 'ready').map(row => row.normalized)
    );
    for (const row of preview.rows) {
      if (row.status !== 'ready') continue;
      try {
        const result = commitOpeningCashRow(tx, ctx.tenantId, row.normalized, commitState);
        if (result.status === 'imported') {
          importedRows.push({
            rowNumber: row.rowNumber,
            templateId: result.templateId,
            issues: [],
          });
        } else if (result.status === 'existing' || result.status === 'conflict') {
          skippedRows.push({
            rowNumber: row.rowNumber,
            issues: [{ code: 'concurrent_register_change', field: 'registerName' }],
          });
        } else {
          failedRows.push({
            rowNumber: row.rowNumber,
            issues: [
              {
                code: result.status === 'active' ? 'active_register' : 'site_not_found',
                field: result.status === 'active' ? 'registerName' : 'siteName',
              },
            ],
          });
        }
      } catch (error) {
        log.error(
          {
            ...getSafeImportErrorMetadata(error),
            tenantId: ctx.tenantId,
            importId,
            rowNumber: row.rowNumber,
          },
          'opening cash import row failed'
        );
        failedRows.push({
          rowNumber: row.rowNumber,
          issues: [{ code: 'import_failed', field: 'openingFloat' }],
        });
      }
    }

    writeAuditLog({
      tx,
      tenantId: ctx.tenantId,
      actorId: ctx.user.id,
      action: 'data_import.opening_cash',
      resourceType: 'data_import',
      resourceId: importId,
      after: {
        imported: importedRows.length,
        skipped: skippedRows.length,
        invalid: invalidRows.length,
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

  const completedAt = new Date().toISOString();
  return {
    dataMode: 'real' as const,
    importId,
    completedAt,
    summary: {
      total: preview.summary.total,
      imported: importedRows.length,
      skipped: skippedRows.length,
      invalid: invalidRows.length,
      failed: failedRows.length,
      warnings: 0,
    },
    importedRows,
    skippedRows,
    invalidRows,
    failedRows,
  };
}
