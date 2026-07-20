import { describe, expect, it } from 'vitest';

import type { CustomerBalanceImportPreview, CustomerBalanceImportReport } from './types';
import { buildCustomerBalanceImportReportRows } from './customerBalanceImportReportRows';

describe(' customer balance report rows', () => {
  it('keeps imported, skipped, invalid, and failed source rows traceable', () => {
    const normalized = {
      customerId: 'customer-1',
      customerName: 'Customer One',
      taxId: '9001',
      email: 'one@example.com',
      openingBalance: 100,
      note: null,
    };
    const preview = {
      dataMode: 'real',
      previewHash: 'hash',
      summary: { total: 4, ready: 2, duplicates: 1, invalid: 1 },
      rows: [
        { rowNumber: 2, status: 'ready', normalized, issues: [] },
        {
          rowNumber: 3,
          status: 'duplicate',
          normalized,
          issues: [{ code: 'duplicate_existing_balance', field: 'openingBalance' }],
        },
        {
          rowNumber: 4,
          status: 'invalid',
          normalized: { ...normalized, customerId: null, customerName: null },
          issues: [{ code: 'customer_not_found', field: 'taxId' }],
        },
        { rowNumber: 5, status: 'ready', normalized, issues: [] },
      ],
    } as CustomerBalanceImportPreview;
    const report = {
      dataMode: 'real',
      importId: 'import-1',
      completedAt: '2026-07-15T12:00:00.000Z',
      summary: { total: 4, imported: 1, skipped: 1, invalid: 1, failed: 1, warnings: 0 },
      importedRows: [
        {
          rowNumber: 2,
          customerId: 'customer-1',
          adjustmentId: 'adjustment-1',
          amount: 100,
          issues: [],
        },
      ],
      skippedRows: [
        {
          rowNumber: 3,
          issues: [{ code: 'duplicate_existing_balance', field: 'openingBalance' }],
        },
      ],
      failedRows: [{ rowNumber: 5, issues: [{ code: 'import_failed', field: 'openingBalance' }] }],
    } as CustomerBalanceImportReport;

    expect(buildCustomerBalanceImportReportRows(preview, report)).toEqual([
      expect.objectContaining({ rowNumber: 2, status: 'imported', adjustmentId: 'adjustment-1' }),
      expect.objectContaining({ rowNumber: 3, status: 'skipped' }),
      expect.objectContaining({ rowNumber: 4, status: 'invalid' }),
      expect.objectContaining({ rowNumber: 5, status: 'failed' }),
    ]);
  });
});
