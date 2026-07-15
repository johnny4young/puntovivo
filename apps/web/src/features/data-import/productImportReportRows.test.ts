import { describe, expect, it } from 'vitest';

import { buildProductImportReportRows } from './productImportReportRows';
import type { ProductImportPreview, ProductImportReport } from './types';

describe('ENG-123a product import report rows', () => {
  it('preserves imported, skipped, invalid, failed, and warning rows', () => {
    const normalized = {
      name: 'Product',
      sku: 'SKU',
      description: null,
      barcode: null,
      price: 1,
      cost: 1,
      stock: 1,
      minStock: 0,
      taxRate: 0,
    };
    const preview = {
      previewHash: 'hash',
      summary: { total: 5, ready: 3, duplicates: 1, invalid: 1 },
      rows: [
        { rowNumber: 2, status: 'ready', normalized: { ...normalized, sku: 'OK' }, issues: [] },
        { rowNumber: 3, status: 'ready', normalized: { ...normalized, sku: 'WARN' }, issues: [] },
        {
          rowNumber: 4,
          status: 'duplicate',
          normalized: { ...normalized, sku: 'DUP' },
          issues: [{ code: 'duplicate_existing_sku', field: 'sku' }],
        },
        {
          rowNumber: 5,
          status: 'invalid',
          normalized: { ...normalized, sku: '' },
          issues: [{ code: 'required', field: 'sku' }],
        },
        { rowNumber: 6, status: 'ready', normalized: { ...normalized, sku: 'FAIL' }, issues: [] },
      ],
    } satisfies ProductImportPreview;
    const report = {
      importId: 'import-1',
      completedAt: '2026-07-15T12:00:00.000Z',
      summary: {
        total: 5,
        imported: 2,
        stockInitialized: 1,
        skipped: 1,
        invalid: 1,
        failed: 1,
        warnings: 1,
      },
      importedRows: [
        { rowNumber: 2, productId: 'p-ok', stockInitialized: true, issues: [] },
        {
          rowNumber: 3,
          productId: 'p-warning',
          stockInitialized: false,
          issues: [{ code: 'stock_failed', field: 'stock' }],
        },
      ],
      skippedRows: [
        {
          rowNumber: 4,
          issues: [{ code: 'duplicate_existing_sku', field: 'sku' }],
        },
      ],
      failedRows: [{ rowNumber: 6, issues: [{ code: 'import_failed', field: 'sku' }] }],
    } satisfies ProductImportReport;

    expect(buildProductImportReportRows(preview, report)).toEqual([
      {
        rowNumber: 2,
        status: 'imported',
        sku: 'OK',
        productId: 'p-ok',
        stockInitialized: true,
        issue: null,
      },
      expect.objectContaining({ rowNumber: 3, status: 'importedWithWarnings' }),
      expect.objectContaining({ rowNumber: 4, status: 'skipped' }),
      expect.objectContaining({ rowNumber: 5, status: 'invalid' }),
      expect.objectContaining({ rowNumber: 6, status: 'failed' }),
    ]);
  });
});
