/**
 * ENG-123a — Server-authoritative product, price, and opening-stock import.
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
import { products } from '../../db/schema.js';
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

function canonicalImportPayload(input: PreviewLaunchProductImportInput) {
  return {
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

/**
 * Parse the two common spreadsheet number conventions without using the
 * process locale. Explicit modes are deterministic; auto treats the last of
 * comma/dot as the decimal separator and a plausible lone three-digit suffix
 * as a thousands group.
 */
function normalizeExplicitNumber(
  unsigned: string,
  decimalSeparator: '.' | ',',
  thousandsSeparator: '.' | ','
): string | null {
  const decimalParts = unsigned.split(decimalSeparator);
  if (decimalParts.length > 2) return null;
  const integerPart = decimalParts[0] ?? '';
  const fractionPart = decimalParts[1];
  const groups = integerPart.split(thousandsSeparator);
  if (
    groups.length > 1 &&
    (!/^[0-9]{1,3}$/.test(groups[0] ?? '') ||
      groups.slice(1).some(group => !/^[0-9]{3}$/.test(group)))
  ) {
    return null;
  }
  if (groups.length === 1 && !/^[0-9]+$/.test(integerPart)) return null;
  if (fractionPart !== undefined && !/^[0-9]+$/.test(fractionPart)) return null;
  return `${groups.join('')}${fractionPart === undefined ? '' : `.${fractionPart}`}`;
}

export function parseImportNumber(
  raw: string | undefined,
  decimalFormat: ImportDecimalFormat
): number | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return 0;
  // Accept common currency symbols, but never erase arbitrary characters.
  // Silently stripping letters/operators could turn values such as `abc12`
  // or `=1+1` into valid-looking prices.
  const spacedSource = trimmed.replace(/\u00a0/g, ' ');
  if (/[\t\r\n]/.test(spacedSource)) return null;
  const numericSource = spacedSource.replace(/[$€£¥₱₡₹-]/g, '').trim();
  if (
    numericSource.includes(' ') &&
    !/^[0-9]{1,3}(?: [0-9]{3})+(?:[.,][0-9]+)?$/.test(numericSource)
  ) {
    return null;
  }
  const compactSource = spacedSource.replace(/ /g, '');
  if ((compactSource.match(/[$€£¥₱₡₹]/g)?.length ?? 0) > 1) return null;
  if (!/^(?:(?:[$€£¥₱₡₹]-?)|(?:-?[$€£¥₱₡₹]?))[0-9][0-9.,]*(?:[$€£¥₱₡₹])?$/.test(compactSource)) {
    return null;
  }
  const compact = compactSource.replace(/[$€£¥₱₡₹]/g, '');
  if (!compact || !/^-?[0-9][0-9.,]*$/.test(compact)) return null;

  const sign = compact.startsWith('-') ? '-' : '';
  const unsigned = sign ? compact.slice(1) : compact;
  let normalizedUnsigned: string | null;

  if (decimalFormat === 'dot') {
    normalizedUnsigned = normalizeExplicitNumber(unsigned, '.', ',');
  } else if (decimalFormat === 'comma') {
    normalizedUnsigned = normalizeExplicitNumber(unsigned, ',', '.');
  } else {
    const lastComma = unsigned.lastIndexOf(',');
    const lastDot = unsigned.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      const decimalSeparator = lastComma > lastDot ? ',' : '.';
      normalizedUnsigned = normalizeExplicitNumber(
        unsigned,
        decimalSeparator,
        decimalSeparator === ',' ? '.' : ','
      );
    } else {
      const separator = lastComma >= 0 ? ',' : lastDot >= 0 ? '.' : null;
      if (!separator) {
        normalizedUnsigned = unsigned;
      } else {
        const pieces = unsigned.split(separator);
        const suffix = pieces.at(-1) ?? '';
        const validThousands =
          /^[0-9]{1,3}$/.test(pieces[0] ?? '') &&
          pieces.slice(1).every(group => /^[0-9]{3}$/.test(group));
        if (pieces.length > 2) {
          normalizedUnsigned = validThousands ? pieces.join('') : null;
        } else {
          normalizedUnsigned =
            suffix.length === 3 && validThousands
              ? pieces.join('')
              : /^[0-9]+$/.test(pieces[0] ?? '') && /^[0-9]+$/.test(suffix)
                ? `${pieces[0]}.${suffix}`
                : null;
        }
      }
    }
  }

  if (normalizedUnsigned === null) return null;
  const parsed = Number(`${sign}${normalizedUnsigned}`);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRow(
  row: LaunchProductImportRow,
  decimalFormat: ImportDecimalFormat
): { normalized: NormalizedLaunchProduct; issues: ProductImportIssue[] } {
  const name = row.values.name?.trim() ?? '';
  const sku = row.values.sku?.trim() ?? '';
  const description = row.values.description?.trim() || null;
  const barcode = row.values.barcode?.trim() || null;
  const issues: ProductImportIssue[] = [];

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

  return {
    normalized: {
      name,
      sku,
      description,
      barcode,
      price: values.price ?? 0,
      cost: values.cost ?? 0,
      stock: values.stock ?? 0,
      minStock: values.minStock ?? 0,
      taxRate: values.taxRate ?? 0,
    },
    issues,
  };
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
  const normalizedRows = input.rows.map(row => ({
    rowNumber: row.rowNumber,
    ...normalizeRow(row, input.decimalFormat),
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
        initialCost: row.normalized.cost,
        stock: 0,
        minStock: row.normalized.minStock,
        sellByFraction: false,
        isActive: true,
        barcode: row.normalized.barcode,
      });

      const issues: ProductImportIssue[] = [];
      // Count only durable opening-ledger entries. A product with zero (or
      // unmapped) opening stock needs no inventory mutation and must not make
      // the completion report claim that stock was recorded.
      let stockInitialized = false;
      if (row.normalized.stock > 0) {
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
              notes: `ENG-123a launch import ${importId}`,
            });
            stockInitialized = true;
          } catch (error) {
            log.warn(
              {
                err: error,
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
          err: error,
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
        sourceName: input.sourceName,
        previewHash: input.previewHash,
        totalRows: preview.summary.total,
        warnings,
      },
    });
  });

  return {
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
