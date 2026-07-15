/** ENG-123f — Server-authoritative fiscal issuer-profile import. */
import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { tenantLocaleSettings, tenants } from '../../db/schema.js';
import { createModuleLogger } from '../../logging/logger.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { findComuna, findGiroComercial } from '../../services/fiscal/packs/cl/catalogs/index.js';
import { validateRut } from '../../services/fiscal/packs/cl/rut.js';
import {
  buildClFiscalSettingsPatch,
  mergeClFiscalSettingsIntoTenantSettings,
  readClFiscalSettings,
  type ClFiscalSettings,
} from '../../services/fiscal/packs/cl/settings.js';
import {
  mergeCoFiscalSettingsIntoTenantSettings,
  readCoFiscalSettings,
  type CoFiscalSettings,
} from '../../services/fiscal/packs/co/settings.js';
import { findRegimenFiscal } from '../../services/fiscal/packs/mx/catalogs/index.js';
import { validateRfc } from '../../services/fiscal/packs/mx/rfc.js';
import {
  buildMxFiscalSettingsPatch,
  mergeMxFiscalSettingsIntoTenantSettings,
  readMxFiscalSettings,
  type MxFiscalSettings,
} from '../../services/fiscal/packs/mx/settings.js';
import type {
  CommitLaunchFiscalProfileImportInput,
  LaunchFiscalProfileImportRow,
  PreviewLaunchFiscalProfileImportInput,
} from '../../trpc/schemas/launchMigration.js';
import {
  assertRealDataCommit,
  getImportSourceFormat,
  getSafeImportErrorMetadata,
} from './safety.js';
import type {
  FiscalProfileCountryCode,
  FiscalProfileImportIssue,
  FiscalProfileImportIssueCode,
  FiscalProfileImportPreviewRow,
  LaunchMigrationContext,
  NormalizedLaunchFiscalProfile,
} from './types.js';

const log = createModuleLogger('launch-migration');
const CO_NIT_PATTERN = /^\d{9,10}(-?\d)?$/u;
const DUPLICATE_ISSUES = new Set<FiscalProfileImportIssueCode>([
  'duplicate_file_profile',
  'duplicate_existing_profile',
]);

interface FiscalProfileState {
  countryCode: FiscalProfileCountryCode | null;
  settings: Record<string, unknown>;
}

type ExistingCountrySettings = CoFiscalSettings | MxFiscalSettings | ClFiscalSettings;

function optionalText(value: string | undefined): string | null {
  return value?.trim() || null;
}

function normalizedToken(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en-US');
}

function parseCountryCode(value: string | undefined): FiscalProfileCountryCode | null {
  const normalized = optionalText(value)?.toUpperCase();
  return normalized === 'CO' || normalized === 'MX' || normalized === 'CL' ? normalized : null;
}

function parsePositiveInteger(value: string | undefined): number | null {
  const raw = optionalText(value);
  if (!raw || !/^\d+$/u.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeEnvironment(
  countryCode: FiscalProfileCountryCode | null,
  value: string | undefined
): string | null {
  const token = normalizedToken(value ?? '');
  if (countryCode === 'MX') {
    if (!token || ['sandbox', 'test', 'prueba', 'pruebas'].includes(token)) return 'sandbox';
    if (['production', 'produccion', 'live'].includes(token)) return 'production';
  }
  if (countryCode === 'CL') {
    if (!token || ['certificacion', 'test', 'prueba', 'pruebas', 'sandbox'].includes(token)) {
      return 'certificacion';
    }
    if (['production', 'produccion', 'live'].includes(token)) return 'produccion';
  }
  if (countryCode === 'CO') {
    if (!token || ['habilitacion', 'test', 'prueba', 'pruebas', 'sandbox'].includes(token)) {
      return 'habilitacion';
    }
    if (['production', 'produccion', 'live'].includes(token)) return 'produccion';
  }
  return null;
}

function canonicalImportPayload(input: PreviewLaunchFiscalProfileImportInput) {
  return {
    dataMode: input.dataMode,
    sourceName: input.sourceName,
    rows: input.rows.map(row => ({ rowNumber: row.rowNumber, values: row.values })),
  };
}

export function hashLaunchFiscalProfileImport(
  input: PreviewLaunchFiscalProfileImportInput
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalImportPayload(input)))
    .digest('hex');
}

function required(
  value: string | number | null,
  field: FiscalProfileImportIssue['field'],
  issues: FiscalProfileImportIssue[]
) {
  if (value === null || value === '') issues.push({ code: 'required', field });
}

function normalizeRow(row: LaunchFiscalProfileImportRow): {
  normalized: NormalizedLaunchFiscalProfile;
  issues: FiscalProfileImportIssue[];
} {
  const countryCodeRaw = optionalText(row.values.countryCode) ?? '';
  const countryCode = parseCountryCode(row.values.countryCode);
  const taxIdentifierRaw = optionalText(row.values.taxIdentifier) ?? '';
  const economicActivityCode = optionalText(row.values.economicActivityCode);
  const issueLocation = optionalText(row.values.issueLocation);
  const administrativeAreaCode = parsePositiveInteger(row.values.administrativeAreaCode);
  const resolutionNumber = optionalText(row.values.resolutionNumber);
  const numberingPrefix = optionalText(row.values.numberingPrefix)?.toUpperCase() ?? null;
  const rangeFrom = parsePositiveInteger(row.values.rangeFrom);
  const rangeTo = parsePositiveInteger(row.values.rangeTo);
  const environment = normalizeEnvironment(countryCode, row.values.environment);
  const issues: FiscalProfileImportIssue[] = [];

  required(countryCodeRaw, 'countryCode', issues);
  required(taxIdentifierRaw, 'taxIdentifier', issues);
  if (countryCodeRaw && !countryCode) {
    issues.push({ code: 'unsupported_country', field: 'countryCode' });
  }
  if (optionalText(row.values.environment) && !environment) {
    issues.push({ code: 'invalid_environment', field: 'environment' });
  }

  const textLimits: Array<[string | null, FiscalProfileImportIssue['field'], number]> = [
    [taxIdentifierRaw, 'taxIdentifier', 20],
    [economicActivityCode, 'economicActivityCode', 20],
    [issueLocation, 'issueLocation', 200],
    [resolutionNumber, 'resolutionNumber', 40],
    [numberingPrefix, 'numberingPrefix', 10],
  ];
  for (const [value, field, max] of textLimits) {
    if (value && value.length > max) issues.push({ code: 'too_long', field });
  }

  let taxIdentifier = taxIdentifierRaw;
  if (countryCode === 'MX') {
    required(economicActivityCode, 'economicActivityCode', issues);
    required(issueLocation, 'issueLocation', issues);
    if (taxIdentifierRaw) {
      const validation = validateRfc(taxIdentifierRaw);
      if (validation.ok) taxIdentifier = validation.normalized;
      else issues.push({ code: 'invalid_tax_identifier', field: 'taxIdentifier' });
    }
    if (economicActivityCode && !findRegimenFiscal(economicActivityCode)) {
      issues.push({ code: 'invalid_activity_code', field: 'economicActivityCode' });
    }
    if (issueLocation && !/^\d{5}$/u.test(issueLocation)) {
      issues.push({ code: 'invalid_issue_location', field: 'issueLocation' });
    }
  } else if (countryCode === 'CL') {
    required(economicActivityCode, 'economicActivityCode', issues);
    required(issueLocation, 'issueLocation', issues);
    required(administrativeAreaCode, 'administrativeAreaCode', issues);
    if (taxIdentifierRaw) {
      const validation = validateRut(taxIdentifierRaw);
      if (validation.ok) taxIdentifier = validation.normalized;
      else issues.push({ code: 'invalid_tax_identifier', field: 'taxIdentifier' });
    }
    if (economicActivityCode && !findGiroComercial(economicActivityCode)) {
      issues.push({ code: 'invalid_activity_code', field: 'economicActivityCode' });
    }
    if (optionalText(row.values.administrativeAreaCode) && administrativeAreaCode === null) {
      issues.push({ code: 'invalid_administrative_area', field: 'administrativeAreaCode' });
    } else if (administrativeAreaCode !== null && !findComuna(administrativeAreaCode)) {
      issues.push({ code: 'invalid_administrative_area', field: 'administrativeAreaCode' });
    }
  } else if (countryCode === 'CO') {
    required(resolutionNumber, 'resolutionNumber', issues);
    required(rangeFrom, 'rangeFrom', issues);
    required(rangeTo, 'rangeTo', issues);
    if (taxIdentifierRaw && !CO_NIT_PATTERN.test(taxIdentifierRaw)) {
      issues.push({ code: 'invalid_tax_identifier', field: 'taxIdentifier' });
    }
    if (optionalText(row.values.rangeFrom) && rangeFrom === null) {
      issues.push({ code: 'invalid_number', field: 'rangeFrom' });
    }
    if (optionalText(row.values.rangeTo) && rangeTo === null) {
      issues.push({ code: 'invalid_number', field: 'rangeTo' });
    }
    if (rangeFrom !== null && rangeTo !== null && rangeFrom > rangeTo) {
      issues.push({ code: 'invalid_range', field: 'rangeFrom' });
    }
  }

  return {
    normalized: {
      countryCode,
      taxIdentifier,
      economicActivityCode,
      issueLocation,
      administrativeAreaCode,
      resolutionNumber,
      numberingPrefix,
      rangeFrom,
      rangeTo,
      environment: environment ?? '',
      activationRequired: true,
    },
    issues,
  };
}

function loadFiscalProfileState(
  db: LaunchMigrationContext['db'],
  tenantId: string
): FiscalProfileState {
  const locale = db
    .select({ countryCode: tenantLocaleSettings.countryCode })
    .from(tenantLocaleSettings)
    .where(eq(tenantLocaleSettings.tenantId, tenantId))
    .get();
  const tenant = db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  return {
    countryCode: parseCountryCode(locale?.countryCode),
    settings: (tenant?.settings ?? {}) as Record<string, unknown>,
  };
}

function readCountrySettings(
  settings: Record<string, unknown>,
  countryCode: FiscalProfileCountryCode
): ExistingCountrySettings {
  if (countryCode === 'MX') return readMxFiscalSettings(settings);
  if (countryCode === 'CL') return readClFiscalSettings(settings);
  return readCoFiscalSettings(settings);
}

function isPristineProfile(
  countryCode: FiscalProfileCountryCode,
  settings: ExistingCountrySettings
): boolean {
  if (countryCode === 'MX') {
    const value = settings as MxFiscalSettings;
    return (
      !value.enabled &&
      value.rfc === null &&
      value.regimenFiscalCode === null &&
      value.lugarExpedicion === null &&
      value.environment === 'sandbox'
    );
  }
  if (countryCode === 'CL') {
    const value = settings as ClFiscalSettings;
    return (
      !value.enabled &&
      value.rut === null &&
      value.giroCode === null &&
      value.comunaCode === null &&
      value.casaMatriz === null &&
      value.environment === 'certificacion'
    );
  }
  const value = settings as CoFiscalSettings;
  return (
    !value.enabled &&
    value.nit === null &&
    value.dianResolutionNumber === null &&
    value.prefix === null &&
    value.rangeFrom === null &&
    value.rangeTo === null &&
    value.environment === 'habilitacion'
  );
}

function profileEquals(
  countryCode: FiscalProfileCountryCode,
  existing: ExistingCountrySettings,
  profile: NormalizedLaunchFiscalProfile
): boolean {
  if (countryCode === 'MX') {
    const value = existing as MxFiscalSettings;
    return (
      value.rfc === profile.taxIdentifier &&
      value.regimenFiscalCode === profile.economicActivityCode &&
      value.lugarExpedicion === profile.issueLocation &&
      value.environment === profile.environment
    );
  }
  if (countryCode === 'CL') {
    const value = existing as ClFiscalSettings;
    return (
      value.rut === profile.taxIdentifier &&
      value.giroCode === profile.economicActivityCode &&
      value.comunaCode === profile.administrativeAreaCode &&
      value.casaMatriz === profile.issueLocation &&
      value.environment === profile.environment
    );
  }
  const value = existing as CoFiscalSettings;
  return (
    value.nit === profile.taxIdentifier &&
    value.dianResolutionNumber === profile.resolutionNumber &&
    value.prefix === profile.numberingPrefix &&
    value.rangeFrom === profile.rangeFrom &&
    value.rangeTo === profile.rangeTo &&
    value.environment === profile.environment
  );
}

function mergeImportedProfile(
  settings: Record<string, unknown>,
  profile: NormalizedLaunchFiscalProfile
): Record<string, unknown> {
  if (profile.countryCode === 'MX') {
    return mergeMxFiscalSettingsIntoTenantSettings(
      settings,
      buildMxFiscalSettingsPatch({
        enabled: false,
        rfc: profile.taxIdentifier,
        regimenFiscalCode: profile.economicActivityCode,
        lugarExpedicion: profile.issueLocation,
        environment: profile.environment as MxFiscalSettings['environment'],
      })
    );
  }
  if (profile.countryCode === 'CL') {
    return mergeClFiscalSettingsIntoTenantSettings(
      settings,
      buildClFiscalSettingsPatch({
        enabled: false,
        rut: profile.taxIdentifier,
        giroCode: profile.economicActivityCode,
        comunaCode: profile.administrativeAreaCode,
        casaMatriz: profile.issueLocation,
        environment: profile.environment as ClFiscalSettings['environment'],
      })
    );
  }
  return mergeCoFiscalSettingsIntoTenantSettings(settings, {
    enabled: false,
    nit: profile.taxIdentifier,
    dianResolutionNumber: profile.resolutionNumber,
    prefix: profile.numberingPrefix,
    rangeFrom: profile.rangeFrom,
    rangeTo: profile.rangeTo,
    environment: profile.environment as CoFiscalSettings['environment'],
  });
}

function summarizeRows(rows: FiscalProfileImportPreviewRow[]) {
  return {
    total: rows.length,
    ready: rows.filter(row => row.status === 'ready').length,
    duplicates: rows.filter(row => row.status === 'duplicate').length,
    invalid: rows.filter(row => row.status === 'invalid').length,
  };
}

export async function previewLaunchFiscalProfileImport(
  ctx: LaunchMigrationContext,
  input: PreviewLaunchFiscalProfileImportInput
) {
  const state = loadFiscalProfileState(ctx.db, ctx.tenantId);
  const seenCountries = new Set<FiscalProfileCountryCode>();
  const rows: FiscalProfileImportPreviewRow[] = input.rows.map(inputRow => {
    const { normalized, issues: normalizationIssues } = normalizeRow(inputRow);
    const issues = [...normalizationIssues];
    const countryCode = normalized.countryCode;

    if (countryCode) {
      if (seenCountries.has(countryCode)) {
        issues.push({ code: 'duplicate_file_profile', field: 'countryCode' });
      }
      seenCountries.add(countryCode);
      if (state.countryCode !== countryCode) {
        issues.push({ code: 'tenant_country_mismatch', field: 'countryCode' });
      } else if (issues.length === 0) {
        const existing = readCountrySettings(state.settings, countryCode);
        if (profileEquals(countryCode, existing, normalized)) {
          issues.push({ code: 'duplicate_existing_profile', field: 'taxIdentifier' });
        } else if (!isPristineProfile(countryCode, existing)) {
          issues.push({ code: 'existing_profile_conflict', field: 'taxIdentifier' });
        }
      }
    }

    const hasInvalidIssue = issues.some(issue => !DUPLICATE_ISSUES.has(issue.code));
    return {
      rowNumber: inputRow.rowNumber,
      status: hasInvalidIssue ? 'invalid' : issues.length ? 'duplicate' : 'ready',
      normalized,
      issues,
    };
  });

  return {
    dataMode: input.dataMode,
    activationRequired: true as const,
    tenantCountryCode: state.countryCode,
    previewHash: hashLaunchFiscalProfileImport(input),
    summary: summarizeRows(rows),
    rows,
  };
}

export async function commitLaunchFiscalProfileImport(
  ctx: LaunchMigrationContext,
  input: CommitLaunchFiscalProfileImportInput
) {
  assertRealDataCommit(input);
  const preview = await previewLaunchFiscalProfileImport(ctx, input);
  if (preview.previewHash !== input.previewHash) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The import changed after preview. Preview it again before importing.',
    });
  }

  const importId = nanoid();
  const importedRows: Array<{
    rowNumber: number;
    countryCode: FiscalProfileCountryCode;
    issues: FiscalProfileImportIssue[];
  }> = [];
  const skippedRows: Array<{ rowNumber: number; issues: FiscalProfileImportIssue[] }> = preview.rows
    .filter(row => row.status === 'duplicate')
    .map(row => ({ rowNumber: row.rowNumber, issues: row.issues }));
  const invalidRows: Array<{ rowNumber: number; issues: FiscalProfileImportIssue[] }> = preview.rows
    .filter(row => row.status === 'invalid')
    .map(row => ({ rowNumber: row.rowNumber, issues: row.issues }));
  const failedRows: Array<{ rowNumber: number; issues: FiscalProfileImportIssue[] }> = [];

  ctx.db.transaction(tx => {
    for (const row of preview.rows) {
      if (row.status !== 'ready' || !row.normalized.countryCode) continue;
      try {
        const state = loadFiscalProfileState(tx, ctx.tenantId);
        if (state.countryCode !== row.normalized.countryCode) {
          invalidRows.push({
            rowNumber: row.rowNumber,
            issues: [{ code: 'concurrent_profile_change', field: 'countryCode' }],
          });
          continue;
        }
        const existing = readCountrySettings(state.settings, state.countryCode);
        if (profileEquals(state.countryCode, existing, row.normalized)) {
          skippedRows.push({
            rowNumber: row.rowNumber,
            issues: [{ code: 'duplicate_existing_profile', field: 'taxIdentifier' }],
          });
          continue;
        }
        if (!isPristineProfile(state.countryCode, existing)) {
          invalidRows.push({
            rowNumber: row.rowNumber,
            issues: [{ code: 'concurrent_profile_change', field: 'taxIdentifier' }],
          });
          continue;
        }

        const nextSettings = mergeImportedProfile(state.settings, row.normalized);
        tx.update(tenants)
          .set({ settings: nextSettings, updatedAt: new Date().toISOString() })
          .where(eq(tenants.id, ctx.tenantId))
          .run();
        importedRows.push({
          rowNumber: row.rowNumber,
          countryCode: state.countryCode,
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
          'fiscal profile import row failed'
        );
        failedRows.push({
          rowNumber: row.rowNumber,
          issues: [{ code: 'import_failed', field: 'taxIdentifier' }],
        });
      }
    }

    writeAuditLog({
      tx,
      tenantId: ctx.tenantId,
      actorId: ctx.user.id,
      action: 'data_import.fiscal_profile',
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
        previewHash: preview.previewHash,
        totalRows: preview.summary.total,
        countryCode: importedRows[0]?.countryCode ?? preview.tenantCountryCode,
        activationRequired: true,
      },
    });
  });

  return {
    importId,
    dataMode: 'real' as const,
    completedAt: new Date().toISOString(),
    activationRequired: true as const,
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
