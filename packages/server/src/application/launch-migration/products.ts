/**
 * Server-authoritative product, price, and opening-stock import.
 *
 * The browser only maps source columns. Every value is reparsed, validated,
 * deduplicated, and tenant-scoped here before any catalog write runs.
 */
import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createProduct } from '../products/index.js';
import { recordInventoryEntry } from '../inventory/index.js';
import { products, units, vatRates } from '../../db/schema.js';
import { createModuleLogger } from '../../logging/logger.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import type {
  CommitLaunchProductImportInput,
  ImportDecimalFormat,
  LaunchProductImportRow,
  PreviewLaunchProductImportInput,
} from '../../trpc/schemas/launchMigration.js';
import type {
  LaunchMigrationContext,
  NormalizedLaunchProduct,
  ProductImportIssue,
  ProductImportPreviewRow,
} from './types.js';
import {
  assertRealDataCommit,
  getImportSourceFormat,
  getSafeImportErrorMetadata,
} from './safety.js';
import { parseImportNumber } from './numbers.js';

const log = createModuleLogger('launch-migration');

const DUPLICATE_ISSUES = new Set<ProductImportIssue['code']>([
  'duplicate_file_sku',
  'duplicate_existing_sku',
  'duplicate_file_barcode',
  'duplicate_existing_barcode',
]);

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function normalizeBarcode(value: string): string {
  return value.trim();
}

function normalizeCatalogKey(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

const UNIT_ALIASES: Readonly<Record<string, string>> = {
  each: 'und',
  piece: 'und',
  pieza: 'und',
  unit: 'und',
  unidad: 'und',
  unidades: 'und',
  un: 'und',
  kilogram: 'kg',
  kilogramo: 'kg',
  kilogramos: 'kg',
  kgs: 'kg',
  pound: 'lb',
  pounds: 'lb',
  libra: 'lb',
  libras: 'lb',
  box: 'cj',
  caja: 'cj',
  cajas: 'cj',
  dozen: 'doc',
  docena: 'doc',
};

const NO_TAX_NAMES = new Set(['none', 'ninguno', 'no tax', 'sin impuesto']);

interface ProductImportCatalogs {
  units: Array<{
    id: string;
    name: string;
    abbreviation: string;
    standardCode: string | null;
  }>;
  vatRates: Array<{ id: string; name: string; rate: number }>;
}

function canonicalUnitKey(value: string): string {
  const key = normalizeCatalogKey(value);
  return UNIT_ALIASES[key] ?? key;
}

function resolveImportUnit(
  raw: string | undefined,
  catalogs: ProductImportCatalogs
): { unit: string | null; unitId: string | null; issue?: ProductImportIssue } {
  const unit = raw?.trim() || null;
  if (!unit) return { unit: null, unitId: null };
  const sourceKey = canonicalUnitKey(unit);
  const matches = catalogs.units.filter(candidate =>
    [candidate.name, candidate.abbreviation, candidate.standardCode]
      .filter((value): value is string => Boolean(value))
      .some(value => canonicalUnitKey(value) === sourceKey)
  );
  if (matches.length === 0) {
    return { unit, unitId: null, issue: { code: 'unit_not_found', field: 'unit' } };
  }
  if (matches.length > 1) {
    return { unit, unitId: null, issue: { code: 'ambiguous_unit', field: 'unit' } };
  }
  return { unit, unitId: matches[0]!.id };
}

function resolveImportTax(
  rawName: string | undefined,
  rawRate: string | undefined,
  parsedRate: number | null,
  catalogs: ProductImportCatalogs
): {
  taxName: string | null;
  taxRate: number;
  vatRateId: string | null;
  issue?: ProductImportIssue;
} {
  const taxName = rawName?.trim() || null;
  const hasExplicitRate = Boolean(rawRate?.trim());
  if (!taxName) {
    return { taxName: null, taxRate: parsedRate ?? 0, vatRateId: null };
  }
  const taxKey = normalizeCatalogKey(taxName);
  if (NO_TAX_NAMES.has(taxKey)) {
    if (hasExplicitRate && (parsedRate ?? 0) !== 0) {
      return {
        taxName,
        taxRate: parsedRate ?? 0,
        vatRateId: null,
        issue: { code: 'ambiguous_tax', field: 'taxName' },
      };
    }
    return { taxName, taxRate: 0, vatRateId: null };
  }
  const matches = catalogs.vatRates.filter(
    candidate => normalizeCatalogKey(candidate.name) === taxKey
  );
  if (matches.length === 0) {
    return {
      taxName,
      taxRate: parsedRate ?? 0,
      vatRateId: null,
      issue: { code: 'tax_not_found', field: 'taxName' },
    };
  }
  if (matches.length > 1) {
    return {
      taxName,
      taxRate: parsedRate ?? 0,
      vatRateId: null,
      issue: { code: 'ambiguous_tax', field: 'taxName' },
    };
  }
  const match = matches[0]!;
  if (hasExplicitRate && parsedRate !== null && Math.abs(match.rate - parsedRate) > 1e-9) {
    return {
      taxName,
      taxRate: parsedRate,
      vatRateId: null,
      issue: { code: 'ambiguous_tax', field: 'taxName' },
    };
  }
  return { taxName, taxRate: match.rate, vatRateId: match.id };
}

function parseImportBoolean(value: string | undefined, defaultValue = false): boolean | null {
  const normalized = (value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en-US');
  if (!normalized) return defaultValue;
  if (['true', 'yes', 'y', 'si', 's', '1'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0'].includes(normalized)) return false;
  return null;
}

function canonicalImportPayload(input: PreviewLaunchProductImportInput) {
  return {
    dataMode: input.dataMode,
    sourceName: input.sourceName,
    decimalFormat: input.decimalFormat,
    rows: input.rows.map(row => ({ rowNumber: row.rowNumber, values: row.values })),
  };
}

export function hashLaunchProductImport(input: PreviewLaunchProductImportInput): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalImportPayload(input)))
    .digest('hex');
}

function normalizeRow(
  row: LaunchProductImportRow,
  decimalFormat: ImportDecimalFormat,
  catalogs: ProductImportCatalogs
): { normalized: NormalizedLaunchProduct; issues: ProductImportIssue[] } {
  const name = row.values.name?.trim() ?? '';
  const sku = row.values.sku?.trim() ?? '';
  const description = row.values.description?.trim() || null;
  const barcode = row.values.barcode?.trim() || null;
  const issues: ProductImportIssue[] = [];
  const tracksStock = parseImportBoolean(row.values.tracksStock, true);
  const tracksLots = parseImportBoolean(row.values.tracksLots);
  const resolvedUnit = resolveImportUnit(row.values.unit, catalogs);

  if (!name) issues.push({ code: 'required', field: 'name' });
  if (!sku) issues.push({ code: 'required', field: 'sku' });
  if (name.length > 255) issues.push({ code: 'too_long', field: 'name' });
  if (sku.length > 100) issues.push({ code: 'too_long', field: 'sku' });
  if (description && description.length > 2_000) {
    issues.push({ code: 'too_long', field: 'description' });
  }
  if (barcode && barcode.length > 64) issues.push({ code: 'too_long', field: 'barcode' });

  const numericFields = ['price', 'cost', 'stock', 'minStock', 'taxRate'] as const;
  const values = Object.fromEntries(
    numericFields.map(field => [field, parseImportNumber(row.values[field], decimalFormat)])
  ) as Record<(typeof numericFields)[number], number | null>;

  for (const field of numericFields) {
    const value = values[field];
    if (value === null) {
      issues.push({ code: 'invalid_number', field });
    } else if (value < 0 || (field === 'taxRate' && value > 100)) {
      issues.push({ code: 'out_of_range', field });
    }
  }
  const resolvedTax = resolveImportTax(
    row.values.taxName,
    row.values.taxRate,
    values.taxRate,
    catalogs
  );
  if (resolvedUnit.issue) issues.push(resolvedUnit.issue);
  if (resolvedTax.issue) issues.push(resolvedTax.issue);
  if (tracksLots === null) {
    issues.push({ code: 'invalid_boolean', field: 'tracksLots' });
  }
  if (tracksStock === null) {
    issues.push({ code: 'invalid_boolean', field: 'tracksStock' });
  }
  if (tracksStock === false && (values.stock ?? 0) > 0) {
    issues.push({ code: 'service_requires_zero_stock', field: 'stock' });
  }
  if (tracksStock === false && tracksLots === true) {
    issues.push({ code: 'service_tracking_conflict', field: 'tracksLots' });
  }
  if (tracksLots === true && (values.stock ?? 0) > 0) {
    issues.push({ code: 'lot_tracking_requires_zero_stock', field: 'stock' });
  }

  return {
    normalized: {
      name,
      sku,
      description,
      barcode,
      unit: resolvedUnit.unit,
      unitId: resolvedUnit.unitId,
      price: values.price ?? 0,
      cost: values.cost ?? 0,
      stock: values.stock ?? 0,
      minStock: values.minStock ?? 0,
      taxName: resolvedTax.taxName,
      taxRate: resolvedTax.taxRate,
      vatRateId: resolvedTax.vatRateId,
      tracksStock: tracksStock ?? true,
      tracksLots: tracksLots ?? false,
    },
    issues,
  };
}

async function loadImportCatalogs(ctx: LaunchMigrationContext): Promise<ProductImportCatalogs> {
  const [availableUnits, availableVatRates] = await Promise.all([
    ctx.db
      .select({
        id: units.id,
        name: units.name,
        abbreviation: units.abbreviation,
        standardCode: units.standardCode,
      })
      .from(units)
      .where(and(eq(units.tenantId, ctx.tenantId), eq(units.isActive, true)))
      .all(),
    ctx.db
      .select({ id: vatRates.id, name: vatRates.name, rate: vatRates.rate })
      .from(vatRates)
      .where(and(eq(vatRates.tenantId, ctx.tenantId), eq(vatRates.isActive, true)))
      .all(),
  ]);
  return { units: availableUnits, vatRates: availableVatRates };
}

async function loadExistingKeys(
  ctx: LaunchMigrationContext,
  normalizedRows: NormalizedLaunchProduct[]
) {
  const skuKeys = [...new Set(normalizedRows.map(row => normalizeKey(row.sku)).filter(Boolean))];
  const barcodeKeys = [
    ...new Set(
      normalizedRows
        .map(row => (row.barcode ? normalizeBarcode(row.barcode) : null))
        .filter((value): value is string => Boolean(value))
    ),
  ];

  const existingSkuRows =
    skuKeys.length > 0
      ? await ctx.db
          .select({ sku: products.sku })
          .from(products)
          .where(
            and(
              eq(products.tenantId, ctx.tenantId),
              inArray(sql<string>`lower(trim(${products.sku}))`, skuKeys)
            )
          )
          .all()
      : [];
  const existingBarcodeRows =
    barcodeKeys.length > 0
      ? await ctx.db
          .select({ barcode: products.barcode })
          .from(products)
          .where(
            and(
              eq(products.tenantId, ctx.tenantId),
              inArray(sql<string>`trim(${products.barcode})`, barcodeKeys)
            )
          )
          .all()
      : [];

  return {
    skus: new Set(existingSkuRows.map(row => normalizeKey(row.sku))),
    barcodes: new Set(
      existingBarcodeRows
        .map(row => (row.barcode ? normalizeBarcode(row.barcode) : null))
        .filter((value): value is string => Boolean(value))
    ),
  };
}

export async function previewLaunchProductImport(
  ctx: LaunchMigrationContext,
  input: PreviewLaunchProductImportInput
) {
  const catalogs = await loadImportCatalogs(ctx);
  const normalizedRows = input.rows.map(row => ({
    rowNumber: row.rowNumber,
    ...normalizeRow(row, input.decimalFormat, catalogs),
  }));
  const existing = await loadExistingKeys(
    ctx,
    normalizedRows.map(row => row.normalized)
  );
  const seenSkus = new Set<string>();
  const seenBarcodes = new Set<string>();

  const rows: ProductImportPreviewRow[] = normalizedRows.map(row => {
    const issues = [...row.issues];
    const skuKey = normalizeKey(row.normalized.sku);
    const barcodeKey = row.normalized.barcode ? normalizeBarcode(row.normalized.barcode) : null;

    if (skuKey) {
      if (seenSkus.has(skuKey)) {
        issues.push({ code: 'duplicate_file_sku', field: 'sku' });
      } else if (existing.skus.has(skuKey)) {
        issues.push({ code: 'duplicate_existing_sku', field: 'sku' });
      }
      seenSkus.add(skuKey);
    }
    if (barcodeKey) {
      if (seenBarcodes.has(barcodeKey)) {
        issues.push({ code: 'duplicate_file_barcode', field: 'barcode' });
      } else if (existing.barcodes.has(barcodeKey)) {
        issues.push({ code: 'duplicate_existing_barcode', field: 'barcode' });
      }
      seenBarcodes.add(barcodeKey);
    }

    const hasValidationIssue = issues.some(issue => !DUPLICATE_ISSUES.has(issue.code));
    const status = hasValidationIssue ? 'invalid' : issues.length > 0 ? 'duplicate' : 'ready';
    return { rowNumber: row.rowNumber, status, normalized: row.normalized, issues };
  });

  return {
    dataMode: input.dataMode,
    previewHash: hashLaunchProductImport(input),
    summary: {
      total: rows.length,
      ready: rows.filter(row => row.status === 'ready').length,
      duplicates: rows.filter(row => row.status === 'duplicate').length,
      invalid: rows.filter(row => row.status === 'invalid').length,
    },
    rows,
  };
}

function isConflictError(error: unknown): boolean {
  return (
    (error instanceof TRPCError && error.code === 'CONFLICT') ||
    (error instanceof Error && /UNIQUE constraint failed.*products/i.test(error.message))
  );
}

export async function commitLaunchProductImport(
  ctx: LaunchMigrationContext,
  input: CommitLaunchProductImportInput
) {
  assertRealDataCommit(input);
  const preview = await previewLaunchProductImport(ctx, input);
  if (preview.previewHash !== input.previewHash) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The import changed after preview. Preview it again before importing.',
    });
  }

  const importId = nanoid();
  const importedRows: Array<{
    rowNumber: number;
    productId: string;
    stockInitialized: boolean;
    issues: ProductImportIssue[];
  }> = [];
  const failedRows: Array<{ rowNumber: number; issues: ProductImportIssue[] }> = [];
  const skippedRows: Array<{ rowNumber: number; issues: ProductImportIssue[] }> = preview.rows
    .filter(row => row.status === 'duplicate')
    .map(row => ({ rowNumber: row.rowNumber, issues: row.issues }));

  for (const row of preview.rows) {
    if (row.status !== 'ready') continue;
    try {
      const created = await createProduct(ctx, {
        name: row.normalized.name,
        sku: row.normalized.sku,
        description: row.normalized.description,
        price: row.normalized.price,
        price2: 0,
        price3: 0,
        cost: row.normalized.cost,
        marginPercent1: 0,
        marginPercent2: 0,
        marginPercent3: 0,
        marginAmount1: 0,
        marginAmount2: 0,
        marginAmount3: 0,
        taxRate: row.normalized.taxRate,
        vatRateId: row.normalized.vatRateId,
        initialCost: row.normalized.cost,
        stock: 0,
        minStock: row.normalized.minStock,
        sellByFraction: false,
        tracksStock: row.normalized.tracksStock,
        tracksLots: row.normalized.tracksLots,
        tracksSerials: false,
        isActive: true,
        barcode: row.normalized.barcode,
        unitAssignments: row.normalized.unitId
          ? [
              {
                unitId: row.normalized.unitId,
                equivalence: 1,
                price: row.normalized.price,
                price2: 0,
                price3: 0,
                isBase: true,
              },
            ]
          : undefined,
      });

      const issues: ProductImportIssue[] = [];
      // Count only durable opening-ledger entries. A product with zero (or
      // unmapped) opening stock needs no inventory mutation and must not make
      // the completion report claim that stock was recorded.
      let stockInitialized = false;
      if (row.normalized.tracksStock && row.normalized.stock > 0) {
        const baseUnit = created.unitAssignments.find(assignment => assignment.isBase);
        if (!baseUnit) {
          issues.push({ code: 'stock_failed', field: 'stock' });
        } else {
          try {
            await recordInventoryEntry(ctx, {
              productId: created.id,
              unitId: baseUnit.unitId,
              mode: 'initial',
              quantity: row.normalized.stock,
              cost: row.normalized.cost,
              notes: `Launch import ${importId}`,
            });
            stockInitialized = true;
          } catch (error) {
            log.warn(
              {
                ...getSafeImportErrorMetadata(error),
                tenantId: ctx.tenantId,
                importId,
                rowNumber: row.rowNumber,
                productId: created.id,
              },
              'opening stock import failed'
            );
            issues.push({ code: 'stock_failed', field: 'stock' });
          }
        }
      }
      importedRows.push({
        rowNumber: row.rowNumber,
        productId: created.id,
        stockInitialized,
        issues,
      });
    } catch (error) {
      if (isConflictError(error)) {
        skippedRows.push({
          rowNumber: row.rowNumber,
          issues: [{ code: 'concurrent_duplicate', field: 'sku' }],
        });
        continue;
      }
      log.error(
        {
          ...getSafeImportErrorMetadata(error),
          tenantId: ctx.tenantId,
          importId,
          rowNumber: row.rowNumber,
        },
        'product import row failed'
      );
      failedRows.push({
        rowNumber: row.rowNumber,
        issues: [{ code: 'import_failed', field: 'sku' }],
      });
    }
  }

  const completedAt = new Date().toISOString();
  const skipped = skippedRows.length;
  const warnings = importedRows.reduce((count, row) => count + row.issues.length, 0);
  ctx.db.transaction(tx => {
    writeAuditLog({
      tx,
      tenantId: ctx.tenantId,
      actorId: ctx.user.id,
      action: 'data_import.products',
      resourceType: 'data_import',
      resourceId: importId,
      after: {
        imported: importedRows.length,
        stockInitialized: importedRows.filter(row => row.stockInitialized).length,
        skipped,
        invalid: preview.summary.invalid,
        failed: failedRows.length,
      },
      metadata: {
        dataMode: input.dataMode,
        sourceFormat: getImportSourceFormat(input.sourceName),
        previewHash: input.previewHash,
        totalRows: preview.summary.total,
        warnings,
      },
    });
  });

  return {
    dataMode: input.dataMode,
    importId,
    completedAt,
    summary: {
      total: preview.summary.total,
      imported: importedRows.length,
      stockInitialized: importedRows.filter(row => row.stockInitialized).length,
      skipped,
      invalid: preview.summary.invalid,
      failed: failedRows.length,
      warnings,
    },
    importedRows,
    skippedRows,
    failedRows,
  };
}
