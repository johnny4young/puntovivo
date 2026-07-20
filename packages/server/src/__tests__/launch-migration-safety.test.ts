/** Explicit real/demo launch-import safety. */
import { describe, expect, it } from 'vitest';

import {
  assertRealDataCommit,
  getImportSourceFormat,
  getSafeImportErrorMetadata,
  hashLaunchProductImport,
} from '../application/launch-migration/index.js';
import { commitLaunchProductImportInput } from '../trpc/schemas/launchMigration.js';

const rows = [{ rowNumber: 2, values: { name: 'Fixture', sku: 'FIXTURE-123C' } }];

describe(' launch import safety', () => {
  it('binds the selected data mode into the preview hash', () => {
    const realHash = hashLaunchProductImport({
      dataMode: 'real',
      decimalFormat: 'auto',
      sourceName: 'fixture.csv',
      rows,
    });
    const demoHash = hashLaunchProductImport({
      dataMode: 'demo',
      decimalFormat: 'auto',
      sourceName: 'fixture.csv',
      rows,
    });

    expect(demoHash).not.toBe(realHash);
  });

  it('rejects demo and unconfirmed commit envelopes at both safety boundaries', () => {
    expect(
      commitLaunchProductImportInput.safeParse({
        confirmedRealData: true,
        dataMode: 'demo',
        decimalFormat: 'auto',
        previewHash: '0'.repeat(64),
        sourceName: 'fixture.csv',
        rows,
      }).success
    ).toBe(false);
    expect(
      commitLaunchProductImportInput.safeParse({
        dataMode: 'real',
        decimalFormat: 'auto',
        previewHash: '0'.repeat(64),
        sourceName: 'real.csv',
        rows,
      }).success
    ).toBe(false);
    expect(() => assertRealDataCommit({ dataMode: 'demo', confirmedRealData: true })).toThrow(
      'Demo imports are preview-only'
    );
    expect(() => assertRealDataCommit({ dataMode: 'real', confirmedRealData: false })).toThrow(
      'Confirm real data'
    );
    expect(() => assertRealDataCommit({ dataMode: 'real', confirmedRealData: true })).not.toThrow();
  });

  it('keeps filenames and error values out of reusable audit metadata', () => {
    expect(getImportSourceFormat('Merchant Name.XLSX')).toBe('xlsx');
    expect(getImportSourceFormat('unknown.txt')).toBe('unknown');
    expect(
      getSafeImportErrorMetadata(
        Object.assign(new Error('query params: Fixture Product'), { code: 'SQLITE_IOERR' })
      )
    ).toEqual({ errorCode: 'SQLITE_IOERR', errorType: 'Error' });
    const unsafe = Object.assign(new Error('hidden row'), {
      code: 'CUSTOMER-customer@example.com',
      name: 'Customer@example.com',
    });
    expect(getSafeImportErrorMetadata(unsafe)).toEqual({ errorType: 'Error' });
  });
});
