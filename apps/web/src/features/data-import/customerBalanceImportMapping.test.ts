import { describe, expect, it } from 'vitest';

import {
  autoMapCustomerBalanceHeaders,
  hasRequiredCustomerBalanceMapping,
  mapCustomerBalanceImportRows,
} from './customerBalanceImportMapping';

describe(' customer balance import mapping', () => {
  it.each([
    ['English', ['Tax ID', 'Email', 'Opening balance', 'Note']],
    ['Spanish', ['Identificación tributaria', 'Correo electrónico', 'Cartera inicial', 'Nota']],
  ])('round-trips the %s template headers', (_, headers) => {
    expect(autoMapCustomerBalanceHeaders(headers)).toEqual({
      taxId: headers[0],
      email: headers[1],
      openingBalance: headers[2],
      note: headers[3],
    });
  });

  it('requires an amount plus one identity and excludes unmapped columns', () => {
    const file = {
      sourceName: 'balances.csv',
      headers: ['NIT', 'Saldo por cobrar', 'Private'],
      rows: [
        {
          rowNumber: 7,
          values: { NIT: '9001', 'Saldo por cobrar': '1.234,50', Private: 'ignore' },
        },
      ],
    };
    const mapping = autoMapCustomerBalanceHeaders(file.headers);
    expect(hasRequiredCustomerBalanceMapping(mapping)).toBe(true);
    expect(mapCustomerBalanceImportRows(file, mapping)).toEqual([
      { rowNumber: 7, values: { taxId: '9001', openingBalance: '1.234,50' } },
    ]);
    expect(
      hasRequiredCustomerBalanceMapping({
        taxId: '',
        email: '',
        openingBalance: 'Saldo por cobrar',
        note: '',
      })
    ).toBe(false);
  });
});
