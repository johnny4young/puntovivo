import { describe, expect, it } from 'vitest';

import { buildOpeningCashImportReportRows } from './openingCashImportReportRows';
import type { OpeningCashImportPreview, OpeningCashImportReport } from './types';

describe('buildOpeningCashImportReportRows', () => {
  it('keeps imported, skipped, invalid, and failed source rows in the report', () => {
    const preview = {
      dataMode: 'real',
      previewHash: 'a'.repeat(64),
      summary: { total: 4, ready: 3, duplicates: 1, invalid: 0 },
      rows: [
        {
          rowNumber: 2,
          status: 'ready',
          normalized: {
            siteId: 'site-1',
            siteName: 'North',
            registerName: 'Front',
            openingFloat: 120,
            denominations: [
              { value: 50, count: 2 },
              { value: 20, count: 1 },
            ],
            operation: 'create',
          },
          issues: [],
        },
        {
          rowNumber: 3,
          status: 'duplicate',
          normalized: {
            siteId: 'site-1',
            siteName: 'North',
            registerName: 'Existing',
            openingFloat: 50,
            denominations: [{ value: 50, count: 1 }],
            operation: 'create',
          },
          issues: [{ code: 'duplicate_existing_register', field: 'registerName' }],
        },
        {
          rowNumber: 4,
          status: 'ready',
          normalized: {
            siteId: null,
            siteName: 'Unknown',
            registerName: 'Back',
            openingFloat: 20,
            denominations: [{ value: 20, count: 1 }],
            operation: 'create',
          },
          issues: [],
        },
        {
          rowNumber: 5,
          status: 'ready',
          normalized: {
            siteId: 'site-1',
            siteName: 'North',
            registerName: 'Late',
            openingFloat: 20,
            denominations: [{ value: 20, count: 1 }],
            operation: 'create',
          },
          issues: [],
        },
      ],
    } satisfies OpeningCashImportPreview;
    const report = {
      dataMode: 'real',
      importId: 'import-1',
      completedAt: '2026-07-15T00:00:00.000Z',
      summary: { total: 4, imported: 1, skipped: 1, invalid: 1, failed: 1, warnings: 0 },
      importedRows: [{ rowNumber: 2, templateId: 'template-1', issues: [] }],
      skippedRows: [
        {
          rowNumber: 3,
          issues: [{ code: 'duplicate_existing_register', field: 'registerName' }],
        },
      ],
      invalidRows: [{ rowNumber: 4, issues: [{ code: 'site_not_found', field: 'siteName' }] }],
      failedRows: [{ rowNumber: 5, issues: [{ code: 'active_register', field: 'registerName' }] }],
    } satisfies OpeningCashImportReport;

    expect(buildOpeningCashImportReportRows(preview, report)).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        status: 'imported',
        templateId: 'template-1',
        denominations: '50:2;20:1',
        issue: null,
      }),
      expect.objectContaining({ rowNumber: 3, status: 'skipped' }),
      expect.objectContaining({
        rowNumber: 4,
        status: 'invalid',
        issue: { code: 'site_not_found', field: 'siteName' },
      }),
      expect.objectContaining({ rowNumber: 5, status: 'failed' }),
    ]);
  });
});
