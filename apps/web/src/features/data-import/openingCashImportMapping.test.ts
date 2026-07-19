import { describe, expect, it } from 'vitest';

import type { ParsedImportFile } from './fileParser';
import {
  autoMapOpeningCashHeaders,
  hasRequiredOpeningCashMapping,
  mapOpeningCashImportRows,
} from './openingCashImportMapping';

describe('openingCashImportMapping', () => {
  it('auto-maps English and accent-insensitive Spanish headers', () => {
    expect(
      autoMapOpeningCashHeaders(['Nombre de sede', 'Caja', 'Base de apertura', 'Denominaciones'])
    ).toEqual({
      siteName: 'Nombre de sede',
      registerName: 'Caja',
      openingFloat: 'Base de apertura',
      denominations: 'Denominaciones',
    });
  });

  it('maps selected columns and requires every reconciled-cash field', () => {
    const file: ParsedImportFile = {
      sourceName: 'cash.csv',
      headers: ['Site', 'Register', 'Opening cash', 'Cash breakdown'],
      rows: [
        {
          rowNumber: 2,
          values: {
            Site: 'North',
            Register: 'Front',
            'Opening cash': '120',
            'Cash breakdown': '50:2;20:1',
          },
        },
      ],
    };
    const mapping = autoMapOpeningCashHeaders(file.headers);
    expect(hasRequiredOpeningCashMapping(mapping)).toBe(true);
    expect(mapOpeningCashImportRows(file, mapping)).toEqual([
      {
        rowNumber: 2,
        values: {
          siteName: 'North',
          registerName: 'Front',
          openingFloat: '120',
          denominations: '50:2;20:1',
        },
      },
    ]);
    expect(hasRequiredOpeningCashMapping({ ...mapping, denominations: '' })).toBe(false);
  });
});
