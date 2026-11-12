/** Server-authoritative fiscal issuer-profile import. */
import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { sites, tenantLocaleSettings, tenants } from '../../db/schema.js';
import { ServerErrorWithCode } from '../../lib/errorCodes.js';
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
import {
  createNumberingRange,
  NUMBERING_PREFIX_PATTERN,
  toColombianDayBoundary,
  withinMaxValidity,
} from '../../services/fiscal/numbering/ranges.js';
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
  NormalizedLaunchNumberingRange,
} from './types.js';
import { FISCAL_PROFILE_NUMBERING_FIELDS } from './types.js';

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

/** Parse the optional DEE range columns; any one present makes the whole set required. */
function normalizeNumbering(
  row: LaunchFiscalProfileImportRow,
  issues: FiscalProfileImportIssue[]
): NormalizedLaunchNumberingRange | null {
  const values = row.values;
  if (!FISCAL_PROFILE_NUMBERING_FIELDS.some(field => optionalText(values[field]))) return null;
  const before = issues.length;
  const resolutionNumber = optionalText(values.resolutionNumber);
  const prefix = optionalText(values.numberingPrefix)?.toUpperCase() ?? '';
  const fromNumber = parsePositiveInteger(values.rangeFrom);
  const toNumber = parsePositiveInteger(values.rangeTo);
  const resolutionDate = toColombianDayBoundary(values.resolutionDate ?? '', 'start');
  const validFrom = toColombianDayBoundary(values.validFrom ?? '', 'start');
  const validUntil = toColombianDayBoundary(values.validUntil ?? '', 'end');

  required(resolutionNumber, 'resolutionNumber', issues);
  if (resolutionNumber && resolutionNumber.length > 40) {
    issues.push({ code: 'too_long', field: 'resolutionNumber' });
  }
  if (prefix && !NUMBERING_PREFIX_PATTERN.test(prefix)) {
    issues.push({ code: 'invalid_prefix', field: 'numberingPrefix' });
  }
  for (const [raw, parsed, field] of [
    [values.rangeFrom, fromNumber, 'rangeFrom'],
    [values.rangeTo, toNumber, 'rangeTo'],
  ] as const) {
    if (!optionalText(raw)) issues.push({ code: 'required', field });
    else if (parsed === null) issues.push({ code: 'invalid_number', field });
  }
  if (fromNumber !== null && toNumber !== null && fromNumber > toNumber) {
    issues.push({ code: 'invalid_range', field: 'rangeTo' });
  }
  for (const [raw, parsed, field] of [
    [values.resolutionDate, resolutionDate, 'resolutionDate'],
    [values.validFrom, validFrom, 'validFrom'],
    [values.validUntil, validUntil, 'validUntil'],
  ] as const) {
    if (!optionalText(raw)) issues.push({ code: 'required', field });
    else if (parsed === null) issues.push({ code: 'invalid_date', field });
  }
  if (
    validFrom &&
    validUntil &&
    (Date.parse(validUntil) <= Date.parse(validFrom) || !withinMaxValidity(validFrom, validUntil))
  ) {
    issues.push({ code: 'invalid_range', field: 'validUntil' });
  }
  if (
    issues.length > before ||
    !resolutionNumber ||
    fromNumber === null ||
    toNumber === null ||
    !resolutionDate ||
    !validFrom ||
    !validUntil
  ) {
    return null;
  }
  return {
    siteName: optionalText(values.siteName),
    resolutionNumber,
    resolutionDate,
    prefix,
    fromNumber,
    toNumber,
    validFrom,
    validUntil,
  };
}

/** Active site a range row targets: by name, or the only active site when unnamed. */
function resolveNumberingSite(
  db: LaunchMigrationContext['db'],
  tenantId: string,
  numbering: NormalizedLaunchNumberingRange
): { siteId: string; multiSite: boolean } | FiscalProfileImportIssue {
  const activeSites = db
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .all();
  const multiSite = activeSites.length > 1;
  if (numbering.siteName === null) {
    const only = activeSites.length === 1 ? activeSites[0] : undefined;
    return only ? { siteId: only.id, multiSite } : { code: 'required', field: 'siteName' };
  }
  const wanted = normalizedToken(numbering.siteName);
  const match = activeSites.find(site => normalizedToken(site.name) === wanted);
  if (!match) return { code: 'unknown_site', field: 'siteName' };
  if (multiSite && numbering.prefix === '') {
    return { code: 'invalid_prefix', field: 'numberingPrefix' };
  }
  return { siteId: match.id, multiSite };
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
  const environment = normalizeEnvironment(countryCode, row.values.environment);
  const issues: FiscalProfileImportIssue[] = [];
  let numbering: NormalizedLaunchNumberingRange | null = null;

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
    if (taxIdentifierRaw && !CO_NIT_PATTERN.test(taxIdentifierRaw)) {
      issues.push({ code: 'invalid_tax_identifier', field: 'taxIdentifier' });
    }
    numbering = normalizeNumbering(row, issues);
  }

  return {
    normalized: {
      countryCode,
      taxIdentifier,
      economicActivityCode,
      issueLocation,
      administrativeAreaCode,
      environment: environment ?? '',
      numbering,
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
  return !value.enabled && value.nit === null && value.environment === 'habilitacion';
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
  return value.nit === profile.taxIdentifier && value.environment === profile.environment;
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

    if (normalized.numbering) {
      const site = resolveNumberingSite(ctx.db, ctx.tenantId, normalized.numbering);
      if ('code' in site) issues.push(site);
    }
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

  // Revalidate and write the mutable profile only after reserving the writer.
  // The same reservation protects the audit-chain head read from lock upgrades.
  ctx.db.transaction(
    tx => {
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

          // Validated and written before the profile, so a rejected range
          // leaves the row untouched.
          const numbering = row.normalized.numbering;
          if (numbering) {
            const site = resolveNumberingSite(tx, ctx.tenantId, numbering);
            if ('code' in site) {
              invalidRows.push({ rowNumber: row.rowNumber, issues: [site] });
              continue;
            }
            const environment = row.normalized.environment as CoFiscalSettings['environment'];
            try {
              createNumberingRange(tx, {
                tenantId: ctx.tenantId,
                actorId: ctx.user.id,
                tenantEnvironment: environment,
                input: {
                  siteId: site.siteId,
                  kind: 'DEE',
                  resolutionNumber: numbering.resolutionNumber,
                  resolutionDate: numbering.resolutionDate,
                  prefix: numbering.prefix,
                  fromNumber: numbering.fromNumber,
                  toNumber: numbering.toNumber,
                  validFrom: numbering.validFrom,
                  validUntil: numbering.validUntil,
                  environment,
                },
              });
            } catch (error) {
              if (!isNumberingRejection(error)) throw error;
              invalidRows.push({
                rowNumber: row.rowNumber,
                issues: [{ code: 'numbering_range_rejected', field: 'rangeFrom' }],
              });
              continue;
            }
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
    },
    { behavior: 'immediate' }
  );

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

function isNumberingRejection(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  return (
    cause instanceof ServerErrorWithCode && cause.errorCode.startsWith('FISCAL_NUMBERING_RANGE_')
  );
}
