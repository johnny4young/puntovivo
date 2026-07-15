import { describe, expect, it } from 'vitest';

import { buildPartyImportReportRows } from './partyImportReportRows';
import type { CustomerImportPreview, CustomerImportReport } from './types';

function customerRow(
  rowNumber: number,
  status: CustomerImportPreview['rows'][number]['status'],
  issues: CustomerImportPreview['rows'][number]['issues'] = []
): CustomerImportPreview['rows'][number] {
  return {
    rowNumber,
    status,
    normalized: {
      name: `Customer ${rowNumber}`,
      taxId: `TAX-${rowNumber}`,
      email: `customer-${rowNumber}@example.com`,
      phone: null,
      address: null,
      city: null,
      state: null,
      postalCode: null,
      country: null,
      notes: null,
    },
    issues,
  };
}

describe('buildPartyImportReportRows', () => {
  it('keeps every source row and expands multiple row issues in the final report', () => {
    const preview: CustomerImportPreview = {
      previewHash: 'preview-hash',
      summary: { total: 4, ready: 2, duplicates: 1, invalid: 1 },
      rows: [
        customerRow(2, 'ready'),
        customerRow(3, 'duplicate', [{ code: 'duplicate_file_tax_id', field: 'taxId' }]),
        customerRow(4, 'invalid', [
          { code: 'required', field: 'name' },
          { code: 'invalid_email', field: 'email' },
        ]),
        customerRow(5, 'ready'),
      ],
    };
    const report: CustomerImportReport = {
      importId: 'import-1',
      completedAt: '2026-07-15T15:00:00.000Z',
      summary: { total: 4, imported: 1, skipped: 1, invalid: 1, failed: 1, warnings: 0 },
      importedRows: [{ rowNumber: 2, recordId: 'customer-2', issues: [] }],
      skippedRows: [
        {
          rowNumber: 3,
          issues: [{ code: 'duplicate_file_tax_id', field: 'taxId' }],
        },
      ],
      failedRows: [
        {
          rowNumber: 5,
          issues: [{ code: 'import_failed', field: 'name' }],
        },
      ],
    };

    expect(buildPartyImportReportRows(preview, report)).toEqual([
      expect.objectContaining({ rowNumber: 2, status: 'imported', recordId: 'customer-2' }),
      expect.objectContaining({
        rowNumber: 3,
        status: 'skipped',
        issue: { code: 'duplicate_file_tax_id', field: 'taxId' },
      }),
      expect.objectContaining({
        rowNumber: 4,
        status: 'invalid',
        issue: { code: 'required', field: 'name' },
      }),
      expect.objectContaining({
        rowNumber: 4,
        status: 'invalid',
        issue: { code: 'invalid_email', field: 'email' },
      }),
      expect.objectContaining({
        rowNumber: 5,
        status: 'failed',
        issue: { code: 'import_failed', field: 'name' },
      }),
    ]);
  });
});
