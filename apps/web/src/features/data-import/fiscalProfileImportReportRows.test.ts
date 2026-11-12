import { describe, expect, it } from 'vitest';

import { buildFiscalProfileImportReportRows } from './fiscalProfileImportReportRows';

describe(' fiscal profile report rows', () => {
  it('prefers commit-time row classifications over stale preview state', () => {
    const preview = {
      dataMode: 'real' as const,
      activationRequired: true as const,
      tenantCountryCode: 'CO' as const,
      previewHash: 'hash',
      summary: { total: 1, ready: 1, duplicates: 0, invalid: 0 },
      rows: [
        {
          rowNumber: 2,
          status: 'ready' as const,
          normalized: {
            countryCode: 'CO' as const,
            taxIdentifier: '900123456-8',
            economicActivityCode: null,
            issueLocation: null,
            administrativeAreaCode: null,
            environment: 'habilitacion',
            numbering: null,
            activationRequired: true as const,
          },
          issues: [],
        },
      ],
    };
    const report = {
      importId: 'import-1',
      dataMode: 'real' as const,
      completedAt: '2026-07-15T17:00:00.000Z',
      activationRequired: true as const,
      summary: { total: 1, imported: 0, skipped: 0, invalid: 1, failed: 0, warnings: 0 },
      importedRows: [],
      skippedRows: [],
      invalidRows: [
        {
          rowNumber: 2,
          issues: [
            {
              code: 'existing_profile_conflict' as const,
              field: 'taxIdentifier' as const,
            },
          ],
        },
      ],
      failedRows: [],
    };

    expect(buildFiscalProfileImportReportRows(preview, report)).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        status: 'invalid',
        issue: { code: 'existing_profile_conflict', field: 'taxIdentifier' },
      }),
    ]);
  });
});
